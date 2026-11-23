import type { Candidate, DatabaseState, GradeLevel, Voter, VoterLoginMode } from '../types/evoting';
import { isAdditionalVoter } from './electionLogic';

export type CloudSyncDecision = 'PULL_CLOUD' | 'PUSH_LOCAL' | 'IN_SYNC';

export const FIRESTORE_PRICING_URL = 'https://firebase.google.com/pricing#cloud-firestore';
export const QUOTA_COOLDOWN_STORAGE_KEY = 'osis_evoting_firestore_quota_until_v1';
export const DAILY_QUOTA_USAGE_STORAGE_KEY = 'osis_evoting_firestore_daily_usage_v1';
export const DAILY_QUOTA_UPDATE_EVENT = 'osis-firestore-quota-usage-update';
export const FIRESTORE_SPARK_STORAGE_BYTES = 1024 * 1024 * 1024; // 1 GiB Cloud Firestore Spark free tier limit
export const FIRESTORE_DOC_OVERHEAD_BYTES = 64;
export const FIRESTORE_SPARK_DAILY_READS = 50000;
export const FIRESTORE_SPARK_DAILY_WRITES = 20000;
export const FIRESTORE_SPARK_DAILY_DELETES = 20000;
export const FIRESTORE_CSV_BATCH_LIMIT = 450;

export function chunkIntoBatches<T>(
  items: T[],
  batchSize = FIRESTORE_CSV_BATCH_LIMIT
): T[][] {
  const safeSize = Math.max(1, Math.min(450, Math.floor(batchSize)));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) {
    chunks.push(items.slice(i, i + safeSize));
  }
  return chunks;
}

export type GradeSummaryBucket = GradeLevel | 'DPTB';

export interface ElectionSummaryCounters {
  totalDpt: number;
  totalVoted: number;
  totalValidVotes: number;
  candidateVotes: Record<string, number>;
  gradeTotals: Record<GradeSummaryBucket, number>;
  gradeVoted: Record<GradeSummaryBucket, number>;
}

export function buildSummaryCounters(
  voters: Voter[],
  candidates: Candidate[]
): ElectionSummaryCounters {
  const candidateVotes: Record<string, number> = {};
  let totalValidVotes = 0;
  for (const c of candidates) {
    const safeVotes = Number.isFinite(c.votes) && c.votes > 0 ? Math.round(c.votes) : 0;
    candidateVotes[c.id] = safeVotes;
    totalValidVotes += safeVotes;
  }

  const gradeTotals: Record<GradeSummaryBucket, number> = { X: 0, XI: 0, XII: 0, DPTB: 0 };
  const gradeVoted: Record<GradeSummaryBucket, number> = { X: 0, XI: 0, XII: 0, DPTB: 0 };
  let totalVoted = 0;

  for (const v of voters) {
    const bucket: GradeSummaryBucket = isAdditionalVoter(v)
      ? 'DPTB'
      : v.grade === 'XII'
        ? 'XII'
        : v.grade === 'XI'
          ? 'XI'
          : 'X';
    gradeTotals[bucket] += 1;
    if (v.hasVoted) {
      totalVoted += 1;
      gradeVoted[bucket] += 1;
    }
  }

  return {
    totalDpt: voters.length,
    totalVoted,
    totalValidVotes,
    candidateVotes,
    gradeTotals,
    gradeVoted,
  };
}

export function getFirestoreUpgradeUrl(projectId: string, databaseId: string): string {
  const safeProject = encodeURIComponent(projectId.trim());
  const safeDb = encodeURIComponent(databaseId.trim());
  return `https://console.firebase.google.com/project/${safeProject}/firestore/databases/${safeDb}/data?openUpgradeDialog=true`;
}

export function getFirestoreUsageUrl(projectId: string, databaseId: string): string {
  const safeProject = encodeURIComponent(projectId.trim());
  const safeDb = encodeURIComponent(databaseId.trim());
  return `https://console.firebase.google.com/project/${safeProject}/firestore/databases/${safeDb}/usage`;
}

export function getFirebaseAuthSettingsUrl(projectId: string): string {
  const safeProject = encodeURIComponent(projectId.trim());
  return `https://console.firebase.google.com/project/${safeProject}/authentication/settings`;
}

export function isUnauthorizedDomainAuthError(error: unknown): boolean {
  const raw = extractRawErrorText(error).toLowerCase();
  return raw.includes('auth/unauthorized-domain') || raw.includes('unauthorized-domain');
}

