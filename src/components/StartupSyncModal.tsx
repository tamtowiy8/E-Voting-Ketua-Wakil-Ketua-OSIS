import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CloudCog,
  Code2,
  Copy,
  ExternalLink,
  Loader2,
  Lock,
  ShieldCheck,
  X,
} from 'lucide-react';
import { FIRESTORE_PROJECT_ID } from '../services/firebaseClient';
import { isValidGasWebAppUrl } from '../utils/gasGenerator';
import { isGasDevUrl } from '../utils/safeJson';
import {
  DEFAULT_GAS_WEB_APP_URL,
  MASKED_SYNC_EMAIL_BAR,
  type StartupSyncStep,
} from '../utils/startupSyncConfig';

interface StartupSyncModalProps {
  step: StartupSyncStep;
  firebaseVerified: boolean;
  onConfirmFirebase: () => Promise<void>;
  onConfirmGas: (url: string, skipPing?: boolean) => Promise<void>;
  onDismiss: () => void;
}

export function StartupSyncModal({
  step,
  firebaseVerified,
  onConfirmFirebase,
  onConfirmGas,
  onDismiss,
}: StartupSyncModalProps) {
  const [firebaseBusy, setFirebaseBusy] = useState(false);
  const [firebaseError, setFirebaseError] = useState<{
    message: string;
    isUnauthorizedDomain: boolean;
  } | null>(null);
  const [copiedDomain, setCopiedDomain] = useState(false);

  const [gasUrlInput, setGasUrlInput] = useState(DEFAULT_GAS_WEB_APP_URL);
  const [gasBusy, setGasBusy] = useState(false);
  const [gasError, setGasError] = useState<string | null>(null);

  useEffect(() => {
    if (step === 'GAS') {
      setGasError(null);
      setGasUrlInput((prev) => (prev.trim() ? prev : DEFAULT_GAS_WEB_APP_URL));
    } else if (step === 'FIREBASE') {
      setFirebaseError(null);
    }
  }, [step]);

  if (!step) return null;

  const activeHostname =
    typeof window !== 'undefined' ? window.location.hostname || 'localhost' : 'localhost';

  const handleCopyHostname = async () => {
    try {
      await navigator.clipboard.writeText(activeHostname);
      setCopiedDomain(true);
      window.setTimeout(() => setCopiedDomain(false), 2200);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleFirebaseSubmit = async () => {
    if (firebaseBusy) return;
    setFirebaseBusy(true);
    setFirebaseError(null);
    try {
      await onConfirmFirebase();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Gagal menghubungkan ke Google Sheets & Firebase Cloud.';
      const isDomainErr =
        msg.toLowerCase().includes('unauthorized-domain') ||
        msg.toLowerCase().includes('authorized domains');
      setFirebaseError({ message: msg, isUnauthorizedDomain: isDomainErr });
    } finally {
      setFirebaseBusy(false);
    }
  };

  const handleGasSubmit = async (skipPing = false) => {
    if (gasBusy) return;
    const cleanUrl = gasUrlInput.trim();
    if (!isValidGasWebAppUrl(cleanUrl)) {
      setGasError(
        'URL Web App Google Apps Script tidak valid. Harus diawali https://script.google.com/macros/...'
      );
      return;
    }
    setGasBusy(true);
    setGasError(null);
    try {
      await onConfirmGas(cleanUrl, skipPing);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Gagal memverifikasi Backend Google Apps Script.';
      setGasError(msg);
    } finally {
      setGasBusy(false);
    }
  };

  return (
    <div
      id="startup-sync-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="startup-sync-title"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl">
        {/* Top Modal Header */}
        <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-4 bg-slate-50">
          <div className="flex items-start gap-3.5 min-w-0">
            <div
              className={`w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 ${
                step === 'FIREBASE'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-sky-50 border-sky-200 text-sky-700'
              }`}
            >
              {step === 'FIREBASE' ? (
                <CloudCog className="w-5 h-5" aria-hidden="true" />
              ) : (
                <Code2 className="w-5 h-5" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-500">
                {step === 'FIREBASE'
                  ? 'Langkah 1 dari 2 · Integrasi Google Sheets & Firebase Cloud'
                  : 'Langkah 2 dari 2 · Backend Google Apps Script (Web App & Spreadsheet)'}
              </p>
              <h2
                id="startup-sync-title"
                className="text-base font-extrabold text-slate-900 mt-0.5 leading-snug"
              >
                {step === 'FIREBASE'
                  ? 'Sinkronkan Integrasi Google Sheets & Firebase Cloud'
                  : 'Konfirmasi Backend Google Apps Script'}
              </h2>
            </div>
          </div>

          <button
            type="button"
            id="startup-sync-close-btn"
            onClick={onDismiss}
            aria-label="Tutup notifikasi sinkronisasi"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        {step === 'FIREBASE' ? (
          <div className="p-6 space-y-5">
            <p className="text-sm text-slate-600 leading-relaxed">
              Aplikasi belum terhubung ke{' '}
              <strong className="text-slate-900">Integrasi Google Sheets &amp; Firebase Cloud</strong>{' '}
              dan <strong className="text-slate-900">Backend Google Apps Script</strong>. Silakan
              konfirmasi akun pengelola di bawah ini untuk menyinkronkan data pemilihan secara
              otomatis.
            </p>

            {/* Masked Confirmation Email Bar */}
            <div className="space-y-2">
              <label
                htmlFor="startup-firebase-email-bar"
                className="block text-xs font-bold text-slate-700"
              >
                Bilah Konfirmasi Email Pengelola
              </label>
              <div className="flex items-center gap-3 px-3.5 h-12 rounded-xl border border-slate-300 bg-slate-50">
                <Lock className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                <input
                  id="startup-firebase-email-bar"
                  type="text"
                  readOnly
                  value={MASKED_SYNC_EMAIL_BAR}
                  aria-label="Email akun terkonfirmasi (tersembunyi)"
                  className="flex-1 bg-transparent text-sm font-mono font-bold tracking-[0.22em] text-slate-900 select-none focus:outline-none cursor-default"
                />
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 shrink-0">
                  <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                  <span>Terkunci</span>
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Alamat email disembunyikan demi privasi. Pembuka aplikasi cukup menekan tombol
                konfirmasi untuk melakukan verifikasi Google &amp; Firebase Cloud.
              </p>
            </div>

            {firebaseError && (
              <div
                id="startup-firebase-error"
                role="alert"
                className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 space-y-2.5"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="leading-relaxed font-medium">{firebaseError.message}</p>
                </div>

                {firebaseError.isUnauthorizedDomain && (
                  <div className="pt-2 border-t border-rose-200 space-y-2">
                    <p className="text-[11px] text-rose-800">
                      Tambahkan hostname{' '}
                      <code className="px-1.5 py-0.5 rounded bg-white border border-rose-200 font-mono font-bold">
                        {activeHostname}
                      </code>{' '}
                      ke Firebase Authorized Domains agar login Google di domain ini diizinkan:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleCopyHostname}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-rose-300 text-[11px] font-bold text-rose-900 hover:bg-rose-100 cursor-pointer"
                      >
                        {copiedDomain ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                            <span>Domain Disalin</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Salin Domain</span>
                          </>
                        )}
                      </button>
                      <a
                        href={`https://console.firebase.google.com/project/${FIRESTORE_PROJECT_ID}/authentication/settings`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-[11px] font-bold"
                      >
                        <span>Buka Authorized Domains</span>
                        <ExternalLink className="w-3 h-3" aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2">
              <button
                type="button"
                id="startup-dismiss-btn"
                disabled={firebaseBusy}
                onClick={onDismiss}
                className="px-4 h-11 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Nanti Saja
              </button>
              <button
                type="button"
                id="startup-confirm-firebase-btn"
                disabled={firebaseBusy}
                onClick={handleFirebaseSubmit}
                className="inline-flex items-center justify-center gap-2 px-5 h-11 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
              >
                {firebaseBusy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>Memverifikasi...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    <span>Konfirmasi &amp; Sinkronkan</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-5">
            {firebaseVerified && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                <span className="font-semibold">
                  Integrasi Google Sheets &amp; Firebase Cloud terverifikasi. Lanjutkan konfirmasi
                  Backend Google Apps Script di bawah ini.
                </span>
              </div>
            )}

            <p className="text-sm text-slate-600 leading-relaxed">
              URL Deployment Web App Google Apps Script telah disiapkan. Konfirmasikan koneksi agar
              database pemilihan tersinkronisasi otomatis ke Spreadsheet Apps Script.
            </p>

            {/* Pre-filled Google Apps Script Web App Confirmation Bar */}
            <div className="space-y-2">
              <label
                htmlFor="startup-gas-url-input"
                className="block text-xs font-bold text-slate-700"
              >
                URL Deployment Web App Google Apps Script
              </label>
              <input
                id="startup-gas-url-input"
                type="url"
                value={gasUrlInput}
                onChange={(e) => {
                  setGasUrlInput(e.target.value);
                  setGasError(null);
                }}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="w-full h-11 px-3.5 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white text-xs font-mono text-slate-900"
              />
              {isGasDevUrl(gasUrlInput) && (
                <p className="text-[11px] text-amber-800 font-medium">
                  URL berakhiran /dev memerlukan login Google. Pastikan menggunakan URL berakhiran
                  /exec.
                </p>
              )}
            </div>

            {gasError && (
              <div
                id="startup-gas-error"
                role="alert"
                className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 space-y-2"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="leading-relaxed">{gasError}</p>
                </div>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2.5 pt-2">
              <button
                type="button"
                id="startup-gas-dismiss-btn"
                disabled={gasBusy}
                onClick={onDismiss}
                className="px-4 h-11 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Nanti Saja
              </button>

              <div className="flex flex-col sm:flex-row gap-2">
                {gasError && isValidGasWebAppUrl(gasUrlInput) && (
                  <button
                    type="button"
                    id="startup-save-gas-anyway-btn"
                    disabled={gasBusy}
                    onClick={() => void handleGasSubmit(true)}
                    className="px-4 h-11 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-800 cursor-pointer"
                  >
                    Simpan URL Tetap Lanjutkan
                  </button>
                )}
                <button
                  type="button"
                  id="startup-confirm-gas-btn"
                  disabled={!gasUrlInput.trim() || gasBusy}
                  onClick={() => void handleGasSubmit(false)}
                  className="inline-flex items-center justify-center gap-2 px-5 h-11 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
                >
                  {gasBusy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      <span>Menghubungkan...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                      <span>Konfirmasi &amp; Hubungkan</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
