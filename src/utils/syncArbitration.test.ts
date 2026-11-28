import assert from 'node:assert/strict';
import test from 'node:test';
import { SEED_DATABASE, SEED_TIMESTAMP } from '../data/seedData';
import {
  castVoteInState,
  computeStatistics,
  resetElectionData,
} from './electionLogic';
import {
  applyVoteDeltaToCloudSummary,
  buildOptimisticCloudSummary,
  mergeSummaryIntoDb,
  resolveEffectiveSummaryOverride,
  resolveGasSyncAction,
  shouldAcceptServerState,
  type CloudSummaryLike,
} from './syncArbitration';
import { resolveTheme } from './theme';
import type { PendingOfflineVote } from './offlineVoteQueue';

function createDbWithVotes(voteCount: number, timestamp = SEED_TIMESTAMP + 50000) {
  let state = structuredClone(SEED_DATABASE);
  for (let i = 0; i < voteCount; i++) {
    const voter = state.voters[i];
    const cand = state.candidates[i % state.candidates.length];
    state = castVoteInState(state, voter.id, cand.id).nextState;
  }
  return { ...state, lastUpdated: timestamp };
}

test('resolveEffectiveSummaryOverride ignores stale cloudSummary (e.g. 3 votes) after local reset', () => {
  const admin = SEED_DATABASE.admins[0];
  const dbWith3Votes = createDbWithVotes(3, 1795800000000);
  const staleCloudSummary: CloudSummaryLike = {
    ...buildOptimisticCloudSummary(dbWith3Votes, 'uid_1'),
    isLocalOptimistic: false,
  };

  // User resets election locally -> local lastUpdated is newer than staleCloudSummary.clientUpdatedAt
  const resetDb = {
    ...resetElectionData(dbWith3Votes, admin),
    lastUpdated: 1795800005000,
  };

  const override = resolveEffectiveSummaryOverride({
    db: resetDb,
    cloudSummary: staleCloudSummary,
    autoSyncEnabled: true,
    quotaExceeded: false,
    pendingOfflineVotes: [],
    seedTimestamp: SEED_TIMESTAMP,
  });

  assert.equal(override, null);
  const stats = computeStatistics(resetDb.voters, resetDb.candidates, override);
  assert.equal(stats.totalVoted, 0);
  assert.equal(stats.totalValidVotes, 0);
});

test('resolveEffectiveSummaryOverride ignores cloudSummary when quotaExceeded or autoSyncEnabled=false', () => {
  const dbWith3Votes = createDbWithVotes(3, 1795800000000);
  const staleCloudSummary: CloudSummaryLike = {
    ...buildOptimisticCloudSummary(dbWith3Votes, 'uid_1'),
    isLocalOptimistic: false,
  };
  const emptyDb = {
    ...SEED_DATABASE,
    lastUpdated: SEED_TIMESTAMP,
  };

  assert.equal(
    resolveEffectiveSummaryOverride({
      db: emptyDb,
      cloudSummary: staleCloudSummary,
      autoSyncEnabled: true,
      quotaExceeded: true,
      pendingOfflineVotes: [],
      seedTimestamp: SEED_TIMESTAMP,
    }),
    null
  );

  assert.equal(
    resolveEffectiveSummaryOverride({
      db: emptyDb,
      cloudSummary: staleCloudSummary,
      autoSyncEnabled: false,
      quotaExceeded: false,
      pendingOfflineVotes: [],
      seedTimestamp: SEED_TIMESTAMP,
    }),
    null
  );
});

