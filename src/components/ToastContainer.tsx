import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import type { ToastMessage } from '../types/evoting';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-20 right-4 z-[60] flex flex-col gap-2.5 max-w-xs sm:max-w-sm w-full pointer-events-none"
      aria-live="polite"
      aria-label="Notifikasi sistem"
    >
      {toasts.map((toast) => {
        const isSuccess = toast.type === 'success';
        const isError = toast.type === 'error';

        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-lg bg-white transition-all duration-200 ${
              isSuccess
                ? 'border-emerald-200'
                : isError
                  ? 'border-rose-200'
                  : 'border-slate-200'
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {isSuccess ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600" aria-hidden="true" />
              ) : isError ? (
                <AlertCircle className="w-5 h-5 text-rose-600" aria-hidden="true" />
              ) : (
                <Info className="w-5 h-5 text-[#1E3A5F]" aria-hidden="true" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
              {toast.description && (
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{toast.description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label={`Tutup notifikasi ${toast.title}`}
              className="shrink-0 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
