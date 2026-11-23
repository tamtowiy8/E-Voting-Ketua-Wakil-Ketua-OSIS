import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_DATABASE } from '../data/seedData';
import {
  buildElectionSheetPayload,
  extractSpreadsheetId,
  parseSheetRowsToVoters,
} from './googleSheets';
import { safeParseGoogleSheetsResponse } from './safeJson';

test('extractSpreadsheetId extracts ID from URLs and raw IDs cleanly', () => {
  assert.equal(
    extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0'),
    '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
  );
  assert.equal(
    extractSpreadsheetId('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'),
    '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
  );
  assert.equal(extractSpreadsheetId('invalid'), null);
});

test('parseSheetRowsToVoters parses headered sheet rows and deduplicates NIS', () => {
  const rows = [
    ['NIS/NISN', 'Nama Lengkap', 'Kelas'],
    ['2024901', 'Siti Nurhaliza', 'XI MIPA 1'],
    ['2024001', 'Duplicate Existing', 'XII MIPA 1'],
    ['2024902', 'Budi Santoso', 'X Merdeka 2'],
    ['', 'Missing NIS', 'X Merdeka 3'],
  ];
  const existingNis = new Set(['2024001']);
  const existingTokens = new Set(['111111']);
  const result = parseSheetRowsToVoters(rows, existingNis, existingTokens);

  assert.equal(result.added.length, 2);
  assert.equal(result.added[0].nis, '2024901');
  assert.equal(result.added[0].grade, 'XI');
  assert.equal(result.added[1].grade, 'X');
  assert.equal(result.skippedCount, 1);
  assert.equal(result.invalidRows, 1);
});

test('buildElectionSheetPayload generates Rekap, DPT, and Paslon tabs with correct totals', () => {
  const payload = buildElectionSheetPayload(SEED_DATABASE);
  assert.ok(payload.rekapRows.some((r) => r[0] === 'Sekolah' && r[1] === SEED_DATABASE.settings.schoolName));
  assert.equal(payload.dptRows.length, SEED_DATABASE.voters.length + 1);
  assert.equal(payload.paslonRows.length, SEED_DATABASE.candidates.length + 1);
});

test('safeParseGoogleSheetsResponse handles HTML error pages cleanly without Unexpected token <', async () => {
  const htmlOkRes = new Response('<!DOCTYPE html><html><body>Captive Portal</body></html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
  await assert.rejects(
    () => safeParseGoogleSheetsResponse(htmlOkRes, 'membaca metadata Spreadsheet'),
    (err: Error) => /halaman HTML/.test(err.message) && !err.message.includes('Unexpected token')
  );

  const html502Res = new Response('\uFEFF<!doctype html><html><body>502 Bad Gateway</body></html>', {
    status: 502,
    headers: { 'Content-Type': 'text/html' },
  });
  await assert.rejects(
    () => safeParseGoogleSheetsResponse(html502Res, 'membuat Spreadsheet baru'),
    (err: Error) => /HTTP 502/.test(err.message) && !err.message.includes('Unexpected token')
  );

  const jsonErrRes = new Response(
    JSON.stringify({ error: { message: 'The caller does not have permission' } }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  );
  await assert.rejects(
    () => safeParseGoogleSheetsResponse(jsonErrRes, 'membaca data sheet'),
    /does not have permission/
  );
});
