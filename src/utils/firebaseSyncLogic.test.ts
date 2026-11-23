import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_DATABASE } from '../data/seedData';
import { normalizeDatabase } from './storage';
import {
  applyDailyUsageDelta,
  computeDailyQuotaSummary,
  decideCloudSyncAction,
  estimateFirestoreStorageUsage,
  FIRESTORE_SPARK_DAILY_DELETES,
  FIRESTORE_SPARK_DAILY_READS,
  FIRESTORE_SPARK_DAILY_WRITES,
  FIRESTORE_SPARK_STORAGE_BYTES,
  formatFirestoreErrorMessage,
  formatStorageBytes,
  getFirestoreUpgradeUrl,
  getFirestoreUsageUrl,
  getQuotaCooldownUntilMs,
  hasCandidateChanged,
  hasElectionSummaryChanged,
  hasVoterChanged,
  isFirestoreQuotaError,
  isQuotaCooldownActive,
} from './firebaseSyncLogic';

const SEED_TS = 1763276400000;

test('pushes local DB when cloud workspace does not exist yet', () => {
  assert.equal(decideCloudSyncAction(SEED_TS, SEED_TS, null), 'PUSH_LOCAL');
  assert.equal(decideCloudSyncAction(SEED_TS + 5000, SEED_TS, null), 'PUSH_LOCAL');
});

test('pulls from cloud when local state is fresh seed data and cloud has saved snapshot', () => {
  assert.equal(
    decideCloudSyncAction(SEED_TS, SEED_TS, { clientUpdatedAt: SEED_TS + 1000 }),
    'PULL_CLOUD'
  );
  assert.equal(
    decideCloudSyncAction(SEED_TS, SEED_TS, { clientUpdatedAt: SEED_TS - 10000 }),
    'PULL_CLOUD'
  );
});

test('pulls from cloud when cloud clientUpdatedAt is newer than local', () => {
  assert.equal(
    decideCloudSyncAction(SEED_TS + 2000, SEED_TS, { clientUpdatedAt: SEED_TS + 8000 }),
    'PULL_CLOUD'
  );
});

test('pushes local to cloud when local has newer changes than cloud', () => {
  assert.equal(
    decideCloudSyncAction(SEED_TS + 9000, SEED_TS, { clientUpdatedAt: SEED_TS + 5000 }),
    'PUSH_LOCAL'
  );
});

test('reports IN_SYNC when timestamps match', () => {
  assert.equal(
    decideCloudSyncAction(SEED_TS + 5000, SEED_TS, { clientUpdatedAt: SEED_TS + 5000 }),
    'IN_SYNC'
  );
});

test('isFirestoreQuotaError detects raw and JSON-wrapped resource-exhausted quota errors', () => {
  const rawErr = new Error(
    "FirebaseError: [code=resource-exhausted]: Quota limit exceeded. Cause - Quota exceeded for quota metric 'Free daily write units per project (free tier database)'"
  );
  assert.equal(isFirestoreQuotaError(rawErr), true);

  const wrappedErr = new Error(
    JSON.stringify({
      error: 'Quota limit exceeded. [code=resource-exhausted]',
      operationType: 'write',
      path: 'elections/osis_123/records',
    })
  );
  assert.equal(isFirestoreQuotaError(wrappedErr), true);
  assert.equal(isFirestoreQuotaError(new Error('Permission denied')), false);
  assert.match(formatFirestoreErrorMessage(wrappedErr), /Kuota harian gratis Cloud Firestore/i);
  assert.equal(
    getFirestoreUpgradeUrl('gen-lang-client-0680921408', 'ai-studio-db'),
    'https://console.firebase.google.com/project/gen-lang-client-0680921408/firestore/databases/ai-studio-db/data?openUpgradeDialog=true'
  );
  assert.equal(
    getFirestoreUsageUrl('gen-lang-client-0680921408', 'ai-studio-db'),
    'https://console.firebase.google.com/project/gen-lang-client-0680921408/firestore/databases/ai-studio-db/usage'
  );
});