test('resolveEffectiveSummaryOverride reconciles unsynced offline votes cleanly without double counting', () => {
  const dbWith2Votes = createDbWithVotes(2, 1795800000000);
  const firestoreSummary: CloudSummaryLike = {
    ...buildOptimisticCloudSummary(dbWith2Votes, 'uid_1'),
    isLocalOptimistic: false,
  };

  const pendingVoter = dbWith2Votes.voters[10];
  const pendingTargetCand = dbWith2Votes.candidates[0];
  const pendingQueue: PendingOfflineVote[] = [
    {
      id: 'off_1',
      voterId: pendingVoter.id,
      voterSnapshot: pendingVoter,
      candidateId: pendingTargetCand.id,
      votedAt: '2026-11-27T10:00:00.000Z',
      receipt: {
        receiptCode: 'OSIS-2026-TEST',
        voterName: pendingVoter.name,
        voterNis: pendingVoter.nis,
        voterClass: pendingVoter.kelas,
        timestamp: '2026-11-27T10:00:00.000Z',
        offlinePending: true,
      },
      syncedServer: true,
      syncedFirestore: false,
      attempts: 0,
      createdAt: 1795800000500,
    },
  ];

  const effective = resolveEffectiveSummaryOverride({
    db: { ...SEED_DATABASE, lastUpdated: SEED_TIMESTAMP },
    cloudSummary: firestoreSummary,
    autoSyncEnabled: true,
    quotaExceeded: false,
    pendingOfflineVotes: pendingQueue,
    seedTimestamp: SEED_TIMESTAMP,
  });

  assert.ok(effective);
  assert.equal(effective.totalVoted, 3);
  assert.equal(effective.totalValidVotes, 3);

  // Optimistic local summary already includes pending offline votes -> should NOT double count
  const optimistic = buildOptimisticCloudSummary(createDbWithVotes(3, 1795800001000), 'uid_1');
  const effectiveOptimistic = resolveEffectiveSummaryOverride({
    db: { ...SEED_DATABASE, lastUpdated: 1795800001000 },
    cloudSummary: optimistic,
    autoSyncEnabled: true,
    quotaExceeded: false,
    pendingOfflineVotes: pendingQueue,
    seedTimestamp: SEED_TIMESTAMP,
  });
  assert.ok(effectiveOptimistic);
  assert.equal(effectiveOptimistic.totalVoted, 3);
});

test('mergeSummaryIntoDb clears local voters hasVoted flags when cloud summary resets to 0', () => {
  const local3Votes = createDbWithVotes(3, 1795800000000);
  const resetCloudSummary: CloudSummaryLike = {
    ...buildOptimisticCloudSummary(
      resetElectionData(local3Votes, local3Votes.admins[0]),
      'uid_1'
    ),
    clientUpdatedAt: 1795800010000,
    isLocalOptimistic: false,
  };

  const merged = mergeSummaryIntoDb(local3Votes, resetCloudSummary, [], resolveTheme);
  assert.equal(merged.voters.filter((v) => v.hasVoted).length, 0);
  assert.equal(
    merged.candidates.reduce((sum, c) => sum + c.votes, 0),
    0
  );
  assert.equal(merged.lastUpdated, 1795800010000);
});

test('applyVoteDeltaToCloudSummary increments totalVoted, totalValidVotes, candidateVotes, and gradeVoted', () => {
  const baseSummary = buildOptimisticCloudSummary(SEED_DATABASE, 'uid_1');
  const voter = SEED_DATABASE.voters[0];
  const cand = SEED_DATABASE.candidates[0];
  const updated = applyVoteDeltaToCloudSummary(baseSummary, voter, cand.id, 1795800020000);

  assert.ok(updated);
  assert.equal(updated.totalVoted, 1);
  assert.equal(updated.totalValidVotes, 1);
  assert.equal(updated.candidateVotes?.[cand.id], 1);
  assert.equal(updated.clientUpdatedAt, 1795800020000);
});