export function formatFirebaseAuthError(error: unknown, currentHostname?: string): string {
  const raw = extractRawErrorText(error);
  const lower = raw.toLowerCase();
  const host = (currentHostname || '').trim();

  if (isUnauthorizedDomainAuthError(error)) {
    return host
      ? `Domain "${host}" belum didaftarkan di Firebase Authentication → Settings → Authorized domains. Buka Firebase Console, klik "Add domain", lalu masukkan "${host}" (tanpa https:// dan tanpa tanda *) agar Login Google & Firebase berfungsi di Netlify.`
      : 'Domain situs ini belum didaftarkan di Firebase Authentication → Settings → Authorized domains. Tambahkan domain Netlify Anda (tanpa https:// dan tanpa *) di Firebase Console.';
  }
  if (lower.includes('auth/popup-blocked')) {
    return 'Popup login Google diblokir oleh peramban. Izinkan jendela popup untuk situs ini lalu coba lagi.';
  }
  if (lower.includes('auth/popup-closed-by-user') || lower.includes('auth/cancelled-popup-request')) {
    return 'Jendela login Google ditutup sebelum otorisasi selesai. Silakan coba lagi dan pilih akun Google panitia.';
  }
  if (lower.includes('auth/network-request-failed')) {
    return 'Koneksi internet bermasalah saat menghubungi server autentikasi Google/Firebase. Periksa jaringan Anda lalu coba lagi.';
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Gagal masuk dengan akun Google.';
}

/**
 * Google Cloud / Firebase daily quotas reset at midnight Pacific Time (08:00 UTC in PST).
 * Returns the next 08:00 UTC timestamp after `nowMs`.
 */
export function getQuotaCooldownUntilMs(nowMs = Date.now()): number {
  const d = new Date(nowMs);
  const candidate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8, 0, 0, 0);
  if (candidate > nowMs) {
    return candidate;
  }
  return candidate + 24 * 60 * 60 * 1000;
}

export function isQuotaCooldownActive(untilMs: number | null, nowMs = Date.now()): boolean {
  return typeof untilMs === 'number' && Number.isFinite(untilMs) && untilMs > nowMs;
}

export function loadQuotaCooldownUntil(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(QUOTA_COOLDOWN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= Date.now()) {
      window.localStorage.removeItem(QUOTA_COOLDOWN_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveQuotaCooldownUntil(untilMs: number | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (untilMs === null) {
      window.localStorage.removeItem(QUOTA_COOLDOWN_STORAGE_KEY);
    } else {
      window.localStorage.setItem(QUOTA_COOLDOWN_STORAGE_KEY, String(untilMs));
    }
  } catch {
    // Ignore storage quota error
  }
}

export function decideCloudSyncAction(
  localLastUpdated: number,
  seedTimestamp: number,
  cloudSummary: { clientUpdatedAt?: number } | null
): CloudSyncDecision {
  if (!cloudSummary) {
    return 'PUSH_LOCAL';
  }
  const cloudTs = typeof cloudSummary.clientUpdatedAt === 'number' ? cloudSummary.clientUpdatedAt : 0;

  if (localLastUpdated === seedTimestamp && cloudTs > 0) {
    return 'PULL_CLOUD';
  }
  if (cloudTs > localLastUpdated) {
    return 'PULL_CLOUD';
  }
  if (localLastUpdated > cloudTs) {
    return 'PUSH_LOCAL';
  }
  return 'IN_SYNC';
}

function extractRawErrorText(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    const obj = error as { code?: unknown; message?: unknown };
    const parts: string[] = [];
    if (typeof obj.code === 'string') parts.push(obj.code);
    if (typeof obj.message === 'string') {
      parts.push(obj.message);
      try {
        const parsed = JSON.parse(obj.message) as { error?: unknown };
        if (typeof parsed?.error === 'string') {
          parts.push(parsed.error);
        }
      } catch {
        // Not a JSON-wrapped FirestoreErrorInfo
      }
    }
    return parts.join(' ');
  }
  return String(error);
}

export function isFirestoreQuotaError(error: unknown): boolean {
  const text = extractRawErrorText(error).toLowerCase();
  if (!text) return false;
  return (
    text.includes('resource-exhausted') ||
    text.includes('quota limit exceeded') ||
    text.includes('quota exceeded') ||
    text.includes('free daily write units') ||
    text.includes('free daily read units')
  );
}

export function formatFirestoreErrorMessage(error: unknown): string {
  if (isFirestoreQuotaError(error)) {
    return 'Kuota harian gratis Cloud Firestore untuk proyek ini telah habis dan akan direset keesokan harinya. Auto-Sync dijeda otomatis sementara agar tidak membebani kuota; data tetap tersimpan aman di penyimpanan lokal & server.';
  }
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message) as {
        error?: string;
        operationType?: string;
        path?: string;
      };
      if (parsed && typeof parsed.error === 'string') {
        if (isFirestoreQuotaError(parsed.error)) {
          return 'Kuota harian gratis Cloud Firestore untuk proyek ini telah habis dan akan direset keesokan harinya. Auto-Sync dijeda otomatis sementara agar tidak membebani kuota; data tetap tersimpan aman di penyimpanan lokal & server.';
        }
        return parsed.operationType
          ? `Firestore (${parsed.operationType} ${parsed.path || ''}): ${parsed.error}`
          : parsed.error;
      }
    } catch {
      // Plain error message
    }
    return error.message;
  }
  return typeof error === 'string' ? error : 'Terjadi kesalahan saat menyinkronkan ke Cloud Firestore.';
}