test('delta comparison helpers skip unchanged voters, candidates, and election summaries', () => {
  const baseVoter = {
    nis: '2026001',
    name: 'ABDUL ROZAK',
    kelas: 'Guru',
    grade: 'X',
    hasVoted: false,
  };
  assert.equal(hasVoterChanged({ ...baseVoter }, baseVoter), false);
  assert.equal(
    hasVoterChanged({ ...baseVoter }, { ...baseVoter, hasVoted: true, votedCandidateId: 'paslon_1' }),
    true
  );

  const baseCand = {
    nomorUrut: 1,
    ketuaName: 'Ahmad',
    ketuaClass: 'XI A',
    wakilName: 'Budi',
    wakilClass: 'X B',
    photoUrl: '/img/1.jpg',
    vision: 'Visi 1',
    missions: ['Misi A', 'Misi B'],
    votes: 10,
    accentColor: '#1E3A5F',
  };
  assert.equal(hasCandidateChanged({ ...baseCand }, baseCand), false);
  assert.equal(hasCandidateChanged({ ...baseCand }, { ...baseCand, votes: 11 }), true);

  const baseSummary = {
    schoolName: 'SMA Negeri 1 Kabun',
    academicYear: '2026/2027',
    electionTitle: 'Pemilihan OSIS',
    isBoothOpen: true,
    hideLiveResults: false,
    totalDpt: 535,
    totalVoted: 10,
    totalValidVotes: 10,
    startTime: '2026-01-01T07:00',
    endTime: '2027-12-31T17:00',
    logoUrl: '/logo.jpg',
    themePresetId: 'navy',
    themePrimaryColor: '#0F1E3D',
    themeSecondaryColor: '#1E3A5F',
    themeAccentColor: '#F59E0B',
    themeSurfaceMode: 'light',
    voterLoginMode: 'NISN' as const,
    clientUpdatedAt: 123456,
    status: 'active',
  };
  assert.equal(hasElectionSummaryChanged({ ...baseSummary }, baseSummary), false);
  assert.equal(hasElectionSummaryChanged({ ...baseSummary }, { ...baseSummary, totalVoted: 11 }), true);
  assert.equal(
    hasElectionSummaryChanged({ ...baseSummary }, { ...baseSummary, voterLoginMode: 'QR_CODE' }),
    true
  );
});

test('getQuotaCooldownUntilMs targets next 08:00 UTC reset and isQuotaCooldownActive evaluates expiry', () => {
  const beforeReset = Date.UTC(2026, 10, 18, 1, 10, 0);
  const expectedSameDayReset = Date.UTC(2026, 10, 18, 8, 0, 0);
  assert.equal(getQuotaCooldownUntilMs(beforeReset), expectedSameDayReset);
  assert.equal(isQuotaCooldownActive(expectedSameDayReset, beforeReset), true);
  assert.equal(isQuotaCooldownActive(expectedSameDayReset, expectedSameDayReset + 1), false);

  const afterReset = Date.UTC(2026, 10, 18, 9, 0, 0);
  const expectedNextDayReset = Date.UTC(2026, 10, 19, 8, 0, 0);
  assert.equal(getQuotaCooldownUntilMs(afterReset), expectedNextDayReset);
});

test('estimateFirestoreStorageUsage and formatStorageBytes compute accurate used and remaining Spark storage', () => {
  assert.equal(formatStorageBytes(0), '0 B');
  assert.equal(formatStorageBytes(512), '512 B');
  assert.match(formatStorageBytes(2048), /2,0 KB/);
  assert.match(formatStorageBytes(FIRESTORE_SPARK_STORAGE_BYTES), /1,00 GiB/);

  const manyLogs = Array.from({ length: 140 }, (_, i) => ({
    id: `log_${i}`,
    timestamp: '2026-11-18T10:00:00.000Z',
    actorName: 'Admin',
    actorRole: 'SUPERADMIN' as const,
    action: 'TEST_ACTION',
    detail: `Detail log ${i}`,
  }));

  const dbWithManyLogs = {
    ...SEED_DATABASE,
    auditLogs: manyLogs,
  };

  const sheetLinks = [
    {
      id: 'sheet_1',
      spreadsheetId: '1AbCdEfG',
      spreadsheetTitle: 'Rekap OSIS 2026',
      sheetName: 'Rekap Hasil',
      purpose: 'results_export',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/1AbCdEfG/edit',
    },
  ];

  const estimate = estimateFirestoreStorageUsage({
    db: dbWithManyLogs,
    sheetLinks,
  });

  assert.equal(estimate.quotaBytes, FIRESTORE_SPARK_STORAGE_BYTES);
  assert.equal(estimate.usedBytes + estimate.remainingBytes, estimate.quotaBytes);
  assert.equal(
    estimate.usedBytes,
    estimate.breakdown.settingsBytes +
      estimate.breakdown.candidatesBytes +
      estimate.breakdown.votersBytes +
      estimate.breakdown.auditLogsBytes +
      estimate.breakdown.sheetLinksBytes
  );
  assert.equal(estimate.auditLogStoredCount, 100);
  assert.equal(estimate.sheetLinkCount, 1);
  assert.equal(
    estimate.documentCount,
    2 + SEED_DATABASE.candidates.length + SEED_DATABASE.voters.length + 100 + 1
  );
  assert.ok(estimate.usedBytes > 0);
  assert.ok(estimate.remainingBytes < FIRESTORE_SPARK_STORAGE_BYTES);
  assert.ok(Math.abs(estimate.usedPercentage + estimate.remainingPercentage - 100) < 1e-9);
});

