import assert from 'node:assert/strict';
import test from 'node:test';
import { SEED_DATABASE } from '../data/seedData';
import { applyVoterEditInState, exportVotersCsv } from './electionLogic';
import { buildElectionSheetPayload } from './googleSheets';
import { buildElectionPdfDocument } from './pdfReport';

// 1x1 transparent PNG data URI for deterministic Node unit testing
const SAMPLE_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('buildElectionPdfDocument embeds school logo XObject in kop surat when logoImage is provided', () => {
  const docWithLogo = buildElectionPdfDocument(SEED_DATABASE, 'Tamtowi Yahya, S.Pd. (SUPERADMIN)', {
    dataUrl: SAMPLE_PNG_DATA_URL,
    format: 'PNG',
    width: 120,
    height: 120,
  });
  const pdfWithLogo = docWithLogo.output();

  assert.match(pdfWithLogo, /\/Subtype \/Image/);
  assert.match(pdfWithLogo, /SMA Negeri 1 Kabun/);
  assert.match(pdfWithLogo, /BERITA ACARA & REKAPITULASI HASIL E-VOTING OSIS/);

  const docWithoutLogo = buildElectionPdfDocument(
    SEED_DATABASE,
    'Tamtowi Yahya, S.Pd. (SUPERADMIN)',
    null
  );
  const pdfWithoutLogo = docWithoutLogo.output();
  assert.doesNotMatch(pdfWithoutLogo, /\/Subtype \/Image/);
  assert.match(pdfWithoutLogo, /SMA Negeri 1 Kabun/);
});

