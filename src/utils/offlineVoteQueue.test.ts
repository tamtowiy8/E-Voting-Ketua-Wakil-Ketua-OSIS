import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOfflineReceipt,
  enqueuePendingOfflineVote,
  hasVoterPendingOfflineVote,
  isOfflineOrNetworkFailure,
  isOfflineVoteCompleted,
  reconcilePendingVotesIntoDb,
  type PendingOfflineVote,
} from './offlineVoteQueue';
import type { DatabaseState, Voter } from '../types/evoting';

function makeVoter(id: string, nis: string, hasVoted = false): Voter {
  return {
    id,
    nis,
    name: `Siswa ${nis}`,
    kelas: 'X A',
    grade: 'X',
    token: '123456',
    hasVoted,
  };
}

function makeDb(voters: Voter[], votesByCand: Record<string, number> = {}): DatabaseState {
  return {
    voters,
    candidates: [
      {
        id: 'paslon_1',
        nomorUrut: 1,
        ketuaName: 'Calon 1',
        ketuaClass: 'XI A',
        wakilName: 'Wakil 1',
        wakilClass: 'X A',
        photoUrl: '',
        vision: 'Visi 1',
        missions: ['Misi 1'],
        votes: votesByCand['paslon_1'] ?? 0,
        accentColor: '#059669',
      },
      {
        id: 'paslon_2',
        nomorUrut: 2,
        ketuaName: 'Calon 2',
        ketuaClass: 'XI B',
        wakilName: 'Wakil 2',
        wakilClass: 'X B',
        photoUrl: '',
        vision: 'Visi 2',
        missions: ['Misi 2'],
        votes: votesByCand['paslon_2'] ?? 0,
        accentColor: '#1E3A5F',
      },
    ],
    admins: [],
    auditLogs: [],
    settings: {
      schoolName: 'SMA Negeri 1',
      academicYear: '2026/2027',
      electionTitle: 'Pemilihan OSIS',
      logoUrl: '',
      isBoothOpen: true,
      startTime: '2026-01-01T00:00',
      endTime: '2026-12-31T23:59',
      hideLiveResults: false,
      voterLoginMode: 'QR_CODE',
    },
    lastUpdated: 1000,
  };
}

function makeQueueEntry(
  voter: Voter,
  candidateId: string,
  overrides: Partial<PendingOfflineVote> = {}
): PendingOfflineVote {
  const nowIso = '2026-11-21T10:00:00.000Z';
  return {
    id: `off_${voter.id}`,
    voterId: voter.id,
    voterSnapshot: voter,
    candidateId,
    votedAt: nowIso,
    receipt: createOfflineReceipt(voter, nowIso),
    syncedServer: false,
    syncedFirestore: false,
    attempts: 0,
    createdAt: 1000,
    ...overrides,
  };
}

test('enqueuePendingOfflineVote prevents duplicate voter entries by voterId or NIS', () => {
  const voter = makeVoter('v_1', '24001');
  const first = makeQueueEntry(voter, 'paslon_1');
  const duplicateByNis = makeQueueEntry({ ...voter, id: 'v_other' }, 'paslon_2');

  const q1 = enqueuePendingOfflineVote([], first);
  const q2 = enqueuePendingOfflineVote(q1, duplicateByNis);

  assert.equal(q2.length, 1);
  assert.equal(q2[0].candidateId, 'paslon_1');
});

test('hasVoterPendingOfflineVote matches by NIS (case-insensitive & trimmed) or voterId', () => {
  const voter = makeVoter('v_10', '24010');
  const queue = [makeQueueEntry(voter, 'paslon_1')];

  assert.equal(hasVoterPendingOfflineVote(queue, ' 24010 '), true);
  assert.equal(hasVoterPendingOfflineVote(queue, '99999', 'v_10'), true);
  assert.equal(hasVoterPendingOfflineVote(queue, '24011', 'v_11'), false);
});

test('isOfflineVoteCompleted checks server and optional Firestore completion cleanly', () => {
  const voter = makeVoter('v_1', '24001');
  const serverOnly = makeQueueEntry(voter, 'paslon_1', {
    syncedServer: true,
    syncedFirestore: false,
  });
  const firestoreOnlyStatic = makeQueueEntry(voter, 'paslon_1', {
    syncedServer: false,
    syncedFirestore: true,
  });
  const bothDone = makeQueueEntry(voter, 'paslon_1', {
    syncedServer: true,
    syncedFirestore: true,
  });

  assert.equal(isOfflineVoteCompleted(serverOnly, false), true);
  assert.equal(isOfflineVoteCompleted(serverOnly, true), false);
  assert.equal(isOfflineVoteCompleted(bothDone, true), true);
  // On static Netlify hosting (requireServerSync = false), completion only depends on Firestore
  assert.equal(isOfflineVoteCompleted(firestoreOnlyStatic, true, false), true);
  assert.equal(isOfflineVoteCompleted(serverOnly, true, false), false);
  assert.equal(isOfflineVoteCompleted(serverOnly, false, false), true);
});

test('reconcilePendingVotesIntoDb merges un-synced offline votes without double counting', () => {
  const v1 = makeVoter('v_1', '24001', false);
  const v2 = makeVoter('v_2', '24002', true);
  const v3 = makeVoter('v_3', '24003', false); // not in server db array (Case 1 hydration)

  // Server DB still shows v1 hasVoted=false and paslon_1 has 1 vote (from v2)
  const serverDb = makeDb([v1, v2], { paslon_1: 1, paslon_2: 0 });
  const queue = [
    makeQueueEntry(v1, 'paslon_1'),
    makeQueueEntry(v2, 'paslon_1'), // already voted in serverDb -> must NOT increment again!
    makeQueueEntry(v3, 'paslon_2'), // missing from serverDb -> appended and counted!
  ];

  const reconciled = reconcilePendingVotesIntoDb(serverDb, queue);

  assert.equal(reconciled.voters.find((v) => v.id === 'v_1')?.hasVoted, true);
  assert.equal(reconciled.voters.find((v) => v.id === 'v_1')?.votedCandidateId, 'paslon_1');
  assert.equal(reconciled.voters.find((v) => v.id === 'v_3')?.hasVoted, true);
  assert.equal(reconciled.candidates.find((c) => c.id === 'paslon_1')?.votes, 2);
  assert.equal(reconciled.candidates.find((c) => c.id === 'paslon_2')?.votes, 1);
});

test('isOfflineOrNetworkFailure detects offline/network failures without false-positives on vote conflict', () => {
  assert.equal(isOfflineOrNetworkFailure(new Error('Anything'), false), true);
  assert.equal(isOfflineOrNetworkFailure(new Error('TypeError: Failed to fetch'), true), true);
  assert.equal(
    isOfflineOrNetworkFailure(new Error('FirebaseError: [code=unavailable]: client is offline'), true),
    true
  );
  assert.equal(
    isOfflineOrNetworkFailure(
      new Error('Anda sudah menggunakan hak suara. Setiap pemilih hanya dapat memilih satu kali.'),
      true
    ),
    false
  );
});
