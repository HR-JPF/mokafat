import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  MessageSquare,
  Search,
  Send,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import {
  groupEvaluationsByWorkflow,
  renderDecisionMessage,
} from '../lib/attendanceEngine';
import {
  DECISION_LABELS,
  type EmployeeEvaluation,
  type ManagerDecision,
  type UserPermissions,
  type UserSettings,
  type WeeklyBatch,
} from '../types';

interface EvaluationDashboardProps {
  batches: WeeklyBatch[];
  activeBatch: WeeklyBatch | null;
  onSelectBatch: (batchId: string) => void;
  evaluations: EmployeeEvaluation[];
  settings: UserSettings;
  uploading: boolean;
  exportingPdf: boolean;
  onUploadFile: (file: File) => void;
  onLoadDemoData: () => void;
  onDownloadSampleDat: () => void;
  onDecisionChange: (ev: EmployeeEvaluation, decision: ManagerDecision) => void;
  onBulkDecisionChange: (evalIds: string[], decision: ManagerDecision) => void;
  onToggleExcuseDay: (ev: EmployeeEvaluation, date: string) => void;
  onQuickAddEmployee: (empCode: string, defaultName: string) => void;
  onOpenDispatch: (preselectedIds?: string[]) => void;
  onExportExcel: () => void;
  onExportPdf: () => void;
  permissions?: UserPermissions;
}

type FilterMode =
  | 'all'
  | 'pending'
  | 'ready'
  | 'sent'
  | 'compliant'
  | 'allowed'
  | 'denied';

type WorkflowGroupKey = 'pending' | 'ready' | 'sent';

