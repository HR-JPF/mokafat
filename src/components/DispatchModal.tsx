import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Mail,
  MessageCircle,
  Send,
  UserPlus,
  X,
} from 'lucide-react';
import {
  buildWhatsAppWebUrl,
  normalizePhoneNumber,
  renderDecisionMessage,
} from '../lib/attendanceEngine';
import {
  DECISION_LABELS,
  type DispatchChannel,
  type EmployeeEvaluation,
  type ServerSecretsStatus,
  type UserSettings,
  type WeeklyBatch,
} from '../types';

interface DispatchModalProps {
  open: boolean;
  onClose: () => void;
  batch: WeeklyBatch;
  evaluations: EmployeeEvaluation[];
  preselectedIds?: string[];
  settings: UserSettings;
  secretsStatus: ServerSecretsStatus;
  isDemoMode: boolean;
  onDispatchAutomated: (
    targets: EmployeeEvaluation[],
    channels: Array<'whatsapp_api' | 'email'>
  ) => Promise<Record<string, { ok: boolean; error?: string }>>;
  onRecordWhatsAppWebSent: (ev: EmployeeEvaluation, message: string) => Promise<void>;
  onQuickAddEmployee?: (empCode: string, defaultName: string) => void;
}

type ChannelChoice = 'whatsapp_web' | 'whatsapp_api' | 'email' | 'api_and_email';

