import assert from 'node:assert/strict';
import test from 'node:test';
import { SEED_DATABASE } from '../data/seedData';
import {
  buildVoterCardsPdfDocument,
  generateVoterQrDataUrl,
  getCardLoginHint,
} from './voterCardPdf';

const SAMPLE_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('generateVoterQrDataUrl creates a PNG QR data URL for voter NIS', async () => {
  const url = await generateVoterQrDataUrl(SEED_DATABASE.voters[0]);
  assert.ok(url.startsWith('data:image/png;base64,'));
  assert.ok(url.length > 200);
});

test('buildVoterCardsPdfDocument generates multi-page A4 Kartu Pemilih PDFs with QR code images and voter details', async () => {
  const tenVoters = SEED_DATABASE.voters.slice(0, 10);
  const doc = await buildVoterCardsPdfDocument(
    tenVoters,
    { ...SEED_DATABASE.settings, voterLoginMode: 'QR_CODE' },
    {
      dataUrl: SAMPLE_PNG_DATA_URL,
      format: 'PNG',
      width: 120,
      height: 120,
    }
  );

  // 8 cards per page -> 10 voters spans 2 A4 pages
  assert.equal(doc.getNumberOfPages(), 2);

  const pdfOutput = doc.output();
  assert.match(pdfOutput, /\/Subtype \/Image/);
  assert.match(pdfOutput, /KARTU PEMILIH E-VOTING OSIS/);
  assert.match(pdfOutput, new RegExp(SEED_DATABASE.voters[0].name));
  assert.match(pdfOutput, new RegExp(SEED_DATABASE.voters[0].nis));
  assert.match(pdfOutput, /Halaman 2 dari 2/);
});

test('buildVoterCardsPdfDocument uses ID & KETERANGAN for DPTb and NIS / NISN & KELAS for student DPT', async () => {
  const dptbVoter = {
    id: '2026099',
    nis: '2026099',
    name: 'Drs. H. Ahmad Fauzi, M.Pd.',
    kelas: 'Kepala Sekolah',
    grade: 'X' as const,
    token: '654321',
    hasVoted: false,
  };
  const guruVoter = {
    id: '2026100',
    nis: '2026100',
    name: 'Siti Aminah, S.Pd.',
    kelas: 'Guru',
    grade: 'X' as const,
    token: '111222',
    hasVoted: false,
  };
  const tendikVoter = {
    id: '2026101',
    nis: '2026101',
    name: 'Budi Santoso',
    kelas: 'Tendik',
    grade: 'X' as const,
    token: '333444',
    hasVoted: false,
  };
  const studentVoter = {
    id: '2026500',
    nis: '2026500',
    name: 'Alya Putri',
    kelas: 'X A',
    grade: 'X' as const,
    token: '112233',
    hasVoted: false,
  };

  const nisnSettings = { ...SEED_DATABASE.settings, voterLoginMode: 'NISN' as const };
  const bothSettings = { ...SEED_DATABASE.settings, voterLoginMode: 'BOTH' as const };

  const dptbDoc = await buildVoterCardsPdfDocument(
    [dptbVoter, guruVoter, tendikVoter],
    nisnSettings,
    null
  );
  const dptbPdf = dptbDoc.output();
  assert.match(dptbPdf, /\(ID\)/);
  assert.match(dptbPdf, /\(KETERANGAN\)/);
  assert.match(dptbPdf, /Kepala Sekolah/);
  assert.match(dptbPdf, /Gunakan QR Code atau ID pada kartu ini\./);
  assert.doesNotMatch(dptbPdf, /NIS\/NISN/);
  assert.doesNotMatch(dptbPdf, /\(NIS \/ NISN\)/);

  const studentDoc = await buildVoterCardsPdfDocument([studentVoter], nisnSettings, null);
  const studentPdf = studentDoc.output();
  assert.match(studentPdf, /\(NIS \/ NISN\)/);
  assert.match(studentPdf, /\(KELAS\)/);
  assert.match(studentPdf, /Gunakan QR Code atau NIS\/NISN pada kartu ini\./);

  assert.equal(getCardLoginHint(nisnSettings, true), 'Gunakan QR Code atau ID pada kartu ini.');
  assert.equal(
    getCardLoginHint(nisnSettings, false),
    'Gunakan QR Code atau NIS/NISN pada kartu ini.'
  );
  assert.equal(getCardLoginHint(bothSettings, true), 'Scan QR Code atau ketik ID saat login.');
  assert.equal(
    getCardLoginHint(bothSettings, false),
    'Scan QR Code atau ketik NIS/NISN saat login.'
  );
});