export function EvaluationDashboard({
  batches,
  activeBatch,
  onSelectBatch,
  evaluations,
  settings,
  uploading,
  exportingPdf,
  onUploadFile,
  onLoadDemoData,
  onDownloadSampleDat,
  onDecisionChange,
  onBulkDecisionChange,
  onToggleExcuseDay,
  onQuickAddEmployee,
  onOpenDispatch,
  onExportExcel,
  onExportPdf,
  permissions,
}: EvaluationDashboardProps) {
  const canUpload = permissions ? permissions.uploadAttendance : true;
  const canDecide = permissions ? permissions.manageDecisions : true;
  const canSend = permissions ? permissions.sendNotifications : true;
  const canExport = permissions ? permissions.exportReports : true;
  const canManageEmployees = permissions ? permissions.manageEmployees : true;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewEval, setPreviewEval] = useState<EmployeeEvaluation | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<WorkflowGroupKey, boolean>>({
    pending: false,
    ready: false,
    sent: false,
  });

  const metrics = useMemo(() => {
    const total = evaluations.length;
    const compliant = evaluations.filter((e) => e.isCompliant).length;
    const groupedAll = groupEvaluationsByWorkflow(evaluations);
    const pending = groupedAll.pending.length;
    const readyToSend = groupedAll.ready.length;
    const sent = groupedAll.sent.length;
    const allowed = evaluations.filter(
      (e) =>
        e.decision === 'reward' ||
        e.decision === 'allow_same' ||
        e.decision === 'allow_with_warning'
    ).length;
    const denied = evaluations.filter((e) => e.decision === 'deny_reward').length;
    const unmapped = evaluations.filter((e) => !e.phone && !e.email);
    return { total, compliant, pending, allowed, denied, readyToSend, sent, unmapped };
  }, [evaluations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return evaluations.filter((ev) => {
      if (filter === 'compliant' && !ev.isCompliant) return false;
      if (filter === 'pending' && !(ev.lastNotificationStatus !== 'sent' && ev.decision === 'pending'))
        return false;
      if (filter === 'ready' && !(ev.lastNotificationStatus !== 'sent' && ev.decision !== 'pending'))
        return false;
      if (filter === 'sent' && ev.lastNotificationStatus !== 'sent') return false;
      if (
        filter === 'allowed' &&
        ev.decision !== 'reward' &&
        ev.decision !== 'allow_same' &&
        ev.decision !== 'allow_with_warning'
      ) {
        return false;
      }
      if (filter === 'denied' && ev.decision !== 'deny_reward') return false;

      if (q) {
        return (
          ev.employeeName.toLowerCase().includes(q) ||
          ev.empCode.toLowerCase().includes(q) ||
          ev.department.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [evaluations, filter, search]);

  const groupedFiltered = useMemo(() => groupEvaluationsByWorkflow(filtered), [filtered]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadFile(file);
      e.target.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onUploadFile(file);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectGroup = (items: EmployeeEvaluation[]) => {
    const groupIds = items.map((e) => e.id);
    const allChecked = groupIds.length > 0 && groupIds.every((id) => selectedIds.includes(id));
    if (allChecked) {
      const setToRemove = new Set(groupIds);
      setSelectedIds((prev) => prev.filter((id) => !setToRemove.has(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...groupIds])));
    }
  };

  const toggleGroupCollapse = (key: WorkflowGroupKey) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const applyBulk = (decision: ManagerDecision) => {
    if (selectedIds.length === 0) return;
    const nonCompliantSelected = selectedIds.filter((id) => {
      const ev = evaluations.find((e) => e.id === id);
      return ev && !ev.isCompliant;
    });
    if (nonCompliantSelected.length > 0) {
      onBulkDecisionChange(nonCompliantSelected, decision);
    }
    setSelectedIds([]);
  };

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".dat,.txt,.csv,.tsv,.xlsx,.xls"
        onChange={handleFileChange}
        className="hidden"
        aria-label="رفع ملف البصمة"
      />

      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold font-display text-slate-900">
            التقييم الأسبوعي ومكافأة الخميس
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
            <span>الأحد – الخميس</span>
            <span aria-hidden="true">·</span>
            <span>
              الدوام <span className="font-mono tabular-nums">{settings.workStartTime}</span> –{' '}
              <span className="font-mono tabular-nums">{settings.workEndTime}</span>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              سماح التأخير <span className="font-mono tabular-nums">{settings.graceLateMinutes}</span> د
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {settings.thursdayMorningOnly ? 'الخميس: دخول الصباح فقط' : 'الخميس: دوام كامل'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {batches.length > 0 && activeBatch && (
            <select
              aria-label="اختيار الأسبوع"
              value={activeBatch.id}
              onChange={(e) => onSelectBatch(e.target.value)}
              className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  أسبوع {b.weekLabel}
                </option>
              ))}
            </select>
          )}

          {canUpload && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-white text-slate-800 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="w-4 h-4 text-teal-700" />
              <span>{uploading ? 'جارٍ تحليل الملف...' : 'رفع ملف البصمة'}</span>
            </button>
          )}

          {activeBatch && evaluations.length > 0 && (
            <>
              {canExport && (
                <>
                  <button
                    type="button"
                    onClick={onExportExcel}
                    className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                    <span>تصدير Excel</span>
                  </button>

                  <button
                    type="button"
                    onClick={onExportPdf}
                    disabled={exportingPdf}
                    className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-red-700" />
                    <span>{exportingPdf ? 'جارٍ التصدير...' : 'تصدير PDF'}</span>
                  </button>
                </>
              )}

              {canSend && (
                <button
                  type="button"
                  onClick={() => onOpenDispatch(selectedIds.length > 0 ? selectedIds : undefined)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>
                    إرسال على الواتساب ({selectedIds.length > 0 ? selectedIds.length : metrics.readyToSend})
                  </span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Empty State when no batch uploaded yet */}
      {!activeBatch || evaluations.length === 0 ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`bg-white border border-dashed rounded-xl p-12 text-center transition-colors ${
            dragOver ? 'border-teal-600 bg-teal-50/40' : 'border-slate-300'
          }`}
        >
          <div className="w-12 h-12 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center mx-auto mb-4">
            <Upload className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold font-display text-slate-900 mb-2">
            ارفع ملف بصمة ZKTeco للبدء بالتقييم الأسبوعي
          </h2>
          <p className="text-sm text-slate-600 max-w-lg mx-auto mb-6 leading-relaxed">
            يدعم النظام ملفات أجهزة ZKTeco النصية (
            <span dir="ltr" className="inline-block font-mono text-slate-800">.dat / .txt</span>)
            بالإضافة إلى ملفات (
            <span dir="ltr" className="inline-block font-mono text-slate-800">.csv / .xlsx</span>
            ). سيقوم النظام تلقائياً بحساب أول بصمة وآخر بصمة لكل موظف من الأحد إلى الخميس وتجهيز قرارات المكافأة.
          </p>

          {canUpload ? (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 transition-colors cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>اختيار ملف البصمة</span>
              </button>

              <button
                type="button"
                onClick={onLoadDemoData}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-white text-slate-800 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4 text-teal-700" />
                <span>تحميل بيانات تجريبية جاهزة</span>
              </button>

              <button
                type="button"
                onClick={onDownloadSampleDat}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>تنزيل ملف ZKTeco تجريبي</span>
              </button>
            </div>
          ) : (
            <div className="text-xs text-slate-500">
              لا يوجد أسبوع مرفوع حالياً. حسابك لا يملك صلاحية رفع ملفات البصمة.
            </div>
          )}
        </div>
      ) : (
        <>
          {/* KPI Strip — Flat Single-Elevation with Hairline Dividers */}
          <div className="grid grid-cols-2 md:grid-cols-5 bg-white border border-slate-200 rounded-xl divide-y md:divide-y-0 md:divide-x md:divide-x-reverse divide-slate-200">
            <div className="p-4">
              <div className="text-xs text-slate-500">إجمالي الموظفين</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {metrics.total}
              </div>
              <div className="text-xs text-slate-400 mt-0.5 truncate">{activeBatch.fileName}</div>
            </div>
            <div className="p-4">
              <div className="text-xs text-slate-500">ملتزمون (مكافأة تلقائية)</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                {metrics.compliant}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {metrics.total > 0 ? Math.round((metrics.compliant / metrics.total) * 100) : 0}% من الفريق
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-slate-500">بانتظار قرار المدير</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1">
                {metrics.pending}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">غير ملتزمين لم يُحدد قرارهم</div>
            </div>
            <div className="p-4">
              <div className="text-xs text-slate-500">تم السماح / لم يُسمح</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1 flex items-baseline gap-1.5">
                <span className="text-emerald-700">{metrics.allowed}</span>
                <span className="text-slate-300 text-lg">/</span>
                <span className="text-red-700">{metrics.denied}</span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">خروج مبكر مقابل رفض</div>
            </div>
            <div className="p-4">
              <div className="text-xs text-slate-500">تم الإرسال</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-teal-700 mt-1">
                {metrics.sent}
                <span className="text-sm font-normal text-slate-400"> / {metrics.total}</span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">جاهز للإرسال: {metrics.readyToSend}</div>
            </div>
          </div>

          {/* Unmapped / Missing Contacts Alert */}
          {metrics.unmapped.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 text-sm text-amber-900">
                <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">
                    يوجد {metrics.unmapped.length} موظف بدون رقم واتساب أو بريد إلكتروني مسجل:
                  </span>{' '}
                  <span className="text-amber-800">
                    {metrics.unmapped.slice(0, 4).map((u) => `${u.employeeName} (${u.empCode})`).join('، ')}
                  </span>
                </div>
              </div>
              {canManageEmployees && (
                <div className="flex flex-wrap gap-2">
                  {metrics.unmapped.slice(0, 3).map((u) => (
                    <button
                      key={u.empCode}
                      type="button"
                      onClick={() => onQuickAddEmployee(u.empCode, u.employeeName)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-amber-300 text-amber-900 rounded-lg hover:bg-amber-100 transition-colors cursor-pointer"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>ربط رقم {u.empCode}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Filter Tabs + Search + Bulk Decision Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  ['all', `الكل (${metrics.total})`],
                  ['pending', `لم يُتخذ إجراء (${metrics.pending})`],
                  ['ready', `جاهزون للإرسال (${metrics.readyToSend})`],
                  ['sent', `تم الإرسال (${metrics.sent})`],
                  ['compliant', `ملتزمون (${metrics.compliant})`],
                  ['allowed', `تم السماح (${metrics.allowed})`],
                  ['denied', `لم يُسمح (${metrics.denied})`],
                ] as Array<[FilterMode, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    filter === key
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
                placeholder="بحث بالاسم أو الرقم الوظيفي..."
                className="w-full pr-9 pl-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
              />
            </div>
          </div>

          {selectedIds.length > 0 && (canDecide || canSend) && (
            <div className="bg-slate-900 text-white rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                تم تحديد <span className="font-mono font-semibold">{selectedIds.length}</span> موظف
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canDecide && (
                  <>
                    <button
                      type="button"
                      onClick={() => applyBulk('allow_same')}
                      className="px-3 py-1.5 text-xs font-medium bg-emerald-700 hover:bg-emerald-600 rounded-lg transition-colors cursor-pointer"
                    >
                      تطبيق: السماح بالمكافأة
                    </button>
                    <button
                      type="button"
                      onClick={() => applyBulk('allow_with_warning')}
                      className="px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 rounded-lg transition-colors cursor-pointer"
                    >
                      تطبيق: سماح مع تنبيه
                    </button>
                    <button
                      type="button"
                      onClick={() => applyBulk('deny_reward')}
                      className="px-3 py-1.5 text-xs font-medium bg-red-700 hover:bg-red-600 rounded-lg transition-colors cursor-pointer"
                    >
                      تطبيق: عدم منح المكافأة
                    </button>
                  </>
                )}
                {canSend && (
                  <button
                    type="button"
                    onClick={() => onOpenDispatch(selectedIds)}
                    className="px-3 py-1.5 text-xs font-semibold bg-teal-600 hover:bg-teal-500 rounded-lg transition-colors cursor-pointer"
                  >
                    إرسال للمحددين
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="px-2 py-1.5 text-xs text-slate-300 hover:text-white cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </div>
          )}

          {/* 3 Grouped Workflow Sections: Pending -> Ready -> Sent */}
          {filtered.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl py-12 text-center text-sm text-slate-500">
              لا توجد نتائج مطابقة لخيارات البحث أو التصفية الحالية.
            </div>
          ) : (
            <div className="space-y-5">
              {(
                [
                  {
                    key: 'pending' as WorkflowGroupKey,
                    title: 'لم يتم اتخاذ الإجراء بعد',
                    subtitle: 'موظفون غير ملتزمين بانتظار اختيار قرار المدير (٣ خيارات) لتجهيزهم للإرسال',
                    items: groupedFiltered.pending,
                    headerBg: 'bg-amber-50/70 border-amber-200/80',
                    titleColor: 'text-amber-950',
                    countBg: 'bg-amber-100 text-amber-900',
                    emptyText: 'ممتاز! تم اتخاذ القرار لجميع الموظفين ولا يوجد أحد بانتظار الإجراء.',
                  },
                  {
                    key: 'ready' as WorkflowGroupKey,
                    title: 'جاهزون للإرسال',
                    subtitle: 'تم اعتماد قرارهم (ملتزمون أو صدر بحقهم قرار المدير) وجاهزون للإرسال الآن',
                    items: groupedFiltered.ready,
                    headerBg: 'bg-teal-50/70 border-teal-200/80',
                    titleColor: 'text-teal-950',
                    countBg: 'bg-teal-100 text-teal-900',
                    emptyText: 'لا يوجد موظفون جاهزون للإرسال حالياً.',
                  },
                  {
                    key: 'sent' as WorkflowGroupKey,
                    title: 'تم الانتهاء من الإرسال',
                    subtitle: 'موظفون تم إرسال إشعار الواتساب أو البريد الإلكتروني لهم بنجاح لهذا الأسبوع',
                    items: groupedFiltered.sent,
                    headerBg: 'bg-emerald-50/60 border-emerald-200/80',
                    titleColor: 'text-emerald-950',
                    countBg: 'bg-emerald-100 text-emerald-900',
                    emptyText: 'لم يتم إرسال إشعارات لأي موظف بعد في هذا الأسبوع.',
                  },
                ]
              )
                .filter((group) => {
                  if (filter === 'pending') return group.key === 'pending';
                  if (filter === 'ready') return group.key === 'ready';
                  if (filter === 'sent') return group.key === 'sent';
                  return true;
                })
                .map((group) => {
                  const isCollapsed = collapsedGroups[group.key];
                  const groupAllSelected =
                    group.items.length > 0 &&
                    group.items.every((item) => selectedIds.includes(item.id));

                  return (
                    <section
                      key={group.key}
                      aria-label={group.title}
                      className="bg-white border border-slate-200 rounded-xl overflow-hidden"
                    >
                      {/* Group Header */}
                      <div
                        className={`px-4 py-3.5 border-b flex flex-wrap items-center justify-between gap-3 ${group.headerBg}`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleGroupCollapse(group.key)}
                          aria-expanded={!isCollapsed}
                          className="flex items-center gap-3 text-right cursor-pointer min-w-0"
                        >
                          <span className={`text-sm font-bold font-display ${group.titleColor}`}>
                            {group.title}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-md text-xs font-mono font-semibold tabular-nums ${group.countBg}`}
                          >
                            {group.items.length}
                          </span>
                          <span className="hidden md:inline text-xs text-slate-600 truncate">
                            — {group.subtitle}
                          </span>
                        </button>

                        <div className="flex items-center gap-2 shrink-0">
                          {group.key === 'ready' && group.items.length > 0 && canSend && (
                            <button
                              type="button"
                              onClick={() => onOpenDispatch(group.items.map((item) => item.id))}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 transition-colors cursor-pointer"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>إرسال للمجموعة ({group.items.length})</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => toggleGroupCollapse(group.key)}
                            aria-label={isCollapsed ? `فتح مجموعة ${group.title}` : `طي مجموعة ${group.title}`}
                            className="p-1.5 text-slate-600 hover:text-slate-900 rounded-md hover:bg-white/60 cursor-pointer"
                          >
                            {isCollapsed ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronUp className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      {!isCollapsed &&
                        (group.items.length === 0 ? (
                          <div className="px-4 py-5 text-xs text-slate-500 text-center">
                            {group.emptyText}
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-right border-collapse">
                              <thead>
                                <tr className="bg-slate-50/80 border-b border-slate-200 text-xs font-semibold text-slate-600">
                                  <th className="py-2.5 px-3 w-10">
                                    <input
                                      type="checkbox"
                                      aria-label={`تحديد كل مجموعة ${group.title}`}
                                      checked={groupAllSelected}
                                      onChange={() => toggleSelectGroup(group.items)}
                                      className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                                    />
                                  </th>
                                  <th className="py-2.5 px-3">الرقم</th>
                                  <th className="py-2.5 px-3">الموظف</th>
                                  <th className="py-2.5 px-3">ملخص الالتزام (الأحد–الخميس)</th>
                                  <th className="py-2.5 px-3">قرار المدير</th>
                                  <th className="py-2.5 px-3">حالة الإرسال</th>
                                  <th className="py-2.5 px-3 text-left">إجراءات</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 text-sm">
                                {group.items.map((ev) => {
                                  const isExpanded = expandedId === ev.id;
                                  const isChecked = selectedIds.includes(ev.id);

                                  return (
                                    <React.Fragment key={ev.id}>
                                      <tr className="hover:bg-slate-50/70 transition-colors">
                                        <td className="py-3 px-3 align-middle">
                                          <input
                                            type="checkbox"
                                            aria-label={`تحديد ${ev.employeeName}`}
                                            checked={isChecked}
                                            onChange={() => toggleSelect(ev.id)}
                                            className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                                          />
                                        </td>

                                        <td className="py-3 px-3 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                                          {ev.empCode}
                                        </td>

                                        <td className="py-3 px-3">
                                          <div className="font-semibold text-slate-900">
                                            {ev.employeeName}
                                          </div>
                                          <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                                            <span>{ev.department}</span>
                                            <span aria-hidden="true">·</span>
                                            <span className="font-mono tabular-nums" dir="ltr">
                                              {ev.phone || 'بدون جوال'}
                                            </span>
                                          </div>
                                        </td>

                                        <td className="py-3 px-3">
                                          <div className="flex items-center gap-2">
                                            {ev.isCompliant ? (
                                              <span className="text-xs font-semibold text-emerald-700">
                                                ملتزم بالكامل
                                              </span>
                                            ) : (
                                              <span className="text-xs font-semibold text-red-700">
                                                غير ملتزم
                                              </span>
                                            )}
                                            <span className="text-slate-300">·</span>
                                            <span className="text-xs text-slate-600">
                                              حضور{' '}
                                              <span className="font-mono tabular-nums">
                                                {ev.presentDays}/5
                                              </span>
                                            </span>
                                          </div>
                                          <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                            <span>
                                              تأخير:{' '}
                                              <span className="font-mono tabular-nums">
                                                {ev.totalLateMinutes}
                                              </span>{' '}
                                              د (
                                              <span className="font-mono tabular-nums">
                                                {ev.lateDaysCount}
                                              </span>{' '}
                                              أيام)
                                            </span>
                                            {ev.missingPunchDays > 0 && (
                                              <span>
                                                · بصمة ناقصة:{' '}
                                                <span className="font-mono tabular-nums">
                                                  {ev.missingPunchDays}
                                                </span>
                                              </span>
                                            )}
                                            {ev.absentDays > 0 && (
                                              <span>
                                                · غياب:{' '}
                                                <span className="font-mono tabular-nums">
                                                  {ev.absentDays}
                                                </span>
                                              </span>
                                            )}
                                            {ev.earlyLeaveMinutes > 0 && (
                                              <span>
                                                · انصراف مبكر:{' '}
                                                <span className="font-mono tabular-nums">
                                                  {ev.earlyLeaveMinutes}
                                                </span>{' '}
                                                د
                                              </span>
                                            )}
                                          </div>
                                        </td>

                                        <td className="py-3 px-3">
                                          {ev.isCompliant ? (
                                            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                                              <CheckCircle2 className="w-4 h-4 shrink-0" />
                                              <span>مكافأة الخروج بعد ١٢ ظهراً</span>
                                            </div>
                                          ) : canDecide ? (
                                            <div className="flex flex-wrap items-center gap-1.5">
                                              <select
                                                aria-label={`قرار المدير للموظف ${ev.employeeName}`}
                                                value={ev.decision}
                                                onChange={(e) =>
                                                  onDecisionChange(
                                                    ev,
                                                    e.target.value as ManagerDecision
                                                  )
                                                }
                                                className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-teal-600/30 ${
                                                  ev.decision === 'pending'
                                                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                                                    : ev.decision === 'allow_same'
                                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                                    : ev.decision === 'allow_with_warning'
                                                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                                                    : 'bg-red-50 border-red-300 text-red-900'
                                                }`}
                                              >
                                                <option value="pending">
                                                  -- اختر قرار المدير (٣ خيارات) --
                                                </option>
                                                <option value="allow_same">
                                                  1) السماح بنفس رسالة المكافأة الأولى
                                                </option>
                                                <option value="allow_with_warning">
                                                  2) متأخر لكن تم السماح مع تنبيه بالالتزام
                                                </option>
                                                <option value="deny_reward">
                                                  3) عدم منح مكافأة الخروج المبكر
                                                </option>
                                              </select>
                                            </div>
                                          ) : (
                                            <span className="text-xs font-medium text-slate-600">
                                              {DECISION_LABELS[ev.decision]}
                                            </span>
                                          )}
                                        </td>

                                        <td className="py-3 px-3 whitespace-nowrap">
                                          {ev.lastNotificationStatus === 'sent' ? (
                                            <div className="text-xs font-semibold text-emerald-700">
                                              تم الإرسال
                                            </div>
                                          ) : ev.lastNotificationStatus === 'failed' ? (
                                            <div className="text-xs font-semibold text-red-700">
                                              فشل الإرسال
                                            </div>
                                          ) : ev.lastNotificationStatus === 'partial' ? (
                                            <div className="text-xs font-semibold text-amber-700">
                                              إرسال جزئي
                                            </div>
                                          ) : (
                                            <div className="text-xs text-slate-400">
                                              لم يُرسل بعد
                                            </div>
                                          )}
                                        </td>

                                        <td className="py-3 px-3 whitespace-nowrap">
                                          <div className="flex items-center justify-end gap-1.5">
                                            {group.key === 'ready' && canSend && (
                                              <button
                                                type="button"
                                                onClick={() => onOpenDispatch([ev.id])}
                                                aria-label={`إرسال للموظف ${ev.employeeName}`}
                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-200 rounded-md hover:bg-teal-100 cursor-pointer"
                                              >
                                                <Send className="w-3.5 h-3.5" />
                                                <span>إرسال</span>
                                              </button>
                                            )}

                                            <button
                                              type="button"
                                              onClick={() => setPreviewEval(ev)}
                                              disabled={ev.decision === 'pending'}
                                              title="معاينة نص الرسالة"
                                              aria-label={`معاينة رسالة ${ev.employeeName}`}
                                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                                            >
                                              <Eye className="w-3.5 h-3.5" />
                                              <span>الرسالة</span>
                                            </button>

                                            <button
                                              type="button"
                                              onClick={() =>
                                                setExpandedId(isExpanded ? null : ev.id)
                                              }
                                              aria-expanded={isExpanded}
                                              aria-label={`تفاصيل بصمات ${ev.employeeName}`}
                                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                                            >
                                              <Clock className="w-3.5 h-3.5 text-teal-700" />
                                              <span>البصمات</span>
                                              {isExpanded ? (
                                                <ChevronUp className="w-3.5 h-3.5" />
                                              ) : (
                                                <ChevronDown className="w-3.5 h-3.5" />
                                              )}
                                            </button>
                                          </div>
                                        </td>
                                      </tr>

                                      {/* Expandable Sunday-Thursday Punch Breakdown */}
                                      {isExpanded && (
                                        <tr className="bg-slate-50/80">
                                          <td colSpan={7} className="p-4 border-t border-slate-200">
                                            <div className="flex items-center justify-between mb-3">
                                              <div className="text-xs font-semibold text-slate-800">
                                                تفاصيل أول بصمة وآخر بصمة (الأحد – الخميس) —{' '}
                                                {ev.employeeName}
                                              </div>
                                              <div className="text-xs text-slate-500">
                                                يمكنك استثناء أي يوم (إجازة أو استئذان معتمد) لإعادة
                                                احتساب الالتزام فوراً
                                              </div>
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                                              {ev.days.map((day) => {
                                                const statusText = day.excused
                                                  ? 'مستثنى (معتمد)'
                                                  : day.absent
                                                  ? 'غياب'
                                                  : day.missingPunch
                                                  ? 'بصمة خروج ناقصة'
                                                  : day.lateMinutes > 0
                                                  ? `متأخر ${day.lateMinutes} د`
                                                  : day.earlyLeaveMinutes > 0
                                                  ? `انصراف مبكر ${day.earlyLeaveMinutes} د`
                                                  : day.dayIndex === 4 &&
                                                    settings.thursdayMorningOnly
                                                  ? 'منتظم (صباح الخميس)'
                                                  : 'منتظم';

                                                const statusColor = day.excused
                                                  ? 'text-teal-700'
                                                  : day.absent || day.missingPunch
                                                  ? 'text-red-700'
                                                  : day.lateMinutes > 0 ||
                                                    day.earlyLeaveMinutes > 0
                                                  ? 'text-amber-700'
                                                  : 'text-emerald-700';

                                                return (
                                                  <div
                                                    key={day.date}
                                                    className="bg-white border border-slate-200 rounded-lg p-3 flex flex-col justify-between"
                                                  >
                                                    <div>
                                                      <div className="flex items-center justify-between text-xs mb-2">
                                                        <span className="font-semibold text-slate-900">
                                                          {day.dayNameAr}
                                                        </span>
                                                        <span className="font-mono tabular-nums text-slate-400">
                                                          {day.date.slice(5)}
                                                        </span>
                                                      </div>
                                                      <div className="space-y-1 text-xs font-mono tabular-nums text-slate-700">
                                                        <div className="flex justify-between">
                                                          <span className="font-sans text-slate-500">
                                                            أول بصمة:
                                                          </span>
                                                          <span>{day.firstIn || '—'}</span>
                                                        </div>
                                                        <div className="flex justify-between">
                                                          <span className="font-sans text-slate-500">
                                                            آخر بصمة:
                                                          </span>
                                                          <span>
                                                            {day.lastOut ||
                                                              (day.dayIndex === 4 &&
                                                              settings.thursdayMorningOnly
                                                                ? 'غير مطلوب'
                                                                : '—')}
                                                          </span>
                                                        </div>
                                                      </div>
                                                    </div>

                                                    <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                                                      <span
                                                        className={`text-[11px] font-semibold ${statusColor}`}
                                                      >
                                                        {statusText}
                                                      </span>
                                                      {canDecide && (
                                                        <button
                                                          type="button"
                                                          onClick={() =>
                                                            onToggleExcuseDay(ev, day.date)
                                                          }
                                                          className="text-[11px] font-medium text-teal-700 hover:text-teal-900 underline cursor-pointer shrink-0"
                                                        >
                                                          {day.excused
                                                            ? 'إلغاء الاستثناء'
                                                            : 'استثناء اليوم'}
                                                        </button>
                                                      )}
                                                    </div>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </td>
                                        </tr>
                                      )}
                                    </React.Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ))}
                    </section>
                  );
                })}
            </div>
          )}
        </>
      )}

      {/* Message Preview Modal */}
      {previewEval && previewEval.decision !== 'pending' && activeBatch && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="معاينة الرسالة"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-teal-700" />
                <h2 className="text-base font-bold font-display text-slate-900">
                  معاينة رسالة الموظف
                </h2>
              </div>
              <button
                type="button"
                aria-label="إغلاق المعاينة"
                onClick={() => setPreviewEval(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-3">
              <div className="text-xs text-slate-500 flex flex-wrap gap-2">
                <span>الموظف: {previewEval.employeeName}</span>
                <span aria-hidden="true">·</span>
                <span>القرار: {DECISION_LABELS[previewEval.decision]}</span>
              </div>
              <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-4 text-sm text-slate-800 leading-relaxed whitespace-pre-line">
                {renderDecisionMessage(
                  previewEval.decision,
                  previewEval,
                  activeBatch.weekLabel,
                  settings
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPreviewEval(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                إغلاق
              </button>
              {canSend && (
                <button
                  type="button"
                  onClick={() => {
                    const id = previewEval.id;
                    setPreviewEval(null);
                    onOpenDispatch([id]);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>إرسال لهذا الموظف</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
