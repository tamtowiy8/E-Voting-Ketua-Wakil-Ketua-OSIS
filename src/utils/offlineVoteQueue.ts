import type { DatabaseState, VoteReceipt, Voter } from '../types/evoting.ts';

export const OFFLINE_VOTE_QUEUE_KEY = 'osis_evoting_pending_votes_v1';
export const OFFLINE_QUEUE_CHANGE_EVENT = 'osis-evoting-offline-queue-change';

export interface PendingOfflineVote {
  id: string;
  voterId: string;
  voterSnapshot: Voter;
  candidateId: string;
  votedAt: string;
  receipt: VoteReceipt;
  syncedServer: boolean;
  syncedFirestore: boolean;
  attempts: number;
  createdAt: number;
  lastAttemptAt?: number;
  lastError?: string;
}

export function isOfflineOrNetworkFailure(error: unknown, isNavigatorOnline?: boolean): boolean {
  if (isNavigatorOnline === false) {
    return true;
  }
  const msg = (error instanceof Error ? error.message : String(error || '')).toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('offline') ||
    msg.includes('unavailable') ||
    msg.includes('deadline-exceeded') ||
    msg.includes('melebihi batas waktu') ||
    msg.includes('koneksi') ||
    msg.includes('jaringan') ||
    msg.includes('client is offline') ||
    msg.includes('err_internet_disconnected') ||
    msg.includes('timeout')
  );
}

export function createOfflineReceipt(voter: Pick<Voter, 'nis' | 'name' | 'kelas'>, nowIso: string): VoteReceipt {
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  const receiptCode = `OSIS-${new Date(nowIso).getFullYear()}-${randomSuffix}-${voter.nis.slice(-3)}`;
  return {
    receiptCode,
    voterName: voter.name,
    voterNis: voter.nis,
    voterClass: voter.kelas,
    timestamp: nowIso,
    offlinePending: true,
  };
}

export function normalizePendingOfflineVote(raw: unknown): PendingOfflineVote | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<PendingOfflineVote>;
  if (
    typeof item.id !== 'string' ||
    !item.id ||
    typeof item.voterId !== 'string' ||
    !item.voterId ||
    typeof item.candidateId !== 'string' ||
    !item.candidateId ||
    !item.voterSnapshot ||
    typeof item.voterSnapshot !== 'object' ||
    !item.receipt ||
    typeof item.receipt !== 'object'
  ) {
    return null;
  }
  return {
    id: item.id,
    voterId: item.voterId,
    voterSnapshot: item.voterSnapshot,
    candidateId: item.candidateId,
    votedAt: typeof item.votedAt === 'string' && item.votedAt ? item.votedAt : new Date().toISOString(),
    receipt: { ...item.receipt, offlinePending: true },
    syncedServer: Boolean(item.syncedServer),
    syncedFirestore: Boolean(item.syncedFirestore),
    attempts: typeof item.attempts === 'number' && Number.isFinite(item.attempts) ? item.attempts : 0,
    createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
    lastAttemptAt: typeof item.lastAttemptAt === 'number' ? item.lastAttemptAt : undefined,
    lastError: typeof item.lastError === 'string' ? item.lastError : undefined,
  };
}

export function enqueuePendingOfflineVote(
  queue: PendingOfflineVote[],
  entry: PendingOfflineVote
): PendingOfflineVote[] {
  const normalizedNis = entry.voterSnapshot.nis.trim().toLowerCase();
  const existsIdx = queue.findIndex(
    (item) =>
      item.voterId === entry.voterId ||
      (normalizedNis && item.voterSnapshot.nis.trim().toLowerCase() === normalizedNis)
  );
  if (existsIdx >= 0) {
    const existing = queue[existsIdx];
    const merged: PendingOfflineVote = {
      ...existing,
      syncedServer: existing.syncedServer && entry.syncedServer,
      syncedFirestore: existing.syncedFirestore && entry.syncedFirestore,
      lastError: entry.lastError ?? existing.lastError,
    };
    return queue.map((item, idx) => (idx === existsIdx ? merged : item));
  }
  return [...queue, entry];
}

export function isOfflineVoteCompleted(
  item: PendingOfflineVote,
  requireFirestoreSync: boolean,
  requireServerSync = true
): boolean {
  if (requireServerSync && !item.syncedServer) return false;
  if (requireFirestoreSync && !item.syncedFirestore) return false;
  return true;
}

