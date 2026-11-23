import { useState } from 'react';
import { FileDown, FileText, GraduationCap, Loader2, Users, X } from 'lucide-react';
import type { DatabaseState } from '../../types/evoting';
import { computeStatistics, type SummaryStatsOverride } from '../../utils/electionLogic';
import {
  partitionSortedReportVoters,
  resolveCandidateChartColor,
} from '../../utils/pdfReport';

interface PdfReportPreviewModalProps {
  db: DatabaseState;
  summaryOverride?: SummaryStatsOverride | null;
  exportedBy: string;
  isExportingPdf: boolean;
  onConfirmDownload: () => Promise<void> | void;
  onClose: () => void;
}

export function PdfReportPreviewModal({
  db,
  summaryOverride,
  exportedBy,
  isExportingPdf,
  onConfirmDownload,
  onClose,
}: PdfReportPreviewModalProps) {
  const [activeTableTab, setActiveTableTab] = useState<'ALL' | 'SISWA' | 'GURU_TENDIK'>('ALL');
  const stats = computeStatistics(db.voters, db.candidates, summaryOverride);
  const { studentVoters, additionalVoters } = partitionSortedReportVoters(db.voters);
  const maxVotes = Math.max(1, ...stats.candidateStats.map((c) => c.votes));
  const studentVotedCount = studentVoters.filter((v) => v.hasVoted).length;
  const additionalVotedCount = additionalVoters.filter((v) => v.hasVoted).length;

  const nowStr = new Date().toLocaleString('id-ID', {
    dateStyle: 'full',
    timeStyle: 'short',
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-preview-modal-title"
      data-testid="pdf-preview-modal"
    >
      <div className="bg-slate-100 border border-slate-300 rounded-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Sticky Top Toolbar */}
        <div className="bg-white border-b border-slate-200 px-5 py-4 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="pdf-preview-modal-title"
                className="text-base sm:text-lg font-extrabold text-slate-900 truncate"
              >
                Pratinjau Laporan Hasil Pemilihan (PDF)
              </h2>
              <p className="text-xs text-slate-600 truncate">
                Periksa hasil suara, warna grafik paslon, serta pemisahan tabel Siswa &amp; Guru/Tendik sebelum mengunduh.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onConfirmDownload}
              disabled={isExportingPdf}
              data-testid="confirm-download-pdf-btn"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-75 text-white text-xs sm:text-sm font-bold whitespace-nowrap cursor-pointer transition-colors"
            >
              {isExportingPdf ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span>Menyusun PDF...</span>
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4" style={{ color: 'var(--app-accent)' }} aria-hidden="true" />
                  <span>Download PDF Sekarang</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup pratinjau PDF"
              data-testid="close-pdf-preview-btn"
              className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Scrollable A4 Document Canvas */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden max-w-4xl mx-auto">
            {/* Kop Surat */}
            <div className="bg-[#0F1E3D] text-white px-6 py-5 border-b-4 border-amber-500 flex items-center gap-4">
              {db.settings.logoUrl && (
                <div className="w-16 h-16 rounded-xl bg-white p-1.5 flex items-center justify-center shrink-0">
                  <img
                    src={db.settings.logoUrl}
                    alt={`Logo ${db.settings.schoolName}`}
                    className="w-full h-full object-contain"
                  />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-[11px] font-bold tracking-wider text-amber-400">
                  BERITA ACARA &amp; REKAPITULASI HASIL E-VOTING OSIS
                </p>
                <h3 className="text-xl font-extrabold tracking-tight text-white truncate mt-0.5">
                  {db.settings.schoolName}
                </h3>
                <p className="text-xs text-slate-200 mt-0.5 truncate">
                  {db.settings.electionTitle} · Tahun Ajaran {db.settings.academicYear}
                </p>
              </div>
            </div>

            <div className="p-6 space-y-7">
              {/* Print Metadata */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200 text-xs text-slate-600">
                <span>Dicetak pada: {nowStr}</span>
                <span>Dicetak oleh: {exportedBy}</span>
              </div>

              {/* Section 1: Ringkasan Partisipasi */}
              <section>
                <h4 className="text-sm font-extrabold text-[#0F1E3D] mb-3">
                  1. Ringkasan Partisipasi Pemilih (DPT)
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5">
                    <p className="text-[11px] text-slate-500 font-medium">Total DPT</p>
                    <p className="text-lg font-extrabold font-mono tabular-nums text-[#0F1E3D] mt-1">
                      {stats.totalDpt} Pemilih
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5">
                    <p className="text-[11px] text-slate-500 font-medium">Suara Masuk</p>
                    <p className="text-lg font-extrabold font-mono tabular-nums text-emerald-700 mt-1">
                      {stats.totalVoted} Suara
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5">
                    <p className="text-[11px] text-slate-500 font-medium">Belum Memilih</p>
                    <p className="text-lg font-extrabold font-mono tabular-nums text-amber-700 mt-1">
                      {stats.totalNotVoted} Pemilih
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5">
                    <p className="text-[11px] text-slate-500 font-medium">Partisipasi</p>
                    <p className="text-lg font-extrabold font-mono tabular-nums text-[#0F1E3D] mt-1">
                      {stats.participationRate}%
                    </p>
                  </div>
                </div>
              </section>

              {/* Section 2: Grafik & Perolehan Suara Calon */}
              <section>
                <h4 className="text-sm font-extrabold text-[#0F1E3D] mb-3">
                  2. Perolehan Suara &amp; Grafik Pasangan Calon
                </h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs sm:text-sm">
                    <thead className="bg-[#0F1E3D] text-white text-xs">
                      <tr>
                        <th className="px-3.5 py-2.5 w-14">No.</th>
                        <th className="px-3.5 py-2.5">Pasangan Calon &amp; Grafik Suara</th>
                        <th className="px-3.5 py-2.5 text-right w-24">Suara Sah</th>
                        <th className="px-3.5 py-2.5 text-right w-24">Persentase</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {stats.candidateStats.map((c, idx) => {
                        const color = resolveCandidateChartColor(c, idx);
                        const barWidth =
                          stats.totalValidVotes > 0 ? Math.max(4, (c.votes / maxVotes) * 100) : 0;
                        const isLeader =
                          stats.totalValidVotes > 0 &&
                          c.votes === Math.max(...stats.candidateStats.map((x) => x.votes));

                        return (
                          <tr
                            key={c.id}
                            data-testid={`pdf-preview-paslon-${c.nomorUrut}`}
                            className={idx % 2 === 0 ? 'bg-slate-50/70' : 'bg-white'}
                          >
                            <td className="px-3.5 py-3 align-top font-mono font-bold text-[#0F1E3D]">
                              <div className="flex items-center gap-2">
                                <span
                                  className="w-3 h-3 rounded-sm shrink-0"
                                  style={{ backgroundColor: color }}
                                  data-color={color}
                                  aria-hidden="true"
                                />
                                <span>0{c.nomorUrut}</span>
                              </div>
                            </td>
                            <td className="px-3.5 py-3">
                              <p className="font-bold text-slate-900">
                                {c.ketuaName} &amp; {c.wakilName}
                                {isLeader ? ' (Unggul)' : ''}
                              </p>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                {c.ketuaClass} · {c.wakilClass}
                              </p>
                              <div className="mt-2 w-full max-w-sm h-2.5 bg-slate-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  data-testid={`pdf-preview-bar-${c.nomorUrut}`}
                                  style={{
                                    width: `${barWidth}%`,
                                    backgroundColor: color,
                                  }}
                                />
                              </div>
                            </td>
                            <td className="px-3.5 py-3 text-right align-middle font-mono font-bold tabular-nums text-[#0F1E3D]">
                              {c.votes}
                            </td>
                            <td className="px-3.5 py-3 text-right align-middle font-mono font-bold tabular-nums text-[#0F1E3D]">
                              {c.percentage}%
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="bg-slate-100 font-bold text-[#0F1E3D]">
                        <td className="px-3.5 py-2.5" colSpan={2}>
                          Total Suara Sah Masuk
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-mono tabular-nums">
                          {stats.totalValidVotes}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-mono tabular-nums">
                          {stats.totalValidVotes > 0 ? '100%' : '0%'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Section 3: Rincian Partisipasi Per Angkatan & Guru/Tendik */}
              <section>
                <h4 className="text-sm font-extrabold text-[#0F1E3D] mb-3">
                  3. Rincian Partisipasi Pemilih (Siswa &amp; Guru/Tendik)
                </h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs sm:text-sm">
                    <thead className="bg-[#1E3A5F] text-white text-xs">
                      <tr>
                        <th className="px-3.5 py-2.5">Kategori Pemilih</th>
                        <th className="px-3.5 py-2.5 text-right">Sudah Memilih</th>
                        <th className="px-3.5 py-2.5 text-right">Total DPT</th>
                        <th className="px-3.5 py-2.5 text-right">Persentase</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {stats.gradeStats.map((g) => {
                        const unit = g.grade === 'DPTB' ? 'pemilih' : 'siswa';
                        return (
                          <tr key={g.grade} className="bg-white">
                            <td className="px-3.5 py-2.5 font-bold text-slate-900">{g.label}</td>
                            <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-slate-700">
                              {g.voted} {unit}
                            </td>
                            <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-slate-700">
                              {g.total} {unit}
                            </td>
                            <td className="px-3.5 py-2.5 text-right font-mono font-bold tabular-nums text-[#0F1E3D]">
                              {g.percentage}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Filter Switcher for Previewing Separated Tables */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
                <p className="text-xs font-bold text-slate-600">
                  Pemisahan Tabel Daftar Suara Pemilih:
                </p>
                <div className="inline-flex rounded-xl bg-slate-100 p-1 gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveTableTab('ALL')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer ${
                      activeTableTab === 'ALL'
                        ? 'bg-white text-[#0F1E3D] shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Tampilkan Keduanya
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTableTab('SISWA')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer ${
                      activeTableTab === 'SISWA'
                        ? 'bg-white text-[#0F1E3D] shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Siswa ({studentVoters.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTableTab('GURU_TENDIK')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer ${
                      activeTableTab === 'GURU_TENDIK'
                        ? 'bg-white text-[#0F1E3D] shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Guru &amp; Tendik ({additionalVoters.length})
                  </button>
                </div>
              </div>

              {/* Section 4: Tabel Suara Siswa (DPT) */}
              {(activeTableTab === 'ALL' || activeTableTab === 'SISWA') && (
                <section data-testid="pdf-preview-table-siswa">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                    <h4 className="inline-flex items-center gap-2 text-sm font-extrabold text-[#0F1E3D]">
                      <GraduationCap className="w-4 h-4" aria-hidden="true" />
                      <span>4. Tabel Daftar Suara Pemilih Siswa (DPT)</span>
                    </h4>
                    <span className="text-xs font-mono text-slate-600 tabular-nums">
                      Total: {studentVoters.length} Siswa · Sudah: {studentVotedCount} · Belum:{' '}
                      {studentVoters.length - studentVotedCount}
                    </span>
                  </div>
                  <div className="border border-slate-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#0F1E3D] text-white sticky top-0">
                        <tr>
                          <th className="px-3 py-2 w-12">No.</th>
                          <th className="px-3 py-2 w-32">NIS / NISN</th>
                          <th className="px-3 py-2">Nama Lengkap</th>
                          <th className="px-3 py-2 w-28">Kelas</th>
                          <th className="px-3 py-2 text-right w-32">Status Memilih</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {studentVoters.map((v, idx) => (
                          <tr key={v.id} className={idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'}>
                            <td className="px-3 py-2 font-mono text-slate-500">{idx + 1}</td>
                            <td className="px-3 py-2 font-mono text-slate-800">{v.nis}</td>
                            <td className="px-3 py-2 font-semibold text-slate-900">{v.name}</td>
                            <td className="px-3 py-2 text-slate-700">{v.kelas}</td>
                            <td className="px-3 py-2 text-right">
                              <span
                                className={`font-semibold ${
                                  v.hasVoted ? 'text-emerald-700' : 'text-slate-500'
                                }`}
                              >
                                {v.hasVoted ? 'Sudah Memilih' : 'Belum Memilih'}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {studentVoters.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-3 py-5 text-center text-slate-500">
                              Belum ada data pemilih siswa.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* Section 5: Tabel Suara Guru & Tendik (DPTb) */}
              {(activeTableTab === 'ALL' || activeTableTab === 'GURU_TENDIK') && (
                <section data-testid="pdf-preview-table-guru-tendik">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                    <h4 className="inline-flex items-center gap-2 text-sm font-extrabold text-emerald-800">
                      <Users className="w-4 h-4" aria-hidden="true" />
                      <span>5. Tabel Daftar Suara Guru &amp; Tendik (DPTb)</span>
                    </h4>
                    <span className="text-xs font-mono text-slate-600 tabular-nums">
                      Total: {additionalVoters.length} Pemilih · Sudah: {additionalVotedCount} ·
                      Belum: {additionalVoters.length - additionalVotedCount}
                    </span>
                  </div>
                  <div className="border border-emerald-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-emerald-700 text-white sticky top-0">
                        <tr>
                          <th className="px-3 py-2 w-12">No.</th>
                          <th className="px-3 py-2 w-32">ID</th>
                          <th className="px-3 py-2">Nama Lengkap</th>
                          <th className="px-3 py-2 w-36">Keterangan</th>
                          <th className="px-3 py-2 text-right w-32">Status Memilih</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {additionalVoters.map((v, idx) => (
                          <tr key={v.id} className={idx % 2 === 1 ? 'bg-emerald-50/40' : 'bg-white'}>
                            <td className="px-3 py-2 font-mono text-slate-500">{idx + 1}</td>
                            <td className="px-3 py-2 font-mono text-slate-800">{v.nis}</td>
                            <td className="px-3 py-2 font-semibold text-slate-900">{v.name}</td>
                            <td className="px-3 py-2 text-slate-700">{v.kelas}</td>
                            <td className="px-3 py-2 text-right">
                              <span
                                className={`font-semibold ${
                                  v.hasVoted ? 'text-emerald-700' : 'text-slate-500'
                                }`}
                              >
                                {v.hasVoted ? 'Sudah Memilih' : 'Belum Memilih'}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {additionalVoters.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-3 py-5 text-center text-slate-500">
                              Belum ada data Guru &amp; Tendik pada DPTb.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* Signature Preview */}
              <div className="pt-4 flex justify-end">
                <div className="w-64 text-xs text-slate-600">
                  <p>Mengetahui,</p>
                  <p className="font-bold text-[#0F1E3D] mt-0.5">
                    Panitia Pemilihan OSIS {db.settings.schoolName}
                  </p>
                  <div className="mt-10 pt-1.5 border-t border-slate-400 text-slate-700">
                    {exportedBy}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Footer Actions */}
        <div className="bg-white border-t border-slate-200 px-5 py-3.5 flex items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-semibold cursor-pointer"
          >
            Tutup
          </button>
          <button
            type="button"
            onClick={onConfirmDownload}
            disabled={isExportingPdf}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-75 text-white text-xs sm:text-sm font-bold whitespace-nowrap cursor-pointer transition-colors"
          >
            {isExportingPdf ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>Mengunduh PDF...</span>
              </>
            ) : (
              <>
                <FileDown className="w-4 h-4" style={{ color: 'var(--app-accent)' }} aria-hidden="true" />
                <span>Unduh PDF</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
