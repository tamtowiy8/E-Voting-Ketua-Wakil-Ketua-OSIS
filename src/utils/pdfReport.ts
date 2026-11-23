import { jsPDF } from 'jspdf';
import type { Candidate, DatabaseState, Voter } from '../types/evoting';
import {
  compareAdditionalVoters,
  compareStudentVotersByClass,
  computeStatistics,
  isAdditionalVoter,
} from './electionLogic';

export interface PdfLogoImage {
  dataUrl: string;
  format: 'PNG' | 'JPEG';
  width: number;
  height: number;
}

const DEFAULT_SCHOOL_LOGO = '/assets/aistudio/LOGO_SMANSA_3D_d5e941c9.png';

export const CANDIDATE_CHART_FALLBACK_PALETTE = [
  '#059669',
  '#D97706',
  '#1E3A5F',
  '#0284C7',
  '#7C3AED',
  '#DC2626',
];

export function resolveCandidateChartColor(
  candidate: Pick<Candidate, 'nomorUrut' | 'accentColor'>,
  index = 0
): string {
  const raw = (candidate.accentColor || '').trim();
  if (candidate.nomorUrut === 1 && (!raw || raw.toUpperCase() === '#1E3A5F')) {
    return '#059669';
  }
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
    return raw;
  }
  return CANDIDATE_CHART_FALLBACK_PALETTE[index % CANDIDATE_CHART_FALLBACK_PALETTE.length];
}

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return [5, 150, 105];
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return [5, 150, 105];
  return [r, g, b];
}

export function partitionSortedReportVoters(voters: Voter[]): {
  studentVoters: Voter[];
  additionalVoters: Voter[];
} {
  const studentVoters = voters
    .filter((v) => !isAdditionalVoter(v))
    .sort(compareStudentVotersByClass);
  const additionalVoters = voters
    .filter((v) => isAdditionalVoter(v))
    .sort(compareAdditionalVoters);
  return { studentVoters, additionalVoters };
}

function tryLoadImageToPng(src: string, timeoutMs: number): Promise<PdfLogoImage | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val: PdfLogoImage | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(val);
    };

    const timer = window.setTimeout(() => finish(null), timeoutMs);

    const img = new Image();
    if (!src.startsWith('data:') && !src.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }

    img.onload = () => {
      try {
        const naturalWidth = img.naturalWidth || img.width || 128;
        const naturalHeight = img.naturalHeight || img.height || 128;
        const maxPx = 256;
        const scale = Math.min(1, maxPx / Math.max(naturalWidth, naturalHeight));
        const canvasWidth = Math.max(1, Math.round(naturalWidth * scale));
        const canvasHeight = Math.max(1, Math.round(naturalHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
        const pngDataUrl = canvas.toDataURL('image/png');
        finish({
          dataUrl: pngDataUrl,
          format: 'PNG',
          width: canvasWidth,
          height: canvasHeight,
        });
      } catch {
        finish(null);
      }
    };

    img.onerror = () => finish(null);
    img.src = src;
  });
}

export async function loadPdfLogoImage(
  logoUrl: string | undefined,
  timeoutMs = 3000
): Promise<PdfLogoImage | null> {
  if (typeof window === 'undefined' || typeof Image === 'undefined') {
    return null;
  }

  const trimmed = (logoUrl || '').trim();
  if (trimmed) {
    const loaded = await tryLoadImageToPng(trimmed, timeoutMs);
    if (loaded) return loaded;
  }

  if (trimmed !== DEFAULT_SCHOOL_LOGO) {
    return tryLoadImageToPng(DEFAULT_SCHOOL_LOGO, timeoutMs);
  }

  return null;
}