export function hasVoterPendingOfflineVote(
  queue: PendingOfflineVote[],
  nisInput: string,
  voterId?: string
): boolean {
  const cleanedNis = nisInput.trim().toLowerCase();
  return queue.some((item) => {
    if (voterId && item.voterId === voterId) return true;
    return cleanedNis.length > 0 && item.voterSnapshot.nis.trim().toLowerCase() === cleanedNis;
  });
}

export function reconcilePendingVotesIntoDb(
  dbState: DatabaseState,
  queue: PendingOfflineVote[]
): DatabaseState {
  if (!queue || queue.length === 0) return dbState;

  let votersChanged = false;
  let candidatesChanged = false;
  const nextVoters = [...dbState.voters];
  const candidateIncrementMap = new Map<string, number>();

  for (const item of queue) {
    const normalizedNis = item.voterSnapshot.nis.trim().toLowerCase();
    const existingIdx = nextVoters.findIndex(
      (v) => v.id === item.voterId || (normalizedNis && v.nis.trim().toLowerCase() === normalizedNis)
    );

    if (existingIdx >= 0) {
      const existing = nextVoters[existingIdx];
      if (!existing.hasVoted) {
        nextVoters[existingIdx] = {
          ...existing,
          hasVoted: true,
          votedAt: item.votedAt,
          votedCandidateId: item.candidateId,
        };
        votersChanged = true;
        candidateIncrementMap.set(
          item.candidateId,
          (candidateIncrementMap.get(item.candidateId) || 0) + 1
        );
      }
    } else {
      nextVoters.push({
        ...item.voterSnapshot,
        hasVoted: true,
        votedAt: item.votedAt,
        votedCandidateId: item.candidateId,
      });
      votersChanged = true;
      candidateIncrementMap.set(
        item.candidateId,
        (candidateIncrementMap.get(item.candidateId) || 0) + 1
      );
    }
  }

  if (!votersChanged && candidateIncrementMap.size === 0) {
    return dbState;
  }

  const nextCandidates = dbState.candidates.map((cand) => {
    const delta = candidateIncrementMap.get(cand.id) || 0;
    if (delta > 0) {
      candidatesChanged = true;
      return { ...cand, votes: cand.votes + delta };
    }
    return cand;
  });

  if (!votersChanged && !candidatesChanged) {
    return dbState;
  }

  return {
    ...dbState,
    voters: votersChanged ? nextVoters : dbState.voters,
    candidates: candidatesChanged ? nextCandidates : dbState.candidates,
  };
}

export function loadPendingOfflineVotes(): PendingOfflineVote[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(OFFLINE_VOTE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizePendingOfflineVote(item))
      .filter((item): item is PendingOfflineVote => item !== null);
  } catch {
    return [];
  }
}

export function savePendingOfflineVotes(queue: PendingOfflineVote[]): PendingOfflineVote[] {
  const sanitized = queue
    .map((item) => normalizePendingOfflineVote(item))
    .filter((item): item is PendingOfflineVote => item !== null);

  if (typeof window !== 'undefined') {
    try {
      if (sanitized.length === 0) {
        window.localStorage.removeItem(OFFLINE_VOTE_QUEUE_KEY);
      } else {
        window.localStorage.setItem(OFFLINE_VOTE_QUEUE_KEY, JSON.stringify(sanitized));
      }
      window.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_CHANGE_EVENT, { detail: sanitized }));
    } catch {
      // Ignore storage write error
    }
  }
  return sanitized;
}

export function subscribeOfflineVoteQueue(
  onChange: (queue: PendingOfflineVote[]) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleStorage = (e: StorageEvent) => {
    if (e.key === OFFLINE_VOTE_QUEUE_KEY) {
      onChange(loadPendingOfflineVotes());
    }
  };

  const handleCustom = (e: Event) => {
    const custom = e as CustomEvent<PendingOfflineVote[]>;
    if (Array.isArray(custom.detail)) {
      onChange(custom.detail);
    } else {
      onChange(loadPendingOfflineVotes());
    }
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(OFFLINE_QUEUE_CHANGE_EVENT, handleCustom);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(OFFLINE_QUEUE_CHANGE_EVENT, handleCustom);
  };
}
