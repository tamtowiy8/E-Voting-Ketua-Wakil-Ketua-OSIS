import type { DatabaseState, ThemeSurface, Voter, VoterLoginMode } from '../types/evoting.ts';
import { isAdditionalVoter, type SummaryStatsOverride } from './electionLogic.ts';
import { buildSummaryCounters, type GradeSummaryBucket } from './firebaseSyncLogic.ts';
import type { PendingOfflineVote } from './offlineVoteQueue.ts';
import { DEFAULT_THEME } from './theme.ts';

export interface CloudSummaryLike extends SummaryStatsOverride {
  id?: string;
  ownerId?: string;
  schoolName?: string;
  academicYear?: string;
  electionTitle?: string;
  isBoothOpen?: boolean;
  hideLiveResults?: boolean;
  startTime?: string;
  endTime?: string;
  logoUrl?: string;
  themePresetId?: string;
  themePrimaryColor?: string;
  themeSecondaryColor?: string;
  themeAccentColor?: string;
  themeSurfaceMode?: ThemeSurface;
  voterLoginMode?: VoterLoginMode;
  clientUpdatedAt: number;
  status?: 'draft' | 'active' | 'closed';
  isLocalOptimistic?: boolean;
}

export interface OptimisticCloudSummary extends CloudSummaryLike {
  id: string;
  ownerId: string;
  schoolName: string;
  academicYear: string;
  electionTitle: string;
  isBoothOpen: boolean;
  hideLiveResults: boolean;
  totalDpt: number;
  totalVoted: number;
  totalValidVotes: number;
  startTime: string;
  endTime: string;
  logoUrl: string;
  themePresetId: string;
  themePrimaryColor: string;
  themeSecondaryColor: string;
  themeAccentColor: string;
  themeSurfaceMode: ThemeSurface;
  voterLoginMode: VoterLoginMode;
  candidateVotes: Record<string, number>;
  gradeTotals: Record<string, number>;
  gradeVoted: Record<string, number>;
  clientUpdatedAt: number;
  status: 'draft' | 'active' | 'closed';
  isLocalOptimistic: boolean;
}

export interface EffectiveSummaryInput {
  db: Pick<DatabaseState, 'voters' | 'candidates' | 'lastUpdated'>;
  cloudSummary: CloudSummaryLike | null | undefined;
  autoSyncEnabled: boolean;
  quotaExceeded: boolean;
  pendingOfflineVotes?: PendingOfflineVote[];
  seedTimestamp: number;
}

function getVoterGradeBucket(voter: Pick<Voter, 'kelas' | 'grade'>): GradeSummaryBucket {
  if (isAdditionalVoter(voter)) return 'DPTB';
  if (voter.grade === 'XII') return 'XII';
  if (voter.grade === 'XI') return 'XI';
  return 'X';
}

/**
 * Resolves whether `cloudSummary` should be passed to `computeStatistics`,
 * ensuring stale/quota-paused/older cloud summaries NEVER override newer local
 * resets, edits, or votes across LoginPortal, LiveMonitor, AdminPanel, and PDF.
 */
export function resolveEffectiveSummaryOverride(
  input: EffectiveSummaryInput
): SummaryStatsOverride | null {
  const {
    db,
    cloudSummary,
    autoSyncEnabled,
    quotaExceeded,
    pendingOfflineVotes = [],
    seedTimestamp,
  } = input;

  if (!autoSyncEnabled || quotaExceeded || !cloudSummary) {
    return null;
  }

  if (typeof cloudSummary.totalDpt !== 'number' || !Number.isFinite(cloudSummary.totalDpt)) {
    return null;
  }

  const cloudTs =
    typeof cloudSummary.clientUpdatedAt === 'number' && Number.isFinite(cloudSummary.clientUpdatedAt)
      ? cloudSummary.clientUpdatedAt
      : 0;

  if (db.lastUpdated !== seedTimestamp) {
    if (cloudTs <= 0 || cloudTs < db.lastUpdated) {
      return null;
    }
  }

  const baseCandidateVotes: Record<string, number> = {
    ...(cloudSummary.candidateVotes || {}),
  };
  const baseGradeTotals: Record<string, number> = {
    ...(cloudSummary.gradeTotals || {}),
  };
  const baseGradeVoted: Record<string, number> = {
    ...(cloudSummary.gradeVoted || {}),
  };

  const candidateVotesSum = Object.values(baseCandidateVotes).reduce(
    (sum, v) => sum + (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0),
    0
  );
  const localCandidatesSum = db.candidates.reduce(
    (sum, c) => sum + (Number.isFinite(c.votes) && c.votes > 0 ? Math.round(c.votes) : 0),
    0
  );
  const hasCandidateMap = Object.keys(baseCandidateVotes).length > 0;
  const effectiveMapOrLocalVotesSum = hasCandidateMap ? candidateVotesSum : localCandidatesSum;

  const parsedTotalValidVotes =
    typeof cloudSummary.totalValidVotes === 'number' &&
    Number.isFinite(cloudSummary.totalValidVotes)
      ? Math.max(0, Math.round(cloudSummary.totalValidVotes))
      : effectiveMapOrLocalVotesSum;

  let totalValidVotes = Math.max(parsedTotalValidVotes, effectiveMapOrLocalVotesSum);
  let totalVoted = Math.max(0, Math.round(cloudSummary.totalVoted || 0), totalValidVotes);

  // Only add un-synced offline votes when summary comes from Firestore (not already built from local db)
  if (!cloudSummary.isLocalOptimistic && pendingOfflineVotes.length > 0) {
    const unsynced = pendingOfflineVotes.filter((item) => !item.syncedFirestore);
    for (const item of unsynced) {
      totalVoted += 1;
      totalValidVotes += 1;
      if (item.candidateId) {
        baseCandidateVotes[item.candidateId] = (baseCandidateVotes[item.candidateId] || 0) + 1;
      }
      const bucket = getVoterGradeBucket(item.voterSnapshot);
      baseGradeVoted[bucket] = (baseGradeVoted[bucket] || 0) + 1;
    }
  }

  totalVoted = Math.max(totalVoted, totalValidVotes);

  return {
    totalDpt: Math.max(0, Math.round(cloudSummary.totalDpt), totalVoted),
    totalVoted,
    totalValidVotes,
    candidateVotes: baseCandidateVotes,
    gradeTotals: baseGradeTotals,
    gradeVoted: baseGradeVoted,
  };
}