export interface ElectionSummaryComparable {
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
  themeSurfaceMode: string;
  voterLoginMode?: VoterLoginMode;
  clientUpdatedAt: number;
  status: string;
}

export function hasElectionSummaryChanged(
  existing: Record<string, unknown> | undefined,
  next: ElectionSummaryComparable
): boolean {
  if (!existing) return true;
  const existingMode =
    existing.voterLoginMode === 'QR_CODE' ||
    existing.voterLoginMode === 'BOTH' ||
    existing.voterLoginMode === 'NISN'
      ? existing.voterLoginMode
      : 'NISN';
  const nextMode = next.voterLoginMode || 'NISN';
  return (
    existing.schoolName !== next.schoolName ||
    existing.academicYear !== next.academicYear ||
    existing.electionTitle !== next.electionTitle ||
    Boolean(existing.isBoothOpen) !== Boolean(next.isBoothOpen) ||
    Boolean(existing.hideLiveResults) !== Boolean(next.hideLiveResults) ||
    Number(existing.totalDpt ?? -1) !== next.totalDpt ||
    Number(existing.totalVoted ?? -1) !== next.totalVoted ||
    Number(existing.totalValidVotes ?? -1) !== next.totalValidVotes ||
    existing.startTime !== next.startTime ||
    existing.endTime !== next.endTime ||
    existing.logoUrl !== next.logoUrl ||
    existing.themePresetId !== next.themePresetId ||
    existing.themePrimaryColor !== next.themePrimaryColor ||
    existing.themeSecondaryColor !== next.themeSecondaryColor ||
    existing.themeAccentColor !== next.themeAccentColor ||
    existing.themeSurfaceMode !== next.themeSurfaceMode ||
    existingMode !== nextMode ||
    Number(existing.clientUpdatedAt ?? -1) !== next.clientUpdatedAt ||
    existing.status !== next.status
  );
}

export interface CandidateComparable {
  nomorUrut: number;
  ketuaName: string;
  ketuaClass: string;
  wakilName: string;
  wakilClass: string;
  photoUrl: string;
  vision: string;
  missions: string[];
  votes: number;
  accentColor: string;
}

export function hasCandidateChanged(
  existing: Record<string, unknown> | undefined,
  next: CandidateComparable
): boolean {
  if (!existing) return true;
  if (
    Number(existing.nomorUrut ?? -1) !== next.nomorUrut ||
    existing.ketuaName !== next.ketuaName ||
    existing.ketuaClass !== next.ketuaClass ||
    existing.wakilName !== next.wakilName ||
    existing.wakilClass !== next.wakilClass ||
    existing.photoUrl !== next.photoUrl ||
    existing.vision !== next.vision ||
    Number(existing.votes ?? -1) !== next.votes ||
    existing.accentColor !== next.accentColor
  ) {
    return true;
  }
  const existingMissions = Array.isArray(existing.missions) ? existing.missions.map(String) : [];
  if (existingMissions.length !== next.missions.length) return true;
  for (let i = 0; i < next.missions.length; i++) {
    if (existingMissions[i] !== next.missions[i]) return true;
  }
  return false;
}

export interface VoterComparable {
  nis: string;
  name: string;
  kelas: string;
  grade: string;
  hasVoted: boolean;
  votedAt?: string;
  votedCandidateId?: string;
}

export function hasVoterChanged(
  existing: Record<string, unknown> | undefined,
  next: VoterComparable
): boolean {
  if (!existing) return true;
  const existingVotedAt = typeof existing.votedAt === 'string' ? existing.votedAt : undefined;
  const nextVotedAt = typeof next.votedAt === 'string' ? next.votedAt : undefined;
  const existingCandidateId =
    typeof existing.votedCandidateId === 'string' && existing.votedCandidateId
      ? existing.votedCandidateId
      : undefined;
  const nextCandidateId =
    typeof next.votedCandidateId === 'string' && next.votedCandidateId
      ? next.votedCandidateId
      : undefined;

  return (
    existing.nis !== next.nis ||
    existing.name !== next.name ||
    existing.kelas !== next.kelas ||
    existing.grade !== next.grade ||
    Boolean(existing.hasVoted) !== Boolean(next.hasVoted) ||
    existingVotedAt !== nextVotedAt ||
    existingCandidateId !== nextCandidateId
  );
}

