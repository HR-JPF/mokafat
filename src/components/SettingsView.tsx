import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Cloud,
  Database,
  Download,
  KeyRound,
  Mail,
  MessageCircle,
  MessageSquareText,
  RotateCcw,
  Save,
  Send,
  Upload,
} from 'lucide-react';
import { renderDecisionMessage } from '../lib/attendanceEngine';
import {
  DEFAULT_SETTINGS,
  type ServerSecretsStatus,
  type UserSettings,
} from '../types';

interface SettingsViewProps {
  settings: UserSettings;
  secretsStatus: ServerSecretsStatus;
  cloudConnectedEmail?: string | null;
  onConnectCloud?: () => Promise<void>;
  onExportBackup?: () => void;
  onImportBackup?: (file: File) => Promise<void>;
  onSaveSettings: (next: UserSettings) => Promise<void>;
  onTestWhatsApp: (phone: string, draft: UserSettings) => Promise<{ ok: boolean; error?: string }>;
  onTestEmail: (toEmail: string, draft: UserSettings) => Promise<{ ok: boolean; error?: string }>;
}

type SettingsTab = 'attendance' | 'whatsapp' | 'email' | 'templates' | 'backup';

const PLACEHOLDERS = [
  '{الاسم}',
  '{الأسبوع}',
  '{دقائق_التأخير}',
  '{أيام_التأخير}',
  '{البصمات_الناقصة}',
  '{أيام_الغياب}',
];