test('SEED_DATABASE uses new 3D SMANSA logo and saved 535 DPT + 3 Paslon + QR_CODE as default data', () => {
  assert.equal(SEED_DATABASE.settings.logoUrl, '/assets/aistudio/LOGO_SMANSA_3D_d5e941c9.png');
  assert.equal(SEED_DATABASE.settings.voterLoginMode, 'QR_CODE');
  assert.equal(SEED_DATABASE.admins[0].whatsappNumber, '082288418531');
  assert.equal(SEED_DATABASE.voters.length, 535);
  assert.equal(SEED_DATABASE.candidates.length, 3);
  assert.equal(SEED_DATABASE.voters[0].nis, '2026001');
  assert.equal(SEED_DATABASE.candidates[0].ketuaName, 'Calon Ketua 1');
  assert.equal(SEED_DATABASE.candidates[2].ketuaName, 'Calon Ketua 3');

  const legacyNormalized = normalizeDatabase({
    ...SEED_DATABASE,
    settings: {
      ...SEED_DATABASE.settings,
      logoUrl: '/src/assets/images/school_osis_emblem_1794869431849.jpg',
    },
  });
  assert.equal(legacyNormalized.settings.logoUrl, '/assets/aistudio/LOGO_SMANSA_3D_d5e941c9.png');

  const customLogo = 'data:image/png;base64,CUSTOM_LOGO';
  const customNormalized = normalizeDatabase({
    ...SEED_DATABASE,
    settings: {
      ...SEED_DATABASE.settings,
      logoUrl: customLogo,
    },
  });
  assert.equal(customNormalized.settings.logoUrl, customLogo);
});

test('applyDailyUsageDelta and computeDailyQuotaSummary track Reads, Writes, and Deletes and auto-reset at 08:00 UTC', () => {
  const dayStartMs = Date.UTC(2026, 10, 18, 9, 0, 0);
  const first = applyDailyUsageDelta(null, { reads: 580, writes: 120, deletes: 5 }, dayStartMs);
  const second = applyDailyUsageDelta(first, { reads: 20, writes: 80, deletes: 15 }, dayStartMs + 60000);

  const summary = computeDailyQuotaSummary(second, false, dayStartMs + 120000);
  assert.equal(summary.reads.limit, FIRESTORE_SPARK_DAILY_READS);
  assert.equal(summary.writes.limit, FIRESTORE_SPARK_DAILY_WRITES);
  assert.equal(summary.deletes.limit, FIRESTORE_SPARK_DAILY_DELETES);

  assert.equal(summary.reads.used, 600);
  assert.equal(summary.reads.remaining, FIRESTORE_SPARK_DAILY_READS - 600);
  assert.equal(summary.writes.used, 200);
  assert.equal(summary.writes.remaining, FIRESTORE_SPARK_DAILY_WRITES - 200);
  assert.equal(summary.deletes.used, 20);
  assert.equal(summary.deletes.remaining, FIRESTORE_SPARK_DAILY_DELETES - 20);
  assert.equal(summary.quotaExceeded, false);

  // When current time crosses windowResetAtMs, usage automatically resets to 0
  const afterResetSummary = computeDailyQuotaSummary(second, false, second.windowResetAtMs + 1000);
  assert.equal(afterResetSummary.reads.used, 0);
  assert.equal(afterResetSummary.reads.remaining, FIRESTORE_SPARK_DAILY_READS);
  assert.equal(afterResetSummary.writes.used, 0);
  assert.equal(afterResetSummary.writes.remaining, FIRESTORE_SPARK_DAILY_WRITES);
  assert.equal(afterResetSummary.deletes.used, 0);
  assert.equal(afterResetSummary.deletes.remaining, FIRESTORE_SPARK_DAILY_DELETES);

  // Over-limit counts clamp remaining cleanly at 0
  const overLimit = applyDailyUsageDelta(
    null,
    { reads: 60000, writes: 25000, deletes: 21000 },
    dayStartMs
  );
  const overSummary = computeDailyQuotaSummary(overLimit, true, dayStartMs);
  assert.equal(overSummary.reads.remaining, 0);
  assert.equal(overSummary.writes.remaining, 0);
  assert.equal(overSummary.deletes.remaining, 0);
  assert.equal(overSummary.reads.usedPercentage, 100);
  assert.equal(overSummary.quotaExceeded, true);
});

