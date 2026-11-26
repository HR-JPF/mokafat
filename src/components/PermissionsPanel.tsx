import React, { useMemo, useState } from 'react';
import {
  Check,
  Edit3,
  KeyRound,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import {
  ALL_PERMISSION_KEYS,
  countEnabledPermissions,
  PERMISSION_META,
  ROLE_LABELS,
  ROLE_PRESETS,
} from '../lib/authPermissions';
import type { AppUserAccount, PermissionKey, UserPermissions, UserRole } from '../types';

interface PermissionsPanelProps {
  users: AppUserAccount[];
  currentUserId: string;
  isDemoMode: boolean;
  onCreateUser: (payload: {
    username: string;
    password: string;
    displayName: string;
    role: UserRole;
    permissions: UserPermissions;
    active: boolean;
  }) => Promise<void>;
  onUpdateUser: (
    userId: string,
    payload: {
      username: string;
      displayName: string;
      role: UserRole;
      permissions: UserPermissions;
      active: boolean;
    }
  ) => Promise<void>;
  onChangePassword: (userId: string, newPassword: string) => Promise<void>;
  onDeleteUser: (userId: string) => Promise<void>;
}

export function PermissionsPanel({
  users,
  currentUserId,
  isDemoMode,
  onCreateUser,
  onUpdateUser,
  onChangePassword,
  onDeleteUser,
}: PermissionsPanelProps) {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');

  // Create / Edit User Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUserAccount | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('supervisor');
  const [permissions, setPermissions] = useState<UserPermissions>({
    ...ROLE_PRESETS.supervisor,
  });
  const [active, setActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset Password Modal State
  const [pwTarget, setPwTarget] = useState<AppUserAccount | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  const metrics = useMemo(() => {
    const total = users.length;
    const activeCount = users.filter((u) => u.active).length;
    const admins = users.filter((u) => u.role === 'super_admin' && u.active).length;
    const suspended = users.filter((u) => !u.active).length;
    return { total, activeCount, admins, suspended };
  }, [users]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        ROLE_LABELS[u.role].toLowerCase().includes(q)
      );
    });
  }, [users, search, roleFilter]);

  const openCreateModal = () => {
    setEditingUser(null);
    setUsername('');
    setDisplayName('');
    setPassword('');
    setRole('supervisor');
    setPermissions({ ...ROLE_PRESETS.supervisor });
    setActive(true);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (u: AppUserAccount) => {
    setEditingUser(u);
    setUsername(u.username);
    setDisplayName(u.displayName);
    setPassword('');
    setRole(u.role);
    setPermissions({ ...u.permissions });
    setActive(u.active);
    setFormError(null);
    setModalOpen(true);
  };

  const handleRolePresetChange = (nextRole: UserRole) => {
    setRole(nextRole);
    setPermissions({ ...ROLE_PRESETS[nextRole] });
  };

  const togglePermission = (key: PermissionKey) => {
    if (role === 'super_admin') return; // Super admin always keeps full permissions
    setPermissions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!username.trim()) {
      setFormError('اسم المستخدم مطلوب.');
      return;
    }
    if (!editingUser && !password) {
      setFormError('يرجى إدخال الرقم السري للمستخدم الجديد.');
      return;
    }

    setSaving(true);
    try {
      const effectivePerms =
        role === 'super_admin' ? { ...ROLE_PRESETS.super_admin } : permissions;

      if (editingUser) {
        await onUpdateUser(editingUser.id, {
          username: username.trim(),
          displayName: displayName.trim() || username.trim(),
          role,
          permissions: effectivePerms,
          active,
        });
      } else {
        await onCreateUser({
          username: username.trim(),
          password,
          displayName: displayName.trim() || username.trim(),
          role,
          permissions: effectivePerms,
          active,
        });
      }
      setModalOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'تعذر حفظ بيانات المستخدم.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActiveQuick = async (u: AppUserAccount) => {
    try {
      await onUpdateUser(u.id, {
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        permissions: u.permissions,
        active: !u.active,
      });
    } catch {
      // Toast error handled by parent
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwTarget) return;
    setPwError(null);
    if (!newPassword) {
      setPwError('يرجى إدخال الرقم السري الجديد.');
      return;
    }
    setPwSaving(true);
    try {
      await onChangePassword(pwTarget.id, newPassword);
      setPwTarget(null);
      setNewPassword('');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'تعذر تغيير الرقم السري.');
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold font-display text-slate-900">
            لوحة التحكم بالصلاحيات والمستخدمين
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            أنشئ حسابات باسم مستخدم ورقم سري بدون قيود، وحدد صلاحيات كل مستخدم بدقة داخل النظام
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة مستخدم جديد</span>
        </button>
      </div>

      {isDemoMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 leading-relaxed">
          أنت في وضع المعاينة المحلية. لتفعيل الحسابات والصلاحيات بشكل دائم على الخادم، سجّل الخروج وأنشئ حساب المدير الأول باسم المستخدم والرقم السري من شاشة الدخول.
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 bg-white border border-slate-200 rounded-xl divide-y md:divide-y-0 md:divide-x md:divide-x-reverse divide-slate-200">
        <div className="p-4">
          <div className="text-xs text-slate-500">إجمالي المستخدمين</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {metrics.total}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">حسابات مسجلة في النظام</div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">حسابات نشطة</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
            {metrics.activeCount}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">يحق لها تسجيل الدخول</div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">مدراء النظام</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-teal-700 mt-1">
            {metrics.admins}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">صلاحيات كاملة (8 / 8)</div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">حسابات موقوفة</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-red-700 mt-1">
            {metrics.suspended}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">ممنوعة من الدخول فوراً</div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(
            [
              ['all', 'الكل'],
              ['super_admin', ROLE_LABELS.super_admin],
              ['hr_manager', ROLE_LABELS.hr_manager],
              ['supervisor', ROLE_LABELS.supervisor],
              ['viewer', ROLE_LABELS.viewer],
            ] as Array<['all' | UserRole, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setRoleFilter(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                roleFilter === key
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم المستخدم أو الاسم..."
            className="w-full pr-9 pl-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
          />
        </div>
      </div>

      {/* Users & Permissions Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">المستخدم</th>
                <th className="py-3 px-4">الدور الوظيفي</th>
                <th className="py-3 px-4">الصلاحيات الممنوحة</th>
                <th className="py-3 px-4">الحالة</th>
                <th className="py-3 px-4 text-left">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-500">
                    لا توجد حسابات مطابقة للبحث. اضغط «إضافة مستخدم جديد» لإنشاء حساب وتعيين صلاحياته.
                  </td>
                </tr>
              ) : (
                filtered.map((u) => {
                  const enabledCount = countEnabledPermissions(u.permissions);
                  const enabledLabels = ALL_PERMISSION_KEYS.filter((k) => u.permissions[k]).map(
                    (k) => PERMISSION_META[k].label
                  );
                  const isSelf = u.id === currentUserId;

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">{u.displayName}</span>
                          {isSelf && (
                            <span className="text-[11px] font-medium px-2 py-0.5 bg-teal-50 text-teal-800 border border-teal-200 rounded">
                              حسابك الحالي
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-mono text-slate-500 mt-0.5" dir="ltr">
                          @{u.username}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                            u.role === 'super_admin'
                              ? 'text-teal-800'
                              : u.role === 'hr_manager'
                              ? 'text-slate-800'
                              : 'text-slate-600'
                          }`}
                        >
                          {u.role === 'super_admin' ? (
                            <ShieldCheck className="w-4 h-4 text-teal-700" />
                          ) : (
                            <Shield className="w-4 h-4 text-slate-400" />
                          )}
                          <span>{ROLE_LABELS[u.role]}</span>
                        </span>
                      </td>

                      <td className="py-3.5 px-4 max-w-md">
                        <div className="text-xs font-medium text-slate-700">
                          <span className="font-mono tabular-nums text-teal-700 font-semibold">
                            {enabledCount}/{ALL_PERMISSION_KEYS.length}
                          </span>{' '}
                          صلاحيات مفعّلة
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate" title={enabledLabels.join('، ')}>
                          {enabledLabels.length > 0
                            ? enabledLabels.slice(0, 4).join(' · ') +
                              (enabledLabels.length > 4 ? ` +${enabledLabels.length - 4}` : '')
                            : 'بدون صلاحيات'}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleToggleActiveQuick(u)}
                          disabled={isSelf && u.active}
                          title={u.active ? 'إيقاف الحساب' : 'تفعيل الحساب'}
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                            u.active ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {u.active ? (
                            <>
                              <UserCheck className="w-4 h-4" />
                              <span>نشط</span>
                            </>
                          ) : (
                            <>
                              <UserX className="w-4 h-4" />
                              <span>موقوف</span>
                            </>
                          )}
                        </button>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(u)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-teal-700" />
                            <span>الصلاحيات</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setPwTarget(u);
                              setNewPassword('');
                              setPwError(null);
                            }}
                            aria-label={`تغيير الرقم السري للمستخدم ${u.displayName}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                          >
                            <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                            <span>الرقم السري</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onDeleteUser(u.id)}
                            disabled={isSelf}
                            aria-label={`حذف المستخدم ${u.displayName}`}
                            className="p-1.5 text-slate-500 hover:text-red-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit User & Granular Permissions Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingUser ? 'تعديل المستخدم والصلاحيات' : 'إضافة مستخدم جديد'}
          className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-bold font-display text-slate-900">
                {editingUser ? `تعديل صلاحيات: ${editingUser.displayName}` : 'إضافة مستخدم جديد'}
              </h2>
              <button
                type="button"
                aria-label="إغلاق النافذة"
                onClick={() => setModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-6 overflow-y-auto space-y-5 flex-1">
              {formError && (
                <div
                  role="alert"
                  className="p-3 text-xs bg-red-50 border border-red-200 text-red-800 rounded-lg"
                >
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="rbac-username" className="block text-xs font-semibold text-slate-700 mb-1">
                    اسم المستخدم *
                  </label>
                  <input
                    id="rbac-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="مثال: khaled أو hr1"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                  />
                </div>

                <div>
                  <label htmlFor="rbac-display" className="block text-xs font-semibold text-slate-700 mb-1">
                    الاسم الكامل / الظاهر
                  </label>
                  <input
                    id="rbac-display"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="مثال: خالد المشرف"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                  />
                </div>

                {!editingUser && (
                  <div className="sm:col-span-2">
                    <label htmlFor="rbac-password" className="block text-xs font-semibold text-slate-700 mb-1">
                      الرقم السري / كلمة المرور (بدون قيود) *
                    </label>
                    <input
                      id="rbac-password"
                      type="text"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="مثال: 1234 أو أي رقم سري تختاره"
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                    />
                  </div>
                )}
              </div>

              {/* Role Preset Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  قالب الدور الوظيفي (يضبط الصلاحيات تلقائياً ويمكنك تخصيصها بالأسفل)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['super_admin', 'hr_manager', 'supervisor', 'viewer'] as UserRole[]).map(
                    (r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => handleRolePresetChange(r)}
                        className={`px-3 py-2 text-xs font-semibold rounded-lg border text-center transition-colors cursor-pointer ${
                          role === r
                            ? 'bg-teal-50 border-teal-700 text-teal-900'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {ROLE_LABELS[r]}
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Granular 8-Permission Matrix */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-700">
                    الصلاحيات التفصيلية ({countEnabledPermissions(permissions)} من{' '}
                    {ALL_PERMISSION_KEYS.length})
                  </span>
                  {role === 'super_admin' && (
                    <span className="text-[11px] text-teal-700 font-medium">
                      مدير النظام يمتلك كافة الصلاحيات تلقائياً
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {ALL_PERMISSION_KEYS.map((key) => {
                    const checked = role === 'super_admin' ? true : permissions[key];
                    const meta = PERMISSION_META[key];
                    return (
                      <label
                        key={key}
                        className={`p-3 rounded-lg border flex items-start gap-2.5 transition-colors ${
                          role === 'super_admin'
                            ? 'bg-teal-50/40 border-teal-200 cursor-not-allowed'
                            : checked
                            ? 'bg-teal-50/40 border-teal-300 cursor-pointer'
                            : 'bg-white border-slate-200 hover:bg-slate-50 cursor-pointer'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={role === 'super_admin'}
                          onChange={() => togglePermission(key)}
                          className="mt-0.5 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900">{meta.label}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                            {meta.description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span>الحساب نشط ويُسمح له بتسجيل الدخول</span>
              </label>

              <div className="pt-4 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>{saving ? 'جارٍ الحفظ...' : editingUser ? 'حفظ الصلاحيات' : 'إنشاء المستخدم'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {pwTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="تغيير الرقم السري"
          className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <h2 className="text-base font-bold font-display text-slate-900">
                تغيير الرقم السري: {pwTarget.displayName}
              </h2>
              <button
                type="button"
                aria-label="إغلاق"
                onClick={() => setPwTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePassword} className="space-y-4 pt-4">
              {pwError && (
                <div role="alert" className="p-3 text-xs bg-red-50 border border-red-200 text-red-800 rounded-lg">
                  {pwError}
                </div>
              )}

              <div>
                <label htmlFor="rbac-new-pw" className="block text-xs font-semibold text-slate-700 mb-1">
                  الرقم السري الجديد (بدون قيود) *
                </label>
                <input
                  id="rbac-new-pw"
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="أدخل الرقم السري الجديد"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPwTarget(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={pwSaving}
                  className="px-5 py-2 text-sm font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                >
                  {pwSaving ? 'جارٍ التحديث...' : 'حفظ الرقم السري'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