export function buildOptimisticCloudSummary(
  db: DatabaseState,
  ownerId = 'local_owner'
): OptimisticCloudSummary {
  const counters = buildSummaryCounters(db.voters, db.candidates);
  const theme = db.settings.theme || DEFAULT_THEME;
  return {
    id: `osis_${ownerId}`,
    ownerId,
    schoolName: db.settings.schoolName,
    academicYear: db.settings.academicYear,
    electionTitle: db.settings.electionTitle,
    isBoothOpen: Boolean(db.settings.isBoothOpen),
    hideLiveResults: Boolean(db.settings.hideLiveResults),
    totalDpt: counters.totalDpt,
    totalVoted: counters.totalVoted,
    totalValidVotes: counters.totalValidVotes,
    startTime: db.settings.startTime,
    endTime: db.settings.endTime,
    logoUrl: db.settings.logoUrl,
    themePresetId: theme.presetId,
    themePrimaryColor: theme.primaryColor,
    themeSecondaryColor: theme.secondaryColor,
    themeAccentColor: theme.accentColor,
    themeSurfaceMode: theme.surfaceMode,
    voterLoginMode: db.settings.voterLoginMode || 'NISN',
    candidateVotes: counters.candidateVotes,
    gradeTotals: counters.gradeTotals,
    gradeVoted: counters.gradeVoted,
    clientUpdatedAt: db.lastUpdated || Date.now(),
    status: db.settings.isBoothOpen ? 'active' : 'draft',
    isLocalOptimistic: true,
  };
}

export function applyVoteDeltaToCloudSummary<T extends CloudSummaryLike>(
  prev: T | null | undefined,
  voter: Pick<Voter, 'kelas' | 'grade'>,
  candidateId: string,
  clientUpdatedAt: number
): T | null {
  if (!prev) return null;
  const bucket = getVoterGradeBucket(voter);
  const nextCandidateVotes = { ...(prev.candidateVotes || {}) };
  nextCandidateVotes[candidateId] = (nextCandidateVotes[candidateId] || 0) + 1;

  const nextGradeVoted = { ...(prev.gradeVoted || {}) };
  nextGradeVoted[bucket] = (nextGradeVoted[bucket] || 0) + 1;

  const prevValid =
    typeof prev.totalValidVotes === 'number' && Number.isFinite(prev.totalValidVotes)
      ? prev.totalValidVotes
      : Object.values(prev.candidateVotes || {}).reduce((s, n) => s + (Number(n) || 0), 0);

  return {
    ...prev,
    totalVoted: Math.max(0, Math.round(prev.totalVoted || 0)) + 1,
    totalValidVotes: Math.max(0, Math.round(prevValid)) + 1,
    candidateVotes: nextCandidateVotes,
    gradeVoted: nextGradeVoted,
    clientUpdatedAt,
    isLocalOptimistic: true,
  };
}

export type GasSyncAction = 'PULL_REMOTE' | 'PUSH_LOCAL' | 'IN_SYNC';

export function resolveGasSyncAction(params: {
  localLastUpdated: number;
  remoteLastUpdated: number | undefined | null;
  seedTimestamp: number;
}): GasSyncAction {
  const { localLastUpdated, remoteLastUpdated, seedTimestamp } = params;
  const remoteTs =
    typeof remoteLastUpdated === 'number' && Number.isFinite(remoteLastUpdated)
      ? remoteLastUpdated
      : 0;

  if (localLastUpdated === seedTimestamp) {
    if (remoteTs > seedTimestamp) {
      return 'PULL_REMOTE';
    }
    return 'IN_SYNC';
  }

  if (remoteTs <= 0 || remoteTs === seedTimestamp) {
    return 'PUSH_LOCAL';
  }

  if (remoteTs > localLastUpdated) {
    return 'PULL_REMOTE';
  }

  if (localLastUpdated > remoteTs) {
    return 'PUSH_LOCAL';
  }

  return 'IN_SYNC';
}

