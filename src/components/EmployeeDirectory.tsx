import React, { useMemo, useRef, useState } from 'react';
import { Download, Edit3, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  findMatchingDirectoryEmployee,
  normalizeCodeKey,
  sanitizeCode,
  toAsciiDigits,
} from '../lib/attendanceEngine';
import type { Employee } from '../types';

interface EmployeeDirectoryProps {
  employees: Employee[];
  initialDraftCode?: { empCode: string; name: string } | null;
  onClearInitialDraft: () => void;
  onSaveEmployee: (
    emp: Omit<Employee, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
    existingId?: string
  ) => Promise<void>;
  onDeleteEmployee: (id: string) => Promise<void>;
  onBulkImportEmployees: (
    list: Array<Omit<Employee, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>>
  ) => Promise<void>;
}

export function EmployeeDirectory({
  employees,
  initialDraftCode,
  onClearInitialDraft,
  onSaveEmployee,
  onDeleteEmployee,
  onBulkImportEmployees,
}: EmployeeDirectoryProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const matchedInitial = initialDraftCode
    ? findMatchingDirectoryEmployee(initialDraftCode.empCode, initialDraftCode.name, employees)
    : undefined;
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(Boolean(initialDraftCode));
  const [editingId, setEditingId] = useState<string | undefined>(matchedInitial?.id);
  const [empCode, setEmpCode] = useState(
    initialDraftCode?.empCode || matchedInitial?.empCode || ''
  );
  const [name, setName] = useState(matchedInitial?.name || initialDraftCode?.name || '');
  const [department, setDepartment] = useState(matchedInitial?.department || '');
  const [phone, setPhone] = useState(matchedInitial?.phone || '');
  const [email, setEmail] = useState(matchedInitial?.email || '');
  const [active, setActive] = useState(matchedInitial ? matchedInitial.active : true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.empCode.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q) ||
        e.phone.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q)
    );
  }, [employees, search]);

  const openAdd = () => {
    setEditingId(undefined);
    setEmpCode('');
    setName('');
    setDepartment('');
    setPhone('');
    setEmail('');
    setActive(true);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (emp: Employee) => {
    setEditingId(emp.id);
    setEmpCode(emp.empCode);
    setName(emp.name);
    setDepartment(emp.department);
    setPhone(emp.phone);
    setEmail(emp.email);
    setActive(emp.active);
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    onClearInitialDraft();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = sanitizeCode(empCode);
    const cleanName = name.trim();
    if (!cleanCode) {
      setFormError('الرقم الوظيفي (رقم جهاز البصمة) مطلوب ويجب أن يحتوي على أرقام أو حروف إنجليزية.');
      return;
    }
    if (!cleanName) {
      setFormError('اسم الموظف مطلوب.');
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFormError('صيغة البريد الإلكتروني غير صحيحة.');
      return;
    }
    const duplicate = employees.find(
      (x) => normalizeCodeKey(x.empCode) === normalizeCodeKey(cleanCode) && x.id !== editingId
    );
    if (duplicate) {
      setFormError(`الرقم الوظيفي (${cleanCode}) مسجل مسبقاً للموظف ${duplicate.name}.`);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await onSaveEmployee(
        {
          empCode: cleanCode,
          name: cleanName,
          department: department.trim() || 'عام',
          phone: toAsciiDigits(phone).trim(),
          email: email.trim(),
          active,
        },
        editingId
      );
      closeModal();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'تعذر حفظ بيانات الموظف.');
    } finally {
      setSaving(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const parsed: Array<Omit<Employee, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>> = [];

      for (const r of rows) {
        const getVal = (keys: string[]) => {
          for (const [k, v] of Object.entries(r)) {
            const lk = k.trim().toLowerCase();
            if (keys.some((cand) => lk === cand || lk.includes(cand)) && v != null) {
              return String(v).trim();
            }
          }
          return '';
        };
        const code = sanitizeCode(getVal(['empcode', 'employee id', 'pin', 'id', 'الرقم الوظيفي', 'رقم الموظف']));
        const empName = getVal(['name', 'first name', 'الاسم', 'اسم الموظف']);
        if (!code || !empName) continue;
        parsed.push({
          empCode: code,
          name: empName,
          department: getVal(['department', 'dept', 'القسم', 'الإدارة']) || 'عام',
          phone: toAsciiDigits(
            getVal(['phone', 'mobile', 'whatsapp', 'tel', 'الجوال', 'جوال', 'واتساب', 'الهاتف', 'هاتف'])
          ),
          email: getVal(['email', 'البريد', 'الإيميل']),
          active: true,
        });
      }

      if (parsed.length > 0) {
        await onBulkImportEmployees(parsed);
      }
    } finally {
      e.target.value = '';
    }
  };

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    const ws = XLSX.utils.json_to_sheet([
      {
        'الرقم الوظيفي': '101',
        'اسم الموظف': 'سالم العتيبي',
        القسم: 'تقنية المعلومات',
        'رقم الواتساب': '966501112233',
        'البريد الإلكتروني': 'salem@company.sa',
      },
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'دليل الموظفين');
    XLSX.writeFile(wb, 'قالب-دليل-الموظفين.xlsx');
  };

  return (
    <div className="space-y-6">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleImportFile}
        className="hidden"
        aria-label="استيراد دليل الموظفين"
      />

      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold font-display text-slate-900">دليل الموظفين</h1>
          <p className="text-xs text-slate-500 mt-1">
            ربط الرقم الوظيفي في جهاز البصمة (ZKTeco PIN) بأرقام الواتساب والبريد الإلكتروني ({employees.length} موظف)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={downloadTemplate}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>قالب Excel</span>
          </button>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium bg-white text-slate-800 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            <Upload className="w-4 h-4 text-teal-700" />
            <span>استيراد Excel / CSV</span>
          </button>

          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة موظف</span>
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم، الرقم الوظيفي، القسم أو الجوال..."
            className="w-full pr-9 pl-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
          />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">الرقم الوظيفي (ZKTeco)</th>
                <th className="py-3 px-4">اسم الموظف</th>
                <th className="py-3 px-4">القسم</th>
                <th className="py-3 px-4">رقم الواتساب</th>
                <th className="py-3 px-4">البريد الإلكتروني</th>
                <th className="py-3 px-4">الحالة</th>
                <th className="py-3 px-4 text-left">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    لا يوجد موظفون مسجلون حالياً. أضف أول موظف أو استورد ملف Excel للبدء.
                  </td>
                </tr>
              ) : (
                filtered.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-mono tabular-nums text-xs font-semibold text-slate-700">
                      {emp.empCode}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900">{emp.name}</td>
                    <td className="py-3 px-4 text-slate-600">{emp.department}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700" dir="ltr">
                      {emp.phone || '—'}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600" dir="ltr">
                      {emp.email || '—'}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <span className={emp.active ? 'text-emerald-700 font-semibold' : 'text-slate-400'}>
                        {emp.active ? 'نشط' : 'موقوف'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(emp)}
                          aria-label={`تعديل ${emp.name}`}
                          className="p-1.5 text-slate-600 hover:text-teal-700 cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteEmployee(emp.id)}
                          aria-label={`حذف ${emp.name}`}
                          className="p-1.5 text-slate-500 hover:text-red-700 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Employee Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingId ? 'تعديل بيانات موظف' : 'إضافة موظف جديد'}
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <h2 className="text-base font-bold font-display text-slate-900">
                {editingId ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد'}
              </h2>
              <button
                type="button"
                aria-label="إغلاق النافذة"
                onClick={closeModal}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 pt-4">
              {formError && (
                <div role="alert" className="p-3 text-xs bg-red-50 border border-red-200 text-red-800 rounded-lg">
                  {formError}
                </div>
              )}

              <div>
                <label htmlFor="emp-code" className="block text-xs font-semibold text-slate-700 mb-1">
                  الرقم الوظيفي في جهاز ZKTeco *
                </label>
                <input
                  id="emp-code"
                  type="text"
                  value={empCode}
                  onChange={(e) => setEmpCode(e.target.value)}
                  placeholder="مثال: 109"
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                />
              </div>

              <div>
                <label htmlFor="emp-name" className="block text-xs font-semibold text-slate-700 mb-1">
                  الاسم الكامل *
                </label>
                <input
                  id="emp-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: محمد خالد الحارثي"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                />
              </div>

              <div>
                <label htmlFor="emp-dept" className="block text-xs font-semibold text-slate-700 mb-1">
                  القسم / الإدارة
                </label>
                <input
                  id="emp-dept"
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="مثال: العمليات والتشغيل"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                />
              </div>

              <div>
                <label htmlFor="emp-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                  رقم الواتساب (صيغة دولية مثل 9665XXXXXXXX)
                </label>
                <input
                  id="emp-phone"
                  type="tel"
                  dir="ltr"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="966501234567"
                  className="w-full px-3 py-2 text-sm font-mono text-left bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                />
              </div>

              <div>
                <label htmlFor="emp-email" className="block text-xs font-semibold text-slate-700 mb-1">
                  البريد الإلكتروني
                </label>
                <input
                  id="emp-email"
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="employee@company.sa"
                  className="w-full px-3 py-2 text-sm font-mono text-left bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                />
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span>موظف نشط ومشمول في التقييم الأسبوعي</span>
              </label>

              <div className="pt-4 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 text-sm font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                >
                  {saving ? 'جارٍ الحفظ...' : 'حفظ الموظف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
