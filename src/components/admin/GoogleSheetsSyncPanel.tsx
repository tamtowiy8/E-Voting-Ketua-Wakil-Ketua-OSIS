import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  Cloud,
  CloudDownload,
  CloudUpload,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  FolderSync,
  Globe,
  HardDrive,
  Link2,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { useFirebaseAuth } from '../../context/FirebaseContext';
import {
  deleteSheetLinkFromFirestore,
  FIRESTORE_DATABASE_ID,
  FIRESTORE_PROJECT_ID,
  loadElectionFromFirestore,
  saveSheetLinkToFirestore,
  subscribeSheetLinks,
  syncElectionToFirestore,
  type SheetLinkDoc,
} from '../../services/firebaseClient';
import type { DatabaseState, Voter } from '../../types/evoting';
import { DPT_DISPLAY_LIMIT, MAX_CSV_VOTERS } from '../../utils/electionLogic';
import {
  computeDailyQuotaSummary,
  estimateFirestoreStorageUsage,
  FIRESTORE_CSV_BATCH_LIMIT,
  FIRESTORE_PRICING_URL,
  FIRESTORE_SPARK_STORAGE_BYTES,
  formatFirestoreErrorMessage,
  formatStorageBytes,
  getFirebaseAuthSettingsUrl,
  getFirestoreUpgradeUrl,
  getFirestoreUsageUrl,
  isFirestoreQuotaError,
  isUnauthorizedDomainAuthError,
  loadDailyQuotaUsage,
  subscribeDailyQuotaUsage,
  type FirestoreDailyUsageRecord,
} from '../../utils/firebaseSyncLogic';
import {
  createElectionSpreadsheet,
  EXPORT_TAB_DPT,
  EXPORT_TAB_PASLON,
  EXPORT_TAB_REKAP,
  extractSpreadsheetId,
  fetchSpreadsheetMeta,
  fetchSheetValues,
  parseSheetRowsToVoters,
  updateExistingSpreadsheet,
  type SpreadsheetMeta,
} from '../../utils/googleSheets';
import { GoogleSignInButton } from '../GoogleSignInButton';

