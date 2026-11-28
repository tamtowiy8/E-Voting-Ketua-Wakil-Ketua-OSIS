import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CloudUpload,
  KeyRound,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  QrCode,
  ShieldCheck,
  UserCheck,
  Vote,
} from 'lucide-react';
import { SEED_TIMESTAMP } from '../data/seedData';
import type { CloudElectionSummary } from '../services/firebaseClient';
import type { DatabaseState, Voter } from '../types/evoting';
import {
  computeStatistics,
  isWithinSchedule,
  parseVoterQrPayload,
  resolveEffectiveVoterLoginMode,
  validateVoterLogin,
  validateVoterQrLogin,
  type SummaryStatsOverride,
} from '../utils/electionLogic';
import { hasVoterPendingOfflineVote, type PendingOfflineVote } from '../utils/offlineVoteQueue';
import { resolveEffectiveSummaryOverride } from '../utils/syncArbitration';
import { useFullscreen } from '../utils/useFullscreen';
import { VoterQrScanner } from './VoterQrScanner';

interface LoginPortalProps {
  db: DatabaseState;
  cloudSummary?: CloudElectionSummary | null;
  summaryOverride?: SummaryStatsOverride | null;
  pendingOfflineVotes?: PendingOfflineVote[];
  onCloudLookupVoter?: (
    nisInput: string
  ) => Promise<{ found: boolean; voter?: Voter; alreadyVoted?: boolean } | null>;
  onVoterLogin: (voter: Voter) => void;
  onOpenAdminLogin: () => void;
  onOpenLiveMonitor: () => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

export function LoginPortal({
  db,
  cloudSummary,
  summaryOverride,
  pendingOfflineVotes = [],
  onCloudLookupVoter,
  onVoterLogin,
  onOpenAdminLogin,
  onOpenLiveMonitor,
  onNotify,
}: LoginPortalProps) {
  const configuredMode = resolveEffectiveVoterLoginMode(db.settings);
  const [selectedTab, setSelectedTab] = useState<'QR_CODE' | 'NISN'>(
    configuredMode === 'NISN' ? 'NISN' : 'QR_CODE'
  );
  const [nis, setNis] = useState('');
  const [voterError, setVoterError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const { isFullscreen, toggleFullscreen } = useFullscreen();

  useEffect(() => {
    if (configuredMode === 'NISN') {
      setSelectedTab('NISN');
    } else if (configuredMode === 'QR_CODE') {
      setSelectedTab('QR_CODE');
    }
    setVoterError(null);
  }, [configuredMode]);

  useEffect(() => {
    if (pendingOfflineVotes.length === 0 && voterError && voterError.includes('tersimpan offline')) {
      setVoterError(null);
    }
  }, [pendingOfflineVotes.length, voterError]);

  const activeLoginMethod: 'QR_CODE' | 'NISN' =
    configuredMode === 'BOTH' ? selectedTab : configuredMode;

  const verifySingleVoterAndLogin = async (rawIdentifier: string, isQr: boolean) => {
    const cleanedNis = isQr ? parseVoterQrPayload(rawIdentifier) : rawIdentifier.trim();
    if (!cleanedNis) {
      const msg = isQr
        ? 'QR Code tidak valid atau tidak berisi data NIS/NISN pemilih.'
        : 'Harap masukkan Nomor Induk Siswa (NIS / NISN) Anda.';
      setVoterError(msg);
      onNotify('error', isQr ? 'QR Code Ditolak' : 'Data Belum Lengkap', msg);
      return;
    }

    if (!db.settings.isBoothOpen) {
      const msg = 'Bilik suara saat ini sedang ditutup oleh panitia.';
      setVoterError(msg);
      onNotify('error', 'Akses Ditolak', msg);
      return;
    }

    const scheduleCheck = isWithinSchedule(db.settings, Date.now());
    if (!scheduleCheck.valid) {
      const msg = scheduleCheck.reason || 'Di luar jadwal pemilihan.';
      setVoterError(msg);
      onNotify('error', 'Akses Ditolak', msg);
      return;
    }

    if (hasVoterPendingOfflineVote(pendingOfflineVotes, cleanedNis)) {
      const msg =
        'Anda sudah menggunakan hak suara (tersimpan offline, menunggu sinkronisasi internet).';
      setVoterError(msg);
      onNotify('error', isQr ? 'QR Code Ditolak' : 'Akses Ditolak', msg);
      return;
    }

    const isNavigatorOnline = typeof navigator === 'undefined' || navigator.onLine !== false;

    setIsLoggingIn(true);
    try {
      // Strictly max 1 Read (getDoc) when Firestore cloud lookup is available and device is online
      if (onCloudLookupVoter && isNavigatorOnline) {
        try {
          const cloudRes = await onCloudLookupVoter(cleanedNis);
          if (cloudRes?.found && cloudRes.voter) {
            if (
              cloudRes.alreadyVoted ||
              cloudRes.voter.hasVoted ||
              hasVoterPendingOfflineVote(pendingOfflineVotes, cleanedNis, cloudRes.voter.id)
            ) {
              const msg =
                'Anda sudah menggunakan hak suara. Setiap pemilih hanya dapat memilih satu kali.';
              setVoterError(msg);
              onNotify('error', isQr ? 'QR Code Ditolak' : 'Akses Ditolak', msg);
              return;
            }
            onNotify(
              'success',
              isQr ? 'Scan QR Berhasil' : 'Autentikasi Berhasil',
              `Selamat datang, ${cloudRes.voter.name}.`
            );
            onVoterLogin(cloudRes.voter);
            return;
          }
        } catch {
          // Fall back gracefully to local validation if cloud lookup is temporarily unreachable
        }
      }

      const res = isQr
        ? validateVoterQrLogin(db.voters, rawIdentifier, db.settings)
        : validateVoterLogin(db.voters, cleanedNis, db.settings);
      if (!res.ok) {
        setVoterError(res.error);
        onNotify('error', isQr ? 'QR Code Ditolak' : 'Akses Ditolak', res.error);
        return;
      }

      onNotify(
        'success',
        isQr ? 'Scan QR Berhasil' : 'Autentikasi Berhasil',
        `Selamat datang, ${res.voter.name}.`
      );
      onVoterLogin(res.voter);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleVoterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    setVoterError(null);

    if (!nis.trim()) {
      const msg = 'Harap masukkan Nomor Induk Siswa (NIS / NISN) Anda.';
      setVoterError(msg);
      onNotify('error', 'Data Belum Lengkap', msg);
      return;
    }

    void verifySingleVoterAndLogin(nis, false);
  };

  const handleQrScanPayload = (rawPayload: string) => {
    if (isLoggingIn) return;
    setVoterError(null);
    void verifySingleVoterAndLogin(rawPayload, true);
  };

  const resolvedSummary =
    summaryOverride !== undefined
      ? summaryOverride
      : resolveEffectiveSummaryOverride({
          db,
          cloudSummary,
          autoSyncEnabled: true,
          quotaExceeded: false,
          pendingOfflineVotes,
          seedTimestamp: SEED_TIMESTAMP,
        });
  const stats = computeStatistics(db.voters, db.candidates, resolvedSummary);
  const totalDptDisplay = stats.totalDpt;
  const totalVoted = stats.totalVoted;

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-[var(--app-bg)] text-slate-900">
      {/* Top Bar (Stationary Menu Bar): Brand + Proyektor, Login Admin & Live Monitor buttons */}
      <header className="bg-white border-b border-slate-200 shrink-0 z-30">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 sm:gap-4">
          <a
            href="#top"
            className="text-xs sm:text-lg font-extrabold tracking-tight text-[var(--app-primary)] truncate min-w-0"
          >
            E-VOTING PENGURUS OSIS
          </a>

          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <button
              type="button"
              onClick={toggleFullscreen}
              data-testid="projector-toggle-btn"
              aria-pressed={isFullscreen}
              aria-label={isFullscreen ? 'Keluar layar penuh' : 'Mode layar penuh proyektor'}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 sm:py-2.5 rounded-lg border text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-primary)] ${
                isFullscreen
                  ? 'border-amber-400 bg-amber-50 hover:bg-amber-100 text-amber-950 font-bold'
                  : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-800'
              }`}
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-4 h-4 text-amber-700" aria-hidden="true" />
                  <span className="hidden sm:inline">Normal</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-4 h-4 text-[var(--app-secondary)]" aria-hidden="true" />
                  <span className="hidden sm:inline">Proyektor</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onOpenAdminLogin}
              className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-primary)]"
            >
              <ShieldCheck className="w-4 h-4 text-[var(--app-secondary)]" aria-hidden="true" />
              <span>
                <span className="hidden sm:inline">Login </span>Admin
              </span>
            </button>

            <button
              type="button"
              onClick={onOpenLiveMonitor}
              className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-lg bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
            >
              <BarChart3 className="w-4 h-4" style={{ color: 'var(--app-accent)' }} aria-hidden="true" />
              <span>
                <span className="hidden sm:inline">Live </span>Monitor
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content: Scrollable Body Only */}
      <div data-page-scroller="true" className="flex-1 min-h-0 overflow-y-auto">
        <main id="top" className="min-h-full max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12 flex items-center">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
          {/* Left Column: Institutional Overview */}
          <section className="lg:col-span-7 flex flex-col justify-between bg-[var(--app-primary)] text-white rounded-2xl p-6 sm:p-10">
            <div>
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-xl bg-white p-1.5 shrink-0 flex items-center justify-center overflow-hidden">
                  {db.settings.logoUrl && !logoError ? (
                    <img
                      src={db.settings.logoUrl}
                      alt={`Logo ${db.settings.schoolName}`}
                      referrerPolicy="no-referrer"
                      onError={() => setLogoError(true)}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <Vote className="w-8 h-8 text-[var(--app-primary)]" aria-hidden="true" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-wide" style={{ color: 'var(--app-accent)' }}>
                    {db.settings.schoolName}
                  </p>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Tahun Ajaran {db.settings.academicYear} · Komisi Pemilihan Pengurus OSIS
                  </p>
                </div>
              </div>

              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight text-balance">
                {db.settings.electionTitle}
              </h1>
              <p className="mt-4 text-slate-200 text-base leading-relaxed max-w-xl">
                {configuredMode === 'QR_CODE'
                  ? 'Gunakan hak suara Anda secara langsung, bebas, rahasia, jujur, dan adil. Setiap pemilih hanya dapat memberikan suara satu kali dengan memindai QR Code pada Kartu Pemilih.'
                  : configuredMode === 'BOTH'
                    ? 'Gunakan hak suara Anda secara langsung, bebas, rahasia, jujur, dan adil. Setiap pemilih hanya dapat memberikan suara satu kali menggunakan NIS/NISN atau scan QR Code Kartu Pemilih.'
                    : 'Gunakan hak suara Anda secara langsung, bebas, rahasia, jujur, dan adil. Setiap pemilih hanya dapat memberikan suara satu kali menggunakan NIS atau NISN yang terdaftar di DPT.'}
              </p>
            </div>

            {/* Booth Status & Quick Numbers */}
            <div className="mt-8 pt-6 border-t border-white/15 grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div>
                <p className="text-xs text-slate-300">Status Bilik Suara</p>
                <div className="mt-1.5 flex items-center gap-2 text-sm font-semibold">
                  {db.settings.isBoothOpen ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                      <span className="text-emerald-300">Dibuka untuk Pemilih</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                      <span className="text-amber-300">Ditutup Sementara</span>
                    </>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-300">Daftar Pemilih Tetap</p>
                <p className="mt-1 text-xl font-bold font-mono tabular-nums text-white" data-testid="login-total-dpt">
                  {totalDptDisplay} Pemilih
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-300">Suara Masuk Sementara</p>
                <p
                  className="mt-1 text-xl font-bold font-mono tabular-nums"
                  style={{ color: 'var(--app-accent)' }}
                  data-testid="login-total-voted"
                >
                  {totalVoted} Suara
                </p>
              </div>
            </div>
          </section>

          {/* Right Column: Voter Login (NIS / NISN and/or QR Code Camera) */}
          <section className="lg:col-span-5 flex flex-col justify-between bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm">
            <div>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 rounded-xl bg-slate-100 text-[var(--app-primary)] flex items-center justify-center shrink-0">
                  {activeLoginMethod === 'QR_CODE' ? (
                    <QrCode className="w-5 h-5" aria-hidden="true" />
                  ) : (
                    <UserCheck className="w-5 h-5" aria-hidden="true" />
                  )}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Login Pemilih</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {activeLoginMethod === 'QR_CODE'
                      ? 'Scan QR Code pada Kartu Pemilih menggunakan kamera perangkat.'
                      : 'Masukkan NIS atau NISN Anda untuk langsung masuk bilik suara.'}
                  </p>
                </div>
              </div>

              {configuredMode === 'BOTH' && (
                <div
                  role="tablist"
                  aria-label="Pilih metode login pemilih"
                  className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl mb-5"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeLoginMethod === 'QR_CODE'}
                    onClick={() => {
                      setSelectedTab('QR_CODE');
                      setVoterError(null);
                    }}
                    className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      activeLoginMethod === 'QR_CODE'
                        ? 'bg-white text-[var(--app-primary)] shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <QrCode className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Scan QR Code</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeLoginMethod === 'NISN'}
                    onClick={() => {
                      setSelectedTab('NISN');
                      setVoterError(null);
                    }}
                    className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      activeLoginMethod === 'NISN'
                        ? 'bg-white text-[var(--app-primary)] shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Input NIS / NISN</span>
                  </button>
                </div>
              )}

              {pendingOfflineVotes.length > 0 && (
                <div
                  role="status"
                  data-testid="pending-offline-votes-banner"
                  className="mb-4 flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs"
                >
                  <CloudUpload className="w-4 h-4 shrink-0 text-amber-700 mt-0.5" aria-hidden="true" />
                  <span className="leading-snug">
                    <strong className="font-semibold">{pendingOfflineVotes.length} suara tersimpan offline</strong>{' '}
                    dan akan otomatis terkirim saat perangkat kembali terhubung ke internet.
                  </span>
                </div>
              )}

              {voterError && (
                <div
                  role="alert"
                  className="mb-4 flex items-start gap-3 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm"
                >
                  <AlertTriangle className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" aria-hidden="true" />
                  <span className="font-medium leading-snug">{voterError}</span>
                </div>
              )}

              {activeLoginMethod === 'QR_CODE' ? (
                <VoterQrScanner
                  disabled={isLoggingIn}
                  onScanPayload={handleQrScanPayload}
                />
              ) : (
                <form onSubmit={handleVoterSubmit} className="space-y-5" noValidate>
                  <div>
                    <label
                      htmlFor="voter-nis"
                      className="block text-sm font-semibold text-slate-700 mb-1.5"
                    >
                      Nomor Induk Siswa (NIS / NISN)
                    </label>
                    <input
                      id="voter-nis"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      autoFocus
                      disabled={isLoggingIn}
                      value={nis}
                      onChange={(e) => setNis(e.target.value)}
                      placeholder="Contoh: 2024001"
                      className="w-full min-h-[50px] px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 font-mono text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--app-secondary)] focus:border-[var(--app-secondary)] disabled:opacity-60"
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      Cukup masukkan NIS/NISN yang terdaftar di Daftar Pemilih Tetap tanpa token tambahan.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoggingIn}
                    className="w-full min-h-[52px] py-3.5 px-6 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-75 text-white font-bold text-base flex items-center justify-center gap-2 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
                  >
                    {isLoggingIn ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                        <span>Memeriksa NIS/NISN...</span>
                      </>
                    ) : (
                      <>
                        <span>Masuk Bilik Suara</span>
                        <ArrowRight className="w-5 h-5" aria-hidden="true" />
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>

            <div className="mt-6 pt-5 border-t border-slate-200 flex items-center justify-between gap-4">
              <p className="text-xs text-slate-500 leading-relaxed">
                Pantau hasil perolehan suara secara langsung tanpa perlu login.
              </p>
              <button
                type="button"
                onClick={onOpenLiveMonitor}
                className="text-sm font-semibold text-[var(--app-secondary)] hover:text-amber-600 underline underline-offset-4 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Buka Live Monitor
              </button>
            </div>
          </section>
        </div>
      </main>
      </div>
    </div>
  );
}