export interface SheetLinkComparable {
  id: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetName: string;
  purpose: string;
  spreadsheetUrl: string;
}

export interface FirestoreStorageBreakdown {
  settingsBytes: number;
  candidatesBytes: number;
  votersBytes: number;
  auditLogsBytes: number;
  sheetLinksBytes: number;
}

export interface FirestoreStorageUsageEstimate {
  usedBytes: number;
  quotaBytes: number;
  remainingBytes: number;
  usedPercentage: number;
  remainingPercentage: number;
  documentCount: number;
  voterCount: number;
  auditLogStoredCount: number;
  sheetLinkCount: number;
  breakdown: FirestoreStorageBreakdown;
}

const utf8Encoder = new TextEncoder();

function measureUtf8Bytes(value: unknown): number {
  return utf8Encoder.encode(JSON.stringify(value)).length;
}

function clampStringForSize(raw: string | undefined, maxLen: number, fallback = '-'): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return fallback.slice(0, maxLen);
  return trimmed.slice(0, maxLen);
}

export function formatStorageBytes(bytes: number): string {
  const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safeBytes === 0) return '0 B';
  if (safeBytes < 1024) {
    return `${Math.round(safeBytes)} B`;
  }
  if (safeBytes < 1024 * 1024) {
    const kb = safeBytes / 1024;
    return `${new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(kb)} KB`;
  }
  if (safeBytes < 1024 * 1024 * 1024) {
    const mb = safeBytes / (1024 * 1024);
    return `${new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(mb)} MB`;
  }
  const gib = safeBytes / (1024 * 1024 * 1024);
  return `${new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(gib)} GiB`;
}