export function SettingsView({
  settings,
  secretsStatus,
  cloudConnectedEmail,
  onConnectCloud,
  onExportBackup,
  onImportBackup,
  onSaveSettings,
  onTestWhatsApp,
  onTestEmail,
}: SettingsViewProps) {
  const [tab, setTab] = useState<SettingsTab>('attendance');
  const [draft, setDraft] = useState<UserSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [testEmailAddr, setTestEmailAddr] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [importingBackup, setImportingBackup] = useState(false);
  const backupInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const updateField = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSavedMsg(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedMsg(null);
    try {
      await onSaveSettings(draft);
      setSavedMsg('تم حفظ الإعدادات وتحديث قواعد التقييم بنجاح.');
    } finally {
      setSaving(false);
    }
  };

  const handleRunWhatsAppTest = async () => {
    if (!testPhone.trim()) {
      setTestResult({ ok: false, text: 'أدخل رقم واتساب للاختبار أولاً.' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await onTestWhatsApp(testPhone.trim(), draft);
      setTestResult({
        ok: res.ok,
        text: res.ok ? 'تم إرسال رسالة الاختبار عبر الواتساب بنجاح.' : res.error || 'فشل اختبار الواتساب.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleRunEmailTest = async () => {
    if (!testEmailAddr.trim()) {
      setTestResult({ ok: false, text: 'أدخل بريد إلكتروني للاختبار أولاً.' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await onTestEmail(testEmailAddr.trim(), draft);
      setTestResult({
        ok: res.ok,
        text: res.ok ? 'تم إرسال بريد الاختبار بنجاح.' : res.error || 'فشل اختبار البريد الإلكتروني.',
      });
    } finally {
      setTesting(false);
    }
  };

  const sampleEval = {
    employeeName: 'سالم العتيبي',
    totalLateMinutes: 25,
    lateDaysCount: 2,
    missingPunchDays: 1,
    absentDays: 0,
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold font-display text-slate-900">إعدادات النظام</h1>
          <p className="text-xs text-slate-500 mt-1">
            ضبط قواعد الالتزام من الأحد للخميس، وإعدادات الواتساب والبريد الإلكتروني، وقوالب الرسائل الثلاث
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'جارٍ الحفظ...' : 'حفظ جميع الإعدادات'}</span>
        </button>
      </div>

      {savedMsg && (
        <div
          role="status"
          className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-900 flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{savedMsg}</span>
        </div>
      )}

      {/* Settings Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {(
          [
            ['attendance', 'قواعد الدوام والالتزام', Clock],
            ['whatsapp', 'إعدادات الواتساب', MessageCircle],
            ['email', 'إعدادات البريد الإلكتروني', Mail],
            ['templates', 'قوالب الرسائل الثلاث', MessageSquareText],
            ['backup', 'الحفظ الدائم والنسخ الاحتياطي', Database],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTab(key);
              setTestResult(null);
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              tab === key
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Tab 1: Attendance Rules */}
      {tab === 'attendance' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div>
            <h2 className="text-base font-bold font-display text-slate-900 mb-1">
              مواعيد الدوام وفترة السماح (الأحد – الخميس)
            </h2>
            <p className="text-xs text-slate-500">
              يعتمد النظام على هذه الأوقات لتصنيف الموظف كـ «ملتزم» أو «غير ملتزم» تلقائياً بعد رفع ملف ZKTeco.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <div>
              <label htmlFor="work-start" className="block text-xs font-semibold text-slate-700 mb-1.5">
                وقت بداية الدوام الرسمي
              </label>
              <input
                id="work-start"
                type="time"
                value={draft.workStartTime}
                onChange={(e) => updateField('workStartTime', e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label htmlFor="work-end" className="block text-xs font-semibold text-slate-700 mb-1.5">
                وقت نهاية الدوام الرسمي
              </label>
              <input
                id="work-end"
                type="time"
                value={draft.workEndTime}
                onChange={(e) => updateField('workEndTime', e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label htmlFor="grace-late" className="block text-xs font-semibold text-slate-700 mb-1.5">
                فترة السماح للتأخير الصباحي (دقائق)
              </label>
              <input
                id="grace-late"
                type="number"
                min={0}
                max={180}
                value={draft.graceLateMinutes}
                onChange={(e) => updateField('graceLateMinutes', Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label htmlFor="grace-early" className="block text-xs font-semibold text-slate-700 mb-1.5">
                فترة السماح للانصراف المبكر (دقائق)
              </label>
              <input
                id="grace-early"
                type="number"
                min={0}
                max={180}
                value={draft.graceEarlyMinutes}
                onChange={(e) => updateField('graceEarlyMinutes', Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label htmlFor="max-late-days" className="block text-xs font-semibold text-slate-700 mb-1.5">
                الحد الأقصى لأيام التأخير المسموحة أسبوعياً
              </label>
              <input
                id="max-late-days"
                type="number"
                min={0}
                max={5}
                value={draft.maxLateDaysAllowed}
                onChange={(e) => updateField('maxLateDaysAllowed', Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label htmlFor="max-late-mins" className="block text-xs font-semibold text-slate-700 mb-1.5">
                الحد الأقصى لمجموع دقائق التأخير أسبوعياً
              </label>
              <input
                id="max-late-mins"
                type="number"
                min={0}
                max={600}
                value={draft.maxTotalLateMinutes}
                onChange={(e) => updateField('maxTotalLateMinutes', Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.thursdayMorningOnly}
                onChange={(e) => updateField('thursdayMorningOnly', e.target.checked)}
                className="mt-1 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
              />
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  احتساب دخول صباح الخميس فقط (موصى به لمكافأة الخروج بعد ١٢ ظهراً)
                </div>
                <div className="text-xs text-slate-500">
                  يتحقق النظام من أول وآخر بصمة لأيام الأحد–الأربعاء، ومن أول بصمة صباحية فقط ليوم الخميس دون اشتراط بصمة الانصراف.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.countMissingPunchAsNonCompliant}
                onChange={(e) =>
                  updateField('countMissingPunchAsNonCompliant', e.target.checked)
                }
                className="mt-1 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
              />
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  اعتبار البصمة الناقصة (عدم تسجيل الخروج) مخالفة للالتزام
                </div>
                <div className="text-xs text-slate-500">
                  يمكن للمدير دائماً استثناء أي يوم محدد من جدول التقييم عند التأكد من وجود عذر.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.countAbsenceAsNonCompliant}
                onChange={(e) => updateField('countAbsenceAsNonCompliant', e.target.checked)}
                className="mt-1 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
              />
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  اعتبار الغياب بدون استثناء مخالفة للالتزام
                </div>
              </div>
            </label>
          </div>
        </div>
      )}

      {/* Tab 2: WhatsApp Settings */}
      {tab === 'whatsapp' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div>
            <h2 className="text-base font-bold font-display text-slate-900 mb-1">
              إعدادات إرسال الواتساب
            </h2>
            <p className="text-xs text-slate-500">
              يدعم النظام الإرسال الجماعي التلقائي عبر API إلى جانب خيار واتساب ويب الجاهز بدون اشتراك.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label htmlFor="wa-mode" className="block text-xs font-semibold text-slate-700 mb-1.5">
                وضع الإرسال الافتراضي
              </label>
              <select
                id="wa-mode"
                value={draft.whatsappMode}
                onChange={(e) =>
                  updateField('whatsappMode', e.target.value as UserSettings['whatsappMode'])
                }
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
              >
                <option value="both">دعم الاثنين معاً (API تلقائي + واتساب ويب)</option>
                <option value="web">واتساب ويب فقط (روابط مباشرة بدون API)</option>
                <option value="api">API تلقائي فقط</option>
              </select>
            </div>

            <div>
              <label htmlFor="wa-cc" className="block text-xs font-semibold text-slate-700 mb-1.5">
                رمز الدولة الافتراضي للأرقام المحلية
              </label>
              <input
                id="wa-cc"
                type="text"
                dir="ltr"
                value={draft.defaultCountryCode}
                onChange={(e) => updateField('defaultCountryCode', e.target.value)}
                placeholder="966"
                className="w-full px-3 py-2 text-sm font-mono text-left bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label htmlFor="wa-provider" className="block text-xs font-semibold text-slate-700 mb-1.5">
                مزود الواتساب API
              </label>
              <select
                id="wa-provider"
                value={draft.whatsappProvider}
                onChange={(e) =>
                  updateField(
                    'whatsappProvider',
                    e.target.value as UserSettings['whatsappProvider']
                  )
                }
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
              >
                <option value="cloud_api">WhatsApp Cloud API (Meta الرسمي)</option>
                <option value="ultramsg">UltraMsg API</option>
                <option value="webhook">Webhook HTTPS مخصص (n8n / Evolution API)</option>
              </select>
            </div>

            {draft.whatsappProvider === 'cloud_api' && (
              <div>
                <label htmlFor="wa-pid" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  معرف رقم الهاتف (Phone Number ID)
                </label>
                <input
                  id="wa-pid"
                  type="text"
                  dir="ltr"
                  value={draft.whatsappPhoneNumberId}
                  onChange={(e) => updateField('whatsappPhoneNumberId', e.target.value)}
                  placeholder="مثال: 109283746501234"
                  className="w-full px-3 py-2 text-sm font-mono text-left bg-white border border-slate-300 rounded-lg"
                />
              </div>
            )}

            {draft.whatsappProvider === 'ultramsg' && (
              <div>
                <label htmlFor="wa-inst" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  معرف الجلسة (Instance ID)
                </label>
                <input
                  id="wa-inst"
                  type="text"
                  dir="ltr"
                  value={draft.whatsappInstanceId}
                  onChange={(e) => updateField('whatsappInstanceId', e.target.value)}
                  placeholder="مثال: instance98765"
                  className="w-full px-3 py-2 text-sm font-mono text-left bg-white border border-slate-300 rounded-lg"
                />
              </div>
            )}

            {draft.whatsappProvider === 'webhook' && (
              <div>
                <label htmlFor="wa-webhook" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  رابط Webhook (HTTPS فقط)
                </label>
                <input
                  id="wa-webhook"
                  type="url"
                  dir="ltr"
                  value={draft.whatsappWebhookUrl}
                  onChange={(e) => updateField('whatsappWebhookUrl', e.target.value)}
                  placeholder="https://your-gateway.example.com/send-whatsapp"
                  className="w-full px-3 py-2 text-sm font-mono text-left bg-white border border-slate-300 rounded-lg"
                />
              </div>
            )}
          </div>

          {/* Server Secret Status Box */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs space-y-2">
            <div className="flex items-center gap-2 font-semibold text-slate-800">
              <KeyRound className="w-4 h-4 text-teal-700" />
              <span>حالة مفاتيح الواتساب الآمنة على الخادم</span>
            </div>
            <p className="text-slate-600 leading-relaxed">
              حمايةً لبياناتك، تُحفظ رموز الوصول السرية (Access Token) داخل متغيرات البيئة على الخادم ولا تُخزن في المتصفح:
            </p>
            <div className="flex flex-wrap gap-4 font-mono text-[11px] pt-1" dir="ltr">
              <span className={secretsStatus.whatsappCloudConfigured ? 'text-emerald-700' : 'text-slate-500'}>
                WHATSAPP_API_TOKEN: {secretsStatus.whatsappCloudConfigured ? 'مفعّل' : 'غير مضاف'}
              </span>
              <span className={secretsStatus.whatsappUltramsgConfigured ? 'text-emerald-700' : 'text-slate-500'}>
                WHATSAPP_ULTRAMSG_TOKEN: {secretsStatus.whatsappUltramsgConfigured ? 'مفعّل' : 'غير مضاف'}
              </span>
              <span className={secretsStatus.whatsappWebhookSecretConfigured ? 'text-emerald-700' : 'text-slate-500'}>
                WHATSAPP_WEBHOOK_SECRET: {secretsStatus.whatsappWebhookSecretConfigured ? 'مفعّل' : 'اختياري'}
              </span>
            </div>
          </div>

          {/* Test Send */}
          <div className="pt-4 border-t border-slate-200">
            <label htmlFor="wa-test-phone" className="block text-xs font-semibold text-slate-700 mb-2">
              اختبار إرسال رسالة واتساب عبر API
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="wa-test-phone"
                type="tel"
                dir="ltr"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="966501234567"
                className="w-64 px-3 py-2 text-sm font-mono text-left bg-white border border-slate-300 rounded-lg"
              />
              <button
                type="button"
                onClick={handleRunWhatsAppTest}
                disabled={testing}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>{testing ? 'جارٍ الاختبار...' : 'إرسال رسالة اختبار'}</span>
              </button>
            </div>
            {testResult && (
              <div
                className={`mt-3 text-xs p-3 rounded-lg border ${
                  testResult.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}
              >
                {testResult.text}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Email Settings */}
      {tab === 'email' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold font-display text-slate-900 mb-1">
                إعدادات إرسال البريد الإلكتروني (SMTP)
              </h2>
              <p className="text-xs text-slate-500">
                أرسل نسخة من قرار المكافأة عبر البريد الإلكتروني للموظفين بالتوازي مع الواتساب أو بشكل مستقل.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.emailEnabled}
                onChange={(e) => updateField('emailEnabled', e.target.checked)}
                className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
              />
              <span>تفعيل الإرسال بالبريد</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <div>
              <label htmlFor="smtp-host" className="block text-xs font-semibold text-slate-700 mb-1.5">
                خادم SMTP
              </label>
              <input
                id="smtp-host"
                type="text"
                dir="ltr"
                value={draft.smtpHost}
                onChange={(e) => updateField('smtpHost', e.target.value)}
                placeholder="smtp.gmail.com"
                className="w-full px-3 py-2 text-sm font-mono text-left bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label htmlFor="smtp-port" className="block text-xs font-semibold text-slate-700 mb-1.5">
                المنفذ (Port)
              </label>
              <input
                id="smtp-port"
                type="number"
                dir="ltr"
                value={draft.smtpPort}
                onChange={(e) => updateField('smtpPort', Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono text-left bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div className="flex items-end pb-2">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.smtpSecure}
                  onChange={(e) => updateField('smtpSecure', e.target.checked)}
                  className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span>استخدام SSL/TLS مباشر (منفذ 465)</span>
              </label>
            </div>

            <div>
              <label htmlFor="smtp-user" className="block text-xs font-semibold text-slate-700 mb-1.5">
                اسم مستخدم SMTP (البريد)
              </label>
              <input
                id="smtp-user"
                type="email"
                dir="ltr"
                value={draft.smtpUser}
                onChange={(e) => updateField('smtpUser', e.target.value)}
                placeholder="hr@company.sa"
                className="w-full px-3 py-2 text-sm font-mono text-left bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label htmlFor="email-from-name" className="block text-xs font-semibold text-slate-700 mb-1.5">
                اسم المرسل الظاهر
              </label>
              <input
                id="email-from-name"
                type="text"
                value={draft.emailFromName}
                onChange={(e) => updateField('emailFromName', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label htmlFor="email-from-addr" className="block text-xs font-semibold text-slate-700 mb-1.5">
                عنوان المرسل (From Email)
              </label>
              <input
                id="email-from-addr"
                type="email"
                dir="ltr"
                value={draft.emailFromAddress}
                onChange={(e) => updateField('emailFromAddress', e.target.value)}
                placeholder="hr@company.sa"
                className="w-full px-3 py-2 text-sm font-mono text-left bg-white border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label htmlFor="email-subject" className="block text-xs font-semibold text-slate-700 mb-1.5">
              عنوان رسالة البريد الإلكتروني
            </label>
            <input
              id="email-subject"
              type="text"
              value={draft.emailSubject}
              onChange={(e) => updateField('emailSubject', e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-slate-800">
              <KeyRound className="w-4 h-4 text-teal-700" />
              <span>كلمة مرور البريد (SMTP_PASS)</span>
            </div>
            <p className="text-slate-600">
              تُقرأ كلمة مرور التطبيق (App Password) بأمان من متغير البيئة{' '}
              <span className="font-mono">SMTP_PASS</span> على الخادم. الحالة الحالية:{' '}
              <strong className={secretsStatus.smtpPasswordConfigured ? 'text-emerald-700' : 'text-amber-700'}>
                {secretsStatus.smtpPasswordConfigured ? 'مفعّلة وجاهزة' : 'غير مضافة بعد'}
              </strong>
            </p>
          </div>

          <div className="pt-4 border-t border-slate-200">
            <label htmlFor="email-test-to" className="block text-xs font-semibold text-slate-700 mb-2">
              اختبار إرسال بريد إلكتروني
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="email-test-to"
                type="email"
                dir="ltr"
                value={testEmailAddr}
                onChange={(e) => setTestEmailAddr(e.target.value)}
                placeholder="manager@company.sa"
                className="w-64 px-3 py-2 text-sm font-mono text-left bg-white border border-slate-300 rounded-lg"
              />
              <button
                type="button"
                onClick={handleRunEmailTest}
                disabled={testing}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
              >
                <Mail className="w-4 h-4" />
                <span>{testing ? 'جارٍ الاختبار...' : 'إرسال بريد تجريبي'}</span>
              </button>
            </div>
            {testResult && (
              <div
                className={`mt-3 text-xs p-3 rounded-lg border ${
                  testResult.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}
              >
                {testResult.text}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Message Templates */}
      {tab === 'templates' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold font-display text-slate-900 mb-1">
                قوالب الرسائل الثلاث
              </h2>
              <p className="text-xs text-slate-500">
                يمكنك استخدام المتغيرات التالية ليتم استبدالها تلقائياً ببيانات كل موظف:{' '}
                <span className="font-mono text-slate-700">{PLACEHOLDERS.join(' · ')}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  templateReward: DEFAULT_SETTINGS.templateReward,
                  templateAllowWithWarning: DEFAULT_SETTINGS.templateAllowWithWarning,
                  templateDenyReward: DEFAULT_SETTINGS.templateDenyReward,
                }))
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>استعادة النصوص الافتراضية</span>
            </button>
          </div>

          <div className="space-y-5">
            <div>
              <label htmlFor="tpl-reward" className="block text-xs font-semibold text-emerald-800 mb-1.5">
                1) رسالة المكافأة الأسبوعية (للملتزمين + خيار السماح الأول لغير الملتزمين)
              </label>
              <textarea
                id="tpl-reward"
                rows={3}
                value={draft.templateReward}
                onChange={(e) => updateField('templateReward', e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg leading-relaxed"
              />
              <div className="mt-1.5 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md p-2.5">
                معاينة: {renderDecisionMessage('reward', sampleEval, '2026-11-22 إلى 2026-11-26', draft)}
              </div>
            </div>

            <div>
              <label htmlFor="tpl-warn" className="block text-xs font-semibold text-amber-800 mb-1.5">
                2) رسالة السماح الاستثنائي مع تنبيه بالالتزام (الخيار الثاني)
              </label>
              <textarea
                id="tpl-warn"
                rows={3}
                value={draft.templateAllowWithWarning}
                onChange={(e) => updateField('templateAllowWithWarning', e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg leading-relaxed"
              />
              <div className="mt-1.5 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md p-2.5">
                معاينة:{' '}
                {renderDecisionMessage(
                  'allow_with_warning',
                  sampleEval,
                  '2026-11-22 إلى 2026-11-26',
                  draft
                )}
              </div>
            </div>

            <div>
              <label htmlFor="tpl-deny" className="block text-xs font-semibold text-red-800 mb-1.5">
                3) رسالة عدم منح المكافأة بسبب التأخيرات (الخيار الثالث)
              </label>
              <textarea
                id="tpl-deny"
                rows={3}
                value={draft.templateDenyReward}
                onChange={(e) => updateField('templateDenyReward', e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg leading-relaxed"
              />
              <div className="mt-1.5 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md p-2.5">
                معاينة:{' '}
                {renderDecisionMessage(
                  'deny_reward',
                  sampleEval,
                  '2026-11-22 إلى 2026-11-26',
                  draft
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: Permanent Storage & Backup */}
      {tab === 'backup' && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Cloud className="w-5 h-5 text-teal-700" />
                  <h2 className="text-base font-bold font-display text-slate-900">
                    المزامنة السحابية الدائمة (Cloud Firestore)
                  </h2>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
                  يحفظ النظام نسخة احتياطية تلقائية داخل متصفحك لتفادي فقدان البيانات عند التحديث أو إعادة تشغيل الخادم. وللحفظ السحابي الدائم عبر جميع أجهزتك، اربط حساب Google الخاص بك مرة واحدة.
                </p>
              </div>
              {cloudConnectedEmail ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>مرتبط بالسحابة ({cloudConnectedEmail})</span>
                </span>
              ) : onConnectCloud ? (
                <button
                  type="button"
                  onClick={() => void onConnectCloud()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 cursor-pointer shrink-0"
                >
                  <Cloud className="w-4 h-4" />
                  <span>ربط الحفظ السحابي بحساب Google</span>
                </button>
              ) : null}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold font-display text-slate-900 mb-1">
                نسخ احتياطي واستعادة فورية (ملف JSON)
              </h2>
              <p className="text-xs text-slate-500">
                قم بتنزيل نسخة كاملة من دليل الموظفين وملفات البصمة المرفوعة وسجل الأحداث والإعدادات، أو استرجعها في أي وقت بضغطة زر.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {onExportBackup && (
                <button
                  type="button"
                  onClick={onExportBackup}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>تنزيل نسخة احتياطية الآن</span>
                </button>
              )}

              {onImportBackup && (
                <>
                  <input
                    ref={backupInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      setImportingBackup(true);
                      try {
                        await onImportBackup(file);
                      } finally {
                        setImportingBackup(false);
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={importingBackup}
                    onClick={() => backupInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-teal-700" />
                    <span>{importingBackup ? 'جارٍ الاستعادة...' : 'استعادة من نسخة احتياطية'}</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
