import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CloudDownload,
  CloudUpload,
  Code2,
  Copy,
  Download,
  FileCode,
  Loader2,
  PlugZap,
  X,
} from 'lucide-react';
import type { DatabaseState } from '../../types/evoting';
import {
  gasPing,
  gasPullState,
  gasPushState,
  loadGasConfig,
  saveGasConfig,
} from '../../utils/gasClient';
import {
  generateGasCodeGs,
  generateGasIndexHtml,
  generateGasManifestJson,
  isValidGasWebAppUrl,
} from '../../utils/gasGenerator';
import { isGasDevUrl } from '../../utils/safeJson';

interface GoogleAppsScriptPanelProps {
  db: DatabaseState;
  onRestoreFromGas: (nextDb: DatabaseState) => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

type GasFileTab = 'code' | 'index' | 'manifest';
type ConfirmGasAction = 'PUSH_GAS' | 'PULL_GAS' | null;

function downloadTextFile(filename: string, content: string, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function GoogleAppsScriptPanel({
  db,
  onRestoreFromGas,
  onNotify,
}: GoogleAppsScriptPanelProps) {
  const [config, setConfig] = useState(() => loadGasConfig());
  const [urlInput, setUrlInput] = useState(config.webAppUrl);
  const [testingConn, setTestingConn] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [pingResult, setPingResult] = useState<{
    schoolName?: string;
    totalDpt?: number;
    totalCandidates?: number;
  } | null>(null);
  const [gasError, setGasError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmGasAction>(null);

  const [activeFile, setActiveFile] = useState<GasFileTab>('code');
  const [copiedFile, setCopiedFile] = useState<GasFileTab | null>(null);

  const assetBaseUrl = useMemo(() => {
    if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
      return window.location.origin;
    }
    return 'https://ais-pre-dlg3rx76p5mdkvqppw73ei-879386010234.asia-northeast1.run.app';
  }, []);

  const codeGs = useMemo(() => generateGasCodeGs(db, assetBaseUrl), [db, assetBaseUrl]);
  const indexHtml = useMemo(() => generateGasIndexHtml(db, assetBaseUrl), [db, assetBaseUrl]);
  const manifestJson = useMemo(() => generateGasManifestJson(), []);

  const currentFileContent =
    activeFile === 'code' ? codeGs : activeFile === 'index' ? indexHtml : manifestJson;
  const currentFilename =
    activeFile === 'code'
      ? 'Code.gs'
      : activeFile === 'index'
        ? 'Index.html'
        : 'appsscript.json';

  const updateSavedConfig = (next: Partial<typeof config>) => {
    const updated = { ...config, ...next };
    setConfig(updated);
    saveGasConfig(updated);
    window.dispatchEvent(new CustomEvent('osis-gas-config-change', { detail: updated }));
  };

  const handleTestConnection = async () => {
    const cleanUrl = urlInput.trim();
    if (!isValidGasWebAppUrl(cleanUrl)) {
      onNotify(
        'error',
        'URL Apps Script Tidak Valid',
        'Masukkan URL Web App Google Apps Script (https://script.google.com/macros/s/.../exec).'
      );
      return;
    }

    setTestingConn(true);
    setGasError(null);
    try {
      const info = await gasPing(cleanUrl);
      setPingResult(info);
      updateSavedConfig({ webAppUrl: cleanUrl });
      onNotify(
        'success',
        'Terhubung ke Google Apps Script',
        `Spreadsheet "${info.schoolName || db.settings.schoolName}" (${info.totalDpt ?? 0} DPT) siap digunakan.`
      );
    } catch (err) {
      setPingResult(null);
      const msg = err instanceof Error ? err.message : 'Gagal menghubungi Google Apps Script.';
      setGasError(msg);
      onNotify('error', 'Koneksi Apps Script Gagal', msg);
    } finally {
      setTestingConn(false);
    }
  };

  const handleToggleAutoSync = () => {
    const cleanUrl = urlInput.trim();
    if (!config.autoSync && !isValidGasWebAppUrl(cleanUrl)) {
      onNotify(
        'error',
        'Masukkan URL Web App Dulu',
        'Isi dan uji URL Web App Google Apps Script sebelum mengaktifkan sinkronisasi otomatis.'
      );
      return;
    }
    const nextAuto = !config.autoSync;
    updateSavedConfig({ webAppUrl: cleanUrl, autoSync: nextAuto });
    onNotify(
      'info',
      nextAuto ? 'Auto-Sync Apps Script Aktif' : 'Auto-Sync Apps Script Dijeda',
      nextAuto
        ? 'Setiap perubahan database otomatis dikirim ke Google Apps Script Web App.'
        : 'Sinkronisasi otomatis ke Google Apps Script dijeda.'
    );
  };

  const handleExecuteConfirmed = async () => {
    const cleanUrl = urlInput.trim();
    if (!confirmAction || !isValidGasWebAppUrl(cleanUrl)) {
      setConfirmAction(null);
      return;
    }

    setSyncBusy(true);
    setGasError(null);
    try {
      if (confirmAction === 'PUSH_GAS') {
        await gasPushState(cleanUrl, db);
        updateSavedConfig({ webAppUrl: cleanUrl, lastSyncedAt: Date.now() });
        onNotify(
          'success',
          'Terkirim ke Google Apps Script',
          `${db.voters.length} DPT dan ${db.candidates.length} Paslon berhasil ditulis ke Google Sheets via Apps Script.`
        );
      } else if (confirmAction === 'PULL_GAS') {
        const res = await gasPullState(cleanUrl);
        if (!res.db) {
          throw new Error('Data database dari Apps Script kosong.');
        }
        onRestoreFromGas(res.db);
        updateSavedConfig({ webAppUrl: cleanUrl, lastSyncedAt: Date.now() });
        onNotify(
          'success',
          'Data Dimuat dari Apps Script',
          `${res.db.voters.length} DPT dan ${res.db.candidates.length} Paslon dipulihkan dari Google Apps Script.`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Operasi Google Apps Script gagal.';
      setGasError(msg);
      onNotify('error', 'Sinkronisasi Apps Script Gagal', msg);
    } finally {
      setSyncBusy(false);
      setConfirmAction(null);
    }
  };

  const handleCopyCurrent = async () => {
    try {
      await navigator.clipboard.writeText(currentFileContent);
      setCopiedFile(activeFile);
      onNotify('success', 'Kode Disalin', `Isi ${currentFilename} berhasil disalin ke clipboard.`);
      window.setTimeout(() => setCopiedFile(null), 1800);
    } catch {
      onNotify('error', 'Gagal Menyalin', 'Silakan salin kode secara manual dari pratinjau.');
    }
  };

  const handleDownloadAll = () => {
    downloadTextFile('Code.gs', codeGs);
    window.setTimeout(() => downloadTextFile('Index.html', indexHtml, 'text/html;charset=utf-8'), 150);
    window.setTimeout(
      () => downloadTextFile('appsscript.json', manifestJson, 'application/json;charset=utf-8'),
      300
    );
    onNotify(
      'success',
      '3 File Apps Script Diunduh',
      'File Code.gs, Index.html, dan appsscript.json siap diunggah ke script.google.com.'
    );
  };

  const validUrlEntered = isValidGasWebAppUrl(urlInput);

  return (
    <div className="space-y-6">
      {/* 1. Koneksi Live Google Apps Script Web App */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 flex items-center justify-center shrink-0">
              <Code2 className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900">
                Backend Google Apps Script (Web App &amp; Spreadsheet)
              </h2>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                Hubungkan URL Web App Google Apps Script (<span className="font-mono">/exec</span>)
                untuk menyimpan database secara langsung ke Google Sheets tanpa batas sesi browser,
                atau unduh proyek Apps Script mandiri di bawah.
              </p>
            </div>
          </div>

          {pingResult && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 shrink-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              <span>Terhubung: {pingResult.schoolName || 'Apps Script'}</span>
            </span>
          )}
        </div>

        <div className="space-y-2.5">
          <label htmlFor="gas-webapp-url" className="block text-xs font-bold text-slate-700">
            URL Deployment Web App Google Apps Script
          </label>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              id="gas-webapp-url"
              type="url"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                setPingResult(null);
                setGasError(null);
              }}
              placeholder="https://script.google.com/macros/s/AKfycb.../exec"
              className="flex-1 h-11 px-3.5 rounded-xl border border-slate-300 text-xs font-mono"
            />
            <button
              type="button"
              disabled={!urlInput.trim() || testingConn}
              onClick={handleTestConnection}
              className="inline-flex items-center justify-center gap-2 px-5 h-11 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-50 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
            >
              {testingConn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span>Menguji...</span>
                </>
              ) : (
                <>
                  <PlugZap className="w-4 h-4" aria-hidden="true" />
                  <span>Uji &amp; Simpan URL</span>
                </>
              )}
            </button>
          </div>
          {isGasDevUrl(urlInput) && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                URL berakhiran <code className="font-mono font-bold">/dev</code> hanya untuk akun pembuat script
                dan mengembalikan halaman HTML login. Ganti dengan URL Web App produksi berakhiran{' '}
                <code className="font-mono font-bold">/exec</code> dari menu{' '}
                <strong>Deploy &rarr; Manage deployments</strong>.
              </span>
            </div>
          )}
          {gasError && (
            <div
              id="gas-connection-error-banner"
              role="alert"
              className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 flex items-start gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1 flex-1">
                <p className="font-bold text-rose-950">Koneksi Google Apps Script Gagal</p>
                <p className="leading-relaxed">{gasError}</p>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          <div className="lg:col-span-7 flex items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <div>
              <p className="text-xs font-bold text-slate-900">
                Sinkronisasi Otomatis ke Google Apps Script
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {config.autoSync
                  ? 'Aktif — perubahan DPT, Paslon, Pengaturan, dan Suara dikirim otomatis.'
                  : 'Nonaktif — aktifkan setelah URL Web App terpasang agar Apps Script selalu mutakhir.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={config.autoSync}
              aria-label="Sinkronisasi Otomatis ke Google Apps Script"
              onClick={handleToggleAutoSync}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                config.autoSync ? 'bg-emerald-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                  config.autoSync ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="lg:col-span-5 flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              disabled={!validUrlEntered || syncBusy}
              onClick={() => setConfirmAction('PUSH_GAS')}
              className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
            >
              <CloudUpload className="w-4 h-4" aria-hidden="true" />
              <span>Kirim ke Apps Script</span>
            </button>
            <button
              type="button"
              disabled={!validUrlEntered || syncBusy}
              onClick={() => setConfirmAction('PULL_GAS')}
              className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-xs font-bold cursor-pointer"
            >
              <CloudDownload className="w-4 h-4" aria-hidden="true" />
              <span>Muat dari Apps Script</span>
            </button>
          </div>
        </div>

        {config.lastSyncedAt && (
          <p className="text-[11px] text-slate-500">
            Sinkronisasi Apps Script terakhir:{' '}
            <strong className="text-slate-700">
              {new Date(config.lastSyncedAt).toLocaleString('id-ID')}
            </strong>
          </p>
        )}
      </section>

      {/* 2. Generator Proyek Google Apps Script Lengkap */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
              <FileCode className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Kode Proyek Google Apps Script Siap Deploy
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Sudah otomatis memuat data sekolah ({db.settings.schoolName}), {db.candidates.length}{' '}
                Paslon, dan {db.voters.length} DPT terkini.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDownloadAll}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] text-white text-xs font-bold whitespace-nowrap cursor-pointer"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            <span>Unduh Semua (3 File)</span>
          </button>
        </div>

        {/* 4-Step Deployment Guide */}
        <ol className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <li className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="font-mono font-extrabold text-[var(--app-secondary)]">01.</span>{' '}
            <strong className="text-slate-900">Buka Google Sheets</strong>
            <p className="text-[11px] text-slate-600 mt-1">
              Buat Spreadsheet baru, klik menu <strong>Ekstensi &rarr; Apps Script</strong>.
            </p>
          </li>
          <li className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="font-mono font-extrabold text-[var(--app-secondary)]">02.</span>{' '}
            <strong className="text-slate-900">Tempel 3 File</strong>
            <p className="text-[11px] text-slate-600 mt-1">
              Masukkan <code>Code.gs</code>, tambah file HTML <code>Index</code>, dan{' '}
              <code>appsscript.json</code>.
            </p>
          </li>
          <li className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="font-mono font-extrabold text-[var(--app-secondary)]">03.</span>{' '}
            <strong className="text-slate-900">Jalankan Setup</strong>
            <p className="text-[11px] text-slate-600 mt-1">
              Pilih fungsi <code>setupDatabase</code> lalu klik <strong>Run</strong> untuk membuat
              tab database.
            </p>
          </li>
          <li className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="font-mono font-extrabold text-[var(--app-secondary)]">04.</span>{' '}
            <strong className="text-slate-900">Deploy Web App</strong>
            <p className="text-[11px] text-slate-600 mt-1">
              <strong>Deploy &rarr; Web app</strong>, atur akses ke <strong>Anyone</strong>, lalu
              salin URL <code>/exec</code> ke atas.
            </p>
          </li>
        </ol>

        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
          <strong>Penting saat memperbarui kode Apps Script:</strong> Setelah menempel ulang{' '}
          <code>Code.gs</code> dan <code>Index.html</code> terbaru (yang sudah disamakan 100% dengan
          tampilan AI Studio), jangan lupa klik{' '}
          <strong>Deploy &rarr; Manage deployments &rarr; ikon Pensil (Edit) &rarr; Version: New version &rarr; Deploy</strong>{' '}
          agar URL <code>/exec</code> Anda menampilkan pembaruan terbaru.
        </div>

        {/* Code Preview Tabs */}
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="bg-slate-100 border-b border-slate-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {(
                [
                  { id: 'code', label: 'Code.gs' },
                  { id: 'index', label: 'Index.html' },
                  { id: 'manifest', label: 'appsscript.json' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveFile(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-colors cursor-pointer ${
                    activeFile === tab.id
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyCurrent}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 cursor-pointer"
              >
                {copiedFile === activeFile ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                    <span>Disalin</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Salin {currentFilename}</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadTextFile(
                    currentFilename,
                    currentFileContent,
                    activeFile === 'index'
                      ? 'text/html;charset=utf-8'
                      : activeFile === 'manifest'
                        ? 'application/json;charset=utf-8'
                        : 'text/plain;charset=utf-8'
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Unduh</span>
              </button>
            </div>
          </div>

          <pre className="p-4 bg-slate-950 text-slate-100 text-[11px] font-mono leading-relaxed overflow-x-auto max-h-80">
            <code>{currentFileContent}</code>
          </pre>
        </div>
      </section>

      {/* Confirmation Dialog for GAS Push/Pull */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gas-confirm-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-amber-50">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600" aria-hidden="true" />
                <h3 id="gas-confirm-title" className="text-base font-extrabold text-slate-900">
                  Konfirmasi Sinkronisasi Apps Script
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
              {confirmAction === 'PUSH_GAS' ? (
                <p className="text-sm text-slate-700 leading-relaxed">
                  Kirim seluruh database saat ini (<strong>{db.voters.length} DPT</strong> dan{' '}
                  <strong>{db.candidates.length} Paslon</strong>) ke Google Spreadsheet melalui Web
                  App Google Apps Script Anda? Data pada sheet target akan diperbarui.
                </p>
              ) : (
                <p className="text-sm text-slate-700 leading-relaxed">
                  Muat dan terapkan database dari Google Apps Script ke aplikasi ini? Data DPT dan
                  Paslon lokal saat ini akan diganti dengan data terbaru dari Google Spreadsheet.
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={syncBusy}
                  onClick={() => setConfirmAction(null)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={syncBusy}
                  onClick={handleExecuteConfirmed}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
                >
                  {syncBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
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
