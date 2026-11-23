import { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MessageCircle,
  QrCode,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { AdminRole, AdminUser, DatabaseState } from '../types/evoting';
import {
  addAuditLog,
  generateSixDigitToken,
  maskWhatsappNumber,
  normalizeWhatsappNumber,
  validateAdminQrLogin,
} from '../utils/electionLogic';
import {
  apiAdminQrLogin,
  apiRequestForgotPassword,
  apiResetForgotPassword,
} from '../utils/storage';
import { VoterQrScanner } from './VoterQrScanner';

interface AdminLoginPageProps {
  db: DatabaseState;
  onAdminLogin: (admin: AdminUser) => void;
  onDbUpdated: (nextDb: DatabaseState) => void;
  onBackToVoterPortal: () => void;
  onOpenLiveMonitor: () => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

interface ForgotChallenge {
  maskedWhatsapp: string;
  waUrl: string;
  otpPreview: string;
  adminFullName: string;
  role: AdminRole;
  offlineAdminId?: string;
}

export function AdminLoginPage({
  db,
  onAdminLogin,
  onDbUpdated,
  onBackToVoterPortal,
  onOpenLiveMonitor,
  onNotify,
}: AdminLoginPageProps) {
  const [loginMethod, setLoginMethod] = useState<'PASSWORD' | 'QR_CODE'>('PASSWORD');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Lupa Kata Sandi via WhatsApp state
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotStep, setForgotStep] = useState<'REQUEST' | 'VERIFY'>('REQUEST');
  const [forgotUsername, setForgotUsername] = useState('');
  const [forgotWhatsapp, setForgotWhatsapp] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [challenge, setChallenge] = useState<ForgotChallenge | null>(null);

  const handleAdminSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    setAdminError(null);

    const trimmedUser = username.trim();
    if (!trimmedUser || !password) {
      const msg = 'Masukkan username dan kata sandi pengelola.';
      setAdminError(msg);
      onNotify('error', 'Data Belum Lengkap', msg);
      return;
    }

    setIsLoggingIn(true);
    window.setTimeout(() => {
      const found = db.admins.find(
        (a) => a.username.toLowerCase() === trimmedUser.toLowerCase() && a.password === password
      );
      setIsLoggingIn(false);

      if (!found) {
        const msg = 'Username atau kata sandi admin tidak valid.';
        setAdminError(msg);
        onNotify('error', 'Login Admin Gagal', msg);
        return;
      }

      onNotify('success', 'Login Pengelola Berhasil', `Masuk sebagai ${found.fullName} (${found.role}).`);
      onAdminLogin(found);
    }, 350);
  };

  const handleAdminQrScan = async (rawPayload: string) => {
    if (isLoggingIn) return;
    setAdminError(null);
    setIsLoggingIn(true);
    try {
      const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
      if (isOnline) {
        const serverRes = await apiAdminQrLogin(rawPayload);
        if (serverRes) {
          if (!serverRes.ok || !serverRes.admin) {
            const msg = serverRes.error || 'QR Code Panitia tidak valid.';
            setAdminError(msg);
            onNotify('error', 'Login QR Gagal', msg);
            return;
          }
          onNotify(
            'success',
            'Login QR Berhasil',
            `Masuk sebagai ${serverRes.admin.fullName} (${serverRes.admin.role}).`
          );
          onAdminLogin(serverRes.admin);
          return;
        }
      }

      const localCheck = validateAdminQrLogin(db.admins, rawPayload);
      if (!localCheck.ok) {
        setAdminError(localCheck.error);
        onNotify('error', 'Login QR Gagal', localCheck.error);
        return;
      }

      onNotify(
        'success',
        'Login QR Berhasil',
        `Masuk sebagai ${localCheck.admin.fullName} (${localCheck.admin.role}).`
      );
      onAdminLogin(localCheck.admin);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const openForgotModal = () => {
    setForgotUsername(username.trim());
    setForgotWhatsapp('');
    setForgotOtp('');
    setForgotNewPassword('');
    setForgotConfirmPassword('');
    setShowForgotPassword(false);
    setForgotError(null);
    setChallenge(null);
    setForgotStep('REQUEST');
    setForgotOpen(true);
  };

  const handleRequestForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (forgotLoading) return;
    setForgotError(null);

    const u = forgotUsername.trim();
    const waNorm = normalizeWhatsappNumber(forgotWhatsapp);
    if (!u || !waNorm) {
      setForgotError('Masukkan username pengelola dan nomor WhatsApp yang terdaftar.');
      return;
    }

    setForgotLoading(true);
    const serverRes = await apiRequestForgotPassword(u, forgotWhatsapp);

    if (serverRes) {
      setForgotLoading(false);
      if (!serverRes.ok || !serverRes.waUrl || !serverRes.maskedWhatsapp) {
        setForgotError(serverRes.error || 'Gagal memverifikasi nomor WhatsApp.');
        return;
      }
      if (serverRes.db) {
        onDbUpdated(serverRes.db);
      }
      setChallenge({
        maskedWhatsapp: serverRes.maskedWhatsapp,
        waUrl: serverRes.waUrl,
        otpPreview: serverRes.otpPreview || '',
        adminFullName: serverRes.adminFullName || u,
        role: serverRes.role || 'ADMIN',
      });
      setForgotStep('VERIFY');
      onNotify(
        'success',
        'Konfirmasi WhatsApp Dibuat',
        `Kode konfirmasi dikirim ke WhatsApp ${serverRes.maskedWhatsapp}.`
      );
      return;
    }

    // Offline fallback using local database state
    const targetAdmin = db.admins.find((a) => a.username.toLowerCase() === u.toLowerCase());
    if (!targetAdmin) {
      setForgotLoading(false);
      setForgotError('Username pengelola tidak ditemukan.');
      return;
    }

    const storedWa = normalizeWhatsappNumber(targetAdmin.whatsappNumber || '');
    if (!storedWa || storedWa !== waNorm) {
      setForgotLoading(false);
      setForgotError(
        'Nomor WhatsApp tidak sesuai dengan nomor yang terdaftar pada Manajemen Akun Panitia.'
      );
      return;
    }

    const otp = generateSixDigitToken();
    const msg = `Konfirmasi Reset Kata Sandi ${targetAdmin.role} (${targetAdmin.fullName}) pada E-VOTING PENGURUS OSIS ${db.settings.schoolName}. Kode konfirmasi Anda: ${otp}`;
    const waUrl = `https://wa.me/${storedWa}?text=${encodeURIComponent(msg)}`;
    const masked = maskWhatsappNumber(targetAdmin.whatsappNumber || storedWa);
    const nextLogs = addAuditLog(
      db.auditLogs,
      targetAdmin.fullName,
      targetAdmin.role,
      'FORGOT_PASSWORD_REQUEST',
      `Mengirim kode konfirmasi lupa kata sandi ke WhatsApp ${masked}.`
    );
    onDbUpdated({ ...db, auditLogs: nextLogs });
    setForgotLoading(false);
    setChallenge({
      maskedWhatsapp: masked,
      waUrl,
      otpPreview: otp,
      adminFullName: targetAdmin.fullName,
      role: targetAdmin.role,
      offlineAdminId: targetAdmin.id,
    });
    setForgotStep('VERIFY');
    onNotify('success', 'Konfirmasi WhatsApp Dibuat', `Kode konfirmasi siap dikirim ke ${masked}.`);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (forgotLoading || !challenge) return;
    setForgotError(null);

    if (!forgotOtp.trim()) {
      setForgotError('Masukkan kode konfirmasi yang dikirim ke WhatsApp.');
      return;
    }
    if (forgotNewPassword.length < 4) {
      setForgotError('Kata sandi baru minimal 4 karakter.');
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setForgotError('Konfirmasi kata sandi baru tidak cocok.');
      return;
    }

    setForgotLoading(true);
    if (!challenge.offlineAdminId) {
      const serverRes = await apiResetForgotPassword(
        forgotUsername.trim(),
        forgotOtp.trim(),
        forgotNewPassword
      );
      setForgotLoading(false);
      if (!serverRes || !serverRes.ok) {
        setForgotError(serverRes?.error || 'Gagal mengatur ulang kata sandi.');
        return;
      }
      if (serverRes.db) {
        onDbUpdated(serverRes.db);
      }
    } else {
      if (forgotOtp.trim() !== challenge.otpPreview) {
        setForgotLoading(false);
        setForgotError('Kode konfirmasi WhatsApp tidak cocok.');
        return;
      }
      const nextAdmins = db.admins.map((a) =>
        a.id === challenge.offlineAdminId ? { ...a, password: forgotNewPassword } : a
      );
      const nextLogs = addAuditLog(
        db.auditLogs,
        challenge.adminFullName,
        challenge.role,
        'RESET_ADMIN_PASSWORD',
        `Mengatur ulang kata sandi akun @${forgotUsername.trim()} setelah konfirmasi WhatsApp.`
      );
      onDbUpdated({ ...db, admins: nextAdmins, auditLogs: nextLogs });
      setForgotLoading(false);
    }

    setUsername(forgotUsername.trim());
    setPassword('');
    setAdminError(null);
    setForgotOpen(false);
    onNotify(
      'success',
      'Kata Sandi Diperbarui',
      `Kata sandi untuk ${challenge.adminFullName} berhasil diubah. Silakan login kembali.`
    );
  };

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-[var(--app-bg)] text-slate-900">
      {/* Top Bar (Stationary Menu Bar) */}
      <header className="bg-white border-b border-slate-200 shrink-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <button
              type="button"
              onClick={onBackToVoterPortal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>Portal Pemilih</span>
            </button>
            <span className="text-lg font-extrabold tracking-tight text-[var(--app-primary)] whitespace-nowrap truncate">
              E-VOTING PENGURUS OSIS
            </span>
          </div>

          <div className="shrink-0">
            <button
              type="button"
              onClick={onOpenLiveMonitor}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <BarChart3 className="w-4 h-4" style={{ color: 'var(--app-accent)' }} aria-hidden="true" />
              <span>Live Monitor</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Centered Admin Login Card (Scrollable Body Only) */}
      <div data-page-scroller="true" className="flex-1 min-h-0 overflow-y-auto">
        <main className="min-h-full flex items-center justify-center p-4 sm:p-6">
        <section
          aria-labelledby="admin-login-heading"
          className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-[var(--app-primary)] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-6 h-6" style={{ color: 'var(--app-accent)' }} aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-semibold text-amber-700">{db.settings.schoolName}</p>
              <h1 id="admin-login-heading" className="text-xl font-extrabold text-slate-900">
                Login Panel Panitia
              </h1>
            </div>
          </div>

          <p className="text-sm text-slate-600 mb-5 leading-relaxed">
            Halaman khusus panitia pemilihan (Admin) dan pembina (SuperAdmin) untuk mengelola DPT,
            kandidat, dan pengaturan pemilihan.
          </p>

          <div
            role="tablist"
            aria-label="Metode login panel panitia"
            className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl mb-5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={loginMethod === 'PASSWORD'}
              onClick={() => {
                setLoginMethod('PASSWORD');
                setAdminError(null);
              }}
              className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                loginMethod === 'PASSWORD'
                  ? 'bg-white text-[var(--app-primary)] shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Username &amp; Sandi</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={loginMethod === 'QR_CODE'}
              data-testid="admin-qr-tab-btn"
              onClick={() => {
                setLoginMethod('QR_CODE');
                setAdminError(null);
              }}
              className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                loginMethod === 'QR_CODE'
                  ? 'bg-white text-[var(--app-primary)] shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Scan QR Panitia</span>
            </button>
          </div>

          {adminError && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-3 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm"
            >
              <AlertTriangle className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" aria-hidden="true" />
              <span className="font-medium leading-snug">{adminError}</span>
            </div>
          )}

          {loginMethod === 'QR_CODE' ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 leading-relaxed">
                Lupa kata sandi? Pindai atau unggah <strong className="text-slate-900">Kartu QR Login Panitia</strong>{' '}
                (dari menu Akun Panitia) untuk masuk langsung sebagai SuperAdmin atau Admin tanpa
                mengganti kata sandi.
              </div>
              <VoterQrScanner
                persistKey="none"
                targetLabel="Kartu QR Panitia"
                uploadButtonLabel="Unggah Gambar QR Login Panitia"
                disabled={isLoggingIn}
                onScanPayload={(payload) => void handleAdminQrScan(payload)}
              />
            </div>
          ) : (
            <>
              <form onSubmit={handleAdminSubmit} className="space-y-5" noValidate>
                <div>
                  <label
                    htmlFor="admin-username"
                    className="block text-sm font-semibold text-slate-700 mb-1.5"
                  >
                    Username Pengelola
                  </label>
                  <input
                    id="admin-username"
                    type="text"
                    autoComplete="username"
                    autoFocus
                    disabled={isLoggingIn}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Masukkan username admin"
                    className="w-full min-h-[48px] px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--app-secondary)] focus:border-[var(--app-secondary)] disabled:opacity-60"
                  />
                </div>

                <div>
                  <label
                    htmlFor="admin-password"
                    className="block text-sm font-semibold text-slate-700 mb-1.5"
                  >
                    Kata Sandi
                  </label>
                  <div className="relative">
                    <input
                      id="admin-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      disabled={isLoggingIn}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Masukkan kata sandi"
                      className="w-full min-h-[48px] pl-4 pr-12 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--app-secondary)] focus:border-[var(--app-secondary)] disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoggingIn}
                  className="w-full min-h-[52px] py-3.5 px-6 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-75 text-white font-bold text-base flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  {isLoggingIn ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                      <span>Memverifikasi Akun...</span>
                    </>
                  ) : (
                    <>
                      <span>Masuk Panel Admin</span>
                      <ArrowRight className="w-5 h-5" aria-hidden="true" />
                    </>
                  )}
                </button>
              </form>

              {/* Bilah Lupa Kata Sandi via WhatsApp */}
              <div className="mt-4">
                <button
                  type="button"
                  onClick={openForgotModal}
                  className="w-full py-2.5 px-4 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <KeyRound className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Lupa Password? Konfirmasi via WhatsApp</span>
                </button>
              </div>
            </>
          )}

          <div className="mt-6 pt-5 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={onBackToVoterPortal}
              className="text-sm font-semibold text-slate-600 hover:text-[var(--app-primary)] underline underline-offset-4 cursor-pointer"
            >
              Kembali ke Portal Pemilih (Siswa)
            </button>
          </div>
        </section>
        </main>
      </div>

      {/* Modal Lupa Password via WhatsApp */}
      {forgotOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="forgot-modal-title"
        >
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 bg-[var(--app-primary)] text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <MessageCircle className="w-5 h-5" style={{ color: 'var(--app-accent)' }} aria-hidden="true" />
                <h2 id="forgot-modal-title" className="font-bold text-lg">
                  Lupa Password Pengelola
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setForgotOpen(false)}
                aria-label="Tutup modal lupa password"
                className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {forgotStep === 'REQUEST' ? (
              <form onSubmit={handleRequestForgot} className="p-6 space-y-4">
                <p className="text-sm text-slate-600 leading-relaxed">
                  Masukkan username SuperAdmin atau Admin beserta{' '}
                  <strong className="text-slate-900">Nomor WhatsApp</strong> yang sudah terdaftar
                  pada Manajemen Akun Panitia untuk menerima kode konfirmasi.
                </p>

                {forgotError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm"
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" aria-hidden="true" />
                    <span>{forgotError}</span>
                  </div>
                )}

                <div>
                  <label
                    htmlFor="forgot-username"
                    className="block text-sm font-semibold text-slate-700 mb-1"
                  >
                    Username SuperAdmin / Admin *
                  </label>
                  <input
                    id="forgot-username"
                    type="text"
                    required
                    value={forgotUsername}
                    onChange={(e) => setForgotUsername(e.target.value)}
                    placeholder="Contoh: smansakabun atau panitia1"
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-secondary)]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="forgot-wa"
                    className="block text-sm font-semibold text-slate-700 mb-1"
                  >
                    Nomor WhatsApp Terdaftar *
                  </label>
                  <input
                    id="forgot-wa"
                    type="tel"
                    required
                    value={forgotWhatsapp}
                    onChange={(e) => setForgotWhatsapp(e.target.value)}
                    placeholder="Contoh: 081234567890"
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--app-secondary)]"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setForgotOpen(false)}
                    className="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-semibold text-sm hover:bg-slate-100 cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm disabled:opacity-70 cursor-pointer"
                  >
                    {forgotLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Memeriksa...</span>
                      </>
                    ) : (
                      <>
                        <MessageCircle className="w-4 h-4" />
                        <span>Kirim Konfirmasi WhatsApp</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleResetPassword} className="p-6 space-y-4">
                {challenge && (
                  <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2.5">
                    <div className="flex items-start gap-2.5 text-emerald-900">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      <div className="text-xs leading-relaxed">
                        <p className="font-bold">
                          Akun Terverifikasi: {challenge.adminFullName} ({challenge.role})
                        </p>
                        <p>
                          Tujuan WhatsApp:{' '}
                          <span className="font-mono font-bold">{challenge.maskedWhatsapp}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-emerald-200/70">
                      <div className="text-xs text-emerald-900">
                        Kode Konfirmasi:{' '}
                        <span
                          id="forgot-otp-preview"
                          className="font-mono font-extrabold text-sm bg-white px-2 py-0.5 rounded border border-emerald-300 select-all"
                        >
                          {challenge.otpPreview}
                        </span>
                      </div>
                      <a
                        href={challenge.waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>Buka WhatsApp</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                )}

                {forgotError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm"
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" aria-hidden="true" />
                    <span>{forgotError}</span>
                  </div>
                )}

                <div>
                  <label
                    htmlFor="forgot-otp"
                    className="block text-sm font-semibold text-slate-700 mb-1"
                  >
                    Kode Konfirmasi WhatsApp (6 Digit) *
                  </label>
                  <input
                    id="forgot-otp"
                    type="text"
                    required
                    maxLength={6}
                    value={forgotOtp}
                    onChange={(e) => setForgotOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Masukkan 6 digit kode"
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-[var(--app-secondary)]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="forgot-new-pw"
                    className="block text-sm font-semibold text-slate-700 mb-1"
                  >
                    Password Baru *
                  </label>
                  <div className="relative">
                    <input
                      id="forgot-new-pw"
                      type={showForgotPassword ? 'text' : 'password'}
                      required
                      minLength={4}
                      value={forgotNewPassword}
                      onChange={(e) => setForgotNewPassword(e.target.value)}
                      placeholder="Minimal 4 karakter"
                      className="w-full min-h-[44px] pl-3.5 pr-10 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-secondary)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowForgotPassword((prev) => !prev)}
                      aria-label={showForgotPassword ? 'Sembunyikan password baru' : 'Tampilkan password baru'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      {showForgotPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="forgot-confirm-pw"
                    className="block text-sm font-semibold text-slate-700 mb-1"
                  >
                    Ulangi Password Baru *
                  </label>
                  <input
                    id="forgot-confirm-pw"
                    type={showForgotPassword ? 'text' : 'password'}
                    required
                    minLength={4}
                    value={forgotConfirmPassword}
                    onChange={(e) => setForgotConfirmPassword(e.target.value)}
                    placeholder="Ketik ulang password baru"
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-secondary)]"
                  />
                </div>

                <div className="pt-2 flex justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setForgotError(null);
                      setForgotStep('REQUEST');
                    }}
                    className="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-semibold text-sm hover:bg-slate-100 cursor-pointer"
                  >
                    Kembali
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] text-white font-semibold text-sm disabled:opacity-70 cursor-pointer"
                  >
                    {forgotLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Menyimpan...</span>
                      </>
                    ) : (
                      <span>Simpan Password Baru</span>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

