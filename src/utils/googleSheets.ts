import type { DatabaseState, Voter } from '../types/evoting';
import {
  computeStatistics,
  extractGrade,
  generateId,
  generateSixDigitToken,
  sortVotersOrdered,
} from './electionLogic';
import { safeParseGoogleSheetsResponse } from './safeJson';

export interface SpreadsheetSheetMeta {
  sheetId: number;
  title: string;
  index: number;
}

export interface SpreadsheetMeta {
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  sheets: SpreadsheetSheetMeta[];
}

export const EXPORT_TAB_REKAP = 'Rekap Hasil';
export const EXPORT_TAB_DPT = 'Daftar Pemilih (DPT)';
export const EXPORT_TAB_PASLON = 'Kandidat Paslon';

export function extractSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  if (/^[a-zA-Z0-9_-]{12,}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function parseSheetRowsToVoters(
  rows: string[][],
  existingNisSet: Set<string>,
  existingTokens: Set<string>
): { added: Voter[]; skippedCount: number; invalidRows: number } {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { added: [], skippedCount: 0, invalidRows: 0 };
  }

  const firstRow = rows[0].map((c) => String(c || '').trim().toLowerCase());
  const hasHeader = firstRow.some(
    (cell) => cell === 'nis' || cell === 'nis/nisn' || cell === 'nisn' || cell.includes('nama')
  );

  let nisCol = 0;
  let nameCol = 1;
  let kelasCol = 2;

  if (hasHeader) {
    const foundNis = firstRow.findIndex((c) => c.includes('nis'));
    const foundName = firstRow.findIndex((c) => c.includes('nama'));
    const foundKelas = firstRow.findIndex((c) => c.includes('kelas'));
    if (foundNis >= 0) nisCol = foundNis;
    if (foundName >= 0) nameCol = foundName;
    if (foundKelas >= 0) kelasCol = foundKelas;
  }

  const dataRows = hasHeader ? rows.slice(1) : rows;
  const seenNis = new Set(existingNisSet);
  const seenTokens = new Set(existingTokens);
  const added: Voter[] = [];
  let skippedCount = 0;
  let invalidRows = 0;

  for (const row of dataRows) {
    const nis = String(row[nisCol] ?? '').trim();
    const name = String(row[nameCol] ?? '').trim();
    const kelas = String(row[kelasCol] ?? '').trim();

    if (!nis && !name && !kelas) continue;

    if (!nis || !name || !kelas) {
      invalidRows += 1;
      continue;
    }

    if (seenNis.has(nis)) {
      skippedCount += 1;
      continue;
    }

    const token = generateSixDigitToken(seenTokens);
    seenNis.add(nis);
    seenTokens.add(token);

    added.push({
      id: generateId('vtr'),
      nis,
      name,
      kelas,
      grade: extractGrade(kelas),
      token,
      hasVoted: false,
    });
  }

  return { added, skippedCount, invalidRows };
}

export function buildElectionSheetPayload(dbState: DatabaseState): {
  rekapRows: (string | number)[][];
  dptRows: (string | number)[][];
  paslonRows: (string | number)[][];
} {
  const stats = computeStatistics(dbState.voters, dbState.candidates);
  const generatedAt = new Date().toLocaleString('id-ID', {
    dateStyle: 'full',
    timeStyle: 'short',
  });

  const rekapRows: (string | number)[][] = [
    ['LAPORAN HASIL E-VOTING PENGURUS OSIS'],
    ['Sekolah', dbState.settings.schoolName],
    ['Tahun Ajaran', dbState.settings.academicYear],
    ['Judul Pemilihan', dbState.settings.electionTitle],
    ['Waktu Sinkronisasi', generatedAt],
    ['Status Bilik Suara', dbState.settings.isBoothOpen ? 'Dibuka' : 'Ditutup'],
    [],
    ['RINGKASAN PARTISIPASI PEMILIH', 'JUMLAH', 'KETERANGAN'],
    ['Total DPT Terdaftar', stats.totalDpt, 'Siswa'],
    ['Total Suara Masuk', stats.totalVoted, `${stats.participationRate}% partisipasi`],
    ['Total Belum Memilih', stats.totalNotVoted, 'Siswa'],
    ['Total Suara Sah Paslon', stats.totalValidVotes, 'Suara'],
    [],
    ['PEROLEHAN SUARA PASANGAN CALON'],
    ['No. Urut', 'Calon Ketua', 'Calon Wakil', 'Jumlah Suara', 'Persentase (%)'],
    ...stats.candidateStats.map((c) => [
      `Paslon ${String(c.nomorUrut).padStart(2, '0')}`,
      c.ketuaName,
      c.wakilName,
      c.votes,
      `${c.percentage}%`,
    ]),
    [],
    ['PARTISIPASI PER ANGKATAN'],
    ['Angkatan', 'Sudah Memilih', 'Total DPT', 'Persentase (%)'],
    ...stats.gradeStats.map((g) => [g.label, g.voted, g.total, `${g.percentage}%`]),
  ];

  const dptRows: (string | number)[][] = [
    ['NIS/NISN', 'Nama Lengkap', 'Kelas', 'Angkatan', 'Status Memilih', 'Waktu Memilih'],
    ...sortVotersOrdered(dbState.voters).map((v) => [
      v.nis,
      v.name,
      v.kelas,
      v.grade,
      v.hasVoted ? 'Sudah Memilih' : 'Belum Memilih',
      v.votedAt ? new Date(v.votedAt).toLocaleString('id-ID') : '-',
    ]),
  ];

  const paslonRows: (string | number)[][] = [
    ['No. Urut', 'Nama Ketua', 'Kelas Ketua', 'Nama Wakil', 'Kelas Wakil', 'Visi', 'Misi', 'Suara'],
    ...stats.candidateStats.map((c) => [
      c.nomorUrut,
      c.ketuaName,
      c.ketuaClass,
      c.wakilName,
      c.wakilClass,
      c.vision,
      c.missions.join(' | '),
      c.votes,
    ]),
  ];

  return { rekapRows, dptRows, paslonRows };
}

