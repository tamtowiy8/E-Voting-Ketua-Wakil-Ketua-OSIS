import { useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  EyeOff,
  ImagePlus,
  KeyRound,
  Loader2,
  Lock,
  Palette,
  QrCode,
  RotateCcw,
  Save,
  Smartphone,
  Unlock,
  Vote,
  X,
} from 'lucide-react';
import type {
  ElectionSettings,
  ThemeConfig,
  ThemeSurface,
  VoterLoginMode,
} from '../../types/evoting';
import { resolveEffectiveVoterLoginMode } from '../../utils/electionLogic';
import {
  DEFAULT_THEME,
  resolveTheme,
  THEME_PRESETS,
  THEME_SURFACES,
} from '../../utils/theme';

interface ElectionSettingsPanelProps {
  settings: ElectionSettings;
  onSaveSettings: (nextSettings: ElectionSettings, action: string, detail: string) => void;
  onResetElection: () => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

const DEFAULT_SCHOOL_LOGO = '/assets/aistudio/LOGO_SMANSA_3D_d5e941c9.png';

function resizeLogoFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string') {
        reject(new Error('Format gambar tidak dikenali.'));
        return;
      }

      const img = new Image();
      img.onerror = () => reject(new Error('File bukan gambar yang valid.'));
      img.onload = () => {
        const maxSize = 320;
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width >= height) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          } else {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

type SettingsSubMenu = 'BOOTH_LOGIN' | 'IDENTITY' | 'THEME' | 'RESET';

export function ElectionSettingsPanel({
  settings,
  onSaveSettings,
  onResetElection,
  onNotify,
}: ElectionSettingsPanelProps) {
  const [activeSubMenu, setActiveSubMenu] = useState<SettingsSubMenu>('BOOTH_LOGIN');
  const [schoolName, setSchoolName] = useState(settings.schoolName);
  const [academicYear, setAcademicYear] = useState(settings.academicYear);
  const [electionTitle, setElectionTitle] = useState(settings.electionTitle);
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl);
  const [logoError, setLogoError] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [startTime, setStartTime] = useState(settings.startTime);
  const [endTime, setEndTime] = useState(settings.endTime);

  const [themeDraft, setThemeDraft] = useState<ThemeConfig>(() => resolveTheme(settings.theme));
  const [voterLoginMode, setVoterLoginMode] = useState<VoterLoginMode>(() =>
    resolveEffectiveVoterLoginMode(settings)
  );

  const [isSavingIdentity, setIsSavingIdentity] = useState(false);
  const [isSavingLoginMode, setIsSavingLoginMode] = useState(false);
  const [isSavingTheme, setIsSavingTheme] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const logoInputRef = useRef<HTMLInputElement | null>(null);

  // Reset confirmation modal state
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetKeyword, setResetKeyword] = useState('');

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onNotify('error', 'Format Tidak Didukung', 'Pilih file gambar (PNG, JPG, JPEG, WebP, atau SVG).');
      e.target.value = '';
      return;
    }

    setIsUploadingLogo(true);
    try {
      const resized = await resizeLogoFileToDataUrl(file);
      setLogoUrl(resized);
      setLogoError(false);
      onNotify(
        'info',
        'Logo Siap Disimpan',
        `Gambar "${file.name}" berhasil dimuat. Klik Simpan Pengaturan untuk menerapkan.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memproses gambar logo.';
      onNotify('error', 'Upload Logo Gagal', msg);
    } finally {
      setIsUploadingLogo(false);
      e.target.value = '';
    }
  };

  const handleSaveIdentity = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingIdentity) return;

    if (!schoolName.trim() || !academicYear.trim() || !electionTitle.trim()) {
      onNotify(
        'error',
        'Pengaturan Belum Lengkap',
        'Nama sekolah, tahun ajaran, dan judul pemilihan tidak boleh kosong.'
      );
      return;
    }

    setIsSavingIdentity(true);
    window.setTimeout(() => {
      onSaveSettings(
        {
          ...settings,
          schoolName: schoolName.trim(),
          academicYear: academicYear.trim(),
          electionTitle: electionTitle.trim(),
          logoUrl: logoUrl.trim(),
          startTime,
          endTime,
          voterLoginMode,
        },
        'UPDATE_SETTINGS',
        `Memperbarui identitas, logo sekolah & jadwal pemilihan (${schoolName.trim()} - TA ${academicYear.trim()}).`
      );
      setIsSavingIdentity(false);
      onNotify('success', 'Pengaturan Disimpan', 'Identitas sekolah dan jadwal berhasil diperbarui.');
    }, 350);
  };

  const handleSaveLoginMode = () => {
    if (isSavingLoginMode) return;
    setIsSavingLoginMode(true);
    const labelMap: Record<VoterLoginMode, string> = {
      NISN: 'NIS / NISN (Input Manual)',
      QR_CODE: 'QR Code (Scan Kamera Perangkat)',
      BOTH: 'NISN & QR Code (Keduanya)',
    };
    window.setTimeout(() => {
      onSaveSettings(
        {
          ...settings,
          voterLoginMode,
        },
        'UPDATE_VOTER_LOGIN_MODE',
        `Mengatur metode login pemilih menjadi: ${labelMap[voterLoginMode]}.`
      );
      setIsSavingLoginMode(false);
      onNotify(
        'success',
        'Metode Login Pemilih Disimpan',
        `Pemilih sekarang masuk menggunakan mode ${labelMap[voterLoginMode]}.`
      );
    }, 250);
  };

  const handleSelectPreset = (presetId: string) => {
    const preset = THEME_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setThemeDraft((prev) => ({
      ...prev,
      presetId: preset.id,
      primaryColor: preset.primaryColor,
      secondaryColor: preset.secondaryColor,
      accentColor: preset.accentColor,
    }));
  };

  const handleSaveTheme = () => {
    if (isSavingTheme) return;
    setIsSavingTheme(true);
    window.setTimeout(() => {
      onSaveSettings(
        {
          ...settings,
          theme: themeDraft,
        },
        'UPDATE_THEME',
        `Mengubah tema aplikasi (${themeDraft.presetId}, latar ${themeDraft.surfaceMode}).`
      );
      setIsSavingTheme(false);
      onNotify('success', 'Tema Aplikasi Disimpan', 'Tampilan tema baru telah diterapkan.');
    }, 350);
  };

  const handleResetThemeDefault = () => {
    setThemeDraft(DEFAULT_THEME);
    setIsSavingTheme(true);
    window.setTimeout(() => {
      onSaveSettings(
        {
          ...settings,
          theme: DEFAULT_THEME,
        },
        'RESET_THEME',
        'Mengembalikan tema aplikasi ke pengaturan awal (Biru Navy Klasik).'
      );
      setIsSavingTheme(false);
      onNotify('info', 'Tema Direset', 'Tema aplikasi dikembalikan ke Biru Navy Klasik.');
    }, 300);
  };

  const toggleBooth = () => {
    const nextOpen = !settings.isBoothOpen;
    onSaveSettings(
      { ...settings, isBoothOpen: nextOpen },
      nextOpen ? 'OPEN_BOOTH' : 'CLOSE_BOOTH',
      nextOpen
        ? 'Membuka bilik suara secara manual untuk pemilih.'
        : 'Menutup bilik suara secara manual.'
    );
    const modeHint =
      voterLoginMode === 'QR_CODE'
        ? 'Pemilih sekarang dapat masuk dengan memindai QR Code Kartu Pemilih.'
        : voterLoginMode === 'BOTH'
          ? 'Pemilih sekarang dapat masuk menggunakan NIS/NISN atau QR Code Kartu Pemilih.'
          : 'Pemilih sekarang dapat masuk menggunakan NIS/NISN.';
    onNotify(
      nextOpen ? 'success' : 'info',
      nextOpen ? 'Bilik Suara Dibuka' : 'Bilik Suara Ditutup',
      nextOpen ? modeHint : 'Akses login pemilih sementara dinonaktifkan.'
    );
  };

  const toggleSecretMode = () => {
    const nextHide = !settings.hideLiveResults;
    onSaveSettings(
      { ...settings, hideLiveResults: nextHide },
      'TOGGLE_LIVE_MONITOR_VISIBILITY',
      nextHide
        ? 'Mengaktifkan Mode Rahasia pada Live Monitor (hasil disembunyikan).'
        : 'Menonaktifkan Mode Rahasia pada Live Monitor (hasil ditampilkan).'
    );
    onNotify(
      'info',
      nextHide ? 'Mode Rahasia Aktif' : 'Hasil Live Monitor Dibuka',
      nextHide
        ? 'Angka perolehan suara pada Live Monitor disembunyikan.'
        : 'Angka perolehan suara pada Live Monitor ditampilkan ke publik.'
    );
  };

  const handleConfirmReset = (e: React.FormEvent) => {
    e.preventDefault();
    if (isResetting) return;
    if (resetKeyword.trim() !== 'RESET') {
      onNotify('error', 'Konfirmasi Tidak Cocok', 'Ketik tepat kata "RESET" dengan huruf kapital.');
      return;
    }
    setIsResetting(true);
    window.setTimeout(() => {
      onResetElection();
      setIsResetting(false);
      setResetKeyword('');
      setShowResetModal(false);
    }, 400);
  };

  const subMenuItems: Array<{
    id: SettingsSubMenu;
    label: string;
    icon: typeof QrCode;
  }> = [
    { id: 'BOOTH_LOGIN', label: 'Bilik & Metode Login', icon: QrCode },
    { id: 'IDENTITY', label: 'Identitas & Jadwal', icon: CalendarClock },
    { id: 'THEME', label: 'Tema Aplikasi', icon: Palette },
    { id: 'RESET', label: 'Reset Pemilihan', icon: RotateCcw },
  ];

  return (
    <div className="space-y-5">
      {/* Compact Sub-Menu Tabs for Settings */}
      <div
        role="tablist"
        aria-label="Sub Menu Pengaturan"
        className="bg-white border border-slate-200 rounded-2xl p-2 grid grid-cols-2 lg:grid-cols-4 gap-2"
      >
        {subMenuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeSubMenu === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={`settings-submenu-${item.id.toLowerCase()}`}
              onClick={() => setActiveSubMenu(item.id)}
              className={`inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs sm:text-sm transition-colors whitespace-nowrap cursor-pointer ${
                isActive
                  ? item.id === 'RESET'
                    ? 'bg-rose-600 text-white font-bold shadow-xs'
                    : 'bg-[var(--app-primary)] text-white font-bold shadow-xs'
                  : item.id === 'RESET'
                    ? 'text-rose-700 hover:bg-rose-50 font-semibold'
                    : 'text-slate-700 hover:bg-slate-100 font-semibold'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Sub-Menu 1: Booth Control, Secret Mode & Voter Login Method */}
      {activeSubMenu === 'BOOTH_LOGIN' && (
        <div role="tabpanel" aria-label="Bilik & Metode Login" className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col justify-between gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-extrabold text-slate-900">
                Kontrol Status Bilik Suara
              </h2>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Sakelar manual untuk membuka atau menutup akses masuk pemilih ke bilik suara
                elektronik.
              </p>
            </div>
            {settings.isBoothOpen ? (
              <Unlock className="w-6 h-6 text-emerald-600 shrink-0" aria-hidden="true" />
            ) : (
              <Lock className="w-6 h-6 text-amber-600 shrink-0" aria-hidden="true" />
            )}
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm font-bold">
              {settings.isBoothOpen ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                  <span className="text-emerald-700">Status: Bilik Suara Dibuka</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4 text-amber-600" aria-hidden="true" />
                  <span className="text-amber-700">Status: Bilik Suara Ditutup</span>
                </>
              )}
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={settings.isBoothOpen}
              onClick={toggleBooth}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                settings.isBoothOpen
                  ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
            >
              {settings.isBoothOpen ? 'Tutup Bilik Suara' : 'Buka Bilik Suara'}
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col justify-between gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-extrabold text-slate-900">
                Mode Rahasia Live Monitor
              </h2>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Tahan publikasi angka &amp; grafik perolehan suara di Live Monitor hingga waktu
                pemilihan selesai.
              </p>
            </div>
            <EyeOff className="w-6 h-6 text-[var(--app-secondary)] shrink-0" aria-hidden="true" />
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
            <span className="text-sm font-bold text-slate-800">
              {settings.hideLiveResults
                ? 'Angka Perolehan Suara Disembunyikan'
                : 'Angka Perolehan Suara Ditampilkan'}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.hideLiveResults}
              onClick={toggleSecretMode}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                settings.hideLiveResults
                  ? 'bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] text-white'
                  : 'bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300'
              }`}
            >
              {settings.hideLiveResults ? 'Tampilkan Hasil' : 'Aktifkan Mode Rahasia'}
            </button>
          </div>
        </div>
      </div>

      {/* Voter Login Method Settings (SuperAdmin Only) */}
      <section
        aria-labelledby="voter-login-mode-heading"
        className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5"
      >
        <div className="pb-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <QrCode className="w-5 h-5 text-[var(--app-secondary)] shrink-0" aria-hidden="true" />
            <div>
              <h2 id="voter-login-mode-heading" className="text-base font-extrabold text-slate-900">
                Pengaturan Metode Login Pemilih
              </h2>
              <p className="text-xs text-slate-500">
                Atur apakah siswa login menggunakan input NIS/NISN manual, scan QR Code dengan kamera perangkat, atau keduanya.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isSavingLoginMode}
            onClick={handleSaveLoginMode}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-75 text-white text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isSavingLoginMode ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>Menyimpan...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" aria-hidden="true" />
                <span>Simpan Metode Login</span>
              </>
            )}
          </button>
        </div>

        <div
          role="radiogroup"
          aria-labelledby="voter-login-mode-heading"
          className="grid grid-cols-1 md:grid-cols-3 gap-3.5"
        >
          {[
            {
              id: 'NISN' as const,
              title: 'NIS / NISN (Manual)',
              desc: 'Pemilih mengetik Nomor Induk Siswa (NIS/NISN) secara manual di halaman login.',
              icon: KeyRound,
            },
            {
              id: 'QR_CODE' as const,
              title: 'QR Code (Kamera)',
              desc: 'Pemilih memindai QR Code pada Kartu Pemilih menggunakan kamera perangkat.',
              icon: QrCode,
            },
            {
              id: 'BOTH' as const,
              title: 'Keduanya (NISN & QR Code)',
              desc: 'Pemilih bebas memilih scan QR Code kamera atau ketik NIS/NISN manual.',
              icon: Smartphone,
            },
          ].map((option) => {
            const Icon = option.icon;
            const active = voterLoginMode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setVoterLoginMode(option.id)}
                className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2.5 ${
                  active
                    ? 'border-[var(--app-primary)] bg-slate-50 ring-2 ring-[var(--app-primary)]/15'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        active
                          ? 'bg-[var(--app-primary)] text-white'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      <Icon className="w-4 h-4" aria-hidden="true" />
                    </div>
                    <span className="text-sm font-extrabold text-slate-900">{option.title}</span>
                  </div>
                  {active && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />}
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{option.desc}</p>
              </button>
            );
          })}
        </div>
      </section>
        </div>
      )}

      {/* Sub-Menu 2: School Identity & Schedule Form */}
      {activeSubMenu === 'IDENTITY' && (
      <form
        role="tabpanel"
        aria-label="Identitas & Jadwal"
        onSubmit={handleSaveIdentity}
        className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5"
      >
        <div className="pb-4 border-b border-slate-100 flex items-center gap-2.5">
          <CalendarClock className="w-5 h-5 text-[var(--app-secondary)]" aria-hidden="true" />
          <div>
            <h2 className="text-base font-extrabold text-slate-900">
              Identitas Sekolah &amp; Jadwal Pemilihan
            </h2>
            <p className="text-xs text-slate-500">
              Pengaturan ini tampil di halaman utama, kartu pemilih, laporan PDF, dan Live Monitor.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="set-school" className="block text-xs font-bold text-slate-700 mb-1.5">
              Nama Sekolah / Lembaga
            </label>
            <input
              id="set-school"
              type="text"
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label htmlFor="set-year" className="block text-xs font-bold text-slate-700 mb-1.5">
              Tahun Ajaran
            </label>
            <input
              id="set-year"
              type="text"
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl border border-slate-300 font-mono text-sm"
            />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="set-title" className="block text-xs font-bold text-slate-700 mb-1.5">
              Judul Pemilihan
            </label>
            <input
              id="set-title"
              type="text"
              value={electionTitle}
              onChange={(e) => setElectionTitle(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl border border-slate-300 text-sm"
            />
          </div>

          {/* Logo Sekolah Upload from Device Gallery/Folder */}
          <div className="md:col-span-2 p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <label className="block text-xs font-bold text-slate-700">
              Logo Sekolah / OSIS (Unggah dari Galeri atau Folder Perangkat)
            </label>

            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="w-16 h-16 rounded-xl bg-white border border-slate-200 p-1.5 flex items-center justify-center shrink-0 overflow-hidden">
                {logoUrl && !logoError ? (
                  <img
                    src={logoUrl}
                    alt="Pratinjau Logo Sekolah"
                    onError={() => setLogoError(true)}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <Vote className="w-7 h-7 text-slate-400" aria-hidden="true" />
                )}
              </div>

              <div className="flex-1 space-y-2.5 min-w-0">
                <input
                  ref={logoInputRef}
                  id="set-logo-file"
                  type="file"
                  accept="image/*"
                  onChange={handleLogoFileChange}
                  className="hidden"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isUploadingLogo}
                    onClick={() => logoInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-70 text-white text-xs font-bold transition-colors cursor-pointer"
                  >
                    {isUploadingLogo ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        <span>Memproses Gambar...</span>
                      </>
                    ) : (
                      <>
                        <ImagePlus className="w-4 h-4" aria-hidden="true" />
                        <span>Pilih Gambar dari Galeri / Folder</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setLogoUrl(DEFAULT_SCHOOL_LOGO);
                      setLogoError(false);
                    }}
                    className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer"
                  >
                    Gunakan Logo Default
                  </button>
                </div>

                <div>
                  <label htmlFor="set-logo" className="block text-[11px] font-medium text-slate-500 mb-1">
                    Atau masukkan URL / Data URI Logo:
                  </label>
                  <input
                    id="set-logo"
                    type="text"
                    value={logoUrl}
                    onChange={(e) => {
                      setLogoUrl(e.target.value);
                      setLogoError(false);
                    }}
                    placeholder="/src/assets/images/..."
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="set-start" className="block text-xs font-bold text-slate-700 mb-1.5">
              Jadwal Waktu Mulai Pemilihan
            </label>
            <input
              id="set-start"
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl border border-slate-300 font-mono text-sm"
            />
          </div>

          <div>
            <label htmlFor="set-end" className="block text-xs font-bold text-slate-700 mb-1.5">
              Jadwal Waktu Selesai Pemilihan
            </label>
            <input
              id="set-end"
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl border border-slate-300 font-mono text-sm"
            />
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={isSavingIdentity}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-75 text-white text-sm font-bold transition-colors cursor-pointer"
          >
            {isSavingIdentity ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>Menyimpan Pengaturan...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" aria-hidden="true" />
                <span>Simpan Pengaturan</span>
              </>
            )}
          </button>
        </div>
      </form>
      )}

      {/* Sub-Menu 3: Pengaturan Tema Aplikasi */}
      {activeSubMenu === 'THEME' && (
      <section
        role="tabpanel"
        aria-label="Tema Aplikasi"
        aria-labelledby="theme-settings-heading"
        className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5"
      >
        <div className="pb-4 border-b border-slate-100 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Palette className="w-5 h-5 text-[var(--app-secondary)]" aria-hidden="true" />
            <div>
              <h2 id="theme-settings-heading" className="text-base font-extrabold text-slate-900">
                Pengaturan Tema Aplikasi
              </h2>
              <p className="text-xs text-slate-500">
                Sesuaikan palet warna utama, warna aksen, dan nuansa latar aplikasi sesuai identitas sekolah.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isSavingTheme}
            onClick={handleResetThemeDefault}
            className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap"
          >
            Reset Tema Default
          </button>
        </div>

        {/* Presets */}
        <div>
          <p className="text-xs font-bold text-slate-700 mb-2.5">Pilihan Tema Cepat</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {THEME_PRESETS.map((preset) => {
              const isSelected =
                themeDraft.presetId === preset.id &&
                themeDraft.primaryColor.toLowerCase() === preset.primaryColor.toLowerCase();
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset.id)}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'border-slate-900 bg-slate-50 ring-2 ring-slate-900/15'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-4 h-4 rounded-full border border-black/10"
                        style={{ backgroundColor: preset.primaryColor }}
                      />
                      <span
                        className="w-4 h-4 rounded-full border border-black/10"
                        style={{ backgroundColor: preset.secondaryColor }}
                      />
                      <span
                        className="w-4 h-4 rounded-full border border-black/10"
                        style={{ backgroundColor: preset.accentColor }}
                      />
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-emerald-600" aria-hidden="true" />}
                  </div>
                  <p className="text-xs font-bold text-slate-900">{preset.name}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                    {preset.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Colors & Surface Mode */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          <div className="space-y-3">
            <p className="text-xs font-bold text-slate-700">Kustomisasi Warna Manual</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <label htmlFor="theme-primary" className="block text-[11px] font-bold text-slate-700 mb-1.5">
                  Warna Utama
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="theme-primary"
                    type="color"
                    value={themeDraft.primaryColor}
                    onChange={(e) =>
                      setThemeDraft((prev) => ({
                        ...prev,
                        presetId: 'custom',
                        primaryColor: e.target.value,
                      }))
                    }
                    className="h-8 w-10 rounded border border-slate-300 cursor-pointer"
                  />
                  <span className="font-mono text-[11px] text-slate-600">
                    {themeDraft.primaryColor}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <label htmlFor="theme-secondary" className="block text-[11px] font-bold text-slate-700 mb-1.5">
                  Warna Hover
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="theme-secondary"
                    type="color"
                    value={themeDraft.secondaryColor}
                    onChange={(e) =>
                      setThemeDraft((prev) => ({
                        ...prev,
                        presetId: 'custom',
                        secondaryColor: e.target.value,
                      }))
                    }
                    className="h-8 w-10 rounded border border-slate-300 cursor-pointer"
                  />
                  <span className="font-mono text-[11px] text-slate-600">
                    {themeDraft.secondaryColor}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <label htmlFor="theme-accent" className="block text-[11px] font-bold text-slate-700 mb-1.5">
                  Warna Aksen
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="theme-accent"
                    type="color"
                    value={themeDraft.accentColor}
                    onChange={(e) =>
                      setThemeDraft((prev) => ({
                        ...prev,
                        presetId: 'custom',
                        accentColor: e.target.value,
                      }))
                    }
                    className="h-8 w-10 rounded border border-slate-300 cursor-pointer"
                  />
                  <span className="font-mono text-[11px] text-slate-600">
                    {themeDraft.accentColor}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-bold text-slate-700">Nuansa Latar Belakang Halaman</p>
            <div className="grid grid-cols-3 gap-3">
              {THEME_SURFACES.map((s) => {
                const active = themeDraft.surfaceMode === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() =>
                      setThemeDraft((prev) => ({
                        ...prev,
                        surfaceMode: s.id as ThemeSurface,
                      }))
                    }
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      active
                        ? 'border-slate-900 ring-2 ring-slate-900/15'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                    style={{ backgroundColor: s.bgHex }}
                  >
                    <p className="text-xs font-bold text-slate-900">{s.label}</p>
                    <p className="text-[11px] font-mono text-slate-500 mt-0.5">{s.bgHex}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Live Preview Bar + Save Theme Button */}
        <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="px-4 py-2 rounded-xl text-white text-xs font-bold flex items-center gap-2"
              style={{ backgroundColor: themeDraft.primaryColor }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: themeDraft.accentColor }}
              />
              <span>Pratinjau Warna Tema</span>
            </div>
          </div>

          <button
            type="button"
            disabled={isSavingTheme}
            onClick={handleSaveTheme}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-75 text-white text-sm font-bold transition-colors cursor-pointer"
          >
            {isSavingTheme ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>Menyimpan Tema...</span>
              </>
            ) : (
              <>
                <Palette className="w-4 h-4" aria-hidden="true" />
                <span>Terapkan &amp; Simpan Tema</span>
              </>
            )}
          </button>
        </div>
      </section>
      )}

      {/* Sub-Menu 4: Emergency Reset Zone */}
      {activeSubMenu === 'RESET' && (
      <div role="tabpanel" aria-label="Reset Pemilihan" className="space-y-4">
      <div className="bg-rose-50/70 border border-rose-200 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h2 className="text-base font-extrabold text-rose-950">
              Reset Data Perolehan Suara (Darurat)
            </h2>
            <p className="text-xs text-rose-800 mt-1 leading-relaxed max-w-xl">
              Gunakan fitur ini sebelum hari pemilihan dimulai untuk mengosongkan seluruh perolehan
              suara kandidat menjadi 0 dan mereset status memilih seluruh DPT menjadi &ldquo;Belum
              Memilih&rdquo;.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setResetKeyword('');
            setShowResetModal(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-4 h-4" aria-hidden="true" />
          <span>Reset Suara</span>
        </button>
      </div>
      </div>
      )}

      {/* Confirm RESET Modal */}
      {showResetModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-rose-50">
              <h3 id="reset-modal-title" className="text-base font-extrabold text-rose-900">
                Konfirmasi Reset Data Pemilihan
              </h3>
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                aria-label="Tutup modal reset"
                className="p-1.5 rounded-lg text-rose-700 hover:bg-rose-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmReset} className="p-6 space-y-4">
              <p className="text-sm text-slate-700 leading-relaxed">
                Tindakan ini akan mengosongkan seluruh suara masuk Paslon dan mereset status semua
                pemilih di DPT menjadi belum memilih. Data DPT dan kandidat tidak dihapus.
              </p>

              <div>
                <label htmlFor="reset-confirm-input" className="block text-xs font-bold text-slate-700 mb-1.5">
                  Ketik <span className="font-mono text-rose-700">RESET</span> untuk melanjutkan:
                </label>
                <input
                  id="reset-confirm-input"
                  type="text"
                  autoComplete="off"
                  value={resetKeyword}
                  onChange={(e) => setResetKeyword(e.target.value)}
                  placeholder="Ketik RESET"
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-300 font-mono text-sm uppercase focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isResetting}
                  onClick={() => setShowResetModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isResetting}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-75 text-white text-xs font-bold cursor-pointer"
                >
                  {isResetting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      <span>Mereset...</span>
                    </>
                  ) : (
                    <span>Konfirmasi Reset Total</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
