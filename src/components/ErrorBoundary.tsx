import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'حدث خطأ غير متوقع في التطبيق.',
    };
  }

  componentDidCatch(error: Error) {
    console.error('Application ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6"
        >
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-8 text-right">
            <div className="flex items-center gap-3 text-red-700 mb-4">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-lg font-semibold font-display">تعذّر إتمام العملية</h1>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-6">
              واجه النظام خطأً أثناء معالجة البيانات أو الاتصال بقاعدة البيانات السحابية. يمكنك إعادة تحميل الصفحة للمتابعة.
            </p>
            <details className="mb-6 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-500 font-mono" dir="ltr">
              <summary className="cursor-pointer font-sans text-right text-slate-700 mb-2">تفاصيل تقنية</summary>
              <div className="break-all whitespace-pre-wrap">{this.state.message}</div>
            </details>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-teal-700 text-white rounded-lg hover:bg-teal-800 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>إعادة تحميل النظام</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