export async function fetchSpreadsheetMeta(
  accessToken: string,
  spreadsheetId: string
): Promise<SpreadsheetMeta> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title,index)`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await safeParseGoogleSheetsResponse<{
    spreadsheetId: string;
    spreadsheetUrl?: string;
    properties?: { title?: string };
    sheets?: Array<{ properties?: { sheetId?: number; title?: string; index?: number } }>;
  }>(res, 'membaca metadata Spreadsheet');

  const sheets: SpreadsheetSheetMeta[] = (data.sheets || []).map((s, idx) => ({
    sheetId: s.properties?.sheetId ?? idx,
    title: s.properties?.title ?? `Sheet${idx + 1}`,
    index: s.properties?.index ?? idx,
  }));

  return {
    spreadsheetId: data.spreadsheetId,
    spreadsheetUrl:
      data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
    title: data.properties?.title || 'Spreadsheet Tanpa Judul',
    sheets,
  };
}

export async function fetchSheetValues(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string
): Promise<string[][]> {
  const safeSheetName = sheetTitle.replace(/'/g, "''");
  const range = encodeURIComponent(`'${safeSheetName}'!A1:Z2000`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values/${range}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await safeParseGoogleSheetsResponse<{ values?: string[][] }>(
    res,
    'membaca data sheet'
  );
  return Array.isArray(data.values) ? data.values : [];
}

function quoteSheetRange(sheetTitle: string, range: string): string {
  return `'${sheetTitle.replace(/'/g, "''")}'!${range}`;
}

export async function createElectionSpreadsheet(
  accessToken: string,
  dbState: DatabaseState
): Promise<SpreadsheetMeta> {
  const title = `E-Voting OSIS ${dbState.settings.schoolName} (${dbState.settings.academicYear})`;
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        { properties: { title: EXPORT_TAB_REKAP } },
        { properties: { title: EXPORT_TAB_DPT } },
        { properties: { title: EXPORT_TAB_PASLON } },
      ],
    }),
  });

  const created = await safeParseGoogleSheetsResponse<{
    spreadsheetId: string;
    spreadsheetUrl?: string;
    properties?: { title?: string };
    sheets?: Array<{ properties?: { sheetId?: number; title?: string; index?: number } }>;
  }>(createRes, 'membuat Spreadsheet baru');

  const { rekapRows, dptRows, paslonRows } = buildElectionSheetPayload(dbState);
  const batchRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      created.spreadsheetId
    )}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: quoteSheetRange(EXPORT_TAB_REKAP, 'A1'), values: rekapRows },
          { range: quoteSheetRange(EXPORT_TAB_DPT, 'A1'), values: dptRows },
          { range: quoteSheetRange(EXPORT_TAB_PASLON, 'A1'), values: paslonRows },
        ],
      }),
    }
  );

  await safeParseGoogleSheetsResponse<unknown>(batchRes, 'mengisi data Spreadsheet baru', {
    allowEmpty: true,
  });

  return {
    spreadsheetId: created.spreadsheetId,
    spreadsheetUrl:
      created.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`,
    title: created.properties?.title || title,
    sheets: (created.sheets || []).map((s, idx) => ({
      sheetId: s.properties?.sheetId ?? idx,
      title: s.properties?.title ?? `Sheet${idx + 1}`,
      index: s.properties?.index ?? idx,
    })),
  };
}

export async function updateExistingSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  dbState: DatabaseState
): Promise<SpreadsheetMeta> {
  const meta = await fetchSpreadsheetMeta(accessToken, spreadsheetId);
  const existingTitles = new Set(meta.sheets.map((s) => s.title));
  const neededTabs = [EXPORT_TAB_REKAP, EXPORT_TAB_DPT, EXPORT_TAB_PASLON];
  const missingTabs = neededTabs.filter((t) => !existingTitles.has(t));

  if (missingTabs.length > 0) {
    const addRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: missingTabs.map((title) => ({
            addSheet: { properties: { title } },
          })),
        }),
      }
    );
    await safeParseGoogleSheetsResponse<unknown>(addRes, 'menambahkan tab Spreadsheet', {
      allowEmpty: true,
    });
  }

  const clearRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values:batchClear`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ranges: neededTabs.map((t) => quoteSheetRange(t, 'A1:Z5000')),
      }),
    }
  );
  await safeParseGoogleSheetsResponse<unknown>(clearRes, 'membersihkan tab Spreadsheet', {
    allowEmpty: true,
  });

  const { rekapRows, dptRows, paslonRows } = buildElectionSheetPayload(dbState);
  const writeRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: quoteSheetRange(EXPORT_TAB_REKAP, 'A1'), values: rekapRows },
          { range: quoteSheetRange(EXPORT_TAB_DPT, 'A1'), values: dptRows },
          { range: quoteSheetRange(EXPORT_TAB_PASLON, 'A1'), values: paslonRows },
        ],
      }),
    }
  );

  await safeParseGoogleSheetsResponse<unknown>(writeRes, 'memperbarui data Spreadsheet', {
    allowEmpty: true,
  });

  return fetchSpreadsheetMeta(accessToken, spreadsheetId);
}
