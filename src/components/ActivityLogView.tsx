import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  RefreshCw,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import {
  CHANNEL_LABELS,
  DECISION_LABELS,
  type ActivityLog,
  type DispatchChannel,
} from '../types';

interface ActivityLogViewProps {
  logs: ActivityLog[];
  onRetryLog: (log: ActivityLog) => Promise<void>;
  onRetryAllFailed: (failedLogs: ActivityLog[]) => Promise<void>;
  onMarkSent: (log: ActivityLog) => Promise<void>;
}

export function ActivityLogView({
  logs,
  onRetryLog,
  onRetryAllFailed,
  onMarkSent,
}: ActivityLogViewProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'sent' | 'failed' | 'pending'>('all');
  const [channelFilter, setChannelFilter] = useState<'all' | DispatchChannel>('all');
  const [weekFilter, setWeekFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [previewLog, setPreviewLog] = useState<ActivityLog | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryingBulk, setRetryingBulk] = useState(false);

  const weeks = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of logs) {
      if (l.weekKey && !map.has(l.weekKey)) {
        map.set(l.weekKey, l.weekLabel || l.weekKey);
      }
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [logs]);

  const counts = useMemo(() => {
    const total = logs.length;
    const sent = logs.filter((l) => l.status === 'sent').length;
    const failed = logs.filter((l) => l.status === 'failed').length;
    const pending = logs.filter((l) => l.status === 'pending').length;
    return { total, sent, failed, pending };
  }, [logs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (channelFilter !== 'all' && l.channel !== channelFilter) return false;
      if (weekFilter !== 'all' && l.weekKey !== weekFilter) return false;
      if (q) {
        return (
          l.employeeName.toLowerCase().includes(q) ||
          l.empCode.toLowerCase().includes(q) ||
          l.recipient.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [logs, statusFilter, channelFilter, weekFilter, search]);

  const failedInView = useMemo(
    () => filtered.filter((l) => l.status === 'failed'),
    [filtered]
  );

  const handleRetryOne = async (log: ActivityLog) => {
    setRetryingId(log.id);
    try {
      await onRetryLog(log);
    } finally {
      setRetryingId(null);
    }
  };

  const handleRetryBulk = async () => {
    if (failedInView.length === 0) return;
    setRetryingBulk(true);
    try {
      await onRetryAllFailed(failedInView);
    } finally {
      setRetryingBulk(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold font-display text-slate-900">سجل الأحداث والإرسال</h1>
          <p className="text-xs text-slate-500 mt-1">
            توثيق شامل لجميع إشعارات الواتساب والبريد الإلكتروني لمعرفة من تم الإرسال له ومن تعذّر إرساله
          </p>
        </div>

        {failedInView.length > 0 && (
          <button
            type="button"
            onClick={handleRetryBulk}
            disabled={retryingBulk}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${retryingBulk ? 'animate-spin' : ''}`} />
            <span>
              {retryingBulk
                ? 'جارٍ إعادة الإرسال...'
                : `إعادة إرسال الفاشلة (${failedInView.length})`}
            </span>
          </button>
        )}
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 bg-white border border-slate-200 rounded-xl divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-slate-200">
        <div className="p-4">
          <div className="text-xs text-slate-500">إجمالي الأحداث</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {counts.total}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">تم الإرسال بنجاح</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
            {counts.sent}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">فشل الإرسال</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-red-700 mt-1">
            {counts.failed}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">قيد الانتظار</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1">
            {counts.pending}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                ['all', 'الكل'],
                ['sent', 'تم الإرسال'],
                ['failed', 'فشل'],
                ['pending', 'قيد الانتظار'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setStatusFilter(k)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  statusFilter === k
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <select
            aria-label="تصفية حسب القناة"
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value as 'all' | DispatchChannel)}
            className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-700"
          >
            <option value="all">كل القنوات</option>
            <option value="whatsapp_web">واتساب ويب</option>
            <option value="whatsapp_api">واتساب API</option>
            <option value="email">بريد إلكتروني</option>
          </select>

          {weeks.length > 0 && (
            <select
              aria-label="تصفية حسب الأسبوع"
              value={weekFilter}
              onChange={(e) => setWeekFilter(e.target.value)}
              className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-700"
            >
              <option value="all">كل الأسابيع</option>
              {weeks.map(([wk, label]) => (
                <option key={wk} value={wk}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم أو الرقم أو المستلم..."
            className="w-full pr-9 pl-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">التوقيت</th>
                <th className="py-3 px-4">الموظف</th>
                <th className="py-3 px-4">الأسبوع</th>
                <th className="py-3 px-4">القرار</th>
                <th className="py-3 px-4">القناة والمستلم</th>
                <th className="py-3 px-4">الحالة</th>
                <th className="py-3 px-4 text-left">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    لا توجد أحداث إرسال مسجلة بعد. عند إرسال الإشعارات من لوحة التقييم ستظهر هنا تلقائياً.
                  </td>
                </tr>
              ) : (
                filtered.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-500 whitespace-nowrap">
                      {log.createdAt
                        ? new Date(log.createdAt).toLocaleString('ar-SA', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'الآن'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{log.employeeName}</div>
                      <div className="font-mono text-xs text-slate-400">#{log.empCode}</div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                      {log.weekLabel}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700">
                      {DECISION_LABELS[log.decision]}
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-xs font-medium text-slate-800">
                        {CHANNEL_LABELS[log.channel]}
                      </div>
                      <div className="font-mono text-xs text-slate-500" dir="ltr">
                        {log.recipient || '—'}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      {log.status === 'sent' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>تم الإرسال</span>
                        </span>
                      ) : log.status === 'failed' ? (
                        <div>
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
                            <XCircle className="w-3.5 h-3.5" />
                            <span>فشل الإرسال</span>
                          </span>
                          {log.errorMessage && (
                            <div className="text-[11px] text-red-600 mt-0.5 max-w-xs truncate">
                              {log.errorMessage}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs font-semibold text-amber-700">قيد الانتظار</span>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPreviewLog(log)}
                          aria-label={`عرض رسالة ${log.employeeName}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>النص</span>
                        </button>
                        {log.status === 'failed' && (
                          <button
                            type="button"
                            onClick={() => handleRetryOne(log)}
                            disabled={retryingId === log.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-md hover:bg-teal-100 cursor-pointer"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${retryingId === log.id ? 'animate-spin' : ''}`}
                            />
                            <span>إعادة</span>
                          </button>
                        )}
                        {log.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => onMarkSent(log)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>تأكيد</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Preview Modal */}
      {previewLog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="تفاصيل حدث الإرسال"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <h2 className="text-base font-bold font-display text-slate-900">
                تفاصيل الرسالة المُرسلة
              </h2>
              <button
                type="button"
                aria-label="إغلاق"
                onClick={() => setPreviewLog(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="py-4 space-y-3 text-sm">
              <div className="text-xs text-slate-500 flex flex-wrap gap-2">
                <span>الموظف: {previewLog.employeeName}</span>
                <span>·</span>
                <span>القناة: {CHANNEL_LABELS[previewLog.channel]}</span>
                <span>·</span>
                <span dir="ltr">{previewLog.recipient}</span>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-slate-800 leading-relaxed whitespace-pre-line">
                {previewLog.messagePreview}
              </div>
              {previewLog.errorMessage && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">
                  سبب الفشل: {previewLog.errorMessage}
                </div>
              )}
            </div>
            <div className="pt-4 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setPreviewLog(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