test('SuperAdmin edit of a voter who already voted updates PDF, CSV, and Google Sheets downloads', () => {
  const superAdmin = { fullName: 'Tamtowi Yahya, S.Pd.', role: 'SUPERADMIN' as const };

  const votedFixture = {
    ...SEED_DATABASE,
    candidates: [
      {
        ...SEED_DATABASE.candidates[0],
        id: 'paslon_1',
        ketuaName: 'Bima Wijaya',
        wakilName: 'Nadia Kusuma',
        votes: 8,
      },
      {
        ...SEED_DATABASE.candidates[1],
        id: 'paslon_2',
        ketuaName: 'Aulia Rahmawati',
        wakilName: 'Rizky Ramadhan',
        votes: 6,
      },
      {
        ...SEED_DATABASE.candidates[2],
        id: 'paslon_3',
        ketuaName: 'Dimas Pratama',
        wakilName: 'Clarissa Putri',
        votes: 4,
      },
    ],
    voters: [
      ...Array.from({ length: 12 }, (_, idx) => ({
        id: `v_${idx + 1}`,
        nis: `2024${String(idx + 1).padStart(3, '0')}`,
        name: `Pemilih Belum ${idx + 1}`,
        kelas: idx % 3 === 0 ? 'XII MIPA 1' : idx % 3 === 1 ? 'XI IPS 1' : 'X Merdeka 1',
        grade: (idx % 3 === 0 ? 'XII' : idx % 3 === 1 ? 'XI' : 'X') as 'X' | 'XI' | 'XII',
        token: String(100000 + idx),
        hasVoted: false,
      })),
      ...Array.from({ length: 8 }, (_, idx) => ({
        id: `v_${idx + 13}`,
        nis: `2024${String(idx + 13).padStart(3, '0')}`,
        name: idx === 0 ? 'Hendra Wijaya' : `Pemilih P1 ${idx}`,
        kelas: 'XII MIPA 1',
        grade: 'XII' as const,
        token: String(200000 + idx),
        hasVoted: true,
        votedAt: '2026-11-16T08:12:00.000Z',
        votedCandidateId: 'paslon_1',
      })),
      ...Array.from({ length: 6 }, (_, idx) => ({
        id: `v_${idx + 21}`,
        nis: `2024${String(idx + 21).padStart(3, '0')}`,
        name: `Pemilih P2 ${idx}`,
        kelas: 'XI MIPA 1',
        grade: 'XI' as const,
        token: String(300000 + idx),
        hasVoted: true,
        votedAt: '2026-11-16T08:50:00.000Z',
        votedCandidateId: 'paslon_2',
      })),
      ...Array.from({ length: 4 }, (_, idx) => ({
        id: `v_${idx + 27}`,
        nis: `2024${String(idx + 27).padStart(3, '0')}`,
        name: `Pemilih P3 ${idx}`,
        kelas: 'X Merdeka 1',
        grade: 'X' as const,
        token: String(400000 + idx),
        hasVoted: true,
        votedAt: '2026-11-16T09:20:00.000Z',
        votedCandidateId: 'paslon_3',
      })),
    ],
  };

  // v_13 (Hendra Wijaya) originally voted for paslon_1 and is in XII MIPA 1 (grade XII)
  const { nextState } = applyVoterEditInState(
    votedFixture,
    'v_13',
    {
      nis: '2024013-REV',
      name: 'Hendra Wijaya Rev',
      kelas: 'XI MIPA 1',
      hasVoted: true,
      votedCandidateId: 'paslon_2',
    },
    superAdmin
  );

  // Paslon 01: 8 -> 7, Paslon 02: 6 -> 7
  const pdfText = buildElectionPdfDocument(nextState, 'Tamtowi Yahya, S.Pd. (SUPERADMIN)', {
    dataUrl: SAMPLE_PNG_DATA_URL,
    format: 'PNG',
    width: 100,
    height: 100,
  }).output();

  assert.match(pdfText, /\(Bima Wijaya & Nadia Kusuma \\\(Unggul\\\)\)/);
  assert.match(pdfText, /\(Aulia Rahmawati & Rizky Ramadhan \\\(Unggul\\\)\)/);
  assert.match(pdfText, /\(7\)/);
  assert.match(pdfText, /\(7 siswa\)/);

  // CSV & Google Sheets exports reflect revised NIS, name, kelas, and grade
  const csv = exportVotersCsv(nextState.voters);
  assert.match(csv, /2024013-REV,"Hendra Wijaya Rev","XI MIPA 1",XI,Sudah Memilih/);

  const sheets = buildElectionSheetPayload(nextState);
  const paslon1Row = sheets.paslonRows.find((r) => r[0] === 1);
  const paslon2Row = sheets.paslonRows.find((r) => r[0] === 2);
  assert.equal(paslon1Row?.[7], 7);
  assert.equal(paslon2Row?.[7], 7);

  // Also test unchecking hasVoted on a voter who already voted
  const { nextState: uncheckedState } = applyVoterEditInState(
    nextState,
    'v_13',
    {
      nis: '2024013-REV',
      name: 'Hendra Wijaya Rev',
      kelas: 'XI MIPA 1',
      hasVoted: false,
      votedCandidateId: undefined,
    },
    superAdmin
  );
  const uncheckedPdf = buildElectionPdfDocument(uncheckedState, 'SuperAdmin').output();
  assert.match(uncheckedPdf, /\(17 Suara\)/);
  assert.match(uncheckedPdf, /\(13 Pemilih\)/);
});

test('PDF report separates Siswa and Guru & Tendik voter tables and resolves Paslon 01 green color', async () => {
  const { partitionSortedReportVoters, resolveCandidateChartColor } = await import('./pdfReport');

  assert.equal(resolveCandidateChartColor({ nomorUrut: 1, accentColor: '#1E3A5F' }, 0), '#059669');
  assert.equal(resolveCandidateChartColor({ nomorUrut: 1, accentColor: '#059669' }, 0), '#059669');
  assert.equal(resolveCandidateChartColor({ nomorUrut: 3, accentColor: '#1E3A5F' }, 2), '#1E3A5F');

  const { studentVoters, additionalVoters } = partitionSortedReportVoters(SEED_DATABASE.voters);
  assert.equal(studentVoters.length, 498);
  assert.equal(additionalVoters.length, 37);
  assert.equal(studentVoters[0].kelas, 'X A');
  assert.equal(studentVoters[studentVoters.length - 1].kelas, 'XII E');
  assert.equal(additionalVoters[0].kelas, 'Guru');

  const pdfOut = buildElectionPdfDocument(SEED_DATABASE, 'SuperAdmin', null).output();
  assert.match(pdfOut, /4\. Tabel Daftar Suara Pemilih Siswa \\\(DPT\\\)/);
  assert.match(pdfOut, /5\. Tabel Daftar Suara Guru & Tendik \\\(DPTb\\\)/);
  assert.match(pdfOut, /Guru & Tendik/);
  assert.match(pdfOut, /535 Pemilih/);
});