export function shouldAcceptServerState(params: {
  localLastUpdated: number;
  incomingLastUpdated: number | undefined;
  incomingVersion: number | undefined;
  lastAppliedVersion: number;
  seedTimestamp: number;
  localMutationInFlight: boolean;
}): boolean {
  const {
    localLastUpdated,
    incomingLastUpdated,
    incomingVersion,
    lastAppliedVersion,
    seedTimestamp,
    localMutationInFlight,
  } = params;

  if (localMutationInFlight) {
    return false;
  }

  if (
    typeof incomingVersion === 'number' &&
    incomingVersion > 0 &&
    lastAppliedVersion > 0 &&
    incomingVersion <= lastAppliedVersion
  ) {
    return false;
  }

  const remoteTs =
    typeof incomingLastUpdated === 'number' && Number.isFinite(incomingLastUpdated)
      ? incomingLastUpdated
      : 0;

  if (localLastUpdated !== seedTimestamp && remoteTs > 0 && remoteTs < localLastUpdated) {
    return false;
  }

  return true;
}

export function mergeSummaryIntoDb(
  current: DatabaseState,
  summary: CloudSummaryLike,
  pendingVotes: PendingOfflineVote[] = [],
  resolveThemeFn: (raw?: DatabaseState['settings']['theme']) => NonNullable<DatabaseState['settings']['theme']>
): DatabaseState {
  const baseTheme = current.settings.theme || DEFAULT_THEME;
  const resolvedTheme = resolveThemeFn({
    presetId: summary.themePresetId || baseTheme.presetId || DEFAULT_THEME.presetId,
    primaryColor:
      summary.themePrimaryColor || baseTheme.primaryColor || DEFAULT_THEME.primaryColor,
    secondaryColor:
      summary.themeSecondaryColor || baseTheme.secondaryColor || DEFAULT_THEME.secondaryColor,
    accentColor:
      summary.themeAccentColor || baseTheme.accentColor || DEFAULT_THEME.accentColor,
    surfaceMode:
      summary.themeSurfaceMode || baseTheme.surfaceMode || DEFAULT_THEME.surfaceMode,
  });

  const pendingFirestoreDelta = new Map<string, number>();
  for (const item of pendingVotes) {
    if (!item.syncedFirestore) {
      pendingFirestoreDelta.set(
        item.candidateId,
        (pendingFirestoreDelta.get(item.candidateId) || 0) + 1
      );
    }
  }

  const summaryCandidateVotesSum = Object.values(summary.candidateVotes || {}).reduce(
    (sum, v) => sum + (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0),
    0
  );
  const isCloudReset =
    (summary.totalVoted ?? 0) === 0 &&
    (summary.totalValidVotes ?? 0) === 0 &&
    summaryCandidateVotesSum === 0;

  const nextVoters = isCloudReset
    ? current.voters.map((v) =>
        v.hasVoted || v.votedAt || v.votedCandidateId
          ? { ...v, hasVoted: false, votedAt: undefined, votedCandidateId: undefined }
          : v
      )
    : current.voters;

  const nextCandidates = summary.candidateVotes
    ? current.candidates.map((c) => {
        const cloudVotes = isCloudReset
          ? 0
          : typeof summary.candidateVotes?.[c.id] === 'number'
            ? summary.candidateVotes[c.id]
            : c.votes;
        return {
          ...c,
          votes: cloudVotes + (pendingFirestoreDelta.get(c.id) || 0),
        };
      })
    : isCloudReset
      ? current.candidates.map((c) => ({
          ...c,
          votes: pendingFirestoreDelta.get(c.id) || 0,
        }))
      : current.candidates;

  return {
    ...current,
    voters: nextVoters,
    settings: {
      ...current.settings,
      schoolName: summary.schoolName || current.settings.schoolName,
      academicYear: summary.academicYear || current.settings.academicYear,
      electionTitle: summary.electionTitle || current.settings.electionTitle,
      logoUrl: summary.logoUrl || current.settings.logoUrl,
      startTime: summary.startTime || current.settings.startTime,
      endTime: summary.endTime || current.settings.endTime,
      isBoothOpen: Boolean(summary.isBoothOpen),
      hideLiveResults: Boolean(summary.hideLiveResults),
      voterLoginMode:
        summary.voterLoginMode === 'QR_CODE' ||
        summary.voterLoginMode === 'BOTH' ||
        summary.voterLoginMode === 'NISN'
          ? summary.voterLoginMode
          : current.settings.voterLoginMode || 'NISN',
      theme: resolvedTheme,
    },
    candidates: nextCandidates,
    lastUpdated:
      typeof summary.clientUpdatedAt === 'number' && summary.clientUpdatedAt > 0
        ? summary.clientUpdatedAt
        : current.lastUpdated,
  };
}
