import type { AppUserAccount, PermissionKey, UserPermissions, UserRole } from '../types.ts';

export const ALL_PERMISSION_KEYS: PermissionKey[] = [
  'uploadAttendance',
  'manageDecisions',
  'sendNotifications',
  'manageEmployees',
  'viewLogs',
  'exportReports',
  'manageSettings',
  'manageUsers',
];

export const PERMISSION_META: Record<
  PermissionKey,
  { label: string; description: string }
> = {
  uploadAttendance: {
    label: 'رفع ملفات البصمة',
    description: 'رفع ملفات ZKTeco / Excel وتحليل الأسابيع',
  },
  manageDecisions: {
    label: 'قرارات المدير والاستثناءات',
    description: 'اختيار القرارات الثلاثة لغير الملتزمين واستثناء الأيام',
  },
  sendNotifications: {
    label: 'إرسال الواتساب والبريد',
    description: 'إرسال الإشعارات عبر واتساب ويب و API والبريد الإلكتروني',
  },
  manageEmployees: {
    label: 'إدارة دليل الموظفين',
    description: 'إضافة وتعديل وحذف الموظفين وأرقام الواتساب والإيميلات',
  },
  viewLogs: {
    label: 'سجل الأحداث',
    description: 'مراجعة سجل الإرسال وحالة التسليم وإعادة المحاولة',
  },
  exportReports: {
    label: 'تصدير التقارير',
    description: 'استخراج تقارير Excel و PDF الأسبوعية',
  },
  manageSettings: {
    label: 'إعدادات النظام والربط',
    description: 'تعديل أوقات الدوام والقوالب وإعدادات الواتساب والبريد',
  },
  manageUsers: {
    label: 'لوحة التحكم بالصلاحيات',
    description: 'إنشاء المستخدمين وتعديل كلمات المرور والصلاحيات',
  },
};

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'مدير النظام',
  hr_manager: 'مدير موارد بشرية',
  supervisor: 'مشرف متابعة',
  viewer: 'مراقب (عرض فقط)',
};

export const ROLE_PRESETS: Record<UserRole, UserPermissions> = {
  super_admin: {
    uploadAttendance: true,
    manageDecisions: true,
    sendNotifications: true,
    manageEmployees: true,
    viewLogs: true,
    exportReports: true,
    manageSettings: true,
    manageUsers: true,
  },
  hr_manager: {
    uploadAttendance: true,
    manageDecisions: true,
    sendNotifications: true,
    manageEmployees: true,
    viewLogs: true,
    exportReports: true,
    manageSettings: true,
    manageUsers: false,
  },
  supervisor: {
    uploadAttendance: true,
    manageDecisions: true,
    sendNotifications: true,
    manageEmployees: false,
    viewLogs: true,
    exportReports: true,
    manageSettings: false,
    manageUsers: false,
  },
  viewer: {
    uploadAttendance: false,
    manageDecisions: false,
    sendNotifications: false,
    manageEmployees: false,
    viewLogs: true,
    exportReports: true,
    manageSettings: false,
    manageUsers: false,
  },
};

export function isValidRole(role: unknown): role is UserRole {
  return (
    role === 'super_admin' ||
    role === 'hr_manager' ||
    role === 'supervisor' ||
    role === 'viewer'
  );
}

/**
 * Strictly constructs a clean UserPermissions object from an untrusted partial payload,
 * falling back to the role preset and ignoring any unknown keys.
 */
export function normalizePermissions(
  raw: unknown,
  role: UserRole = 'viewer'
): UserPermissions {
  const base = { ...ROLE_PRESETS[role] };
  if (role === 'super_admin') {
    return { ...ROLE_PRESETS.super_admin };
  }
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  const obj = raw as Record<string, unknown>;
  for (const key of ALL_PERMISSION_KEYS) {
    if (typeof obj[key] === 'boolean') {
      base[key] = obj[key] as boolean;
    }
  }
  return base;
}

export function hasPermission(
  user: Pick<AppUserAccount, 'role' | 'permissions' | 'active'> | null | undefined,
  perm: PermissionKey
): boolean {
  if (!user || !user.active) return false;
  if (user.role === 'super_admin') return true;
  return Boolean(user.permissions?.[perm]);
}

export function countEnabledPermissions(permissions: UserPermissions): number {
  return ALL_PERMISSION_KEYS.filter((k) => permissions[k]).length;
}

/**
 * Guards against locking out the system by deleting, suspending, or demoting
 * the last active Super Admin account.
 */
export function validateAdminSafety(
  users: Array<Pick<AppUserAccount, 'id' | 'role' | 'active'>>,
  targetId: string,
  action: { type: 'delete' } | { type: 'update'; nextRole: UserRole; nextActive: boolean }
): { ok: boolean; error?: string } {
  const activeSuperAdmins = users.filter((u) => u.active && u.role === 'super_admin');
  const target = users.find((u) => u.id === targetId);
  if (!target) return { ok: false, error: 'المستخدم غير موجود.' };

  const targetIsActiveSuperAdmin = target.active && target.role === 'super_admin';
  if (!targetIsActiveSuperAdmin) return { ok: true };

  if (action.type === 'delete' && activeSuperAdmins.length <= 1) {
    return { ok: false, error: 'لا يمكن حذف آخر مدير نظام نشط في النظام.' };
  }

  if (
    action.type === 'update' &&
    (!action.nextActive || action.nextRole !== 'super_admin') &&
    activeSuperAdmins.length <= 1
  ) {
    return { ok: false, error: 'يجب بقاء مدير نظام واحد نشط على الأقل.' };
  }

  return { ok: true };
}
