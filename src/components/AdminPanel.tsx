import { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Cloud,
  Code2,
  FileDown,
  FileSpreadsheet,
  History,
  LayoutDashboard,
  Loader2,
  LogOut,
  Maximize2,
  Minimize2,
  RefreshCw,
  Settings,
  ShieldCheck,
  UserCheck,
  UserCog,
  Users,
} from 'lucide-react';
import { useFirebaseAuth } from '../context/FirebaseContext';
import { SEED_TIMESTAMP } from '../data/seedData';
import type {
  AdminUser,
  Candidate,
  DatabaseState,
  ElectionSettings,
  Voter,
} from '../types/evoting';
import {
  canAccessAdminTab,
  computeStatistics,
  type AdminPanelTab,
  type SummaryStatsOverride,
  type VoterEditPayload,
} from '../utils/electionLogic';
import { downloadElectionResultPdf } from '../utils/pdfReport';
import { loadPersistedAdminTab, savePersistedAdminTab } from '../utils/projectorMode';
import { resolveEffectiveSummaryOverride } from '../utils/syncArbitration';
import { useFullscreen } from '../utils/useFullscreen';
import { AuditLogPanel } from './admin/AuditLogPanel';
import { CandidateManager } from './admin/CandidateManager';
import { DptManager } from './admin/DptManager';
import { ElectionSettingsPanel } from './admin/ElectionSettingsPanel';
import { GoogleAppsScriptPanel } from './admin/GoogleAppsScriptPanel';
import { GoogleSheetsSyncPanel } from './admin/GoogleSheetsSyncPanel';
import { PdfReportPreviewModal } from './admin/PdfReportPreviewModal';
import { StaffManager } from './admin/StaffManager';

type AdminTab = AdminPanelTab;

