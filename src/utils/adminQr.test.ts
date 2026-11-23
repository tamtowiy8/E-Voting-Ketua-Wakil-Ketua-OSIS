import assert from 'node:assert/strict';
import test from 'node:test';
import { SEED_DATABASE } from '../data/seedData';
import type { AdminUser } from '../types/evoting';
import { buildAdminQrDownloadFilename, generateAdminQrDataUrl } from './adminQr';
import {
  encodeAdminQrPayload,
  encodeVoterQrPayload,
  ensureAdminQrTokens,
  generateAdminQrToken,
  parseAdminQrPayload,
  parseVoterQrPayload,
  validateAdminQrLogin,
  validateVoterQrLogin,
} from './electionLogic';
import { shouldResumePersistentCamera } from './qrScannerSession';

test('generateAdminQrToken and ensureAdminQrTokens backfill missing tokens without mutating existing tokens', () => {
  const token1 = generateAdminQrToken();
  const token2 = generateAdminQrToken();
  assert.ok(token1.length >= 12);
  assert.notEqual(token1, token2);

  const sampleAdmins: AdminUser[] = [
    {
      ...SEED_DATABASE.admins[0],
      qrToken: undefined,
    },
    {
      ...SEED_DATABASE.admins[1],
      qrToken: 'existing_valid_token_99',
    },
  ];

  const { admins: upgraded, changed } = ensureAdminQrTokens(sampleAdmins);
  assert.equal(changed, true);
  assert.ok(upgraded[0].qrToken && upgraded[0].qrToken.length >= 8);
  assert.equal(upgraded[1].qrToken, 'existing_valid_token_99');

  const secondPass = ensureAdminQrTokens(upgraded);
  assert.equal(secondPass.changed, false);
});

test('encodeAdminQrPayload, parseAdminQrPayload, and validateAdminQrLogin support SuperAdmin and Admin QR login while rejecting mismatched tokens', () => {
  const { admins } = ensureAdminQrTokens(SEED_DATABASE.admins);
  const superAdmin = admins.find((a) => a.role === 'SUPERADMIN')!;
  const panitiaAdmin = admins.find((a) => a.role === 'ADMIN')!;

  const superPayload = encodeAdminQrPayload(superAdmin);
  const adminPayload = encodeAdminQrPayload(panitiaAdmin);

  assert.deepEqual(parseAdminQrPayload(superPayload), {
    adminId: superAdmin.id,
    qrToken: superAdmin.qrToken!,
  });

  const superResult = validateAdminQrLogin(admins, superPayload);
  assert.equal(superResult.ok, true);
  if (superResult.ok) {
    assert.equal(superResult.admin.id, superAdmin.id);
    assert.equal(superResult.admin.role, 'SUPERADMIN');
  }

  const adminResult = validateAdminQrLogin(admins, adminPayload);
  assert.equal(adminResult.ok, true);
  if (adminResult.ok) {
    assert.equal(adminResult.admin.id, panitiaAdmin.id);
    assert.equal(adminResult.admin.role, 'ADMIN');
  }

  // Tampered or revoked token must fail
  const tampered = validateAdminQrLogin(admins, `OSIS-ADMIN:${superAdmin.id}:wrongtoken123`);
  assert.equal(tampered.ok, false);

  // Voter QR payload must be rejected by admin login
  const voterPayload = encodeVoterQrPayload(SEED_DATABASE.voters[0]);
  const voterOnAdmin = validateAdminQrLogin(admins, voterPayload);
  assert.equal(voterOnAdmin.ok, false);
});

test('voter QR parsing and validation reject admin QR payloads clearly', () => {
  const { admins } = ensureAdminQrTokens(SEED_DATABASE.admins);
  const adminPayload = encodeAdminQrPayload(admins[0]);

  assert.equal(parseVoterQrPayload(adminPayload), null);
  const voterCheck = validateVoterQrLogin(
    SEED_DATABASE.voters,
    adminPayload,
    SEED_DATABASE.settings
  );
  assert.equal(voterCheck.ok, false);
  if (!voterCheck.ok) {
    assert.match(voterCheck.error, /Login Admin/i);
  }
});

test('generateAdminQrDataUrl and buildAdminQrDownloadFilename generate valid PNG data URL and safe filenames', async () => {
  const { admins } = ensureAdminQrTokens(SEED_DATABASE.admins);
  const superAdmin = admins[0];

  const dataUrl = await generateAdminQrDataUrl(superAdmin);
  assert.ok(dataUrl.startsWith('data:image/png;base64,'));
  assert.ok(dataUrl.length > 200);

  const filename = buildAdminQrDownloadFilename(superAdmin);
  assert.equal(filename, `QR_Login_${superAdmin.role}_${superAdmin.username.toLowerCase()}.png`);
});

test('shouldResumePersistentCamera returns true only when desiredActive is true and camera permission is granted', () => {
  assert.equal(shouldResumePersistentCamera(true, 'granted'), true);
  assert.equal(shouldResumePersistentCamera(true, 'prompt'), false);
  assert.equal(shouldResumePersistentCamera(true, 'denied'), false);
  assert.equal(shouldResumePersistentCamera(false, 'granted'), false);
});