export function DispatchModal({
  open,
  onClose,
  batch,
  evaluations,
  preselectedIds,
  settings,
  secretsStatus,
  isDemoMode,
  onDispatchAutomated,
  onRecordWhatsAppWebSent,
  onQuickAddEmployee,
}: DispatchModalProps) {
  const defaultChannel: ChannelChoice =
    settings.whatsappMode === 'api' ? 'whatsapp_api' : 'whatsapp_web';
  const [channelChoice, setChannelChoice] = useState<ChannelChoice>(defaultChannel);
  const [skipAlreadySent, setSkipAlreadySent] = useState(true);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<Record<string, { ok: boolean; error?: string }>>({});
  const [webConfirmedIds, setWebConfirmedIds] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyMessage = async (evId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(evId);
      window.setTimeout(() => {
        setCopiedId((prev) => (prev === evId ? null : prev));
      }, 2000);
    } catch {
      // Fallback ignored if clipboard permissions are restricted
    }
  };

  const candidates = useMemo(() => {
    const pool =
      preselectedIds && preselectedIds.length > 0
        ? evaluations.filter((e) => preselectedIds.includes(e.id))
        : evaluations;

    return pool.filter((ev) => {
      if (ev.decision === 'pending') return false;
      const handledInThisSession =
        webConfirmedIds.includes(ev.id) || Boolean(results[ev.id]);
      if (skipAlreadySent && ev.lastNotificationStatus === 'sent' && !handledInThisSession) {
        return false;
      }
      return true;
    });
  }, [evaluations, preselectedIds, skipAlreadySent, webConfirmedIds, results]);

  const pendingDecisionCount = useMemo(() => {
    const pool =
      preselectedIds && preselectedIds.length > 0
        ? evaluations.filter((e) => preselectedIds.includes(e.id))
        : evaluations;
    return pool.filter((e) => e.decision === 'pending').length;
  }, [evaluations, preselectedIds]);

  const alreadySentCount = useMemo(() => {
    const pool =
      preselectedIds && preselectedIds.length > 0
        ? evaluations.filter((e) => preselectedIds.includes(e.id))
        : evaluations;
    return pool.filter((e) => e.lastNotificationStatus === 'sent').length;
  }, [evaluations, preselectedIds]);

  if (!open) return null;

  const isWhatsAppApiReady =
    (settings.whatsappProvider === 'cloud_api' && secretsStatus.whatsappCloudConfigured) ||
    (settings.whatsappProvider === 'ultramsg' && secretsStatus.whatsappUltramsgConfigured) ||
    (settings.whatsappProvider === 'webhook' && Boolean(settings.whatsappWebhookUrl));

  const handleAutomatedSend = async () => {
    if (candidates.length === 0) return;
    setSending(true);
    try {
      const channels: Array<'whatsapp_api' | 'email'> =
        channelChoice === 'whatsapp_api'
          ? ['whatsapp_api']
          : channelChoice === 'email'
          ? ['email']
          : ['whatsapp_api', 'email'];
      const res = await onDispatchAutomated(candidates, channels);
      setResults(res);
    } finally {
      setSending(false);
    }
  };

  const handleConfirmWeb = async (ev: EmployeeEvaluation) => {
    if (ev.decision === 'pending') return;
    const msg = renderDecisionMessage(ev.decision, ev, batch.weekLabel, settings);
    await onRecordWhatsAppWebSent(ev, msg);
    setWebConfirmedIds((prev) => (prev.includes(ev.id) ? prev : [...prev, ev.id]));
  };

  const handleConfirmAllWeb = async () => {
    setSending(true);
    try {
      for (const ev of candidates) {
        if (ev.decision === 'pending' || webConfirmedIds.includes(ev.id)) continue;
        if (!normalizePhoneNumber(ev.phone, settings.defaultCountryCode)) continue;
        const msg = renderDecisionMessage(ev.decision, ev, batch.weekLabel, settings);
        await onRecordWhatsAppWebSent(ev, msg);
        setWebConfirmedIds((prev) => (prev.includes(ev.id) ? prev : [...prev, ev.id]));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="إرسال إشعارات المكافأة الأسبوعية"
      className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4"
    >
      <div className="bg-white border border-slate-200 rounded-xl max-w-3xl w-full max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold font-display text-slate-900">
              إرسال الإشعارات للموظفين
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              أسبوع {batch.weekLabel} · جاهزون للإرسال: {candidates.length} موظف
            </p>
          </div>
          <button
            type="button"
            aria-label="إغلاق نافذة الإرسال"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Channel Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              اختر قناة وطريقة الإرسال
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <button
                type="button"
                onClick={() => setChannelChoice('whatsapp_web')}
                className={`p-3 text-right rounded-lg border transition-colors cursor-pointer ${
                  channelChoice === 'whatsapp_web'
                    ? 'border-teal-700 bg-teal-50/60 text-teal-900'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <MessageCircle className="w-4 h-4 text-emerald-700" />
                  <span>واتساب ويب</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">روابط جاهزة بدون اشتراك API</div>
              </button>

              <button
                type="button"
                onClick={() => setChannelChoice('whatsapp_api')}
                className={`p-3 text-right rounded-lg border transition-colors cursor-pointer ${
                  channelChoice === 'whatsapp_api'
                    ? 'border-teal-700 bg-teal-50/60 text-teal-900'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Send className="w-4 h-4 text-teal-700" />
                  <span>واتساب API تلقائي</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">إرسال جماعي مباشر بضغطة زر</div>
              </button>

              <button
                type="button"
                onClick={() => setChannelChoice('email')}
                className={`p-3 text-right rounded-lg border transition-colors cursor-pointer ${
                  channelChoice === 'email'
                    ? 'border-teal-700 bg-teal-50/60 text-teal-900'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Mail className="w-4 h-4 text-slate-700" />
                  <span>بريد إلكتروني فقط</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">إرسال عبر خادم SMTP</div>
              </button>

              <button
                type="button"
                onClick={() => setChannelChoice('api_and_email')}
                className={`p-3 text-right rounded-lg border transition-colors cursor-pointer ${
                  channelChoice === 'api_and_email'
                    ? 'border-teal-700 bg-teal-50/60 text-teal-900'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Send className="w-4 h-4 text-teal-700" />
                  <span>واتساب API + إيميل</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">إرسال مزدوج معاً</div>
              </button>
            </div>
          </div>

          {/* Warnings & Guards */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs">
            <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={skipAlreadySent}
                onChange={(e) => setSkipAlreadySent(e.target.checked)}
                className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
              />
              <span>
                منع التكرار: استبعاد الموظفين الذين تم الإرسال لهم هذا الأسبوع ({alreadySentCount})
              </span>
            </label>
            {pendingDecisionCount > 0 && (
              <span className="text-amber-700 font-medium">
                تنبيه: يوجد {pendingDecisionCount} موظف بانتظار قرار المدير ولن يُشملوا في الإرسال
              </span>
            )}
          </div>

          {channelChoice !== 'whatsapp_web' && (isDemoMode || (!isWhatsAppApiReady && channelChoice !== 'email')) && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 flex items-start gap-2.5 text-xs text-amber-900">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                {isDemoMode
                  ? 'أنت تعمل حالياً في وضع المعاينة المحلية. لتشغيل الإرسال الحقيقي عبر API أو SMTP يرجى تسجيل الدخول بحساب Google وضبط مفاتيح الخادم؛ في وضع المعاينة سيتم تسجيل العملية كتجربة في سجل الأحداث أو يمكنك استخدام خيار «واتساب ويب» للفتح الفوري.'
                  : 'تأكد من إضافة مفتاح مزود الواتساب في متغيرات البيئة على الخادم وتعبئة معرف الرقم/الجلسة في الإعدادات. يمكنك دائماً التبديل إلى خيار «واتساب ويب» للعمل فوراً.'}
              </div>
            </div>
          )}

          {/* Recipients Queue */}
          {candidates.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-slate-200 rounded-lg text-sm text-slate-500">
              لا يوجد موظفون جاهزون للإرسال حالياً وفق خيارات التصفية. تأكد من اختيار قرار لغير الملتزمين أو إلغاء استبعاد المرسَل لهم سابقاً.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-200">
              {candidates.map((ev) => {
                if (ev.decision === 'pending') return null;
                const message = renderDecisionMessage(ev.decision, ev, batch.weekLabel, settings);
                const normalizedPhone = normalizePhoneNumber(ev.phone, settings.defaultCountryCode);
                const waUrl = buildWhatsAppWebUrl(ev.phone, message, settings.defaultCountryCode);
                const rowResult = results[ev.id];
                const isWebDone = webConfirmedIds.includes(ev.id);

                return (
                  <div key={ev.id} className="p-3.5 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-sm font-semibold text-slate-900">
                          {ev.employeeName}
                        </span>
                        <span className="text-xs font-mono tabular-nums text-slate-400">
                          #{ev.empCode}
                        </span>
                        <span className="text-xs text-slate-300">·</span>
                        <span className="text-xs text-slate-600">{DECISION_LABELS[ev.decision]}</span>
                        {normalizedPhone && (
                          <>
                            <span className="text-xs text-slate-300">·</span>
                            <span className="text-xs font-mono tabular-nums text-slate-500" dir="ltr">
                              +{normalizedPhone}
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {channelChoice === 'whatsapp_web' ? (
                          isWebDone ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-teal-700">
                              <CheckCircle2 className="w-4 h-4" />
                              <span>تم تسجيل الإرسال</span>
                            </span>
                          ) : waUrl ? (
                            <>
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-3 py-1.5 font-medium bg-emerald-700 text-white rounded-md hover:bg-emerald-800 transition-colors"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                <span>فتح واتساب ويب</span>
                              </a>
                              <button
                                type="button"
                                onClick={() => handleCopyMessage(ev.id, message)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium bg-white border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50 cursor-pointer"
                              >
                                {copiedId === ev.id ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-700" />
                                    <span>تم النسخ</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5 text-slate-500" />
                                    <span>نسخ</span>
                                  </>
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleConfirmWeb(ev)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 font-medium bg-white border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50 cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5 text-teal-700" />
                                <span>تأكيد الإرسال</span>
                              </button>
                            </>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-red-700 font-medium">لا يوجد رقم واتساب</span>
                              {onQuickAddEmployee && (
                                <button
                                  type="button"
                                  onClick={() => onQuickAddEmployee(ev.empCode, ev.employeeName)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 font-medium bg-amber-50 border border-amber-300 text-amber-900 rounded-md hover:bg-amber-100 cursor-pointer"
                                >
                                  <UserPlus className="w-3.5 h-3.5" />
                                  <span>إضافة الرقم</span>
                                </button>
                              )}
                            </div>
                          )
                        ) : rowResult ? (
                          rowResult.ok ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-teal-700">
                              <CheckCircle2 className="w-4 h-4" />
                              <span>تم الإرسال</span>
                            </span>
                          ) : (
                            <span className="text-red-700 font-medium">
                              فشل: {rowResult.error || 'خطأ غير معروف'}
                            </span>
                          )
                        ) : (
                          <span className="font-mono tabular-nums text-slate-500" dir="ltr">
                            {channelChoice === 'email'
                              ? ev.email || 'بدون إيميل'
                              : normalizedPhone
                              ? `+${normalizedPhone}`
                              : 'بدون جوال'}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 bg-slate-50 rounded-md p-2.5 leading-relaxed">
                      {message}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            إغلاق
          </button>

          {channelChoice === 'whatsapp_web' ? (
            <button
              type="button"
              onClick={handleConfirmAllWeb}
              disabled={sending || candidates.length === 0}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{sending ? 'جارٍ التسجيل...' : 'تأكيد تسجيل الكل في سجل الأحداث'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleAutomatedSend}
              disabled={sending || candidates.length === 0}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>
                {sending
                  ? 'جارٍ إرسال الرسائل...'
                  : `تنفيذ الإرسال الآن (${candidates.length})`}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