interface AdminPanelProps {
  db: DatabaseState;
  currentAdmin: AdminUser;
  summaryOverride?: SummaryStatsOverride | null;
  onUpdateVoters: (nextVoters: Voter[], action: string, detail: string) => void;
  onImportCsvVoters?: (importedVoters: Voter[], skippedCount: number, warnings: string[]) => Promise<void> | void;
  onEditVoter: (voterId: string, payload: VoterEditPayload) => boolean;
  onUpdateCandidates: (nextCandidates: Candidate[], action: string, detail: string) => void;
  onUpdateAdmins: (nextAdmins: AdminUser[], action: string, detail: string) => void;
  onUpdateSettings: (nextSettings: ElectionSettings, action: string, detail: string) => void;
  onRestoreFromCloud: (nextDb: DatabaseState) => void;
  onResetElection: () => void;
  onOpenLiveMonitor: () => void;
  onRefreshApp?: () => void;
  isRefreshingApp?: boolean;
  onLogout: () => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

export function AdminPanel({
  db,
  currentAdmin,
  summaryOverride,
  onUpdateVoters,
  onImportCsvVoters,
  onEditVoter,
  onUpdateCandidates,
  onUpdateAdmins,
  onUpdateSettings,
  onRestoreFromCloud,
  onResetElection,
  onOpenLiveMonitor,
  onRefreshApp,
  isRefreshingApp = false,
  onLogout,
  onNotify,
}: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    const persisted = loadPersistedAdminTab();
    return persisted && canAccessAdminTab(currentAdmin.role, persisted) ? persisted : 'overview';
  });
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [showPdfPreviewModal, setShowPdfPreviewModal] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const dbRef = useRef(db);
  dbRef.current = db;
  const { isFullscreen, toggleFullscreen } = useFullscreen();

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 });
    savePersistedAdminTab(activeTab);
  }, [activeTab]);

  const { user, syncStatus, quotaExceeded, autoSyncEnabled, cloudSummary } = useFirebaseAuth();

  const isSuperAdmin = currentAdmin.role === 'SUPERADMIN';
  const effectiveSummary =
    summaryOverride !== undefined
      ? summaryOverride
      : resolveEffectiveSummaryOverride({
          db,
          cloudSummary,
          autoSyncEnabled,
          quotaExceeded,
          seedTimestamp: SEED_TIMESTAMP,
        });
  const stats = computeStatistics(db.voters, db.candidates, effectiveSummary);

  useEffect(() => {
    if (!canAccessAdminTab(currentAdmin.role, activeTab)) {
      setActiveTab('overview');
    }
  }, [currentAdmin.role, activeTab]);

  const navItems: { id: AdminTab; label: string; icon: typeof LayoutDashboard; superOnly?: boolean }[] = [
    { id: 'overview', label: 'Ringkasan', icon: LayoutDashboard },
    { id: 'dpt', label: 'Manajemen DPT', icon: Users },
    { id: 'candidates', label: 'Kandidat Paslon', icon: UserCheck, superOnly: true },
    { id: 'staff', label: 'Akun Panitia', icon: UserCog, superOnly: true },
    { id: 'settings', label: 'Pengaturan', icon: Settings, superOnly: true },
    { id: 'sheets', label: 'Firebase & Sheets', icon: FileSpreadsheet, superOnly: true },
    { id: 'gas', label: 'Google Apps Script', icon: Code2, superOnly: true },
    { id: 'audit', label: 'Log Aktivitas', icon: History, superOnly: true },
  ];

  const visibleNavItems = navItems.filter((item) => canAccessAdminTab(currentAdmin.role, item.id));

  const handleOpenPdfPreview = () => {
    setShowPdfPreviewModal(true);
  };

  const handleConfirmDownloadPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const filename = await downloadElectionResultPdf(
        dbRef.current,
        `${currentAdmin.fullName} (${currentAdmin.role})`,
        effectiveSummary
      );
      onNotify('success', 'Laporan PDF Diunduh', `File ${filename} berhasil disimpan.`);
    } catch (err) {
      console.error(err);
      onNotify('error', 'Gagal Membuat PDF', 'Terjadi kesalahan saat menyusun laporan hasil pemilihan.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="h-screen overflow-hidden bg-[var(--app-bg)] flex flex-col lg:flex-row">
      {/* Sidebar Navigation (256px desktop — fixed while page scrolls) */}
      <aside className="lg:w-64 lg:h-full bg-[var(--app-primary)] text-white shrink-0 flex flex-col justify-between overflow-y-auto">
        <div>
          <div className="px-6 py-5 border-b border-white/10">
            <p className="text-xs font-mono font-bold" style={{ color: 'var(--app-accent)' }}>
              PANEL PENGELOLA
            </p>
            <h1 className="text-base font-extrabold tracking-tight mt-0.5 leading-snug">
              E-VOTING PENGURUS OSIS
            </h1>
            <p className="text-xs text-slate-300 mt-1 truncate">{db.settings.schoolName}</p>
          </div>

          <nav aria-label="Navigasi Panel Admin" className="p-3 flex lg:flex-col gap-1 overflow-x-auto">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  style={isActive ? { backgroundColor: 'var(--app-accent)' } : undefined}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'text-slate-950 font-bold'
                      : 'text-slate-200 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="hidden lg:block p-4 border-t border-white/10 space-y-3">
          <div className="px-2">
            <p className="text-xs text-slate-400">Masuk sebagai</p>
            <p className="text-sm font-bold text-white truncate mt-0.5">{currentAdmin.fullName}</p>
            <p className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--app-accent)' }}>
              {currentAdmin.role}
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
            <span>Keluar Panel</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 flex flex-col min-w-0">
        {/* Top Bar (Stationary Menu Bar) */}
        <header className="bg-white border-b border-slate-200 px-4 sm:px-8 h-16 flex items-center justify-between gap-4 shrink-0 z-20">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="w-5 h-5 text-[var(--app-secondary)] shrink-0" aria-hidden="true" />
            <span className="text-sm font-bold text-slate-900 truncate">
              {visibleNavItems.find((i) => i.id === activeTab)?.label}
            </span>
            <span aria-hidden="true" className="text-slate-300 hidden sm:inline">
              ·
            </span>
            <span className="text-xs font-mono text-slate-500 hidden sm:inline">
              {currentAdmin.role}
            </span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {isSuperAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab('sheets')}
                  className={`hidden md:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                    quotaExceeded
                      ? 'border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900'
                      : syncStatus === 'error'
                        ? 'border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800'
                        : user
                          ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
                          : 'border-slate-300 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  {syncStatus === 'syncing' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" aria-hidden="true" />
                      <span>Menyinkronkan Firebase...</span>
                    </>
                  ) : quotaExceeded ? (
                    <>
                      <Cloud className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
                      <span>Kuota Firebase Penuh</span>
                    </>
                  ) : syncStatus === 'error' ? (
                    <>
                      <Cloud className="w-3.5 h-3.5 text-rose-700" aria-hidden="true" />
                      <span>Sync Firebase Bermasalah</span>
                    </>
                  ) : (
                    <>
                      <Cloud className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                      <span>{user ? 'Firebase Tersimpan' : 'Hubungkan Firebase'}</span>
                    </>
                  )}
                </button>
                {onRefreshApp && (
                  <button
                    type="button"
                    onClick={onRefreshApp}
                    disabled={isRefreshingApp}
                    aria-label="Muat ulang seluruh halaman aplikasi"
                    title="Muat ulang halaman"
                    data-testid="superadmin-refresh-btn"
                    className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-700 transition-colors shrink-0 cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-4 h-4 ${isRefreshingApp ? 'animate-spin text-[var(--app-primary)]' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              onClick={handleOpenPdfPreview}
              data-testid="header-pdf-preview-btn"
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold transition-colors whitespace-nowrap cursor-pointer"
            >
              <FileDown className="w-4 h-4 text-rose-600" aria-hidden="true" />
              <span>Unduh Hasil PDF</span>
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              data-testid="projector-toggle-btn"
              aria-pressed={isFullscreen}
              aria-label={isFullscreen ? 'Keluar layar penuh' : 'Mode layar penuh proyektor'}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 rounded-lg border text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                isFullscreen
                  ? 'border-amber-400 bg-amber-50 hover:bg-amber-100 text-amber-950'
                  : 'border-slate-300 bg-white hover:bg-slate-50 text-slate-800'
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
              onClick={onOpenLiveMonitor}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] text-white text-xs font-bold transition-colors whitespace-nowrap cursor-pointer"
            >
              <BarChart3 className="w-4 h-4" style={{ color: 'var(--app-accent)' }} aria-hidden="true" />
              <span>Live Monitor</span>
            </button>

            <button
              type="button"
              onClick={onLogout}
              className="lg:hidden inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-bold cursor-pointer"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              <span>Keluar</span>
            </button>
          </div>
        </header>

        {/* Active Tab Content (Scrollable Body Only) */}
        <div ref={scrollerRef} data-page-scroller="true" className="flex-1 min-h-0 overflow-y-auto">
          <main className="p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Bilah Download Hasil Pemilihan (PDF) — Accessible to both SuperAdmin & Admin */}
              <section
                aria-label="Download Laporan Hasil Pemilihan PDF"
                className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs"
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0">
                    <FileDown className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-extrabold text-slate-900">
                      Download Laporan Hasil Pemilihan (PDF)
                    </h2>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                      Pratinjau &amp; unduh rekapitulasi resmi perolehan suara pasangan calon,
                      partisipasi Siswa serta Guru &amp; Tendik dalam format PDF siap cetak.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleOpenPdfPreview}
                  data-testid="overview-pdf-preview-btn"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] text-white text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FileDown className="w-4 h-4" style={{ color: 'var(--app-accent)' }} aria-hidden="true" />
                  <span>Pratinjau &amp; Download (PDF)</span>
                </button>
              </section>

              {/* 4 KPI Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-2xl p-5">
                  <p className="text-xs font-semibold text-slate-500">Total DPT Terdaftar</p>
                  <p className="mt-2 text-3xl font-extrabold font-mono tabular-nums text-slate-900">
                    {stats.totalDpt}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">Pemilih berhak memilih</p>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5">
                  <p className="text-xs font-semibold text-slate-500">Total Suara Masuk</p>
                  <p className="mt-2 text-3xl font-extrabold font-mono tabular-nums text-emerald-600">
                    {stats.totalVoted}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">Sudah mencoblos</p>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5">
                  <p className="text-xs font-semibold text-slate-500">Total Belum Memilih</p>
                  <p className="mt-2 text-3xl font-extrabold font-mono tabular-nums text-amber-600">
                    {stats.totalNotVoted}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">Belum menggunakan suara</p>
                </div>

                <div className="bg-[var(--app-primary)] text-white rounded-2xl p-5">
                  <p className="text-xs font-semibold text-slate-300">Persentase Partisipasi</p>
                  <p
                    className="mt-2 text-3xl font-extrabold font-mono tabular-nums"
                    style={{ color: 'var(--app-accent)' }}
                  >
                    {stats.participationRate}%
                  </p>
                  <p className="text-xs text-slate-300 mt-1">
                    Bilik Suara: {db.settings.isBoothOpen ? 'Dibuka' : 'Ditutup'}
                  </p>
                </div>
              </div>

              {/* Participation per Grade + Quick Shortcuts */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6">
                  <h2 className="text-base font-extrabold text-slate-900 mb-4">
                    Partisipasi Pemilih per Angkatan
                  </h2>
                  <div className="space-y-4">
                    {stats.gradeStats.map((g) => {
                      const unit = g.grade === 'DPTB' ? 'pemilih' : 'siswa';
                      return (
                        <div key={g.grade}>
                          <div className="flex items-center justify-between text-sm mb-1.5">
                            <span className="font-semibold text-slate-800">{g.label}</span>
                            <span className="font-mono text-xs font-bold text-slate-700 tabular-nums">
                              {g.voted}/{g.total} {unit} ({g.percentage}%)
                            </span>
                          </div>
                          <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                g.grade === 'DPTB' ? 'bg-emerald-600' : 'bg-[var(--app-secondary)]'
                              }`}
                              style={{ width: `${Math.min(100, g.percentage)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 flex flex-col justify-between gap-4">
                  <div>
                    <h2 className="text-base font-extrabold text-slate-900">
                      Informasi Pemilihan Aktif
                    </h2>
                    <dl className="mt-4 space-y-3 text-sm">
                      <div className="flex justify-between gap-2 pb-2 border-b border-slate-100">
                        <dt className="text-slate-500">Sekolah</dt>
                        <dd className="font-semibold text-slate-900 text-right">
                          {db.settings.schoolName}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2 pb-2 border-b border-slate-100">
                        <dt className="text-slate-500">Tahun Ajaran</dt>
                        <dd className="font-mono font-semibold text-slate-900">
                          {db.settings.academicYear}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2 pb-2 border-b border-slate-100">
                        <dt className="text-slate-500">Jumlah Paslon</dt>
                        <dd className="font-mono font-semibold text-slate-900">
                          {db.candidates.length} Pasangan
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-500">Hak Akses Anda</dt>
                        <dd className="font-mono font-bold text-[var(--app-secondary)]">
                          {isSuperAdmin ? 'SuperAdmin (Penuh)' : 'Admin (Panitia DPT)'}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveTab('dpt')}
                    className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-bold transition-colors cursor-pointer"
                  >
                    Kelola Daftar Pemilih Tetap (DPT)
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'dpt' && (
            <DptManager
              voters={db.voters}
              candidates={db.candidates}
              settings={db.settings}
              isSuperAdmin={isSuperAdmin}
              onSaveVoters={onUpdateVoters}
              onImportCsvVoters={onImportCsvVoters}
              onEditVoter={onEditVoter}
              onOpenGoogleSheets={isSuperAdmin ? () => setActiveTab('sheets') : undefined}
              onNotify={onNotify}
            />
          )}

          {activeTab === 'sheets' && isSuperAdmin && (
            <GoogleSheetsSyncPanel
              db={db}
              onUpdateVoters={onUpdateVoters}
              onRestoreFromCloud={onRestoreFromCloud}
              onNotify={onNotify}
            />
          )}

          {activeTab === 'gas' && isSuperAdmin && (
            <GoogleAppsScriptPanel
              db={db}
              onRestoreFromGas={onRestoreFromCloud}
              onNotify={onNotify}
            />
          )}

          {activeTab === 'candidates' && isSuperAdmin && (
            <CandidateManager
              candidates={db.candidates}
              onSaveCandidates={onUpdateCandidates}
              onNotify={onNotify}
            />
          )}

          {activeTab === 'staff' && isSuperAdmin && (
            <StaffManager
              admins={db.admins}
              currentAdminId={currentAdmin.id}
              schoolName={db.settings.schoolName}
              electionTitle={db.settings.electionTitle}
              onSaveAdmins={onUpdateAdmins}
              onNotify={onNotify}
            />
          )}

          {activeTab === 'settings' && isSuperAdmin && (
            <ElectionSettingsPanel
              settings={db.settings}
              onSaveSettings={onUpdateSettings}
              onResetElection={onResetElection}
              onNotify={onNotify}
            />
          )}

          {activeTab === 'audit' && isSuperAdmin && <AuditLogPanel logs={db.auditLogs} />}
          </main>
        </div>
      </div>

      {showPdfPreviewModal && (
        <PdfReportPreviewModal
          db={db}
          summaryOverride={effectiveSummary}
          exportedBy={`${currentAdmin.fullName} (${currentAdmin.role})`}
          isExportingPdf={isExportingPdf}
          onConfirmDownload={handleConfirmDownloadPdf}
          onClose={() => setShowPdfPreviewModal(false)}
        />
      )}
    </div>
  );
}
