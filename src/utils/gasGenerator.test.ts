import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_DATABASE } from '../data/seedData';
import {
  generateGasCodeGs,
  generateGasIndexHtml,
  generateGasManifestJson,
  isValidGasWebAppUrl,
  resolveGasAssetUrl,
  sanitizeDbForSheetsCellLimit,
} from './gasGenerator';

test('isValidGasWebAppUrl accepts only official Google Apps Script Web App URLs', () => {
  assert.equal(
    isValidGasWebAppUrl('https://script.google.com/macros/s/AKfycbx12345/exec'),
    true
  );
  assert.equal(
    isValidGasWebAppUrl('https://script.google.com/a/macros/school.sch.id/s/AKfycb/exec'),
    true
  );
  assert.equal(isValidGasWebAppUrl('http://script.google.com/macros/s/abc/exec'), false);
  assert.equal(isValidGasWebAppUrl('https://localhost:3000/api/test'), false);
  assert.equal(isValidGasWebAppUrl('https://evil.example.com/macros/s/abc/exec'), false);
  assert.equal(isValidGasWebAppUrl(''), false);
});

test('resolveGasAssetUrl resolves relative asset paths against HTTPS origin', () => {
  assert.equal(
    resolveGasAssetUrl('/src/assets/images/logo.jpg', 'https://example.run.app/'),
    'https://example.run.app/src/assets/images/logo.jpg'
  );
  assert.equal(
    resolveGasAssetUrl('data:image/png;base64,ABC', 'https://example.run.app'),
    'data:image/png;base64,ABC'
  );
  assert.equal(
    resolveGasAssetUrl('https://cdn.example.com/img.png', 'https://example.run.app'),
    'https://cdn.example.com/img.png'
  );
});

test('sanitizeDbForSheetsCellLimit clamps oversized base64 images under 50k cell limit', () => {
  const hugeDataUri = 'data:image/png;base64,' + 'A'.repeat(60000);
  const customDb = {
    ...SEED_DATABASE,
    settings: { ...SEED_DATABASE.settings, logoUrl: hugeDataUri },
    candidates: SEED_DATABASE.candidates.map((c, idx) =>
      idx === 0 ? { ...c, photoUrl: hugeDataUri } : c
    ),
  };
  const sanitized = sanitizeDbForSheetsCellLimit(customDb);
  assert.ok(sanitized.settings.logoUrl.length < 40000);
  assert.ok(sanitized.candidates[0].photoUrl.length < 40000);
});

test('generateGasCodeGs includes SpreadsheetApp, LockService, RBAC CRUD, adminEditVoter, smansakabun default, and WhatsApp OTP handlers', () => {
  const superAdmin = SEED_DATABASE.admins.find((a) => a.role === 'SUPERADMIN');
  assert.equal(superAdmin?.username, 'smansakabun');
  assert.equal(superAdmin?.password, 'Smansakabun123!');

  const gs = generateGasCodeGs(SEED_DATABASE, 'https://example.run.app');
  assert.match(gs, /SpreadsheetApp\.getActiveSpreadsheet\(\)/);
  assert.match(gs, /LockService\.getScriptLock\(\)/);
  assert.match(gs, /function doGet\(e\)/);
  assert.match(gs, /function doPost\(e\)/);
  assert.match(gs, /function setupDatabase\(\)/);
  assert.match(gs, /function submitVote\(/);
  assert.match(gs, /function adminSaveVoters\(/);
  assert.match(gs, /function adminEditVoter\(/);
  assert.match(gs, /votedCandidateId/);
  assert.match(gs, /function adminSaveCandidates\(/);
  assert.match(gs, /function adminSaveAdmins\(/);
  assert.match(gs, /function adminSaveSettings\(/);
  assert.match(gs, /function adminToggleSecretMode\(\)/);
  assert.match(gs, /function requestAdminForgotPassword\(/);
  assert.match(gs, /function resetAdminForgotPassword\(/);
  assert.match(gs, /https:\/\/example\.run\.app\/assets\/aistudio\/LOGO_SMANSA_3D_d5e941c9\.png/);
  assert.match(gs, /SMA Negeri 1 Kabun/);
  assert.match(gs, /Tamtowi Yahya, S\.Pd\./);
  assert.match(gs, /smansakabun/);
  assert.match(gs, /Smansakabun123!/);
  assert.match(gs, /var hasLock = false;/);
  assert.match(gs, /if \(hasLock\) lock\.releaseLock\(\);/);
});

test('generateGasIndexHtml matches AI Studio UI, stationary menu bar, Paslon edit UI, valid JS syntax, and avoids native alert/confirm', () => {
  const html = generateGasIndexHtml(SEED_DATABASE, 'https://example.run.app');
  assert.match(html, /google\.script\.run/);
  assert.match(html, /KOMISI PEMILIHAN PENGURUS OSIS \(KPPO\)/);
  assert.match(html, /E-VOTING PENGURUS OSIS/);
  assert.match(html, /<h2[^>]*>Login Pemilih<\/h2>/);
  assert.equal(/Login Pemilih \(Siswa\)/.test(html), false);
  assert.match(html, /Proyektor/);
  assert.match(html, /toggleFullscreenGas\(\)/);
  assert.match(html, /id="scroll-top-btn"/);
  assert.match(html, /scrollToTopGas\(\)/);
  assert.match(html, /data-page-scroller="true"/);
  assert.match(html, /Lihat Visi &amp; Misi/);
  assert.match(html, /Konfirmasi Pilihan Anda/);
  assert.match(html, /Grafik Donat Proporsi Suara/);
  assert.match(html, /Partisipasi Pemilih Per Angkatan/);
  assert.match(html, /Lupa Password\? Konfirmasi via WhatsApp/);
  assert.match(html, /Download Laporan Hasil Pemilihan \(PDF\)/);
  assert.match(html, /Dokumen resmi dihasilkan oleh Sistem E-Voting OSIS\./);
  assert.match(html, /--app-primary/);
  assert.match(html, /h-screen overflow-hidden flex flex-col/);
  assert.match(html, /flex-1 min-h-0 overflow-y-auto/);
  assert.match(html, /dpt-voted-paslon-panel/);
  assert.match(html, /dpt-voted-candidate/);
  assert.match(html, /Tandai sudah menggunakan hak suara/);
  assert.match(html, /Ubah Paslon Pilihan \(Khusus SuperAdmin\)/);

  // Ensure zero native alert()/confirm() usage in generated script
  const scriptMatches = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  assert.ok(scriptMatches.length >= 1);
  const inlineScript = scriptMatches[scriptMatches.length - 1]
    .replace(/^<script>/, '')
    .replace(/<\/script>$/, '');
  assert.equal(/\b(window\.)?(alert|confirm|prompt)\s*\(/.test(inlineScript), false);

  // Verify generated JS parses without syntax errors
  assert.doesNotThrow(() => {
    new Function(inlineScript);
  });

  const manifest = JSON.parse(generateGasManifestJson());
  assert.equal(manifest.timeZone, 'Asia/Jakarta');
  assert.equal(manifest.webapp.access, 'ANYONE_ANONYMOUS');
  assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
});