export function estimateFirestoreStorageUsage(params: {
  db: DatabaseState;
  sheetLinks?: SheetLinkComparable[];
  quotaBytes?: number;
  totalDptOverride?: number;
}): FirestoreStorageUsageEstimate {
  const {
    db,
    sheetLinks = [],
    quotaBytes = FIRESTORE_SPARK_STORAGE_BYTES,
    totalDptOverride,
  } = params;
  const safeQuota = Number.isFinite(quotaBytes) && quotaBytes > 0 ? quotaBytes : FIRESTORE_SPARK_STORAGE_BYTES;

  // 1. User profile doc (users/{uid}) + Election workspace doc (elections/{electionId})
  const userProfilePayload = {
    uid: 'organizer_uid_placeholder',
    email: 'organizer@example.com',
    displayName: 'Panitia OSIS',
    role: 'operator',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const effectiveTotalDpt =
    typeof totalDptOverride === 'number' && Number.isFinite(totalDptOverride) && totalDptOverride > db.voters.length
      ? Math.round(totalDptOverride)
      : db.voters.length;
  const totalDpt = effectiveTotalDpt;
  const totalVoted = db.voters.filter((v) => v.hasVoted).length;
  const totalValidVotes = db.candidates.reduce((sum, c) => sum + c.votes, 0);
  const logoRaw = (db.settings.logoUrl || '').trim();
  const boundedLogo = logoRaw.length > 250000 ? logoRaw.slice(0, 250000) : logoRaw;

  const electionPayload = {
    id: 'osis_workspace',
    ownerId: 'organizer_uid_placeholder',
    schoolName: clampStringForSize(db.settings.schoolName, 160),
    academicYear: clampStringForSize(db.settings.academicYear, 40),
    electionTitle: clampStringForSize(db.settings.electionTitle, 200),
    isBoothOpen: Boolean(db.settings.isBoothOpen),
    hideLiveResults: Boolean(db.settings.hideLiveResults),
    totalDpt,
    totalVoted,
    totalValidVotes,
    startTime: clampStringForSize(db.settings.startTime, 40),
    endTime: clampStringForSize(db.settings.endTime, 40),
    logoUrl: boundedLogo,
    themePresetId: db.settings.theme?.presetId || 'navy-classic',
    themePrimaryColor: db.settings.theme?.primaryColor || '#0F1E3D',
    themeSecondaryColor: db.settings.theme?.secondaryColor || '#1E3A5F',
    themeAccentColor: db.settings.theme?.accentColor || '#F59E0B',
    themeSurfaceMode: db.settings.theme?.surfaceMode || 'light',
    voterLoginMode: db.settings.voterLoginMode || 'NISN',
    clientUpdatedAt: db.lastUpdated || 0,
    status: db.settings.isBoothOpen ? 'active' : 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const settingsBytes =
    measureUtf8Bytes(userProfilePayload) +
    FIRESTORE_DOC_OVERHEAD_BYTES +
    measureUtf8Bytes(electionPayload) +
    FIRESTORE_DOC_OVERHEAD_BYTES;

  // 2. Candidates subcollection
  let candidatesBytes = 0;
  for (const c of db.candidates) {
    const photoRaw = (c.photoUrl || '').trim();
    const boundedPhoto = photoRaw.length > 350000 ? photoRaw.slice(0, 350000) : photoRaw;
    const payload = {
      id: c.id,
      electionId: 'osis_workspace',
      ownerId: 'organizer_uid_placeholder',
      nomorUrut: c.nomorUrut,
      ketuaName: clampStringForSize(c.ketuaName, 120),
      ketuaClass: clampStringForSize(c.ketuaClass, 60),
      wakilName: clampStringForSize(c.wakilName, 120),
      wakilClass: clampStringForSize(c.wakilClass, 60),
      photoUrl: boundedPhoto,
      vision: clampStringForSize(c.vision, 1000),
      missions: (c.missions || []).slice(0, 20).map((m) => clampStringForSize(m, 300)),
      votes: c.votes,
      accentColor: clampStringForSize(c.accentColor, 20),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    candidatesBytes += measureUtf8Bytes(payload) + FIRESTORE_DOC_OVERHEAD_BYTES;
  }

  // 3. Voters subcollection (scaled accurately if client only hydrated limit(20) while cloudSummary reports full totalDpt)
  let loadedVotersBytes = 0;
  for (const v of db.voters) {
    const payload: Record<string, unknown> = {
      id: v.id,
      electionId: 'osis_workspace',
      ownerId: 'organizer_uid_placeholder',
      nis: clampStringForSize(v.nis, 40),
      name: clampStringForSize(v.name, 120),
      kelas: clampStringForSize(v.kelas, 60),
      grade: v.grade,
      hasVoted: Boolean(v.hasVoted),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    if (v.votedAt) payload.votedAt = clampStringForSize(v.votedAt, 60);
    if (v.hasVoted && v.votedCandidateId) payload.votedCandidateId = v.votedCandidateId;
    loadedVotersBytes += measureUtf8Bytes(payload) + FIRESTORE_DOC_OVERHEAD_BYTES;
  }
  const avgVoterBytes = db.voters.length > 0 ? loadedVotersBytes / db.voters.length : 240;
  const votersBytes =
    effectiveTotalDpt > db.voters.length
      ? Math.round(loadedVotersBytes + (effectiveTotalDpt - db.voters.length) * avgVoterBytes)
      : loadedVotersBytes;

  // 4. Audit logs subcollection (capped at 100 entries matching syncElectionToFirestore)
  const boundedLogs = db.auditLogs.slice(0, 100);
  let auditLogsBytes = 0;
  for (const log of boundedLogs) {
    const payload = {
      id: log.id,
      electionId: 'osis_workspace',
      ownerId: 'organizer_uid_placeholder',
      timestamp: clampStringForSize(log.timestamp, 60),
      actorName: clampStringForSize(log.actorName, 120),
      actorRole: log.actorRole,
      action: clampStringForSize(log.action, 80),
      detail: clampStringForSize(log.detail, 500),
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    auditLogsBytes += measureUtf8Bytes(payload) + FIRESTORE_DOC_OVERHEAD_BYTES;
  }

  // 5. Saved Google Sheets links subcollection
  let sheetLinksBytes = 0;
  for (const link of sheetLinks) {
    const payload = {
      id: link.id,
      ownerId: 'organizer_uid_placeholder',
      spreadsheetId: link.spreadsheetId,
      spreadsheetTitle: clampStringForSize(link.spreadsheetTitle, 200),
      sheetName: clampStringForSize(link.sheetName, 120),
      purpose: link.purpose,
      spreadsheetUrl: clampStringForSize(link.spreadsheetUrl, 300),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    sheetLinksBytes += measureUtf8Bytes(payload) + FIRESTORE_DOC_OVERHEAD_BYTES;
  }

  const usedBytes =
    settingsBytes + candidatesBytes + votersBytes + auditLogsBytes + sheetLinksBytes;
  const remainingBytes = Math.max(0, safeQuota - usedBytes);
  const usedPercentage = Math.min(100, (usedBytes / safeQuota) * 100);
  const remainingPercentage = Math.max(0, 100 - usedPercentage);
  const documentCount =
    2 + db.candidates.length + effectiveTotalDpt + boundedLogs.length + sheetLinks.length;

  return {
    usedBytes,
    quotaBytes: safeQuota,
    remainingBytes,
    usedPercentage,
    remainingPercentage,
    documentCount,
    voterCount: effectiveTotalDpt,
    auditLogStoredCount: boundedLogs.length,
    sheetLinkCount: sheetLinks.length,
    breakdown: {
      settingsBytes,
      candidatesBytes,
      votersBytes,
      auditLogsBytes,
      sheetLinksBytes,
    },
  };
}

export interface FirestoreLastOperationSummary {
  label: string;
  reads: number;
  writes: number;
  deletes: number;
  atMs: number;
}

export interface FirestoreDailyUsageRecord {
  windowResetAtMs: number;
  reads: number;
  writes: number;
  deletes: number;
  updatedAtMs: number;
  lastOp?: FirestoreLastOperationSummary;
}

export interface FirestoreDailyQuotaMetric {
  used: number;
  limit: number;
  remaining: number;
  usedPercentage: number;
  remainingPercentage: number;
}

export interface FirestoreDailyQuotaSummary {
  windowResetAtMs: number;
  updatedAtMs: number;
  reads: FirestoreDailyQuotaMetric;
  writes: FirestoreDailyQuotaMetric;
  deletes: FirestoreDailyQuotaMetric;
  quotaExceeded: boolean;
  lastOp?: FirestoreLastOperationSummary;
}

function clampNonNegativeInt(val: number | undefined): number {
  if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) return 0;
  return Math.round(val);
}

export function createEmptyDailyUsage(nowMs = Date.now()): FirestoreDailyUsageRecord {
  return {
    windowResetAtMs: getQuotaCooldownUntilMs(nowMs),
    reads: 0,
    writes: 0,
    deletes: 0,
    updatedAtMs: nowMs,
  };
}

function normalizeLastOp(raw: unknown): FirestoreLastOperationSummary | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<FirestoreLastOperationSummary>;
  if (typeof obj.label !== 'string' || !obj.label.trim()) return undefined;
  return {
    label: obj.label.trim().slice(0, 100),
    reads: clampNonNegativeInt(obj.reads),
    writes: clampNonNegativeInt(obj.writes),
    deletes: clampNonNegativeInt(obj.deletes),
    atMs: typeof obj.atMs === 'number' && Number.isFinite(obj.atMs) ? obj.atMs : Date.now(),
  };
}

export function normalizeDailyUsageRecord(
  raw: Partial<FirestoreDailyUsageRecord> | null | undefined,
  nowMs = Date.now()
): FirestoreDailyUsageRecord {
  if (
    !raw ||
    typeof raw.windowResetAtMs !== 'number' ||
    !Number.isFinite(raw.windowResetAtMs) ||
    nowMs >= raw.windowResetAtMs
  ) {
    return createEmptyDailyUsage(nowMs);
  }
  const normalized: FirestoreDailyUsageRecord = {
    windowResetAtMs: raw.windowResetAtMs,
    reads: clampNonNegativeInt(raw.reads),
    writes: clampNonNegativeInt(raw.writes),
    deletes: clampNonNegativeInt(raw.deletes),
    updatedAtMs:
      typeof raw.updatedAtMs === 'number' && Number.isFinite(raw.updatedAtMs)
        ? raw.updatedAtMs
        : nowMs,
  };
  const lastOp = normalizeLastOp(raw.lastOp);
  if (lastOp) {
    normalized.lastOp = lastOp;
  }
  return normalized;
}

export function applyDailyUsageDelta(
  current: FirestoreDailyUsageRecord | null | undefined,
  delta: { reads?: number; writes?: number; deletes?: number },
  nowMs = Date.now(),
  opLabel?: string
): FirestoreDailyUsageRecord {
  const base = normalizeDailyUsageRecord(current, nowMs);
  const readsDelta = clampNonNegativeInt(delta.reads);
  const writesDelta = clampNonNegativeInt(delta.writes);
  const deletesDelta = clampNonNegativeInt(delta.deletes);
  const next: FirestoreDailyUsageRecord = {
    windowResetAtMs: base.windowResetAtMs,
    reads: base.reads + readsDelta,
    writes: base.writes + writesDelta,
    deletes: base.deletes + deletesDelta,
    updatedAtMs: nowMs,
  };
  const cleanLabel = typeof opLabel === 'string' ? opLabel.trim() : '';
  if (cleanLabel && readsDelta + writesDelta + deletesDelta > 0) {
    next.lastOp = {
      label: cleanLabel.slice(0, 100),
      reads: readsDelta,
      writes: writesDelta,
      deletes: deletesDelta,
      atMs: nowMs,
    };
  } else if (base.lastOp) {
    next.lastOp = base.lastOp;
  }
  return next;
}

function buildDailyQuotaMetric(used: number, limit: number): FirestoreDailyQuotaMetric {
  const safeLimit = Math.max(1, limit);
  const safeUsed = clampNonNegativeInt(used);
  const remaining = Math.max(0, safeLimit - safeUsed);
  const usedPercentage = Math.min(100, (safeUsed / safeLimit) * 100);
  const remainingPercentage = Math.max(0, 100 - usedPercentage);
  return {
    used: safeUsed,
    limit: safeLimit,
    remaining,
    usedPercentage,
    remainingPercentage,
  };
}

export function computeDailyQuotaSummary(
  record: FirestoreDailyUsageRecord | null | undefined,
  quotaExceeded = false,
  nowMs = Date.now()
): FirestoreDailyQuotaSummary {
  const normalized = normalizeDailyUsageRecord(record, nowMs);
  return {
    windowResetAtMs: normalized.windowResetAtMs,
    updatedAtMs: normalized.updatedAtMs,
    reads: buildDailyQuotaMetric(normalized.reads, FIRESTORE_SPARK_DAILY_READS),
    writes: buildDailyQuotaMetric(normalized.writes, FIRESTORE_SPARK_DAILY_WRITES),
    deletes: buildDailyQuotaMetric(normalized.deletes, FIRESTORE_SPARK_DAILY_DELETES),
    quotaExceeded: Boolean(quotaExceeded),
    lastOp: normalized.lastOp,
  };
}

export function loadDailyQuotaUsage(nowMs = Date.now()): FirestoreDailyUsageRecord {
  if (typeof window === 'undefined') {
    return createEmptyDailyUsage(nowMs);
  }
  try {
    const raw = window.localStorage.getItem(DAILY_QUOTA_USAGE_STORAGE_KEY);
    if (!raw) {
      return createEmptyDailyUsage(nowMs);
    }
    const parsed = JSON.parse(raw) as Partial<FirestoreDailyUsageRecord>;
    const normalized = normalizeDailyUsageRecord(parsed, nowMs);
    if (normalized.windowResetAtMs !== parsed.windowResetAtMs) {
      window.localStorage.setItem(DAILY_QUOTA_USAGE_STORAGE_KEY, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return createEmptyDailyUsage(nowMs);
  }
}

export function recordFirestoreQuotaOps(
  delta: { reads?: number; writes?: number; deletes?: number },
  opLabelOrNowMs?: string | number,
  maybeNowMs?: number
): FirestoreDailyUsageRecord {
  const opLabel = typeof opLabelOrNowMs === 'string' ? opLabelOrNowMs : undefined;
  const nowMs =
    typeof opLabelOrNowMs === 'number'
      ? opLabelOrNowMs
      : typeof maybeNowMs === 'number'
        ? maybeNowMs
        : Date.now();
  const next = applyDailyUsageDelta(loadDailyQuotaUsage(nowMs), delta, nowMs, opLabel);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(DAILY_QUOTA_USAGE_STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(DAILY_QUOTA_UPDATE_EVENT, { detail: next }));
    } catch {
      // Ignore storage quota error
    }
  }
  return next;
}

export function subscribeDailyQuotaUsage(
  onChange: (usage: FirestoreDailyUsageRecord) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const handleCustom = (ev: Event) => {
    const custom = ev as CustomEvent<FirestoreDailyUsageRecord>;
    if (custom.detail) {
      onChange(normalizeDailyUsageRecord(custom.detail));
    } else {
      onChange(loadDailyQuotaUsage());
    }
  };
  const handleStorage = (ev: StorageEvent) => {
    if (ev.key === DAILY_QUOTA_USAGE_STORAGE_KEY) {
      onChange(loadDailyQuotaUsage());
    }
  };
  window.addEventListener(DAILY_QUOTA_UPDATE_EVENT, handleCustom);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(DAILY_QUOTA_UPDATE_EVENT, handleCustom);
    window.removeEventListener('storage', handleStorage);
  };
}

// --- Zero-Read Workspace Sync Cache (eliminates full 999-voter & 100-log scans on manual sync) ---
export const WORKSPACE_SYNC_CACHE_PREFIX = 'osis_evoting_firestore_sync_cache_v1_';

export interface FirestoreWorkspaceSyncCache {
  voterHashes: Record<string, string>;
  syncedLogIds: string[];
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function computeVoterComparableHash(
  voter: Pick<Voter, 'nis' | 'name' | 'kelas' | 'grade' | 'hasVoted' | 'votedAt' | 'votedCandidateId'>
): string {
  const payload = [
    (voter.nis || '').trim(),
    (voter.name || '').trim(),
    (voter.kelas || '').trim(),
    voter.grade === 'XII' ? 'XII' : voter.grade === 'XI' ? 'XI' : 'X',
    voter.hasVoted ? '1' : '0',
    voter.votedAt ? voter.votedAt.trim() : '',
    voter.hasVoted && voter.votedCandidateId ? voter.votedCandidateId.trim() : '',
  ].join('\u001f');
  return fnv1aHex(payload);
}

export function diffVotersWithSyncCache<T extends Pick<Voter, 'nis' | 'name' | 'kelas' | 'grade' | 'hasVoted' | 'votedAt' | 'votedCandidateId'>>(
  entries: Array<{ docId: string; voter: T }>,
  cachedHashes: Record<string, string> | null | undefined
): {
  toWrite: Array<{ docId: string; voter: T }>;
  toDeleteIds: string[];
  nextHashes: Record<string, string>;
} {
  const prev = cachedHashes || {};
  const nextHashes: Record<string, string> = {};
  const toWrite: Array<{ docId: string; voter: T }> = [];

  for (const entry of entries) {
    const hash = computeVoterComparableHash(entry.voter);
    nextHashes[entry.docId] = hash;
    if (prev[entry.docId] !== hash) {
      toWrite.push(entry);
    }
  }

  const toDeleteIds = Object.keys(prev).filter((id) => !(id in nextHashes));
  return { toWrite, toDeleteIds, nextHashes };
}

export function diffAuditLogsWithSyncCache(
  logIds: string[],
  cachedLogIds: string[] | null | undefined
): {
  toCreateIds: string[];
  toDeleteIds: string[];
  nextSyncedLogIds: string[];
} {
  const prevSet = new Set(cachedLogIds || []);
  const nextSet = new Set(logIds);
  const toCreateIds = logIds.filter((id) => !prevSet.has(id));
  const toDeleteIds = Array.from(prevSet).filter((id) => !nextSet.has(id));
  return {
    toCreateIds,
    toDeleteIds,
    nextSyncedLogIds: Array.from(nextSet),
  };
}

export function loadWorkspaceSyncCache(electionId: string): FirestoreWorkspaceSyncCache | null {
  if (typeof window === 'undefined' || !electionId) return null;
  try {
    const raw = window.localStorage.getItem(`${WORKSPACE_SYNC_CACHE_PREFIX}${electionId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FirestoreWorkspaceSyncCache>;
    if (!parsed || typeof parsed !== 'object') return null;
    const voterHashes: Record<string, string> = {};
    if (parsed.voterHashes && typeof parsed.voterHashes === 'object') {
      for (const [k, v] of Object.entries(parsed.voterHashes)) {
        if (typeof v === 'string') voterHashes[k] = v;
      }
    }
    const syncedLogIds = Array.isArray(parsed.syncedLogIds)
      ? parsed.syncedLogIds.filter((id): id is string => typeof id === 'string')
      : [];
    return { voterHashes, syncedLogIds };
  } catch {
    return null;
  }
}

export function saveWorkspaceSyncCache(
  electionId: string,
  cache: FirestoreWorkspaceSyncCache
): void {
  if (typeof window === 'undefined' || !electionId) return;
  try {
    window.localStorage.setItem(
      `${WORKSPACE_SYNC_CACHE_PREFIX}${electionId}`,
      JSON.stringify(cache)
    );
  } catch {
    // Ignore storage quota error
  }
}

export function updateWorkspaceVoterCacheEntry(
  electionId: string,
  docId: string,
  voter: Pick<Voter, 'nis' | 'name' | 'kelas' | 'grade' | 'hasVoted' | 'votedAt' | 'votedCandidateId'> | null
): void {
  if (!electionId || !docId) return;
  const existing = loadWorkspaceSyncCache(electionId);
  if (!existing && !voter) return;
  const voterHashes = { ...(existing?.voterHashes || {}) };
  if (voter) {
    voterHashes[docId] = computeVoterComparableHash(voter);
  } else {
    delete voterHashes[docId];
  }
  saveWorkspaceSyncCache(electionId, {
    voterHashes,
    syncedLogIds: existing?.syncedLogIds || [],
  });
}

export function deleteWorkspaceVoterCacheEntries(
  electionId: string,
  docIds: string[]
): void {
  if (!electionId || docIds.length === 0) return;
  const existing = loadWorkspaceSyncCache(electionId);
  if (!existing) return;
  const voterHashes = { ...existing.voterHashes };
  for (const id of docIds) {
    delete voterHashes[id];
  }
  saveWorkspaceSyncCache(electionId, {
    voterHashes,
    syncedLogIds: existing.syncedLogIds,
  });
}

export function recordWorkspaceCsvImportCache(
  electionId: string,
  entries: Array<{
    docId: string;
    voter: Pick<Voter, 'nis' | 'name' | 'kelas' | 'grade' | 'hasVoted' | 'votedAt' | 'votedCandidateId'>;
  }>
): void {
  if (!electionId) return;
  const existing = loadWorkspaceSyncCache(electionId);
  const voterHashes: Record<string, string> = {};
  for (const entry of entries) {
    voterHashes[entry.docId] = computeVoterComparableHash(entry.voter);
  }
  saveWorkspaceSyncCache(electionId, {
    voterHashes,
    syncedLogIds: existing?.syncedLogIds || [],
  });
}
