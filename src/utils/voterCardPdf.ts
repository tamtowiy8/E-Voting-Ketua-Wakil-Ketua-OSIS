import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { ElectionSettings, Voter } from '../types/evoting.ts';
import {
  encodeVoterQrPayload,
  isAdditionalVoter,
  resolveEffectiveVoterLoginMode,
} from './electionLogic.ts';
import { loadPdfLogoImage, type PdfLogoImage } from './pdfReport.ts';

export async function generateVoterQrDataUrl(voter: Pick<Voter, 'nis'>): Promise<string> {
  return QRCode.toDataURL(encodeVoterQrPayload(voter), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 240,
    color: {
      dark: '#0F1E3D',
      light: '#FFFFFF',
    },
  });
}

export function getCardLoginHint(settings: ElectionSettings, isDptb = false): string {
  const mode = resolveEffectiveVoterLoginMode(settings);
  const identifierLabel = isDptb ? 'ID' : 'NIS/NISN';
  if (mode === 'QR_CODE') {
    return 'Scan QR Code pada kamera bilik suara.';
  }
  if (mode === 'BOTH') {
    return `Scan QR Code atau ketik ${identifierLabel} saat login.`;
  }
  return `Gunakan QR Code atau ${identifierLabel} pada kartu ini.`;
}