interface GoogleSheetsSyncPanelProps {
  db: DatabaseState;
  onUpdateVoters: (nextVoters: Voter[], action: string, detail: string) => void;
  onRestoreFromCloud: (nextDb: DatabaseState) => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

type ConfirmAction =
  | {
      type: 'UPDATE_SHEET';
      spreadsheetId: string;
      spreadsheetTitle: string;
    }
  | {
      type: 'SYNC_TO_CLOUD';
    }
  | {
      type: 'LOAD_FROM_CLOUD';
    }
  | {
      type: 'DELETE_LINK';
      link: SheetLinkDoc;
    };

export function GoogleSheetsSyncPanel({
  db,
  onUpdateVoters,
  onRestoreFromCloud,
  onNotify,
}: GoogleSheetsSyncPanelProps) {
  const {
    user,
    accessToken,
    authReady,
    needsGoogleAuth,
    isSigningIn,
    autoSyncEnabled,
    setAutoSyncEnabled,
    syncStatus,
    setSyncStatus,
    lastCloudSyncAt,
    setLastCloudSyncAt,
    syncError,
    setSyncError,
    quotaExceeded,
    setQuotaExceeded,
    cloudSummary,
    clearQuotaLockAndEnableNetwork,
    signInWithGoogle,
    signOutGoogle,
  } = useFirebaseAuth();

  // Firestore synced state
  const [savedLinks, setSavedLinks] = useState<SheetLinkDoc[]>([]);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [authError, setAuthError] = useState<{
    message: string;
    isUnauthorizedDomain: boolean;
  } | null>(null);
  const [copiedDomain, setCopiedDomain] = useState(false);

  // Import from Google Sheets state
  const [importInput, setImportInput] = useState('');
  const [importMeta, setImportMeta] = useState<SpreadsheetMeta | null>(null);
  const [selectedImportSheet, setSelectedImportSheet] = useState('');
  const [loadingImportMeta, setLoadingImportMeta] = useState(false);
  const [loadingImportRows, setLoadingImportRows] = useState(false);
  const [previewResult, setPreviewResult] = useState<{
    added: Voter[];
    skippedCount: number;
    invalidRows: number;
  } | null>(null);

  // Export / Update Google Sheets state
  const [exportInput, setExportInput] = useState('');
  const [creatingSheet, setCreatingSheet] = useState(false);
  const [updatingSheet, setUpdatingSheet] = useState(false);
  const [lastSyncedSheet, setLastSyncedSheet] = useState<SpreadsheetMeta | null>(null);

  // Explicit user confirmation modal before any destructive / mutating API call
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [dailyUsage, setDailyUsage] = useState<FirestoreDailyUsageRecord>(() =>
    loadDailyQuotaUsage()
  );

  useEffect(() => {
    const refresh = () => setDailyUsage(loadDailyQuotaUsage());
    const unsub = subscribeDailyQuotaUsage((next) => setDailyUsage(next));
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      unsub();
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const storageUsage = useMemo(
    () =>
      estimateFirestoreStorageUsage({
        db,
        sheetLinks: savedLinks,
        totalDptOverride: cloudSummary?.totalDpt,
      }),
    [db, savedLinks, cloudSummary?.totalDpt]
  );

  const dailyQuotaSummary = useMemo(
    () => computeDailyQuotaSummary(dailyUsage, quotaExceeded),
    [dailyUsage, quotaExceeded]
  );

  const quotaResetTimeLabel = useMemo(
    () =>
      new Date(dailyQuotaSummary.windowResetAtMs).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [dailyQuotaSummary.windowResetAtMs]
  );

  // Attach Firestore sheetLinks listener ONLY when auth is ready, user is authenticated, and quota is not locked
  useEffect(() => {
    if (!authReady || !user || quotaExceeded) {
      if (!authReady || !user) {
        setSavedLinks([]);
      }
      return;
    }

    const unsubLinks = subscribeSheetLinks(
      user,
      (links) => setSavedLinks(links),
      (err) => {
        if (isFirestoreQuotaError(err)) {
          setQuotaExceeded(true);
        }
        onNotify('error', 'Gagal Memuat Tautan Sheet', formatFirestoreErrorMessage(err));
      }
    );

    return () => {
      unsubLinks();
    };
  }, [authReady, user, quotaExceeded, onNotify, setQuotaExceeded]);

  const activeHostname =
    typeof window !== 'undefined' ? window.location.hostname || 'localhost' : 'localhost';

  const handleCopyHostname = async () => {
    try {
      await navigator.clipboard.writeText(activeHostname);
      setCopiedDomain(true);
      onNotify('success', 'Domain Disalin', `Domain "${activeHostname}" berhasil disalin ke clipboard.`);
      window.setTimeout(() => setCopiedDomain(false), 2500);
    } catch {
      onNotify('info', 'Salin Manual', `Salin domain berikut secara manual: ${activeHostname}`);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      const res = await signInWithGoogle();
      setAuthError(null);
      onNotify(
        'success',
        'Akun Google Terhubung',
        `Terhubung sebagai ${res.user.displayName || res.user.email} untuk Google Sheets & Firebase.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal masuk dengan Google.';
      const isDomainErr =
        isUnauthorizedDomainAuthError(err) ||
        msg.toLowerCase().includes('authorized domains');
      setAuthError({ message: msg, isUnauthorizedDomain: isDomainErr });
      onNotify('error', 'Autentikasi Google Gagal', msg);
    }
  };

  const handleGoogleSignOut = async () => {
    setAuthError(null);
    await signOutGoogle();
    onNotify('info', 'Akun Google Diputuskan', 'Token akses Google Sheets telah dibersihkan.');
  };

  const handleLoadSpreadsheetTabs = async () => {
    if (!accessToken) {
      onNotify('error', 'Perlu Login Google', 'Silakan hubungkan akun Google terlebih dahulu.');
      return;
    }
    const id = extractSpreadsheetId(importInput);
    if (!id) {
      onNotify(
        'error',
        'URL / ID Tidak Valid',
        'Masukkan URL Google Spreadsheet atau ID spreadsheet yang benar.'
      );
      return;
    }

    setLoadingImportMeta(true);
    setPreviewResult(null);
    try {
      const meta = await fetchSpreadsheetMeta(accessToken, id);
      setImportMeta(meta);
      setSelectedImportSheet(meta.sheets[0]?.title || '');
      onNotify(
        'success',
        'Spreadsheet Dimuat',
        `Ditemukan ${meta.sheets.length} tab pada "${meta.title}".`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal membaca metadata spreadsheet.';
      onNotify('error', 'Gagal Membaca Spreadsheet', msg);
    } finally {
      setLoadingImportMeta(false);
    }
  };

  const handlePreviewSheetRows = async () => {
    if (!accessToken || !importMeta || !selectedImportSheet) return;
    setLoadingImportRows(true);
    try {
      const rows = await fetchSheetValues(accessToken, importMeta.spreadsheetId, selectedImportSheet);
      const existingNis = new Set(db.voters.map((v) => v.nis));
      const existingTokens = new Set(db.voters.map((v) => v.token));
      const parsed = parseSheetRowsToVoters(rows, existingNis, existingTokens);
      setPreviewResult(parsed);
      onNotify(
        'info',
        'Pratinjau Siap',
        `${parsed.added.length} pemilih baru siap diimpor (${parsed.skippedCount} duplikat dilewati).`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal membaca baris spreadsheet.';
      onNotify('error', 'Gagal Mengambil Data', msg);
    } finally {
      setLoadingImportRows(false);
    }
  };

  const handleApplyImport = async () => {
    if (!previewResult || previewResult.added.length === 0) return;
    onUpdateVoters(
      [...previewResult.added, ...db.voters],
      'IMPORT_DPT_GOOGLE_SHEETS',
      `Mengimpor ${previewResult.added.length} pemilih dari Google Sheets "${importMeta?.title || '-'}" (${selectedImportSheet}).`
    );

    if (user && importMeta) {
      try {
        await saveSheetLinkToFirestore(user, {
          spreadsheetId: importMeta.spreadsheetId,
          spreadsheetTitle: importMeta.title,
          sheetName: selectedImportSheet || 'Sheet1',
          purpose: 'dpt_import',
          spreadsheetUrl: importMeta.spreadsheetUrl,
        });
      } catch (err) {
        console.error('Failed saving link to Firestore:', err);
      }
    }

    onNotify(
      'success',
      'Impor Google Sheets Berhasil',
      `${previewResult.added.length} pemilih ditambahkan ke DPT.`
    );
    setPreviewResult(null);
  };

  const handleCreateNewSheet = async () => {
    if (!accessToken || creatingSheet) return;
    setCreatingSheet(true);
    try {
      const created = await createElectionSpreadsheet(accessToken, db);
      setLastSyncedSheet(created);
      setExportInput(created.spreadsheetId);

      if (user) {
        await saveSheetLinkToFirestore(user, {
          spreadsheetId: created.spreadsheetId,
          spreadsheetTitle: created.title,
          sheetName: EXPORT_TAB_REKAP,
          purpose: 'results_export',
          spreadsheetUrl: created.spreadsheetUrl,
        });
      }

      onNotify(
        'success',
        'Spreadsheet Baru Dibuat',
        `Laporan hasil & DPT berhasil diekspor ke "${created.title}".`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal membuat spreadsheet baru.';
      onNotify('error', 'Ekspor Google Sheets Gagal', msg);
    } finally {
      setCreatingSheet(false);
    }
  };

  const handlePrepareOverwriteSheet = async () => {
    if (!accessToken) {
      onNotify('error', 'Perlu Login Google', 'Hubungkan akun Google terlebih dahulu.');
      return;
    }
    const id = extractSpreadsheetId(exportInput);
    if (!id) {
      onNotify(
        'error',
        'URL / ID Tidak Valid',
        'Masukkan URL atau ID Google Spreadsheet tujuan untuk diperbarui.'
      );
      return;
    }

    setUpdatingSheet(true);
    try {
      const meta = await fetchSpreadsheetMeta(accessToken, id);
      setConfirmAction({
        type: 'UPDATE_SHEET',
        spreadsheetId: meta.spreadsheetId,
        spreadsheetTitle: meta.title,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Spreadsheet tidak dapat diakses.';
      onNotify('error', 'Gagal Memeriksa Spreadsheet', msg);
    } finally {
      setUpdatingSheet(false);
    }
  };

  const handleExecuteConfirmedAction = async () => {
    if (!confirmAction) return;

    if (confirmAction.type === 'UPDATE_SHEET') {
      if (!accessToken) return;
      setUpdatingSheet(true);
      try {
        const updated = await updateExistingSpreadsheet(
          accessToken,
          confirmAction.spreadsheetId,
          db
        );
        setLastSyncedSheet(updated);
        if (user) {
          await saveSheetLinkToFirestore(user, {
            spreadsheetId: updated.spreadsheetId,
            spreadsheetTitle: updated.title,
            sheetName: EXPORT_TAB_REKAP,
            purpose: 'both',
            spreadsheetUrl: updated.spreadsheetUrl,
          });
        }
        onNotify(
          'success',
          'Spreadsheet Diperbarui',
          `Data DPT dan hasil suara pada "${updated.title}" berhasil disinkronkan.`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal memperbarui spreadsheet.';
        onNotify('error', 'Update Spreadsheet Gagal', msg);
      } finally {
        setUpdatingSheet(false);
        setConfirmAction(null);
      }
      return;
    }

    if (confirmAction.type === 'SYNC_TO_CLOUD') {
      if (!user) return;
      setCloudBusy(true);
      try {
        await clearQuotaLockAndEnableNetwork();
        setSyncStatus('syncing');
        const res = await syncElectionToFirestore(user, db);
        setLastCloudSyncAt(Date.now());
        setSyncStatus('synced');
        setSyncError(null);
        setQuotaExceeded(false);
        onNotify(
          'success',
          'Tersimpan di Firebase Firestore',
          `${res.candidateCount} paslon, ${res.voterCount} pemilih, dan ${res.auditCount} log aktivitas tersimpan di Firebase.`
        );
      } catch (err) {
        const msg = formatFirestoreErrorMessage(err);
        if (isFirestoreQuotaError(err)) {
          setQuotaExceeded(true);
        }
        setSyncStatus('error');
        setSyncError(msg);
        onNotify('error', 'Sinkronisasi Firestore Gagal', msg);
      } finally {
        setCloudBusy(false);
        setConfirmAction(null);
      }
      return;
    }

    if (confirmAction.type === 'LOAD_FROM_CLOUD') {
      if (!user) return;
      setCloudBusy(true);
      try {
        const loaded = await loadElectionFromFirestore(user, db);
        if (!loaded) {
          onNotify('info', 'Belum Ada Data Cloud', 'Workspace Firestore Anda masih kosong.');
        } else {
          onRestoreFromCloud(loaded);
          onNotify(
            'success',
            'Data Dimuat dari Cloud',
            `${loaded.voters.length} pemilih dan ${loaded.candidates.length} paslon dipulihkan dari Firestore.`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal memuat data dari Firestore.';
        onNotify('error', 'Gagal Memuat Cloud', msg);
      } finally {
        setCloudBusy(false);
        setConfirmAction(null);
      }
      return;
    }

    if (confirmAction.type === 'DELETE_LINK') {
      if (!user) return;
      setCloudBusy(true);
      try {
        await deleteSheetLinkFromFirestore(user.uid, confirmAction.link.id);
        onNotify(
          'info',
          'Tautan Dihapus',
          `Tautan "${confirmAction.link.spreadsheetTitle}" dihapus dari daftar tersimpan.`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal menghapus tautan.';
        onNotify('error', 'Hapus Tautan Gagal', msg);
      } finally {
        setCloudBusy(false);
        setConfirmAction(null);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Google Account & Firebase Auth Card */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900">
                Integrasi Google Sheets &amp; Firebase Cloud
              </h2>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                Hubungkan akun Google Anda untuk mengimpor DPT dari Google Sheets, mengekspor laporan
                pemilihan langsung ke Spreadsheet, dan menyinkronkan data ke Cloud Firestore.
              </p>
            </div>
          </div>

          <div className="shrink-0">
            {needsGoogleAuth ? (
              <GoogleSignInButton onClick={handleGoogleSignIn} loading={isSigningIn} />
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <div className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs">
                  <p className="font-bold text-emerald-900">{user?.displayName || 'Akun Google'}</p>
                  <p className="text-[11px] text-emerald-700">{user?.email}</p>
                </div>
                <button
                  type="button"
                  onClick={handleGoogleSignOut}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Putuskan</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {user && !accessToken && (
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Sesi Google aktif untuk Firestore, tetapi akses Google Sheets perlu otorisasi ulang di
              memori setelah memuat ulang halaman. Klik <strong>Sign in with Google</strong> di atas
              untuk menyambungkan kembali akses Google Sheets.
            </span>
          </div>
        )}

        {authError && (
          <div
            role="alert"
            data-testid="firebase-auth-error-banner"
            className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-950 space-y-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2.5 min-w-0">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1 min-w-0">
                  <p className="font-extrabold text-rose-900">
                    {authError.isUnauthorizedDomain
                      ? 'Domain Netlify Belum Diizinkan di Firebase Authentication'
                      : 'Autentikasi Google Gagal'}
                  </p>
                  <p className="text-rose-800 leading-relaxed">{authError.message}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAuthError(null)}
                aria-label="Tutup peringatan autentikasi"
                className="p-1 rounded-lg text-rose-500 hover:text-rose-800 hover:bg-rose-100 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {authError.isUnauthorizedDomain && (
              <div className="pl-6 space-y-2">
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-rose-900">
                  <li>
                    Salin domain persis di bawah (tanpa <span className="font-mono">https://</span>{' '}
                    dan tanpa tanda <span className="font-mono">*</span>):{' '}
                    <span className="font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-rose-200">
                      {activeHostname}
                    </span>
                  </li>
                  <li>
                    Buka <strong>Firebase Console → Authentication → Settings → Authorized domains</strong>, lalu klik <strong>Add domain</strong>.
                  </li>
                  <li>
                    Tempel <span className="font-mono font-semibold">{activeHostname}</span>, simpan, lalu klik <strong>Sign in with Google</strong> kembali.
                  </li>
                </ol>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => void handleCopyHostname()}
                    data-testid="copy-active-domain-error-btn"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-300 bg-white hover:bg-rose-100 text-[11px] font-bold text-rose-900 cursor-pointer"
                  >
                    {copiedDomain ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span>{copiedDomain ? 'Domain Disalin' : `Salin "${activeHostname}"`}</span>
                  </button>
                  <a
                    href={getFirebaseAuthSettingsUrl(FIRESTORE_PROJECT_ID)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-[11px] font-bold"
                  >
                    <span>Buka Authorized Domains Firebase</span>
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        {typeof window !== 'undefined' && (
          <div
            data-testid="netlify-domain-readiness-box"
            className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <Globe className="w-4 h-4 text-[var(--app-secondary)] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-bold text-slate-900">
                  Domain Hosting Aktif:{' '}
                  <span className="font-mono text-[var(--app-secondary)]">
                    {activeHostname}
                  </span>
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                  Saat membuka aplikasi via <strong>Netlify</strong>, daftarkan nama domain persis{' '}
                  <span className="font-mono font-semibold text-slate-800">{activeHostname}</span>{' '}
                  (tanpa <span className="font-mono">https://</span> maupun <span className="font-mono">*</span>) pada{' '}
                  <strong>Authorized domains</strong> di Firebase Authentication agar Login Google &amp;
                  Cloud Sync berjalan lancar.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void handleCopyHostname()}
                data-testid="copy-active-domain-btn"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-bold text-slate-800 whitespace-nowrap cursor-pointer"
              >
                {copiedDomain ? (
                  <Check className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                ) : (
                  <Copy className="w-3 h-3" aria-hidden="true" />
                )}
                <span>{copiedDomain ? 'Tersalin' : 'Salin Domain'}</span>
              </button>
              <a
                href={getFirebaseAuthSettingsUrl(FIRESTORE_PROJECT_ID)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-bold text-slate-800 whitespace-nowrap"
              >
                <span>Atur Domain Firebase</span>
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            </div>
          </div>
        )}
      </section>

      {/* Main Workspace Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* 1. Impor DPT dari Google Sheets */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
            <Table2 className="w-5 h-5 text-[var(--app-secondary)]" aria-hidden="true" />
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Impor DPT dari Google Sheets
              </h3>
              <p className="text-xs text-slate-500">
                Format kolom yang disarankan: <span className="font-mono">NIS</span>,{' '}
                <span className="font-mono">Nama</span>, <span className="font-mono">Kelas</span>.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <label htmlFor="gs-import-url" className="block text-xs font-bold text-slate-700">
              URL atau ID Google Spreadsheet
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="gs-import-url"
                type="text"
                value={importInput}
                onChange={(e) => setImportInput(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                disabled={!accessToken}
                className="flex-1 h-10 px-3 rounded-xl border border-slate-300 text-xs font-mono disabled:bg-slate-50"
              />
              <button
                type="button"
                disabled={!accessToken || loadingImportMeta}
                onClick={handleLoadSpreadsheetTabs}
                className="inline-flex items-center justify-center gap-1.5 px-4 h-10 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-50 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
              >
                {loadingImportMeta ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    <span>Memuat...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Muat Daftar Tab</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {importMeta && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-extrabold text-slate-900 truncate">
                  {importMeta.title}
                </p>
                <a
                  href={importMeta.spreadsheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--app-secondary)] hover:underline shrink-0"
                >
                  <span>Buka Sheet</span>
                  <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  aria-label="Pilih nama tab worksheet"
                  value={selectedImportSheet}
                  onChange={(e) => {
                    setSelectedImportSheet(e.target.value);
                    setPreviewResult(null);
                  }}
                  className="flex-1 h-10 px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800"
                >
                  {importMeta.sheets.map((s) => (
                    <option key={s.sheetId} value={s.title}>
                      {s.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!selectedImportSheet || loadingImportRows}
                  onClick={handlePreviewSheetRows}
                  className="inline-flex items-center justify-center gap-1.5 px-4 h-10 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-slate-800 whitespace-nowrap cursor-pointer"
                >
                  {loadingImportRows ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      <span>Membaca...</span>
                    </>
                  ) : (
                    <span>Pratinjau Data</span>
                  )}
                </button>
              </div>
            </div>
          )}

          {previewResult && (
            <div className="space-y-3 border border-emerald-200 bg-emerald-50/50 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-bold text-emerald-900">
                  {previewResult.added.length} pemilih baru siap diimpor
                </span>
                <span className="text-slate-600">
                  {previewResult.skippedCount} duplikat · {previewResult.invalidRows} baris tidak lengkap
                </span>
              </div>

              {previewResult.added.length > 0 && (
                <>
                  <div className="max-h-40 overflow-y-auto bg-white border border-slate-200 rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="py-1.5 px-2.5">NIS</th>
                          <th className="py-1.5 px-2.5">Nama</th>
                          <th className="py-1.5 px-2.5">Kelas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {previewResult.added.slice(0, 8).map((v) => (
                          <tr key={v.id}>
                            <td className="py-1.5 px-2.5 font-mono">{v.nis}</td>
                            <td className="py-1.5 px-2.5 font-semibold">{v.name}</td>
                            <td className="py-1.5 px-2.5">{v.kelas}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button
                    type="button"
                    onClick={handleApplyImport}
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                  >
                    Tambahkan {previewResult.added.length} Pemilih ke DPT
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        {/* 2. Ekspor & Perbarui Hasil ke Google Sheets */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
            <FolderSync className="w-5 h-5 text-emerald-600" aria-hidden="true" />
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Ekspor Hasil &amp; DPT ke Google Sheets
              </h3>
              <p className="text-xs text-slate-500">
                Membuat atau memperbarui tab <strong>{EXPORT_TAB_REKAP}</strong>,{' '}
                <strong>{EXPORT_TAB_DPT}</strong>, dan <strong>{EXPORT_TAB_PASLON}</strong>.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-slate-900">Buat Google Spreadsheet Baru</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Otomatis mengisi {db.voters.length} DPT dan {db.candidates.length} Paslon.
              </p>
            </div>
            <button
              type="button"
              disabled={!accessToken || creatingSheet}
              onClick={handleCreateNewSheet}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
            >
              {creatingSheet ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  <span>Membuat Sheet...</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Buat Spreadsheet Baru</span>
                </>
              )}
            </button>
          </div>

          <div className="space-y-2.5">
            <label htmlFor="gs-export-url" className="block text-xs font-bold text-slate-700">
              Atau Perbarui Spreadsheet yang Sudah Ada
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="gs-export-url"
                type="text"
                value={exportInput}
                onChange={(e) => setExportInput(e.target.value)}
                placeholder="Tempel URL / ID spreadsheet untuk diperbarui"
                disabled={!accessToken}
                className="flex-1 h-10 px-3 rounded-xl border border-slate-300 text-xs font-mono disabled:bg-slate-50"
              />
              <button
                type="button"
                disabled={!accessToken || updatingSheet}
                onClick={handlePrepareOverwriteSheet}
                className="inline-flex items-center justify-center gap-1.5 px-4 h-10 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-50 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
              >
                {updatingSheet ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    <span>Memeriksa...</span>
                  </>
                ) : (
                  <span>Perbarui Spreadsheet</span>
                )}
              </button>
            </div>
          </div>

          {lastSyncedSheet && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0">
                <p className="font-bold text-emerald-900 truncate">{lastSyncedSheet.title}</p>
                <p className="text-[11px] font-mono text-emerald-700 truncate">
                  ID: {lastSyncedSheet.spreadsheetId}
                </p>
              </div>
              <a
                href={lastSyncedSheet.spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold shrink-0"
              >
                <span>Buka Spreadsheet</span>
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            </div>
          )}
        </section>
      </div>

      {/* 3. Firebase Cloud Firestore Sync + Saved Links */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <section className="xl:col-span-6 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <Cloud className="w-5 h-5 text-[var(--app-secondary)]" aria-hidden="true" />
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  Sinkronisasi Database Firebase
                </h3>
                <p className="text-xs text-slate-500">
                  Menyimpan otomatis DPT, Paslon, Pengaturan, Tema, dan Log di Cloud Firestore.
                </p>
              </div>
            </div>
          </div>

          {/* Auto-Sync Switch */}
          <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <div>
              <p className="text-xs font-bold text-slate-900">
                Sinkronisasi Otomatis ke Firebase
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {autoSyncEnabled
                  ? 'Setiap perubahan data langsung disimpan ke Cloud Firestore.'
                  : 'Mode manual — klik Simpan ke Firestore untuk mencadangkan data.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoSyncEnabled}
              aria-label="Sinkronisasi Otomatis ke Firebase"
              onClick={() => {
                const next = !autoSyncEnabled;
                setAutoSyncEnabled(next);
                onNotify(
                  'info',
                  next ? 'Auto-Sync Firebase Aktif' : 'Auto-Sync Firebase Dijeda',
                  next
                    ? 'Perubahan database kini disinkronkan otomatis ke Cloud Firestore.'
                    : 'Sinkronisasi otomatis dijeda; Anda tetap dapat menyimpan secara manual.'
                );
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                autoSyncEnabled ? 'bg-emerald-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                  autoSyncEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {cloudSummary ? (
            <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-emerald-950">{cloudSummary.schoolName}</p>
                <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                  {syncStatus === 'syncing' ? 'Menyinkronkan...' : 'Tersimpan'}
                </span>
              </div>
              <p className="text-emerald-900">
                {cloudSummary.electionTitle} ({cloudSummary.academicYear})
              </p>
              <p className="font-mono text-emerald-900 pt-1">
                DPT Firestore: <strong>{cloudSummary.totalDpt}</strong> · Suara Masuk:{' '}
                <strong>{cloudSummary.totalVoted}</strong>
              </p>
              {lastCloudSyncAt && (
                <p className="text-[11px] text-emerald-800 pt-0.5">
                  Sinkronisasi terakhir:{' '}
                  {new Date(lastCloudSyncAt).toLocaleTimeString('id-ID', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </p>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
              {user
                ? 'Menyiapkan ruang penyimpanan database Firestore untuk akun Anda...'
                : 'Klik Sign in with Google di atas agar seluruh sinkronisasi database tersimpan permanen di Firebase.'}
            </div>
          )}

          {/* Kapasitas Storage Firebase (Terpakai & Sisa) */}
          <div
            data-testid="firebase-storage-card"
            className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-[var(--app-secondary)]" aria-hidden="true" />
                <h4 className="text-xs font-extrabold text-slate-900">
                  Kapasitas Storage Firebase (Firestore)
                </h4>
              </div>
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                  cloudSummary
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {cloudSummary ? 'Aktif di Cloud' : 'Estimasi Data Aplikasi'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="p-3 rounded-xl bg-white border border-slate-200">
                <p className="text-[11px] font-semibold text-slate-500">
                  Storage Firebase Terpakai
                </p>
                <p
                  data-testid="firebase-storage-used"
                  className="text-base font-extrabold text-slate-900 mt-0.5 tabular-nums"
                >
                  {formatStorageBytes(storageUsage.usedBytes)}
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  {storageUsage.documentCount} dokumen ·{' '}
                  {storageUsage.usedPercentage < 0.01
                    ? '< 0,01%'
                    : `${storageUsage.usedPercentage.toFixed(2).replace('.', ',')}%`}{' '}
                  terpakai
                </p>
              </div>

              <div className="p-3 rounded-xl bg-white border border-slate-200">
                <p className="text-[11px] font-semibold text-slate-500">
                  Sisa Storage Firebase
                </p>
                <p
                  data-testid="firebase-storage-remaining"
                  className="text-base font-extrabold text-emerald-700 mt-0.5 tabular-nums"
                >
                  {formatStorageBytes(storageUsage.remainingBytes)}
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  {storageUsage.remainingPercentage.toFixed(2).replace('.', ',')}% tersisa dari{' '}
                  {formatStorageBytes(FIRESTORE_SPARK_STORAGE_BYTES)} (Spark)
                </p>
              </div>
            </div>

            <div>
              <div
                role="progressbar"
                aria-label="Persentase penggunaan storage Firebase"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Number(storageUsage.usedPercentage.toFixed(2))}
                className="w-full h-2 rounded-full bg-slate-200 overflow-hidden"
              >
                <div
                  className="h-full rounded-full bg-[var(--app-secondary)] transition-all duration-300"
                  style={{
                    width: `${Math.max(storageUsage.usedBytes > 0 ? 1.5 : 0, storageUsage.usedPercentage)}%`,
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5 text-[11px]">
              <div className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 flex items-center justify-between gap-2">
                <span className="text-slate-600 truncate">DPT ({storageUsage.voterCount} dok)</span>
                <span className="font-mono font-bold text-slate-800 whitespace-nowrap shrink-0">
                  {formatStorageBytes(storageUsage.breakdown.votersBytes)}
                </span>
              </div>
              <div className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 flex items-center justify-between gap-2">
                <span className="text-slate-600 truncate">Paslon ({db.candidates.length} dok)</span>
                <span className="font-mono font-bold text-slate-800 whitespace-nowrap shrink-0">
                  {formatStorageBytes(storageUsage.breakdown.candidatesBytes)}
                </span>
              </div>
              <div className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 flex items-center justify-between gap-2">
                <span className="text-slate-600 truncate">Pengaturan &amp; Logo (2 dok)</span>
                <span className="font-mono font-bold text-slate-800 whitespace-nowrap shrink-0">
                  {formatStorageBytes(storageUsage.breakdown.settingsBytes)}
                </span>
              </div>
              <div className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 flex items-center justify-between gap-2">
                <span className="text-slate-600 truncate">
                  Log ({storageUsage.auditLogStoredCount} dok)
                </span>
                <span className="font-mono font-bold text-slate-800 whitespace-nowrap shrink-0">
                  {formatStorageBytes(storageUsage.breakdown.auditLogsBytes)}
                </span>
              </div>
              <div className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 flex items-center justify-between gap-2 sm:col-span-2">
                <span className="text-slate-600 truncate">
                  Tautan Sheets ({storageUsage.sheetLinkCount} dok)
                </span>
                <span className="font-mono font-bold text-slate-800 whitespace-nowrap shrink-0">
                  {formatStorageBytes(storageUsage.breakdown.sheetLinksBytes)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/80 text-[11px]">
              <span className="text-slate-500">
                Kalkulasi lokal dari dokumen workspace agar tidak memboroskan kuota baca harian.
              </span>
              <a
                href={getFirestoreUsageUrl(FIRESTORE_PROJECT_ID, FIRESTORE_DATABASE_ID)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-bold text-[var(--app-secondary)] hover:underline shrink-0"
              >
                <span>Konsol Usage Firebase</span>
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            </div>
          </div>

          {/* Sisa Kuota Harian Firebase (Reads, Writes, Deletes) */}
          <div
            data-testid="firebase-daily-quota-card"
            className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[var(--app-secondary)]" aria-hidden="true" />
                <h4 className="text-xs font-extrabold text-slate-900">
                  Sisa Kuota Harian Firebase (Spark)
                </h4>
              </div>
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                  dailyQuotaSummary.quotaExceeded
                    ? 'bg-amber-100 text-amber-900'
                    : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {dailyQuotaSummary.quotaExceeded
                  ? `Kuota Penuh · Reset ${quotaResetTimeLabel}`
                  : `Reset Harian ${quotaResetTimeLabel}`}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {(
                [
                  {
                    key: 'reads',
                    label: 'Reads',
                    testId: 'firebase-quota-reads-remaining',
                    metric: dailyQuotaSummary.reads,
                    barClass: 'bg-sky-600',
                    textClass: 'text-sky-700',
                  },
                  {
                    key: 'writes',
                    label: 'Writes',
                    testId: 'firebase-quota-writes-remaining',
                    metric: dailyQuotaSummary.writes,
                    barClass: 'bg-emerald-600',
                    textClass: 'text-emerald-700',
                  },
                  {
                    key: 'deletes',
                    label: 'Deletes',
                    testId: 'firebase-quota-deletes-remaining',
                    metric: dailyQuotaSummary.deletes,
                    barClass: 'bg-amber-500',
                    textClass: 'text-amber-700',
                  },
                ] as const
              ).map((item) => (
                <div
                  key={item.key}
                  className="p-3 rounded-xl bg-white border border-slate-200 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <p className="text-[11px] font-bold text-slate-600 whitespace-nowrap">
                      {item.label}
                    </p>
                    <span className="text-[10px] font-mono text-slate-400 whitespace-nowrap shrink-0">
                      /{item.metric.limit.toLocaleString('id-ID')}
                    </span>
                  </div>
                  <p
                    data-testid={item.testId}
                    className={`text-base font-extrabold tabular-nums ${
                      dailyQuotaSummary.quotaExceeded ? 'text-amber-700' : item.textClass
                    }`}
                  >
                    {item.metric.remaining.toLocaleString('id-ID')}
                  </p>
                  <div
                    role="progressbar"
                    aria-label={`Persentase penggunaan kuota harian ${item.label}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Number(item.metric.usedPercentage.toFixed(2))}
                    className="w-full h-1.5 rounded-full bg-slate-200 overflow-hidden"
                  >
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        item.metric.usedPercentage >= 90 ? 'bg-rose-600' : item.barClass
                      }`}
                      style={{
                        width: `${Math.max(item.metric.used > 0 ? 2 : 0, item.metric.usedPercentage)}%`,
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-600 leading-snug">
                    Terpakai{' '}
                    <strong className="font-mono text-slate-800">
                      {item.metric.used.toLocaleString('id-ID')}
                    </strong>{' '}
                    ({item.metric.usedPercentage.toFixed(2).replace('.', ',')}%)
                  </p>
                </div>
              ))}
            </div>

            {/* Operasi Terakhir */}
            <div
              data-testid="firebase-quota-last-op"
              className="p-2.5 rounded-xl bg-white border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px]"
            >
              {dailyQuotaSummary.lastOp ? (
                <>
                  <div className="min-w-0">
                    <span className="text-slate-500">Operasi Terakhir: </span>
                    <strong className="text-slate-900">{dailyQuotaSummary.lastOp.label}</strong>
                    <span className="text-slate-400 ml-1.5 font-mono">
                      (
                      {new Date(dailyQuotaSummary.lastOp.atMs).toLocaleTimeString('id-ID', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                      )
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] font-bold shrink-0">
                    {dailyQuotaSummary.lastOp.reads > 0 && (
                      <span className="px-2 py-0.5 rounded-md bg-sky-50 border border-sky-200 text-sky-800">
                        +{dailyQuotaSummary.lastOp.reads.toLocaleString('id-ID')} Read
                      </span>
                    )}
                    {dailyQuotaSummary.lastOp.writes > 0 && (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800">
                        +{dailyQuotaSummary.lastOp.writes.toLocaleString('id-ID')} Write
                      </span>
                    )}
                    {dailyQuotaSummary.lastOp.deletes > 0 && (
                      <span className="px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800">
                        +{dailyQuotaSummary.lastOp.deletes.toLocaleString('id-ID')} Delete
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <span className="text-slate-500">
                  Belum ada operasi Firestore tercatat pada sesi peramban ini.
                </span>
              )}
            </div>

            {/* Rincian Mode Hemat Kuota Aktif */}
            <div
              data-testid="firebase-quota-optimization-summary"
              className="p-3 rounded-xl bg-white border border-slate-200 space-y-2"
            >
              <p className="text-[11px] font-extrabold text-slate-800">
                Optimasi Kuota Baca &amp; Tulis Firestore Aktif
              </p>
              <div className="grid grid-cols-1 gap-1.5 text-[11px]">
                <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-600">Real-Time Count</span>
                  <span className="font-mono font-bold text-emerald-700">
                    1 dok onSnapshot (tanpa koleksi pemilih)
                  </span>
                </div>
                <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-600">Login Pemilih (NIS / QR)</span>
                  <span className="font-mono font-bold text-emerald-700">
                    Maks. 1 Read (getDoc)
                  </span>
                </div>
                <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-600">Paslon &amp; Voting</span>
                  <span className="font-mono font-bold text-emerald-700">
                    1× getDocs · runTransaction increment(1)
                  </span>
                </div>
                <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-600">Import CSV (≤{MAX_CSV_VOTERS}) &amp; Tabel DPT</span>
                  <span className="font-mono font-bold text-emerald-700">
                    writeBatch ≤{FIRESTORE_CSV_BATCH_LIMIT} · .limit({DPT_DISPLAY_LIMIT})
                  </span>
                </div>
                <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-600">Backup Manual &amp; Auto-Sync</span>
                  <span className="font-mono font-bold text-emerald-700">
                    Diff Cache Lokal (0 scan penuh DPT)
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/80 text-[11px]">
              <span className="text-slate-500">
                {dailyQuotaSummary.quotaExceeded
                  ? 'Server Firebase melaporkan kuota harian proyek penuh; sinkronisasi dijeda hingga reset harian.'
                  : 'Menghitung operasi Reads, Writes, & Deletes aplikasi secara akurat selama siklus 24 jam.'}
              </span>
              <a
                href={getFirestoreUsageUrl(FIRESTORE_PROJECT_ID, FIRESTORE_DATABASE_ID)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-bold text-[var(--app-secondary)] hover:underline shrink-0"
              >
                <span>Cek Kuota Live Proyek</span>
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            </div>
          </div>

          {(quotaExceeded || syncError) && (
            <div
              className={`p-3.5 rounded-xl border text-[11px] space-y-2 ${
                quotaExceeded || isFirestoreQuotaError(syncError)
                  ? 'bg-amber-50 border-amber-200 text-amber-950'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              <p className="font-semibold leading-relaxed">
                {syncError || formatFirestoreErrorMessage('resource-exhausted')}
              </p>
              {(quotaExceeded || isFirestoreQuotaError(syncError)) && (
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <a
                    href={getFirestoreUpgradeUrl(FIRESTORE_PROJECT_ID, FIRESTORE_DATABASE_ID)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-bold text-amber-900 underline hover:text-amber-700"
                  >
                    <span>Buka Konsol Firestore</span>
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                  <a
                    href={FIRESTORE_PRICING_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-bold text-amber-900 underline hover:text-amber-700"
                  >
                    <span>Info Kuota Spark/Enterprise</span>
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              disabled={!user || cloudBusy}
              onClick={() => setConfirmAction({ type: 'SYNC_TO_CLOUD' })}
              className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
            >
              <CloudUpload className="w-4 h-4" aria-hidden="true" />
              <span>Simpan ke Firestore</span>
            </button>
            <button
              type="button"
              disabled={!user || !cloudSummary || cloudBusy}
              onClick={() => setConfirmAction({ type: 'LOAD_FROM_CLOUD' })}
              className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-xs font-bold cursor-pointer"
            >
              <CloudDownload className="w-4 h-4" aria-hidden="true" />
              <span>Muat dari Firestore</span>
            </button>
          </div>
        </section>

        <section className="xl:col-span-6 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
            <Link2 className="w-5 h-5 text-[var(--app-secondary)]" aria-hidden="true" />
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Riwayat Spreadsheet Terhubung (Firestore)
              </h3>
              <p className="text-xs text-slate-500">
                Daftar Google Spreadsheet yang pernah disinkronkan pada akun Google Anda.
              </p>
            </div>
          </div>

          {savedLinks.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">
              Belum ada spreadsheet tersimpan. Impor atau ekspor Google Sheet untuk menyimpannya di
              sini.
            </p>
          ) : (
            <div className="space-y-2.5">
              {savedLinks.map((link) => (
                <div
                  key={link.id}
                  className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-slate-900 truncate">
                      {link.spreadsheetTitle}
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono truncate">
                      Tab: {link.sheetName} · ID: {link.spreadsheetId}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setImportInput(link.spreadsheetId);
                        setExportInput(link.spreadsheetId);
                        onNotify('info', 'ID Dipilih', `ID spreadsheet "${link.spreadsheetTitle}" diisi.`);
                      }}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700 cursor-pointer"
                    >
                      Pilih
                    </button>
                    <a
                      href={link.spreadsheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-semibold text-[var(--app-secondary)]"
                    >
                      <span>Buka</span>
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>
                    <button
                      type="button"
                      onClick={() => setConfirmAction({ type: 'DELETE_LINK', link })}
                      aria-label={`Hapus tautan ${link.spreadsheetTitle}`}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Explicit User Confirmation Modal for All Mutating Google Sheets / Cloud Actions */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gs-confirm-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-amber-50">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600" aria-hidden="true" />
                <h3 id="gs-confirm-title" className="text-base font-extrabold text-slate-900">
                  Konfirmasi Perubahan Data
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                aria-label="Tutup dialog konfirmasi"
                className="p-1 rounded-lg text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {confirmAction.type === 'UPDATE_SHEET' && (
                <p className="text-sm text-slate-700 leading-relaxed">
                  Anda akan menimpa isi tab{' '}
                  <strong>
                    {EXPORT_TAB_REKAP}, {EXPORT_TAB_DPT}, dan {EXPORT_TAB_PASLON}
                  </strong>{' '}
                  pada Google Spreadsheet{' '}
                  <strong>&ldquo;{confirmAction.spreadsheetTitle}&rdquo;</strong> (ID:{' '}
                  <span className="font-mono text-xs">{confirmAction.spreadsheetId}</span>) dengan{' '}
                  <strong>{db.voters.length}</strong> data DPT dan{' '}
                  <strong>{db.candidates.length}</strong> Paslon terbaru. Lanjutkan?
                </p>
              )}

              {confirmAction.type === 'SYNC_TO_CLOUD' && (
                <p className="text-sm text-slate-700 leading-relaxed">
                  Tindakan ini akan memperbarui snapshot workspace pemilihan di{' '}
                  <strong>Cloud Firestore</strong> dengan <strong>{db.voters.length}</strong> data
                  pemilih dan <strong>{db.candidates.length}</strong> pasangan calon saat ini.
                </p>
              )}

              {confirmAction.type === 'LOAD_FROM_CLOUD' && (
                <p className="text-sm text-slate-700 leading-relaxed">
                  Memuat data dari <strong>Cloud Firestore</strong> akan mengganti data DPT (
                  {db.voters.length} baris) dan Paslon ({db.candidates.length} paslon) lokal saat
                  ini dengan snapshot dari cloud ({cloudSummary?.totalDpt ?? 0} DPT). Lanjutkan?
                </p>
              )}

              {confirmAction.type === 'DELETE_LINK' && (
                <p className="text-sm text-slate-700 leading-relaxed">
                  Hapus tautan tersimpan{' '}
                  <strong>&ldquo;{confirmAction.link.spreadsheetTitle}&rdquo;</strong> dari daftar
                  Firestore? File asli di Google Sheets Anda tidak akan dihapus.
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={updatingSheet || cloudBusy}
                  onClick={() => setConfirmAction(null)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={updatingSheet || cloudBusy}
                  onClick={handleExecuteConfirmedAction}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
                >
                  {(updatingSheet || cloudBusy) && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  )}
                  <span>Ya, Lanjutkan</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
