import QRCode from 'qrcode';
import type { AdminUser } from '../types/evoting.ts';
import { encodeAdminQrPayload } from './electionLogic.ts';

export async function generateAdminQrDataUrl(
  admin: Pick<AdminUser, 'id' | 'qrToken'>
): Promise<string> {
  return QRCode.toDataURL(encodeAdminQrPayload(admin), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
    color: {
      dark: '#0F1E3D',
      light: '#FFFFFF',
    },
  });
}

export async function renderAdminQrCardPngDataUrl(
  admin: Pick<AdminUser, 'id' | 'username' | 'fullName' | 'role' | 'qrToken'>,
  schoolName: string,
  electionTitle: string
): Promise<string> {
  const qrDataUrl = await generateAdminQrDataUrl(admin);
  if (typeof document === 'undefined') {
    return qrDataUrl;
  }

  const qrImg = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal merender QR Code Panitia.'));
    img.src = qrDataUrl;
  });

  const width = 520;
  const height = 660;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return qrDataUrl;

  // White card background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // Subtle outer border
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, width - 20, height - 20);

  // Header bar
  ctx.fillStyle = '#0F1E3D';
  ctx.fillRect(10, 10, width - 20, 98);

  ctx.fillStyle = '#F59E0B';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('KARTU QR LOGIN PANITIA E-VOTING', width / 2, 42);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText((schoolName || 'Sekolah').slice(0, 38), width / 2, 72);

  ctx.fillStyle = '#CBD5E1';
  ctx.font = '13px sans-serif';
  ctx.fillText((electionTitle || 'Pemilihan OSIS').slice(0, 48), width / 2, 94);

  // Generous white quiet-zone & QR Image
  const qrSize = 310;
  const qrX = (width - qrSize) / 2;
  const qrY = 138;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(qrX - 16, qrY - 16, qrSize + 32, qrSize + 32);
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(qrX - 16, qrY - 16, qrSize + 32, qrSize + 32);
  ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

  // Admin details below QR
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText((admin.fullName || admin.username).slice(0, 34), width / 2, 502);

  ctx.fillStyle = admin.role === 'SUPERADMIN' ? '#B45309' : '#1E3A5F';
  ctx.font = 'bold 15px monospace';
  ctx.fillText(`${admin.role}  ·  @${admin.username}`, width / 2, 534);

  ctx.fillStyle = '#475569';
  ctx.font = '13px sans-serif';
  ctx.fillText('Pindai atau unggah kartu QR ini pada halaman Login Admin', width / 2, 578);
  ctx.fillText('untuk masuk tanpa perlu mengetik ulang kata sandi.', width / 2, 598);

  ctx.fillStyle = '#94A3B8';
  ctx.font = '11px sans-serif';
  ctx.fillText('Simpan di tempat aman — jangan dibagikan kepada pemilih.', width / 2, 628);

  return canvas.toDataURL('image/png');
}

export function buildAdminQrDownloadFilename(
  admin: Pick<AdminUser, 'username' | 'role'>
): string {
  const cleanUser = admin.username.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase() || 'panitia';
  return `QR_Login_${admin.role}_${cleanUser}.png`;
}