export async function buildVoterCardsPdfDocument(
  voters: Voter[],
  settings: ElectionSettings,
  logoImage: PdfLogoImage | null = null
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const marginX = 12;
  const marginTop = 12;
  const cols = 2;
  const rows = 4;
  const gapX = 6;
  const gapY = 5.5;
  const cardWidth = (pageWidth - marginX * 2 - gapX * (cols - 1)) / cols;
  const cardHeight = (pageHeight - marginTop - 16 - gapY * (rows - 1)) / rows;
  const cardsPerPage = cols * rows;

  const qrDataUrls = await Promise.all(voters.map((v) => generateVoterQrDataUrl(v)));
  const schoolName = (settings.schoolName || 'Sekolah').trim();
  const academicYear = (settings.academicYear || '').trim();
  const electionTitle = (settings.electionTitle || 'Pemilihan Ketua & Wakil Ketua OSIS').trim();

  voters.forEach((voter, index) => {
    if (index > 0 && index % cardsPerPage === 0) {
      doc.addPage();
    }

    const slot = index % cardsPerPage;
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    const x = marginX + col * (cardWidth + gapX);
    const y = marginTop + row * (cardHeight + gapY);

    // Outer card container + dashed cut border guide
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, cardWidth, cardHeight, 2.5, 2.5, 'FD');

    // Card header band
    const headerH = 14.5;
    doc.setFillColor(15, 30, 61);
    doc.roundedRect(x, y, cardWidth, headerH, 2.5, 2.5, 'F');
    doc.rect(x, y + headerH - 3, cardWidth, 3, 'F');

    // Gold accent line under header
    doc.setFillColor(217, 119, 6);
    doc.rect(x, y + headerH, cardWidth, 0.9, 'F');

    let headerTextX = x + 3.5;
    if (logoImage?.dataUrl) {
      const logoBox = 10;
      const lx = x + 3;
      const ly = y + 2.2;
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(lx, ly, logoBox, logoBox, 1.4, 1.4, 'F');

      const innerMax = 8.4;
      const aspect =
        logoImage.width > 0 && logoImage.height > 0 ? logoImage.width / logoImage.height : 1;
      const drawW = aspect >= 1 ? innerMax : innerMax * aspect;
      const drawH = aspect >= 1 ? innerMax / aspect : innerMax;
      doc.addImage(
        logoImage.dataUrl,
        logoImage.format,
        lx + (logoBox - drawW) / 2,
        ly + (logoBox - drawH) / 2,
        drawW,
        drawH,
        undefined,
        'FAST'
      );
      headerTextX = lx + logoBox + 2.5;
    }

    const maxHeaderW = x + cardWidth - 3 - headerTextX;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(251, 191, 36);
    doc.text('KARTU PEMILIH E-VOTING OSIS', headerTextX, y + 5.6, {
      maxWidth: maxHeaderW,
    });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(255, 255, 255);
    const schoolLine =
      doc.splitTextToSize(`${schoolName}${academicYear ? ` (${academicYear})` : ''}`, maxHeaderW)[0] ||
      schoolName;
    doc.text(schoolLine, headerTextX, y + 10.6);

    // Sub-banner election title
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    const titleLine = doc.splitTextToSize(electionTitle, cardWidth - 7)[0] || electionTitle;
    doc.text(titleLine, x + 3.5, y + headerH + 4.5);

    // QR Code Frame on right side
    const qrBoxSize = 27.5;
    const qrX = x + cardWidth - qrBoxSize - 3.5;
    const qrY = y + headerH + 7.2;

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.roundedRect(qrX, qrY, qrBoxSize, qrBoxSize, 1.8, 1.8, 'FD');

    const qrImgSize = 24.5;
    doc.addImage(
      qrDataUrls[index],
      'PNG',
      qrX + (qrBoxSize - qrImgSize) / 2,
      qrY + (qrBoxSize - qrImgSize) / 2,
      qrImgSize,
      qrImgSize,
      undefined,
      'FAST'
    );

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.8);
    doc.setTextColor(15, 30, 61);
    doc.text('SCAN QR LOGIN', qrX + qrBoxSize / 2, qrY + qrBoxSize + 3.4, { align: 'center' });

    // Left Column Voter Info
    const infoX = x + 3.5;
    const infoMaxW = qrX - infoX - 3;
    let infoY = y + headerH + 10;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.3);
    doc.setTextColor(100, 116, 139);
    doc.text('NAMA PEMILIH', infoX, infoY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.2);
    doc.setTextColor(15, 23, 42);
    const nameLines = doc.splitTextToSize(voter.name, infoMaxW).slice(0, 2);
    doc.text(nameLines, infoX, infoY + 4.1);
    infoY += 4.1 + nameLines.length * 4 + 1.8;

    const isDptb = isAdditionalVoter(voter);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.3);
    doc.setTextColor(100, 116, 139);
    doc.text(isDptb ? 'ID' : 'NIS / NISN', infoX, infoY);

    doc.setFont('courier', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 30, 61);
    doc.text(voter.nis, infoX, infoY + 4);
    infoY += 8.6;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.3);
    doc.setTextColor(100, 116, 139);
    doc.text(isDptb ? 'KETERANGAN' : 'KELAS', infoX, infoY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(30, 41, 59);
    const kelasLine = doc.splitTextToSize(voter.kelas, infoMaxW)[0] || voter.kelas;
    doc.text(kelasLine, infoX, infoY + 3.8);

    // Bottom hint strip
    const loginHint = getCardLoginHint(settings, isDptb);
    doc.setDrawColor(226, 232, 240);
    doc.line(x + 3.5, y + cardHeight - 7.5, x + cardWidth - 3.5, y + cardHeight - 7.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    doc.setTextColor(71, 85, 105);
    doc.text(loginHint, x + 3.5, y + cardHeight - 3.5, { maxWidth: cardWidth - 7 });
  });

  // Footer note on every page
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Kartu Pemilih E-Voting OSIS · ${schoolName} · Total ${voters.length} Pemilih`,
      marginX,
      pageHeight - 7
    );
    doc.text(`Halaman ${p} dari ${totalPages}`, pageWidth - marginX, pageHeight - 7, {
      align: 'right',
    });
  }

  return doc;
}

export async function downloadVoterCardsPdf(
  voters: Voter[],
  settings: ElectionSettings,
  filenamePrefix = 'Kartu-Pemilih-OSIS'
): Promise<string> {
  if (voters.length === 0) {
    throw new Error('Tidak ada data pemilih untuk dicetak.');
  }
  const logoImage = await loadPdfLogoImage(settings.logoUrl);
  const doc = await buildVoterCardsPdfDocument(voters, settings, logoImage);
  const safeSlug = settings.schoolName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const filename = `${filenamePrefix}-${safeSlug || 'sekolah'}-${new Date()
    .toISOString()
    .slice(0, 10)}.pdf`;
  doc.save(filename);
  return filename;
}