test('chunkIntoBatches splits 999 CSV rows into 3 Firestore batches of max 450 docs each', async () => {
  const { FIRESTORE_CSV_BATCH_LIMIT, buildSummaryCounters, chunkIntoBatches } = await import(
    './firebaseSyncLogic'
  );

  assert.equal(FIRESTORE_CSV_BATCH_LIMIT, 450);

  const items999 = Array.from({ length: 999 }, (_, i) => ({ id: String(i + 1) }));
  const batches = chunkIntoBatches(items999);
  assert.equal(batches.length, 3);
  assert.equal(batches[0].length, 450);
  assert.equal(batches[1].length, 450);
  assert.equal(batches[2].length, 99);

  const itemsUnder450 = Array.from({ length: 120 }, (_, i) => ({ id: String(i + 1) }));
  const singleBatch = chunkIntoBatches(itemsUnder450);
  assert.equal(singleBatch.length, 1);
  assert.equal(singleBatch[0].length, 120);

  const counters = buildSummaryCounters(SEED_DATABASE.voters, SEED_DATABASE.candidates);
  assert.equal(counters.totalDpt, SEED_DATABASE.voters.length);
  assert.equal(counters.gradeTotals.DPTB, 37);
  assert.equal(
    counters.gradeTotals.X + counters.gradeTotals.XI + counters.gradeTotals.XII,
    498
  );
  assert.equal(
    counters.gradeTotals.X +
      counters.gradeTotals.XI +
      counters.gradeTotals.XII +
      counters.gradeTotals.DPTB,
    SEED_DATABASE.voters.length
  );
  assert.equal(
    Object.values(counters.candidateVotes).reduce((sum, n) => sum + n, 0),
    counters.totalValidVotes
  );
});

test('applyDailyUsageDelta records opLabel in lastOp and estimateFirestoreStorageUsage honors totalDptOverride', async () => {
  const { diffVotersWithSyncCache, diffAuditLogsWithSyncCache } = await import('./firebaseSyncLogic');
  const dayStartMs = Date.UTC(2026, 10, 18, 10, 0, 0);

  const afterLogin = applyDailyUsageDelta(null, { reads: 1 }, dayStartMs, 'Login Pemilih (1 getDoc)');
  assert.equal(afterLogin.lastOp?.label, 'Login Pemilih (1 getDoc)');
  assert.equal(afterLogin.lastOp?.reads, 1);
  assert.equal(afterLogin.lastOp?.writes, 0);

  const afterVote = applyDailyUsageDelta(
    afterLogin,
    { reads: 2, writes: 3 },
    dayStartMs + 5000,
    'Voting (runTransaction)'
  );
  const summary = computeDailyQuotaSummary(afterVote, false, dayStartMs + 6000);
  assert.equal(summary.reads.used, 3);
  assert.equal(summary.writes.used, 3);
  assert.equal(summary.lastOp?.label, 'Voting (runTransaction)');
  assert.equal(summary.lastOp?.reads, 2);
  assert.equal(summary.lastOp?.writes, 3);

  // Storage estimation scales accurately to 999 voters when only 20 are hydrated locally
  const limitedDb = {
    ...SEED_DATABASE,
    voters: SEED_DATABASE.voters.slice(0, 20),
  };
  const scaled = estimateFirestoreStorageUsage({
    db: limitedDb,
    totalDptOverride: 999,
  });
  assert.equal(scaled.voterCount, 999);
  assert.equal(
    scaled.documentCount,
    2 + limitedDb.candidates.length + 999 + Math.min(100, limitedDb.auditLogs.length)
  );

  // Zero-read diff skips unchanged voters and only writes/deletes differences
  const initialDiff = diffVotersWithSyncCache(
    limitedDb.voters.map((v) => ({ docId: v.nis, voter: v })),
    null
  );
  assert.equal(initialDiff.toWrite.length, 20);
  assert.equal(initialDiff.toDeleteIds.length, 0);

  const modifiedVoters = limitedDb.voters.map((v, idx) =>
    idx === 0 ? { ...v, hasVoted: true, votedCandidateId: 'paslon_1' } : v
  );
  const secondDiff = diffVotersWithSyncCache(
    modifiedVoters.slice(0, 19).map((v) => ({ docId: v.nis, voter: v })),
    initialDiff.nextHashes
  );
  assert.equal(secondDiff.toWrite.length, 1);
  assert.equal(secondDiff.toWrite[0].docId, limitedDb.voters[0].nis);
  assert.deepEqual(secondDiff.toDeleteIds, [limitedDb.voters[19].nis]);

  const logDiff = diffAuditLogsWithSyncCache(['log_2', 'log_3'], ['log_1', 'log_2']);
  assert.deepEqual(logDiff.toCreateIds, ['log_3']);
  assert.deepEqual(logDiff.toDeleteIds, ['log_1']);
});

