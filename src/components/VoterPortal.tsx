import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  Loader2,
  LogOut,
  ShieldCheck,
  User,
  Vote,
  WifiOff,
  X,
} from 'lucide-react';
import type { Candidate, ElectionSettings, VoteReceipt, Voter } from '../types/evoting';
import {
  prefetchMaleVoice,
  speakMaleVoice,
  unlockSpeechAndAudio,
  VOTER_SAVED_VOICE_TEXT,
} from '../utils/voiceNarrator';
import { CandidateImage } from './CandidateImage';

interface VoterPortalProps {
  voter: Voter;
  candidates: Candidate[];
  settings: ElectionSettings;
  onCastVote: (candidateId: string) => Promise<VoteReceipt | null> | VoteReceipt | null;
  onLogout: () => void;
}

export function VoterPortal({
  voter,
  candidates,
  settings,
  onCastVote,
  onLogout,
}: VoterPortalProps) {
  const [detailCandidate, setDetailCandidate] = useState<Candidate | null>(null);
  const [confirmCandidate, setConfirmCandidate] = useState<Candidate | null>(null);
  const [receipt, setReceipt] = useState<VoteReceipt | null>(null);
  const [countdown, setCountdown] = useState(5);
  const [isSubmittingVote, setIsSubmittingVote] = useState(false);

  const sortedCandidates = [...candidates].sort((a, b) => a.nomorUrut - b.nomorUrut);

  useEffect(() => {
    void prefetchMaleVoice(VOTER_SAVED_VOICE_TEXT);
  }, []);

  useEffect(() => {
    if (!receipt) return;
    if (countdown <= 0) {
      onLogout();
      return;
    }
    const timer = window.setTimeout(() => {
      setCountdown((c) => c - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [receipt, countdown, onLogout]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmittingVote) {
        setDetailCandidate(null);
        setConfirmCandidate(null);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isSubmittingVote]);

  const handleConfirmVote = () => {
    if (!confirmCandidate || isSubmittingVote) return;
    unlockSpeechAndAudio();
    setIsSubmittingVote(true);
    const chosenId = confirmCandidate.id;
    window.setTimeout(async () => {
      try {
        const result = await onCastVote(chosenId);
        if (result) {
          setCountdown(5);
          setReceipt(result);
          void speakMaleVoice(VOTER_SAVED_VOICE_TEXT, { interrupt: true });
        }
      } finally {
        setIsSubmittingVote(false);
        setConfirmCandidate(null);
      }
    }, 350);
  };

  if (receipt) {
    return (
      <div data-page-scroller="true" className="h-screen overflow-y-auto bg-slate-50 flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="max-w-lg w-full bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 className="w-9 h-9 text-emerald-600" aria-hidden="true" />
          </div>

          <h1 className="text-2xl font-extrabold text-slate-900">
            Suara Anda Berhasil Tercatat
          </h1>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            Terima kasih telah berpartisipasi dalam {settings.electionTitle}. Pilihan Anda tersimpan
            secara rahasia dan terenkripsi.
          </p>

          {/* Struk Digital Sederhana (Tanpa membocorkan pilihan) */}
          <div className="mt-6 rounded-xl bg-slate-50 border border-slate-200 p-5 text-left space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <span className="text-xs font-semibold text-slate-500">Bukti Partisipasi Sah</span>
              <span className="font-mono text-xs font-bold text-[#0F1E3D]">
                {receipt.receiptCode}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-500">Nama Pemilih</p>
                <p className="font-semibold text-slate-900 mt-0.5">{receipt.voterName}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">NIS / Kelas</p>
                <p className="font-mono text-xs font-semibold text-slate-900 mt-1">
                  {receipt.voterNis} · {receipt.voterClass}
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs">
              <span className="text-slate-500">Waktu Pencoblosan</span>
              <span className="font-mono font-medium text-slate-800 tabular-nums">
                {new Date(receipt.timestamp).toLocaleString('id-ID', {
                  dateStyle: 'medium',
                  timeStyle: 'medium',
                })}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-emerald-700 pt-1">
              <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Pilihan kandidat dirahasiakan sistem untuk menjamin asas Luber & Jurdil.</span>
            </div>

            {receipt.offlinePending && (
              <div
                role="status"
                className="mt-2 flex items-start gap-2.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-900 text-left"
              >
                <WifiOff className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  <strong className="font-semibold">Tersimpan Secara Offline:</strong> Koneksi internet
                  sedang terputus. Pilihan Anda tersimpan aman di perangkat ini dan akan otomatis
                  dikirim ke server saat internet tersambung kembali.
                </span>
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <p className="text-sm font-medium text-slate-700 tabular-nums">
              Otomatis keluar ke halaman utama dalam{' '}
              <span className="font-mono font-bold text-[#0F1E3D]">{countdown}</span> detik...
            </p>
            <button
              type="button"
              onClick={onLogout}
              className="w-full min-h-[48px] py-3 px-6 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] text-white font-bold text-sm transition-colors cursor-pointer"
            >
              Selesai & Keluar Sekarang
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-[var(--app-bg)] flex flex-col">
      {/* Top Bar (Stationary Menu Bar) */}
      <header className="bg-white border-b border-slate-200 shrink-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Vote className="w-6 h-6 text-[var(--app-primary)] shrink-0" aria-hidden="true" />
            <span className="text-base sm:text-lg font-extrabold text-[var(--app-primary)] truncate">
              Bilik Suara Elektronik
            </span>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="hidden sm:flex items-center gap-2 text-sm text-slate-700">
              <User className="w-4 h-4 text-slate-400" aria-hidden="true" />
              <span className="font-semibold text-slate-900">{voter.name}</span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="text-slate-600">{voter.kelas}</span>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              <span>Keluar</span>
            </button>
          </div>
        </div>
      </header>

      <div data-page-scroller="true" className="flex-1 min-h-0 overflow-y-auto">
        <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Voter Profile Strip */}
        <section
          aria-label="Profil Pemilih"
          className="bg-[var(--app-primary)] text-white rounded-2xl p-5 sm:p-6 mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--app-accent)' }}>
              Kartu Identitas Pemilih Terverifikasi
            </p>
            <h1 className="text-xl sm:text-2xl font-extrabold mt-1">{voter.name}</h1>
            <p className="text-sm text-slate-200 mt-1 font-mono">
              NIS/NISN {voter.nis} · Kelas {voter.kelas}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs text-slate-300">{settings.schoolName}</p>
            <p className="text-sm font-semibold text-white mt-0.5">{settings.electionTitle}</p>
          </div>
        </section>

        {/* Instruction Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <h2 className="text-2xl font-extrabold text-slate-900">
              Daftar Pasangan Calon Ketua & Wakil Ketua OSIS
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Tinjau visi dan misi setiap pasangan calon sebelum menjatuhkan pilihan.
            </p>
          </div>
          <p className="text-xs font-medium text-slate-500">
            Total Kandidat: <span className="font-mono font-semibold text-slate-900">{sortedCandidates.length} Paslon</span>
          </p>
        </div>

        {sortedCandidates.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
            <p className="text-base font-semibold text-slate-700">
              Belum ada pasangan calon yang terdaftar oleh panitia.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sortedCandidates.map((candidate) => (
              <article
                key={candidate.id}
                className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col justify-between shadow-sm hover:border-[#1E3A5F]/40 transition-colors"
              >
                <div>
                  {/* Card Photo Header */}
                  <div className="relative aspect-[4/3] bg-slate-100 overflow-hidden">
                    <CandidateImage
                      src={candidate.photoUrl}
                      alt={`Foto Paslon ${candidate.nomorUrut}: ${candidate.ketuaName} dan ${candidate.wakilName}`}
                      nomorUrut={candidate.nomorUrut}
                      className="w-full h-full"
                    />
                    <div className="absolute top-3 left-3 bg-[var(--app-primary)] text-white px-3.5 py-1.5 rounded-lg font-mono text-sm font-bold shadow">
                      Paslon 0{candidate.nomorUrut}
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="p-6">
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-slate-500">Calon Ketua OSIS</p>
                        <h3 className="text-lg font-extrabold text-slate-900 leading-snug">
                          {candidate.ketuaName}
                        </h3>
                        <p className="text-xs text-slate-600">{candidate.ketuaClass}</p>
                      </div>

                      <div className="pt-2 border-t border-slate-100">
                        <p className="text-xs font-semibold text-slate-500">Calon Wakil Ketua OSIS</p>
                        <p className="text-base font-bold text-slate-800 leading-snug">
                          {candidate.wakilName}
                        </p>
                        <p className="text-xs text-slate-600">{candidate.wakilClass}</p>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <p className="text-xs font-semibold text-slate-500 mb-1">Visi Singkat</p>
                      <p className="text-sm text-slate-700 leading-relaxed line-clamp-3">
                        &ldquo;{candidate.vision}&rdquo;
                      </p>
                    </div>
                  </div>
                </div>

                {/* Large Touch-Friendly Action Buttons */}
                <div className="px-6 pb-6 pt-2 flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => setDetailCandidate(candidate)}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Eye className="w-4 h-4 text-[var(--app-secondary)]" aria-hidden="true" />
                    <span>Lihat Visi &amp; Misi</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setConfirmCandidate(candidate)}
                    className="w-full min-h-[52px] py-3.5 px-5 rounded-xl bg-[var(--app-primary)] hover:bg-amber-500 hover:text-slate-950 text-white font-bold text-base flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Vote className="w-5 h-5" aria-hidden="true" />
                    <span>Pilih Paslon Ini</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        </main>
      </div>

      {/* Modal: Visi & Misi */}
      {detailCandidate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-visi-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 bg-slate-50">
              <div>
                <p className="text-xs font-mono font-bold text-amber-600">
                  PASANGAN CALON 0{detailCandidate.nomorUrut}
                </p>
                <h2 id="modal-visi-title" className="text-lg font-extrabold text-slate-900">
                  {detailCandidate.ketuaName} &amp; {detailCandidate.wakilName}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDetailCandidate(null)}
                aria-label="Tutup modal visi misi"
                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              <div>
                <h3 className="text-sm font-bold text-[#0F1E3D] mb-2">Visi</h3>
                <p className="text-sm sm:text-base text-slate-800 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-200">
                  {detailCandidate.vision}
                </p>
              </div>

              <div>
                <h3 className="text-sm font-bold text-[#0F1E3D] mb-2">Misi</h3>
                <ol className="space-y-2.5 list-decimal list-inside text-sm text-slate-700 leading-relaxed">
                  {detailCandidate.missions.map((m, idx) => (
                    <li key={idx} className="pl-1">
                      {m}
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3 bg-slate-50">
              <button
                type="button"
                onClick={() => setDetailCandidate(null)}
                className="px-5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-sm cursor-pointer"
              >
                Tutup
              </button>
              <button
                type="button"
                onClick={() => {
                  const chosen = detailCandidate;
                  setDetailCandidate(null);
                  setConfirmCandidate(chosen);
                }}
                className="px-5 py-2.5 rounded-xl bg-[#0F1E3D] hover:bg-amber-500 hover:text-slate-950 text-white font-bold text-sm cursor-pointer transition-colors"
              >
                Pilih Paslon 0{detailCandidate.nomorUrut}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Konfirmasi Ganda */}
      {confirmCandidate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-confirm-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mb-4">
              <AlertCircle className="w-6 h-6 text-amber-600" aria-hidden="true" />
            </div>

            <h2 id="modal-confirm-title" className="text-xl font-extrabold text-slate-900">
              Konfirmasi Pilihan Anda
            </h2>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              Apakah Anda yakin dengan pilihan Anda? Pilihan tidak dapat diubah setelah suara dikirim.
            </p>

            <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-xs font-mono font-bold text-[#1E3A5F]">
                PASANGAN CALON 0{confirmCandidate.nomorUrut}
              </p>
              <p className="text-base font-extrabold text-slate-900 mt-1">
                {confirmCandidate.ketuaName} &amp; {confirmCandidate.wakilName}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {confirmCandidate.ketuaClass} · {confirmCandidate.wakilClass}
              </p>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isSubmittingVote}
                onClick={() => setConfirmCandidate(null)}
                className="min-h-[48px] py-3 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-60 text-slate-800 font-semibold text-sm transition-colors cursor-pointer"
              >
                Batal, Periksa Ulang
              </button>
              <button
                type="button"
                disabled={isSubmittingVote}
                onClick={handleConfirmVote}
                className="min-h-[48px] py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-75 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {isSubmittingVote ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>Menyimpan...</span>
                  </>
                ) : (
                  <span>Ya, Kirim Suara</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