test('resolveGasSyncAction pulls newer remote on seed/older local and pushes newer local reset/vote', () => {
  // Fresh client (SEED_TIMESTAMP) + live GAS spreadsheet with newer votes -> PULL_REMOTE
  assert.equal(
    resolveGasSyncAction({
      localLastUpdated: SEED_TIMESTAMP,
      remoteLastUpdated: 1795509116502,
      seedTimestamp: SEED_TIMESTAMP,
    }),
    'PULL_REMOTE'
  );

  // Fresh client + empty/seed GAS -> IN_SYNC (never overwrite spreadsheet with seed)
  assert.equal(
    resolveGasSyncAction({
      localLastUpdated: SEED_TIMESTAMP,
      remoteLastUpdated: SEED_TIMESTAMP,
      seedTimestamp: SEED_TIMESTAMP,
    }),
    'IN_SYNC'
  );

  // Local reset is newer than remote GAS -> PUSH_LOCAL (never revert reset back to old votes!)
  assert.equal(
    resolveGasSyncAction({
      localLastUpdated: 1795819800000,
      remoteLastUpdated: 1795509116502,
      seedTimestamp: SEED_TIMESTAMP,
    }),
    'PUSH_LOCAL'
  );

  // Remote GAS is newer than local -> PULL_REMOTE
  assert.equal(
    resolveGasSyncAction({
      localLastUpdated: 1795509116502,
      remoteLastUpdated: 1795819800000,
      seedTimestamp: SEED_TIMESTAMP,
    }),
    'PULL_REMOTE'
  );
});

test('shouldAcceptServerState rejects stale server polls during in-flight reset or older timestamps', () => {
  assert.equal(
    shouldAcceptServerState({
      localLastUpdated: 1795819800000,
      incomingLastUpdated: 1795509116502,
      incomingVersion: 5,
      lastAppliedVersion: 4,
      seedTimestamp: SEED_TIMESTAMP,
      localMutationInFlight: false,
    }),
    false
  );

  assert.equal(
    shouldAcceptServerState({
      localLastUpdated: 1795819800000,
      incomingLastUpdated: 1795819805000,
      incomingVersion: 6,
      lastAppliedVersion: 4,
      seedTimestamp: SEED_TIMESTAMP,
      localMutationInFlight: true,
    }),
    false
  );

  assert.equal(
    shouldAcceptServerState({
      localLastUpdated: SEED_TIMESTAMP,
      incomingLastUpdated: 1795819805000,
      incomingVersion: 6,
      lastAppliedVersion: 0,
      seedTimestamp: SEED_TIMESTAMP,
      localMutationInFlight: false,
    }),
    true
  );
});

test('resolveEffectiveSummaryOverride reconciles totalVoted when cloudSummary.totalVoted is 0 but candidateVotes has real votes', () => {
  const [c1, c2, c3] = SEED_DATABASE.candidates;
  const staleCounterSummary: CloudSummaryLike = {
    totalDpt: 535,
    totalVoted: 0,
    totalValidVotes: 0,
    candidateVotes: { [c1.id]: 40, [c2.id]: 137, [c3.id]: 304 },
    clientUpdatedAt: SEED_TIMESTAMP + 5000,
    isLocalOptimistic: false,
  };

  const resolved = resolveEffectiveSummaryOverride({
    db: { ...SEED_DATABASE, lastUpdated: SEED_TIMESTAMP },
    cloudSummary: staleCounterSummary,
    autoSyncEnabled: true,
    quotaExceeded: false,
    pendingOfflineVotes: [],
    seedTimestamp: SEED_TIMESTAMP,
  });

  assert.ok(resolved);
  assert.equal(resolved.totalValidVotes, 481);
  assert.equal(resolved.totalVoted, 481);

  const stats = computeStatistics(SEED_DATABASE.voters, SEED_DATABASE.candidates, resolved);
  assert.equal(stats.totalVoted, 481);
  assert.equal(stats.totalValidVotes, 481);
  assert.equal(stats.totalNotVoted, 54);

  // mergeSummaryIntoDb must NOT clear votes/voters if candidateVotes still has votes
  const local3Votes = createDbWithVotes(3, 1795800000000);
  const merged = mergeSummaryIntoDb(local3Votes, staleCounterSummary, [], resolveTheme);
  assert.equal(merged.candidates.reduce((s, c) => s + c.votes, 0), 481);
  assert.equal(merged.voters.filter((v) => v.hasVoted).length, 3);
});

