import React, { useState } from 'react';
import {
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  LogIn,
  Play,
  ShieldCheck,
  User as UserIcon,
  UserPlus,
} from 'lucide-react';

interface LoginViewProps {
  authInitialized: boolean;
  authStatusLoading: boolean;
  onPasswordLogin: (username: string, password: string) => Promise<void>;
  onFirstAdminSetup: (
    username: string,
    password: string,
    displayName: string
  ) => Promise<void>;
  onGoogleSignIn: () => void;
  onEnterDemo: () => void;
  loading: boolean;
  error: string | null;
}

export function LoginView({
  authInitialized,
  authStatusLoading,
  onPasswordLogin,
  onFirstAdminSetup,
  onGoogleSignIn,
  onEnterDemo,
  loading,
  error,
}: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!username.trim()) {
      setLocalError('يرجى إدخال اسم المستخدم.');
      return;
    }
    if (!password) {
      setLocalError('يرجى إدخال الرقم السري.');
      return;
    }

    if (!authInitialized) {
      await onFirstAdminSetup(username.trim(), password, displayName.trim() || username.trim());
    } else {
      await onPasswordLogin(username.trim(), password);
    }
  };

  const activeError = localError || error;

  return (
    <div dir="rtl" className="min-h-screen bg-[#F8FAFC] flex flex-col lg:flex-row">
      {/* Right Editorial Panel (in RTL) */}
      <div className="lg:w-[52%] bg-slate-900 text-white p-10 lg:p-16 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 rounded-lg bg-teal-600 flex items-center justify-center">
              <Fingerprint className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold font-display tracking-tight">انضباط</span>
          </div>

          <h1 className="text-3xl lg:text-4xl font-bold font-display leading-snug max-w-xl mb-5 [text-wrap:balance]">
            تقييم بصمة الموظفين الأسبوعية وإدارة الصلاحيات ومكافأة الخميس
          </h1>
          <p className="text-slate-300 text-base leading-relaxed max-w-lg mb-10">
            ارفع ملف بصمة ZKTeco أو تقرير First &amp; Last ليقوم النظام بحساب أول وآخر بصمة من الأحد إلى الخميس، وتحديد قرارات المكافأة، وإرسال رسائل الواتساب والبريد، والتحكم الكامل بصلاحيات كل مستخدم.
          </p>

          <div className="grid sm:grid-cols-2 gap-6 max-w-xl border-t border-slate-800 pt-8">
            <div>
              <h2 className="text-sm font-semibold text-white mb-1.5">دخول مباشر باسم مستخدم ورقم سري</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                تسجيل دخول سريع بدون قيود تعقيد على الرقم السري مع إمكانية إنشاء حسابات متعددة لفريقك.
              </p>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white mb-1.5">لوحة تحكم كاملة بالصلاحيات</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                تحكم دقيق في صلاحيات كل مستخدم: رفع البصمة، قرارات المدير، إرسال الواتساب، الدليل، والإعدادات.
              </p>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white mb-1.5">إرسال عبر واتساب ويب و API والإيميل</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                ربط ذكي بدليل الموظفين مع روابط واتساب ويب الجاهزة وسجل أحداث كامل.
              </p>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white mb-1.5">تصدير Excel و PDF عربي</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                تقارير رسمية أسبوعية توضح جميع الموظفين، من تم السماح له ومن لم يُسمح له.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-slate-800 flex items-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="w-4 h-4 text-teal-400 shrink-0" />
          <span>يتم حفظ الأرقام السرية بشكل مشفّر على الخادم والتحقق من الصلاحيات تلقائياً في كل عملية.</span>
        </div>
      </div>

      {/* Left Sign-In / First-Run Setup Form Panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-16">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-8">
          <div className="mb-6">
            <h2 className="text-xl font-bold font-display text-slate-900 mb-1.5">
              {authStatusLoading
                ? 'جارٍ التحقق من النظام...'
                : authInitialized
                ? 'تسجيل الدخول للنظام'
                : 'إنشاء حساب المدير الأول'}
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              {authInitialized
                ? 'أدخل اسم المستخدم والرقم السري للدخول حسب صلاحياتك.'
                : 'اختر أي اسم مستخدم وأي رقم سري تريده بدون قيود لتفعيل حساب مدير النظام الرئيسي والدخول فوراً.'}
            </p>
          </div>

          {activeError && (
            <div
              role="alert"
              className="mb-5 p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 leading-relaxed"
            >
              {activeError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!authInitialized && !authStatusLoading && (
              <div>
                <label
                  htmlFor="login-display-name"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  الاسم الظاهر في النظام (اختياري)
                </label>
                <input
                  id="login-display-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="مثال: مدير الموارد البشرية"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="login-username"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                اسم المستخدم *
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="مثال: admin أو نور"
                  className="w-full pr-9 pl-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                الرقم السري / كلمة المرور *
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={authInitialized ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="أدخل أي رقم سري تختاره"
                  className="w-full pr-9 pl-10 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'إخفاء الرقم السري' : 'إظهار الرقم السري'}
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || authStatusLoading}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 disabled:opacity-60 transition-colors cursor-pointer"
            >
              {authInitialized ? (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>{loading ? 'جارٍ تسجيل الدخول...' : 'دخول'}</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>{loading ? 'جارٍ إنشاء الحساب...' : 'إنشاء حساب المدير والدخول'}</span>
                </>
              )}
            </button>
          </form>

          <div className="relative py-5 flex items-center justify-center">
            <div className="border-t border-slate-200 w-full" />
            <span className="bg-white px-3 text-xs text-slate-400 shrink-0">خيارات إضافية</span>
            <div className="border-t border-slate-200 w-full" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={onGoogleSignIn}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-60 transition-colors cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5 text-teal-700" />
              <span>دخول بحساب Google</span>
            </button>

            <button
              type="button"
              onClick={onEnterDemo}
              className="inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 text-teal-700" />
              <span>وضع المعاينة السريعة</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
