import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Lock,
  Maximize2,
  Minimize2,
  Users,
  Volume2,
  VolumeX,
  Vote,
} from 'lucide-react';
import { useFirebaseAuth } from '../context/FirebaseContext';
import type { DatabaseState } from '../types/evoting';
import { computeStatistics } from '../utils/electionLogic';
import {
  loadMonitorSoundEnabled,
  playIncomingVoteCoinSound,
  saveMonitorSoundEnabled,
  unlockMonitorAudio,
} from '../utils/soundEffects';
import { useFullscreen } from '../utils/useFullscreen';
import { CandidateImage } from './CandidateImage';

interface LiveMonitorProps {
  db: DatabaseState;
  onToggleSecretMode: () => void;
  onBack: () => void;
}

const CHART_COLORS = ['#059669', '#D97706', '#1E3A5F', '#0284C7', '#7C3AED', '#DC2626'];

export function LiveMonitor({ db, onToggleSecretMode, onBack }: LiveMonitorProps) {
  const { isFullscreen, toggleFullscreen } = useFullscreen();
  const { cloudSummary } = useFirebaseAuth();
  const [hoveredCandidateId, setHoveredCandidateId] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => loadMonitorSoundEnabled());
  const [nowText, setNowText] = useState(() =>
    new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );

  const stats = computeStatistics(db.voters, db.candidates, cloudSummary);
  const isSecret = db.settings.hideLiveResults;
  const maxVotes = Math.max(1, ...stats.candidateStats.map((c) => c.votes));
  const prevTotalVotedRef = useRef<number | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowText(
        new Date().toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleUnlock = () => unlockMonitorAudio();
    window.addEventListener('pointerdown', handleUnlock, { passive: true });
    window.addEventListener('keydown', handleUnlock, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', handleUnlock);
      window.removeEventListener('keydown', handleUnlock);
    };
  }, []);

  useEffect(() => {
    if (prevTotalVotedRef.current === null) {
      prevTotalVotedRef.current = stats.totalVoted;
      return;
    }
    if (stats.totalVoted > prevTotalVotedRef.current && soundEnabled) {
      const incomingCount = Math.min(3, stats.totalVoted - prevTotalVotedRef.current);
      for (let i = 0; i < incomingCount; i++) {
        playIncomingVoteCoinSound(i * 150);
      }
    }
    prevTotalVotedRef.current = stats.totalVoted;
  }, [stats.totalVoted, soundEnabled]);

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    saveMonitorSoundEnabled(next);
    if (next) {
      unlockMonitorAudio();
      playIncomingVoteCoinSound();
    }
  };

  // Compute SVG Donut segments
  const radius = 84;
  const circumference = 2 * Math.PI * radius;
  let cumulativeOffset = 0;

  const donutSegments = stats.candidateStats.map((c, idx) => {
    const fraction = stats.totalValidVotes > 0 ? c.votes / stats.totalValidVotes : 0;
    const dashLength = fraction * circumference;
    const offset = cumulativeOffset;
    cumulativeOffset += dashLength;
    return {
      candidate: c,
      color: c.accentColor || CHART_COLORS[idx % CHART_COLORS.length],
      dashArray: `${dashLength} ${circumference - dashLength}`,
      dashOffset: -offset,
    };
  });

  return (
    <div className="h-screen overflow-hidden bg-[var(--app-bg)] text-slate-900 flex flex-col">
      {/* Top Bar (Stationary Menu Bar) */}
      <header className="bg-[var(--app-primary)] text-white border-b border-white/10 shrink-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>Kembali</span>
            </button>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-extrabold truncate">
                Live Monitor Quick Count
              </h1>
              <p className="text-xs text-slate-300 truncate hidden sm:block">
                {db.settings.schoolName} · Tahun Ajaran {db.settings.academicYear}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Real-time LIVE indicator */}
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-xs font-mono font-bold"
              title="Sinkronisasi realtime lintas perangkat aktif"
            >
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-live-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
              </span>
              <span>LIVE</span>
              <span className="hidden md:inline text-emerald-200/80 tabular-nums">{nowText}</span>
            </div>

            <button
              type="button"
              onClick={handleToggleSound}
              data-testid="sound-toggle-btn"
              aria-pressed={soundEnabled}
              aria-label={soundEnabled ? 'Bisukan efek suara masuk' : 'Aktifkan efek suara masuk'}
              title={
                soundEnabled
                  ? 'Efek suara koin aktif setiap ada suara masuk'
                  : 'Efek suara dibisukan (klik untuk aktifkan)'
              }
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                soundEnabled
                  ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-400/30'
                  : 'bg-white/10 hover:bg-white/20 text-slate-300'
              }`}
            >
              {soundEnabled ? (
                <>
                  <Volume2 className="w-4 h-4" aria-hidden="true" />
                  <span className="hidden md:inline">Suara Aktif</span>
                </>
              ) : (
                <>
                  <VolumeX className="w-4 h-4" aria-hidden="true" />
                  <span className="hidden md:inline">Bisukan</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onToggleSecretMode}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isSecret
                  ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                  : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
            >
              {isSecret ? (
                <>
                  <Eye className="w-4 h-4" aria-hidden="true" />
                  <span>Tampilkan Hasil</span>
                </>
              ) : (
                <>
                  <EyeOff className="w-4 h-4" aria-hidden="true" />
                  <span>Sembunyikan Hasil</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              data-testid="projector-toggle-btn"
              aria-pressed={isFullscreen}
              aria-label={isFullscreen ? 'Keluar layar penuh' : 'Mode layar penuh proyektor'}
              className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isFullscreen
                  ? 'bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold'
                  : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-4 h-4" aria-hidden="true" />
                  <span>Normal</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-4 h-4" aria-hidden="true" />
                  <span>Proyektor</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <div data-page-scroller="true" className="flex-1 min-h-0 overflow-y-auto">
        <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Top Participation KPIs */}
        <section aria-label="Ringkasan Partisipasi Pemilih" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <p className="text-xs font-semibold text-slate-500">Total Daftar Pemilih Tetap</p>
            <p className="mt-2 text-3xl font-extrabold font-mono tabular-nums text-slate-900">
              {stats.totalDpt}
            </p>
            <p className="text-xs text-slate-500 mt-1">Pemilih terdaftar aktif</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <p className="text-xs font-semibold text-slate-500">Total Suara Masuk</p>
            <p className="mt-2 text-3xl font-extrabold font-mono tabular-nums text-emerald-600">
              {stats.totalVoted}
            </p>
            <p className="text-xs text-slate-500 mt-1">Pemilih telah mencoblos</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <p className="text-xs font-semibold text-slate-500">Belum Menggunakan Hak Suara</p>
            <p className="mt-2 text-3xl font-extrabold font-mono tabular-nums text-amber-600">
              {stats.totalNotVoted}
            </p>
            <p className="text-xs text-slate-500 mt-1">Menunggu kehadiran di bilik</p>
          </div>

          <div className="bg-[var(--app-primary)] text-white rounded-2xl p-5">
            <p className="text-xs font-semibold text-slate-300">Tingkat Partisipasi Keseluruhan</p>
            <p
              className="mt-2 text-3xl font-extrabold font-mono tabular-nums"
              style={{ color: 'var(--app-accent)' }}
            >
              {stats.participationRate}%
            </p>
            <div className="mt-2.5 w-full bg-white/15 rounded-full h-2 overflow-hidden">
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, stats.participationRate)}%`,
                  backgroundColor: 'var(--app-accent)',
                }}
              />
            </div>
          </div>
        </section>

        {/* Secret Mode Banner OR Charts */}
        {isSecret ? (
          <section
            aria-label="Mode Rahasia Aktif"
            className="bg-white border border-amber-300 rounded-2xl p-10 sm:p-14 text-center shadow-sm"
          >
            <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto mb-5">
              <Lock className="w-8 h-8 text-amber-600" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-extrabold text-slate-900">
              Mode Rahasia Aktif — Perolehan Suara Disembunyikan
            </h2>
            <p className="text-sm sm:text-base text-slate-600 mt-2 max-w-xl mx-auto leading-relaxed">
              Panitia saat ini menahan publikasi grafik dan angka perolehan suara masing-masing
              pasangan calon hingga waktu pemilihan selesai. Statistik partisipasi pemilih tetap
              diperbarui secara realtime.
            </p>
            <button
              type="button"
              onClick={onToggleSecretMode}
              className="mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#0F1E3D] hover:bg-[#1E3A5F] text-white font-bold text-sm transition-colors cursor-pointer"
            >
              <Eye className="w-4 h-4" aria-hidden="true" />
              <span>Tampilkan Hasil Sekarang</span>
            </button>
          </section>
        ) : (
          <section aria-label="Grafik Perolehan Suara" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Bar Chart + Candidate Summary */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100">
                  <div>
                    <h2 className="text-lg font-extrabold text-slate-900">
                      Grafik Batang Perolehan Suara
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Perbandingan jumlah suara sah setiap pasangan calon
                    </p>
                  </div>
                  <span className="text-xs font-mono font-semibold text-slate-700 tabular-nums">
                    Total Sah: {stats.totalValidVotes} Suara
                  </span>
                </div>

                <div className="mt-6 space-y-6">
                  {stats.candidateStats.map((c, idx) => {
                    const color = c.accentColor || CHART_COLORS[idx % CHART_COLORS.length];
                    const widthPct = stats.totalValidVotes > 0 ? Math.max(4, (c.votes / maxVotes) * 100) : 0;
                    return (
                      <div
                        key={c.id}
                        onMouseEnter={() => setHoveredCandidateId(c.id)}
                        onMouseLeave={() => setHoveredCandidateId(null)}
                        className={`p-3 rounded-xl transition-colors ${
                          hoveredCandidateId === c.id ? 'bg-slate-50' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-11 h-11 rounded-xl overflow-hidden bg-slate-100 shrink-0 border border-slate-200">
                              <CandidateImage
                                src={c.photoUrl}
                                alt={`Paslon ${c.nomorUrut}`}
                                nomorUrut={c.nomorUrut}
                                className="w-full h-full"
                              />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-mono font-bold text-slate-500">
                                PASLON 0{c.nomorUrut}
                              </p>
                              <p className="text-sm sm:text-base font-bold text-slate-900 truncate">
                                {c.ketuaName} &amp; {c.wakilName}
                              </p>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <p className="text-lg font-extrabold font-mono tabular-nums text-slate-900">
                              {c.percentage}%
                            </p>
                            <p className="text-xs font-mono tabular-nums text-slate-500">
                              {c.votes} suara
                            </p>
                          </div>
                        </div>

                        <div
                          className="w-full h-4 bg-slate-100 rounded-full overflow-hidden"
                          role="progressbar"
                          aria-valuenow={c.percentage}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`Perolehan suara Paslon ${c.nomorUrut}`}
                        >
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${widthPct}%`,
                              backgroundColor: color,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Donut Chart */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 flex flex-col justify-between">
              <div className="pb-4 border-b border-slate-100">
                <h2 className="text-lg font-extrabold text-slate-900">
                  Grafik Donat Proporsi Suara
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Distribusi persentase suara masuk sah
                </p>
              </div>

              <div className="my-6 flex flex-col items-center justify-center">
                <div className="relative w-56 h-56 flex items-center justify-center">
                  <svg
                    viewBox="0 0 220 220"
                    className="w-full h-full -rotate-90"
                    role="img"
                    aria-label="Grafik Donat Perolehan Suara Paslon"
                  >
                    <circle
                      cx="110"
                      cy="110"
                      r={radius}
                      fill="none"
                      stroke="#E2E8F0"
                      strokeWidth="28"
                    />
                    {stats.totalValidVotes > 0 &&
                      donutSegments.map((seg) => (
                        <circle
                          key={seg.candidate.id}
                          cx="110"
                          cy="110"
                          r={radius}
                          fill="none"
                          stroke={seg.color}
                          strokeWidth={hoveredCandidateId === seg.candidate.id ? '34' : '28'}
                          strokeDasharray={seg.dashArray}
                          strokeDashoffset={seg.dashOffset}
                          className="transition-all duration-300 cursor-pointer"
                          onMouseEnter={() => setHoveredCandidateId(seg.candidate.id)}
                          onMouseLeave={() => setHoveredCandidateId(null)}
                        />
                      ))}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                    <Vote className="w-5 h-5 text-[#1E3A5F] mb-1" aria-hidden="true" />
                    <span className="text-3xl font-extrabold font-mono tabular-nums text-slate-900">
                      {stats.totalValidVotes}
                    </span>
                    <span className="text-xs font-medium text-slate-500">Suara Sah</span>
                  </div>
                </div>
              </div>

              {/* Legend */}
              <div className="space-y-2.5 pt-4 border-t border-slate-100">
                {stats.candidateStats.map((c, idx) => {
                  const color = c.accentColor || CHART_COLORS[idx % CHART_COLORS.length];
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between text-sm py-1"
                      onMouseEnter={() => setHoveredCandidateId(c.id)}
                      onMouseLeave={() => setHoveredCandidateId(null)}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-3 h-3 rounded-sm shrink-0"
                          style={{ backgroundColor: color }}
                          aria-hidden="true"
                        />
                        <span className="font-semibold text-slate-800 truncate">
                          0{c.nomorUrut}. {c.ketuaName} &amp; {c.wakilName}
                        </span>
                      </div>
                      <span className="font-mono font-bold tabular-nums text-slate-900 shrink-0 ml-2">
                        {c.votes} ({c.percentage}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Participation Breakdown per Grade Level (X, XI, XII) + Guru & Tendik */}
        <section
          aria-label="Rincian Partisipasi Per Angkatan"
          className="bg-white border border-slate-200 rounded-2xl p-6"
        >
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <Users className="w-5 h-5 text-[#1E3A5F]" aria-hidden="true" />
              <div>
                <h2 className="text-lg font-extrabold text-slate-900">
                  Partisipasi Pemilih Per Angkatan
                </h2>
                <p className="text-xs text-slate-500">
                  Pemantauan kehadiran pemilih jenjang Kelas X, XI, XII, serta Guru &amp; Tendik
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {stats.gradeStats.map((g) => {
              const unit = g.grade === 'DPTB' ? 'pemilih' : 'siswa';
              return (
                <div
                  key={g.grade}
                  data-testid={`grade-card-${g.grade}`}
                  className="p-4 rounded-xl bg-slate-50 border border-slate-200"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-base font-bold text-slate-900">{g.label}</h3>
                    <span className="font-mono text-sm font-extrabold tabular-nums text-[var(--app-secondary)]">
                      {g.percentage}%
                    </span>
                  </div>
                  <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        g.grade === 'DPTB' ? 'bg-emerald-600' : 'bg-[var(--app-secondary)]'
                      }`}
                      style={{ width: `${Math.min(100, g.percentage)}%` }}
                    />
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-xs text-slate-600 font-mono tabular-nums">
                    <span>Sudah: {g.voted} {unit}</span>
                    <span>Total: {g.total} {unit}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        </main>
      </div>
    </div>
  );
}