export function buildElectionPdfDocument(
  db: DatabaseState,
  exportedBy: string,
  logoImage: PdfLogoImage | null = null
): jsPDF {
  const stats = computeStatistics(db.voters, db.candidates);
  const { studentVoters, additionalVoters } = partitionSortedReportVoters(db.voters);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  const bottomLimit = pageHeight - 24;

  // Header Kop Surat Banner
  doc.setFillColor(15, 30, 61);
  doc.rect(0, 0, pageWidth, 40, 'F');
  doc.setFillColor(217, 119, 6);
  doc.rect(0, 39.2, pageWidth, 1.2, 'F');

  let textX = margin;
  if (logoImage?.dataUrl) {
    const boxSize = 24;
    const boxX = margin;
    const boxY = 7.5;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(boxX, boxY, boxSize, boxSize, 2.5, 2.5, 'F');

    const innerMax = 20;
    const aspect =
      logoImage.width > 0 && logoImage.height > 0 ? logoImage.width / logoImage.height : 1;
    const drawW = aspect >= 1 ? innerMax : innerMax * aspect;
    const drawH = aspect >= 1 ? innerMax / aspect : innerMax;
    const drawX = boxX + (boxSize - drawW) / 2;
    const drawY = boxY + (boxSize - drawH) / 2;

    doc.addImage(logoImage.dataUrl, logoImage.format, drawX, drawY, drawW, drawH, undefined, 'FAST');
    textX = margin + boxSize + 5;
  }

  const maxHeaderTextWidth = pageWidth - margin - textX;

  doc.setTextColor(251, 191, 36);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('BERITA ACARA & REKAPITULASI HASIL E-VOTING OSIS', textX, 13.5, {
    maxWidth: maxHeaderTextWidth,
  });

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15.5);
  const schoolLine = doc.splitTextToSize(db.settings.schoolName, maxHeaderTextWidth)[0] || '';
  doc.text(schoolLine, textX, 22.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(226, 232, 240);
  const subLine =
    doc.splitTextToSize(
      `${db.settings.electionTitle} · Tahun Ajaran ${db.settings.academicYear}`,
      maxHeaderTextWidth
    )[0] || '';
  doc.text(subLine, textX, 30.5);

  // Meta Info Row
  let y = 50;
  doc.setTextColor(51, 65, 85);
  doc.setFontSize(9);
  const nowStr = new Date().toLocaleString('id-ID', {
    dateStyle: 'full',
    timeStyle: 'short',
  });
  doc.text(`Dicetak pada: ${nowStr}`, margin, y);
  doc.text(`Dicetak oleh: ${exportedBy}`, pageWidth - margin, y, { align: 'right' });

  y += 8;
  doc.setDrawColor(203, 213, 225);
  doc.line(margin, y, pageWidth - margin, y);

  // Section 1: Ringkasan Partisipasi
  y += 9;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 30, 61);
  doc.text('1. Ringkasan Partisipasi Pemilih (DPT)', margin, y);

  y += 5;
  const boxW = (contentWidth - 9) / 4;
  const summaryBoxes = [
    { label: 'Total DPT', value: `${stats.totalDpt} Pemilih` },
    { label: 'Suara Masuk', value: `${stats.totalVoted} Suara` },
    { label: 'Belum Memilih', value: `${stats.totalNotVoted} Pemilih` },
    { label: 'Partisipasi', value: `${stats.participationRate}%` },
  ];

  summaryBoxes.forEach((box, idx) => {
    const x = margin + idx * (boxW + 3);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, boxW, 18, 2, 2, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(box.label, x + 3, y + 6.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 30, 61);
    doc.text(box.value, x + 3, y + 13.5);
  });

  // Section 2: Perolehan Suara Pasangan Calon (with chart bars & distinct Paslon 01 Green)
  y += 27;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 30, 61);
  doc.text('2. Perolehan Suara & Grafik Pasangan Calon', margin, y);

  y += 5;
  doc.setFillColor(15, 30, 61);
  doc.rect(margin, y, contentWidth, 9, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.text('No.', margin + 3, y + 6);
  doc.text('Pasangan Calon (Ketua & Wakil)', margin + 18, y + 6);
  doc.text('Suara Sah', margin + 132, y + 6, { align: 'right' });
  doc.text('Persentase', pageWidth - margin - 4, y + 6, { align: 'right' });

  y += 9;
  const maxVotes = Math.max(0, ...stats.candidateStats.map((c) => c.votes));
  const barTrackWidth = 92;

  stats.candidateStats.forEach((c, idx) => {
    const rowHeight = 18;
    if (y + rowHeight > bottomLimit) {
      doc.addPage();
      y = 20;
    }

    if (idx % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, contentWidth, rowHeight, 'F');
    }
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight);

    const chartColor = resolveCandidateChartColor(c, idx);
    const [r, g, b] = hexToRgb(chartColor);
    const isLeader = maxVotes > 0 && c.votes === maxVotes;

    // Color swatch square next to candidate number
    doc.setFillColor(r, g, b);
    doc.roundedRect(margin + 3, y + 3.5, 3.2, 3.2, 0.7, 0.7, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 30, 61);
    doc.text(`0${c.nomorUrut}`, margin + 8, y + 6.2);

    const pairName = `${c.ketuaName} & ${c.wakilName}${isLeader ? ' (Unggul)' : ''}`;
    doc.text(pairName, margin + 18, y + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`${c.ketuaClass} · ${c.wakilClass}`, margin + 18, y + 10.5);

    // Chart bar visualizing vote share in candidate accentColor
    doc.setFillColor(226, 232, 240);
    doc.roundedRect(margin + 18, y + 12.6, barTrackWidth, 2.4, 1, 1, 'F');
    if (stats.totalValidVotes > 0 && c.votes > 0) {
      const fillW = Math.max(3, (c.votes / Math.max(1, maxVotes)) * barTrackWidth);
      doc.setFillColor(r, g, b);
      doc.roundedRect(margin + 18, y + 12.6, fillW, 2.4, 1, 1, 'F');
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 30, 61);
    doc.text(`${c.votes}`, margin + 132, y + 9, { align: 'right' });
    doc.text(`${c.percentage}%`, pageWidth - margin - 4, y + 9, { align: 'right' });

    y += rowHeight;
  });

  // Total Row
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, y, contentWidth, 9, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 30, 61);
  doc.text('Total Suara Sah Masuk', margin + 18, y + 6);
  doc.text(`${stats.totalValidVotes}`, margin + 132, y + 6, { align: 'right' });
  doc.text(stats.totalValidVotes > 0 ? '100%' : '0%', pageWidth - margin - 4, y + 6, {
    align: 'right',
  });

  // Section 3: Rincian Partisipasi Per Angkatan & Guru/Tendik
  y += 17;
  if (y + 52 > bottomLimit) {
    doc.addPage();
    y = 20;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 30, 61);
  doc.text('3. Rincian Partisipasi Pemilih (Siswa & Guru/Tendik)', margin, y);

  y += 5;
  doc.setFillColor(30, 58, 95);
  doc.rect(margin, y, contentWidth, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.text('Kategori Pemilih', margin + 3, y + 5.5);
  doc.text('Sudah Memilih', margin + 85, y + 5.5, { align: 'right' });
  doc.text('Total DPT', margin + 128, y + 5.5, { align: 'right' });
  doc.text('Persentase', pageWidth - margin - 4, y + 5.5, { align: 'right' });

  y += 8;
  stats.gradeStats.forEach((g) => {
    const unit = g.grade === 'DPTB' ? 'pemilih' : 'siswa';
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y + 8.5, pageWidth - margin, y + 8.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text(g.label, margin + 3, y + 5.8);

    doc.setFont('helvetica', 'normal');
    doc.text(`${g.voted} ${unit}`, margin + 85, y + 5.8, { align: 'right' });
    doc.text(`${g.total} ${unit}`, margin + 128, y + 5.8, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.text(`${g.percentage}%`, pageWidth - margin - 4, y + 5.8, { align: 'right' });
    y += 8.5;
  });

  // Helper to render separated voter tables cleanly across pages
  const renderVoterTableSection = (
    sectionTitle: string,
    summarySubtitle: string,
    idColLabel: string,
    groupColLabel: string,
    rows: Voter[],
    headerRgb: [number, number, number]
  ) => {
    y += 12;
    if (y + 28 > bottomLimit) {
      doc.addPage();
      y = 20;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 30, 61);
    doc.text(sectionTitle, margin, y);

    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(summarySubtitle, margin, y);

    const drawTableHeader = () => {
      doc.setFillColor(headerRgb[0], headerRgb[1], headerRgb[2]);
      doc.rect(margin, y, contentWidth, 7.5, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('No.', margin + 3, y + 5.2);
      doc.text(idColLabel, margin + 14, y + 5.2);
      doc.text('Nama Lengkap', margin + 45, y + 5.2);
      doc.text(groupColLabel, margin + 122, y + 5.2);
      doc.text('Status Memilih', pageWidth - margin - 3, y + 5.2, { align: 'right' });
      y += 7.5;
    };

    y += 3.5;
    drawTableHeader();

    if (rows.length === 0) {
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y + 8, pageWidth - margin, y + 8);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text('Belum ada data pemilih pada kategori ini.', margin + 3, y + 5.3);
      y += 8;
      return;
    }

    const rowH = 6.5;
    rows.forEach((v, idx) => {
      if (y + rowH > bottomLimit) {
        doc.addPage();
        y = 18;
        drawTableHeader();
      }

      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, contentWidth, rowH, 'F');
      }
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y + rowH, pageWidth - margin, y + rowH);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.8);
      doc.setTextColor(71, 85, 105);
      doc.text(String(idx + 1), margin + 3, y + 4.5);

      doc.setTextColor(30, 41, 59);
      doc.text((v.nis || '-').slice(0, 18), margin + 14, y + 4.5);

      doc.setFont('helvetica', 'bold');
      const nameText = doc.splitTextToSize(v.name || '-', 74)[0] || '-';
      doc.text(nameText, margin + 45, y + 4.5);

      doc.setFont('helvetica', 'normal');
      const groupText = doc.splitTextToSize(v.kelas || '-', 32)[0] || '-';
      doc.text(groupText, margin + 122, y + 4.5);

      if (v.hasVoted) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(5, 150, 105);
        doc.text('Sudah Memilih', pageWidth - margin - 3, y + 4.5, { align: 'right' });
      } else {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text('Belum Memilih', pageWidth - margin - 3, y + 4.5, { align: 'right' });
      }

      y += rowH;
    });
  };

  // Section 4: Tabel Suara Siswa (DPT)
  const studentVotedCount = studentVoters.filter((v) => v.hasVoted).length;
  renderVoterTableSection(
    '4. Tabel Daftar Suara Pemilih Siswa (DPT)',
    `Total: ${studentVoters.length} Siswa · Sudah Memilih: ${studentVotedCount} · Belum Memilih: ${studentVoters.length - studentVotedCount}`,
    'NIS / NISN',
    'Kelas',
    studentVoters,
    [15, 30, 61]
  );

  // Section 5: Tabel Suara Guru & Tendik (DPTb)
  const additionalVotedCount = additionalVoters.filter((v) => v.hasVoted).length;
  renderVoterTableSection(
    '5. Tabel Daftar Suara Guru & Tendik (DPTb)',
    `Total: ${additionalVoters.length} Pemilih · Sudah Memilih: ${additionalVotedCount} · Belum Memilih: ${additionalVoters.length - additionalVotedCount}`,
    'ID',
    'Keterangan',
    additionalVoters,
    [5, 150, 105]
  );

  // Signature Block (wrapped neatly inside right margin, never clipped)
  const sigWidth = 76;
  const sigX = pageWidth - margin - sigWidth;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const orgText = `Panitia Pemilihan OSIS ${db.settings.schoolName}`;
  const orgLines = doc.splitTextToSize(orgText, sigWidth);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const signerLines = doc.splitTextToSize(exportedBy, sigWidth);

  const estimatedSigHeight = 6 + orgLines.length * 4.5 + 18 + signerLines.length * 4;
  y += 14;
  if (y + estimatedSigHeight > pageHeight - 24) {
    doc.addPage();
    y = 24;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text('Mengetahui,', sigX, y);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 30, 61);
  doc.text(orgLines, sigX, y + 5);

  const lineY = y + 5 + orgLines.length * 4.5 + 16;
  doc.setDrawColor(148, 163, 184);
  doc.line(sigX, lineY, pageWidth - margin, lineY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  doc.text(signerLines, sigX, lineY + 4.5);

  // Bottom-left official footer on every page
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, pageHeight - 17, pageWidth - margin, pageHeight - 17);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Dokumen resmi dihasilkan oleh Sistem E-Voting OSIS.', margin, pageHeight - 11);

    if (totalPages > 1) {
      doc.text(`Halaman ${p} dari ${totalPages}`, pageWidth - margin, pageHeight - 11, {
        align: 'right',
      });
    }
  }

  return doc;
}

export async function downloadElectionResultPdf(
  db: DatabaseState,
  exportedBy: string
): Promise<string> {
  const logoImage = await loadPdfLogoImage(db.settings.logoUrl);
  const doc = buildElectionPdfDocument(db, exportedBy, logoImage);

  const safeSlug = db.settings.schoolName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const filename = `Hasil-Pemilihan-OSIS-${safeSlug || 'sekolah'}-${new Date()
    .toISOString()
    .slice(0, 10)}.pdf`;
  doc.save(filename);
  return filename;
}
