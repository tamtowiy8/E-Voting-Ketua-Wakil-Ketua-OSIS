import type {
  AdminRole,
  AdminUser,
  AuditLogEntry,
  Candidate,
  DatabaseState,
  ElectionSettings,
  GradeLevel,
  VoteReceipt,
  Voter,
  VoterLoginMode,
} from '../types/evoting.ts';

export function extractGrade(kelas: string): GradeLevel {
  const normalized = kelas.trim().toUpperCase();
  if (normalized.startsWith('XII') || normalized.startsWith('12')) return 'XII';
  if (normalized.startsWith('XI') || normalized.startsWith('11')) return 'XI';
  return 'X';
}

const STUDENT_CLASS_REGEX = /^(XII|XI|X|12|11|10)(?:$|[\s\-_./])/i;

export function isAdditionalVoter(voter: Pick<Voter, 'kelas'>): boolean {
  const trimmed = (voter.kelas || '').trim();
  if (!trimmed) return false;
  return !STUDENT_CLASS_REGEX.test(trimmed);
}

function parseStudentClassSortParts(
  kelas: string,
  fallbackGrade: GradeLevel
): { gradeRank: number; subLabel: string } {
  const trimmed = (kelas || '').trim();
  const match = /^(XII|XI|X|12|11|10)(?:$|[\s\-_./]+(.*)$)/i.exec(trimmed);
  if (match) {
    const token = match[1].toUpperCase();
    const gradeRank =
      token === 'X' || token === '10'
        ? 10
        : token === 'XI' || token === '11'
          ? 11
          : 12;
    const subLabel = (match[2] || '').trim();
    return { gradeRank, subLabel };
  }
  const fallbackRank = fallbackGrade === 'XII' ? 12 : fallbackGrade === 'XI' ? 11 : 10;
  return { gradeRank: fallbackRank, subLabel: trimmed };
}

export function compareStudentVotersByClass(a: Voter, b: Voter): number {
  const pa = parseStudentClassSortParts(a.kelas, a.grade);
  const pb = parseStudentClassSortParts(b.kelas, b.grade);
  if (pa.gradeRank !== pb.gradeRank) {
    return pa.gradeRank - pb.gradeRank;
  }
  const subCmp = pa.subLabel.localeCompare(pb.subLabel, 'id', {
    numeric: true,
    sensitivity: 'base',
  });
  if (subCmp !== 0) return subCmp;

  const nameCmp = a.name.localeCompare(b.name, 'id', { sensitivity: 'base' });
  if (nameCmp !== 0) return nameCmp;

  return a.nis.localeCompare(b.nis, 'id', { numeric: true, sensitivity: 'base' });
}

function getAdditionalRoleRank(keterangan: string): number {
  const norm = (keterangan || '').trim().toLowerCase();
  if (!norm) return 99;
  if (norm.includes('wakil kepala') || norm.includes('wakasek')) return 2;
  if (norm.includes('kepala sekolah') || norm === 'kepsek') return 1;
  if (norm.includes('guru') || norm.includes('pendidik')) return 3;
  if (
    norm.includes('tendik') ||
    norm.includes('tenaga kependidikan') ||
    norm.includes('staf') ||
    norm.includes('tata usaha') ||
    norm === 'tu'
  ) {
    return 4;
  }
  return 5;
}

export function compareAdditionalVoters(a: Voter, b: Voter): number {
  const rankA = getAdditionalRoleRank(a.kelas);
  const rankB = getAdditionalRoleRank(b.kelas);
  if (rankA !== rankB) return rankA - rankB;

  const ketCmp = a.kelas.trim().localeCompare(b.kelas.trim(), 'id', {
    numeric: true,
    sensitivity: 'base',
  });
  if (ketCmp !== 0) return ketCmp;

  const nameCmp = a.name.localeCompare(b.name, 'id', { sensitivity: 'base' });
  if (nameCmp !== 0) return nameCmp;

  return a.nis.localeCompare(b.nis, 'id', { numeric: true, sensitivity: 'base' });
}

export function sortVotersOrdered(voters: Voter[]): Voter[] {
  const students = voters.filter((v) => !isAdditionalVoter(v)).sort(compareStudentVotersByClass);
  const additional = voters.filter((v) => isAdditionalVoter(v)).sort(compareAdditionalVoters);
  return [...students, ...additional];
}

export function generateSixDigitToken(existingTokens?: Set<string>): string {
  for (let attempt = 0; attempt < 500; attempt++) {
    const num = Math.floor(100000 + Math.random() * 900000);
    const token = String(num);
    if (!existingTokens || !existingTokens.has(token)) {
      return token;
    }
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

export const MAX_CSV_VOTERS = 999;
export const DPT_DISPLAY_LIMIT = 20;

export function getVoterDocIdFromNis(nis: string): string {
  const cleaned = nis.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned && /^[a-zA-Z0-9_-]+$/.test(cleaned) ? cleaned : 'vtr';
}

export function computeNotVotedCount(totalDpt: number, totalVoted: number): number {
  const dpt = Number.isFinite(totalDpt) ? Math.max(0, Math.round(totalDpt)) : 0;
  const voted = Number.isFinite(totalVoted) ? Math.max(0, Math.round(totalVoted)) : 0;
  return Math.max(0, dpt - voted);
}

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function addAuditLog(
  logs: AuditLogEntry[],
  actorName: string,
  actorRole: AdminRole | 'SYSTEM',
  action: string,
  detail: string,
  nowIso: string = new Date().toISOString()
): AuditLogEntry[] {
  const entry: AuditLogEntry = {
    id: generateId('log'),
    timestamp: nowIso,
    actorName,
    actorRole,
    action,
    detail,
  };
  return [entry, ...logs].slice(0, 200);
}

export type VoterLoginValidationResult =
  | { ok: true; voter: Voter }
  | {
      ok: false;
      code: 'BOOTH_CLOSED' | 'OUTSIDE_SCHEDULE' | 'INVALID_CREDENTIALS' | 'ALREADY_VOTED';
      error: string;
    };

export function isWithinSchedule(
  settings: ElectionSettings,
  nowMs: number = Date.now()
): { valid: boolean; reason?: string } {
  if (settings.startTime) {
    const startMs = new Date(settings.startTime).getTime();
    if (!Number.isNaN(startMs) && nowMs < startMs) {
      return { valid: false, reason: 'Pemilihan belum dimulai sesuai jadwal yang ditetapkan panitia.' };
    }
  }
  if (settings.endTime) {
    const endMs = new Date(settings.endTime).getTime();
    if (!Number.isNaN(endMs) && nowMs > endMs) {
      return { valid: false, reason: 'Waktu pemilihan telah berakhir sesuai jadwal.' };
    }
  }
  return { valid: true };
}

export function validateVoterLogin(
  voters: Voter[],
  nisInput: string,
  settings: ElectionSettings,
  nowMs: number = Date.now()
): VoterLoginValidationResult {
  const nis = nisInput.trim();

  if (!settings.isBoothOpen) {
    return {
      ok: false,
      code: 'BOOTH_CLOSED',
      error: 'Bilik suara saat ini sedang ditutup oleh panitia.',
    };
  }

  const scheduleCheck = isWithinSchedule(settings, nowMs);
  if (!scheduleCheck.valid) {
    return {
      ok: false,
      code: 'OUTSIDE_SCHEDULE',
      error: scheduleCheck.reason || 'Di luar jadwal pemilihan.',
    };
  }

  const voter = voters.find((v) => v.nis.trim().toLowerCase() === nis.toLowerCase());
  if (!nis || !voter) {
    return {
      ok: false,
      code: 'INVALID_CREDENTIALS',
      error: 'NIS/NISN tidak ditemukan dalam Daftar Pemilih Tetap (DPT). Periksa kembali nomor Anda.',
    };
  }

  if (voter.hasVoted) {
    return {
      ok: false,
      code: 'ALREADY_VOTED',
      error: 'Anda sudah menggunakan hak suara. Setiap pemilih hanya dapat memilih satu kali.',
    };
  }

  return { ok: true, voter };
}

export function resolveEffectiveVoterLoginMode(
  settings?: Pick<ElectionSettings, 'voterLoginMode'> | null
): VoterLoginMode {
  const mode = settings?.voterLoginMode;
  if (mode === 'QR_CODE' || mode === 'BOTH' || mode === 'NISN') {
    return mode;
  }
  return 'NISN';
}

export function encodeVoterQrPayload(voter: Pick<Voter, 'nis'>): string {
  return `OSIS-VOTER:${voter.nis.trim()}`;
}

export function parseVoterQrPayload(rawPayload: string): string | null {
  const trimmed = rawPayload.trim();
  if (!trimmed) return null;

  if (/^OSIS-ADMIN\s*:/i.test(trimmed)) {
    return null;
  }

  const prefixMatch = /^OSIS-VOTER\s*:\s*(.+)$/i.exec(trimmed);
  if (prefixMatch) {
    const extracted = prefixMatch[1].trim();
    return extracted || null;
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        type?: unknown;
        nis?: unknown;
        nisn?: unknown;
        voterNis?: unknown;
      };
      if (typeof parsed.type === 'string' && parsed.type.toUpperCase() === 'OSIS-ADMIN') {
        return null;
      }
      const candidateNis = parsed.nis ?? parsed.nisn ?? parsed.voterNis;
      if (typeof candidateNis === 'string' && candidateNis.trim()) {
        return candidateNis.trim();
      }
      if (typeof candidateNis === 'number' && Number.isFinite(candidateNis)) {
        return String(candidateNis);
      }
      return null;
    } catch {
      return null;
    }
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const param = url.searchParams.get('nis') || url.searchParams.get('nisn');
      if (param && param.trim()) {
        return param.trim();
      }
    } catch {
      // Fall through if not a valid URL
    }
  }

  if (/[\r\n]/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export function validateVoterQrLogin(
  voters: Voter[],
  rawQrPayload: string,
  settings: ElectionSettings,
  nowMs: number = Date.now()
): VoterLoginValidationResult {
  if (!settings.isBoothOpen) {
    return {
      ok: false,
      code: 'BOOTH_CLOSED',
      error: 'Bilik suara saat ini sedang ditutup oleh panitia.',
    };
  }

  const scheduleCheck = isWithinSchedule(settings, nowMs);
  if (!scheduleCheck.valid) {
    return {
      ok: false,
      code: 'OUTSIDE_SCHEDULE',
      error: scheduleCheck.reason || 'Di luar jadwal pemilihan.',
    };
  }

  const extractedNis = parseVoterQrPayload(rawQrPayload);
  if (!extractedNis) {
    const isAdminQr = /^OSIS-ADMIN\s*:/i.test(rawQrPayload.trim());
    return {
      ok: false,
      code: 'INVALID_CREDENTIALS',
      error: isAdminQr
        ? 'QR Code ini adalah Kartu QR Panitia/Admin. Gunakan menu Login Admin untuk masuk.'
        : 'QR Code tidak valid atau tidak berisi data NIS/NISN pemilih.',
    };
  }

  return validateVoterLogin(voters, extractedNis, settings, nowMs);
}

export function generateAdminQrToken(): string {
  const bytes = new Uint8Array(12);
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 24);
}

export function ensureAdminQrTokens(admins: AdminUser[]): { admins: AdminUser[]; changed: boolean } {
  let changed = false;
  const next = admins.map((admin) => {
    if (typeof admin.qrToken === 'string' && admin.qrToken.trim().length >= 8) {
      return admin;
    }
    changed = true;
    return { ...admin, qrToken: generateAdminQrToken() };
  });
  return { admins: next, changed };
}

export function encodeAdminQrPayload(admin: Pick<AdminUser, 'id' | 'qrToken'>): string {
  const id = admin.id.trim();
  const token = (admin.qrToken || '').trim();
  return `OSIS-ADMIN:${id}:${token}`;
}

export function parseAdminQrPayload(
  rawPayload: string
): { adminId: string; qrToken: string } | null {
  const trimmed = rawPayload.trim();
  if (!trimmed) return null;

  const prefixMatch = /^OSIS-ADMIN\s*:\s*([^:\s]+)\s*:\s*([^\s]+)$/i.exec(trimmed);
  if (prefixMatch) {
    const adminId = prefixMatch[1].trim();
    const qrToken = prefixMatch[2].trim();
    if (adminId && qrToken) {
      return { adminId, qrToken };
    }
    return null;
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        type?: unknown;
        adminId?: unknown;
        qrToken?: unknown;
      };
      if (
        typeof parsed.type === 'string' &&
        parsed.type.toUpperCase() === 'OSIS-ADMIN' &&
        typeof parsed.adminId === 'string' &&
        typeof parsed.qrToken === 'string' &&
        parsed.adminId.trim() &&
        parsed.qrToken.trim()
      ) {
        return {
          adminId: parsed.adminId.trim(),
          qrToken: parsed.qrToken.trim(),
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

export type AdminQrLoginResult =
  | { ok: true; admin: AdminUser }
  | { ok: false; error: string };

export function validateAdminQrLogin(
  admins: AdminUser[],
  rawPayload: string
): AdminQrLoginResult {
  const trimmed = rawPayload.trim();
  if (/^OSIS-VOTER\s*:/i.test(trimmed)) {
    return {
      ok: false,
      error: 'QR Code ini adalah Kartu Pemilih, bukan QR Login Panitia/Admin.',
    };
  }

  const parsed = parseAdminQrPayload(trimmed);
  if (!parsed) {
    return {
      ok: false,
      error: 'QR Code tidak valid atau bukan Kartu QR Login Panitia/Admin.',
    };
  }

  const found = admins.find((a) => a.id === parsed.adminId);
  if (!found || !found.qrToken || found.qrToken !== parsed.qrToken) {
    return {
      ok: false,
      error: 'QR Code Panitia tidak dikenali atau sudah diperbarui oleh SuperAdmin.',
    };
  }

  return { ok: true, admin: found };
}

export function castVoteInState(
  state: DatabaseState,
  voterId: string,
  candidateId: string,
  nowIso: string = new Date().toISOString()
): { nextState: DatabaseState; receipt: VoteReceipt } {
  const voter = state.voters.find((v) => v.id === voterId);
  if (!voter) {
    throw new Error('Data pemilih tidak ditemukan.');
  }
  if (voter.hasVoted) {
    throw new Error('Anda sudah menggunakan hak suara.');
  }

  const candidate = state.candidates.find((c) => c.id === candidateId);
  if (!candidate) {
    throw new Error('Kandidat tidak ditemukan.');
  }

  const nextVoters = state.voters.map((v) =>
    v.id === voterId
      ? { ...v, hasVoted: true, votedAt: nowIso, votedCandidateId: candidateId }
      : v
  );

  const nextCandidates = state.candidates.map((c) =>
    c.id === candidateId ? { ...c, votes: c.votes + 1 } : c
  );

  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  const receiptCode = `OSIS-${new Date(nowIso).getFullYear()}-${randomSuffix}-${voter.nis.slice(-3)}`;

  const receipt: VoteReceipt = {
    receiptCode,
    voterName: voter.name,
    voterNis: voter.nis,
    voterClass: voter.kelas,
    timestamp: nowIso,
  };

  return {
    nextState: {
      ...state,
      voters: nextVoters,
      candidates: nextCandidates,
      lastUpdated: Date.now(),
    },
    receipt,
  };
}

export interface GradeStat {
  grade: GradeLevel | 'DPTB';
  label: string;
  total: number;
  voted: number;
  percentage: number;
}

export interface CandidateStat extends Candidate {
  percentage: number;
}

export interface ElectionStats {
  totalDpt: number;
  totalVoted: number;
  totalNotVoted: number;
  participationRate: number;
  totalValidVotes: number;
  gradeStats: GradeStat[];
  candidateStats: CandidateStat[];
}

export interface SummaryStatsOverride {
  totalDpt: number;
  totalVoted: number;
  totalValidVotes?: number;
  candidateVotes?: Record<string, number>;
  gradeTotals?: Record<string, number>;
  gradeVoted?: Record<string, number>;
}

export function computeStatistics(
  voters: Voter[],
  candidates: Candidate[],
  summaryOverride?: SummaryStatsOverride | null
): ElectionStats {
  const useSummary = Boolean(
    summaryOverride &&
      typeof summaryOverride.totalDpt === 'number' &&
      Number.isFinite(summaryOverride.totalDpt)
  );

  const sortedCandidates = [...candidates].sort((a, b) => a.nomorUrut - b.nomorUrut);
  const candidateVotesMap = summaryOverride?.candidateVotes;
  const hasCandidateMap =
    useSummary && candidateVotesMap && Object.keys(candidateVotesMap).length > 0;

  const effectiveCandidateVotes = sortedCandidates.map((c) => {
    const mapped = hasCandidateMap ? candidateVotesMap?.[c.id] : undefined;
    return typeof mapped === 'number' && Number.isFinite(mapped)
      ? Math.max(0, Math.round(mapped))
      : Math.max(0, Math.round(Number(c.votes) || 0));
  });

  const computedSumValidVotes = effectiveCandidateVotes.reduce((sum, v) => sum + v, 0);
  const totalValidVotes =
    useSummary &&
    typeof summaryOverride?.totalValidVotes === 'number' &&
    Number.isFinite(summaryOverride.totalValidVotes)
      ? Math.max(0, Math.round(summaryOverride.totalValidVotes), computedSumValidVotes)
      : computedSumValidVotes;

  const rawTotalVoted = useSummary
    ? Math.max(0, Math.round(summaryOverride!.totalVoted || 0))
    : voters.filter((v) => v.hasVoted).length;
  const totalVoted = Math.max(rawTotalVoted, totalValidVotes);

  const rawTotalDpt = useSummary ? Math.max(0, Math.round(summaryOverride!.totalDpt)) : voters.length;
  const totalDpt = Math.max(rawTotalDpt, totalVoted);
  const totalNotVoted = computeNotVotedCount(totalDpt, totalVoted);
  const participationRate =
    totalDpt > 0 ? Number(Math.min(100, (totalVoted / totalDpt) * 100).toFixed(1)) : 0;

  const candidateStats: CandidateStat[] = sortedCandidates.map((c, idx) => {
    const votes = effectiveCandidateVotes[idx];
    return {
      ...c,
      votes,
      percentage: totalValidVotes > 0 ? Number(((votes / totalValidVotes) * 100).toFixed(1)) : 0,
    };
  });

  const grades: { grade: GradeLevel; label: string }[] = [
    { grade: 'X', label: 'Kelas X' },
    { grade: 'XI', label: 'Kelas XI' },
    { grade: 'XII', label: 'Kelas XII' },
  ];

  const hasGradeTotals = Boolean(
    useSummary &&
      summaryOverride?.gradeTotals &&
      Object.values(summaryOverride.gradeTotals).some((n) => typeof n === 'number' && n > 0)
  );

  const studentVoters = voters.filter((v) => !isAdditionalVoter(v));
  const additionalVoters = voters.filter((v) => isAdditionalVoter(v));

  const gradeStats: GradeStat[] = grades.map(({ grade, label }) => {
    if (hasGradeTotals) {
      const total = Math.max(0, Math.round(Number(summaryOverride?.gradeTotals?.[grade] ?? 0)));
      const voted = Math.max(0, Math.round(Number(summaryOverride?.gradeVoted?.[grade] ?? 0)));
      return {
        grade,
        label,
        total,
        voted,
        percentage: total > 0 ? Number(((voted / total) * 100).toFixed(1)) : 0,
      };
    }
    const group = studentVoters.filter((v) => v.grade === grade);
    const voted = group.filter((v) => v.hasVoted).length;
    const total = group.length;
    return {
      grade,
      label,
      total,
      voted,
      percentage: total > 0 ? Number(((voted / total) * 100).toFixed(1)) : 0,
    };
  });

  const hasDptbSummary = Boolean(
    hasGradeTotals &&
      summaryOverride?.gradeTotals &&
      typeof summaryOverride.gradeTotals.DPTB === 'number'
  );
  const dptbTotal = hasDptbSummary
    ? Math.max(0, Math.round(Number(summaryOverride?.gradeTotals?.DPTB ?? 0)))
    : additionalVoters.length;
  const dptbVoted = hasDptbSummary
    ? Math.max(0, Math.round(Number(summaryOverride?.gradeVoted?.DPTB ?? 0)))
    : additionalVoters.filter((v) => v.hasVoted).length;

  gradeStats.push({
    grade: 'DPTB',
    label: 'Guru & Tendik',
    total: dptbTotal,
    voted: dptbVoted,
    percentage: dptbTotal > 0 ? Number(((dptbVoted / dptbTotal) * 100).toFixed(1)) : 0,
  });

  return {
    totalDpt,
    totalVoted,
    totalNotVoted,
    participationRate,
    totalValidVotes,
    gradeStats,
    candidateStats,
  };
}

const CSV_HEADER_FIRST_COL_TOKENS = new Set([
  'nis',
  'nisn',
  'nip',
  'niy',
  'token',
  'id',
  'id_login',
  'id login',
  'nis/nisn',
  'nis/token',
  'nis_token',
  'nisn/token',
  'kode',
  'nomor',
]);

export function parseVotersCsv(
  csvText: string,
  existingNisSet: Set<string>,
  existingTokens: Set<string>,
  maxRows: number = MAX_CSV_VOTERS
): { added: Voter[]; skippedCount: number; errors: string[] } {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const added: Voter[] = [];
  const errors: string[] = [];
  let skippedCount = 0;
  let limitExceededNotified = false;

  lines.forEach((line, index) => {
    const cols = line.split(/[,;]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    const firstColNormalized = (cols[0] || '').toLowerCase();
    if (index === 0 && CSV_HEADER_FIRST_COL_TOKENS.has(firstColNormalized)) {
      return; // Skip header row
    }

    if (added.length >= maxRows) {
      if (!limitExceededNotified) {
        limitExceededNotified = true;
        errors.push(`Kapasitas maksimal ${maxRows} pemilih tercapai; baris selebihnya dilewati.`);
      }
      return;
    }

    if (cols.length < 3) {
      errors.push(`Baris ${index + 1}: Format tidak valid (minimal NIS, Nama, Kelas).`);
      return;
    }

    const [nis, name, kelas, optionalToken] = cols;
    if (!nis || !name || !kelas) {
      errors.push(`Baris ${index + 1}: NIS, Nama, atau Kelas kosong.`);
      return;
    }

    if (existingNisSet.has(nis)) {
      skippedCount += 1;
      return;
    }

    const tokenValid = optionalToken && /^\d{6}$/.test(optionalToken);
    const token = tokenValid ? optionalToken : generateSixDigitToken(existingTokens);

    existingNisSet.add(nis);
    existingTokens.add(token);

    added.push({
      id: getVoterDocIdFromNis(nis),
      nis,
      name,
      kelas,
      grade: extractGrade(kelas),
      token,
      hasVoted: false,
    });
  });

  return { added, skippedCount, errors };
}

export function parseDptbVotersCsv(
  csvText: string,
  existingNisSet: Set<string>,
  existingTokens: Set<string>,
  maxRows: number = MAX_CSV_VOTERS
): { added: Voter[]; skippedCount: number; errors: string[] } {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const added: Voter[] = [];
  const errors: string[] = [];
  let skippedCount = 0;
  let limitExceededNotified = false;

  lines.forEach((line, index) => {
    const cols = line.split(/[,;]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    const firstColNormalized = (cols[0] || '').toLowerCase();
    if (index === 0 && CSV_HEADER_FIRST_COL_TOKENS.has(firstColNormalized)) {
      return; // Skip header row (ID, Nama, Keterangan)
    }

    if (added.length >= maxRows) {
      if (!limitExceededNotified) {
        limitExceededNotified = true;
        errors.push(`Kapasitas maksimal ${maxRows} pemilih tambahan tercapai; baris selebihnya dilewati.`);
      }
      return;
    }

    if (cols.length < 3) {
      errors.push(`Baris ${index + 1}: Format tidak valid (minimal ID, Nama, Keterangan).`);
      return;
    }

    const [idLogin, name, keterangan, optionalToken] = cols;
    if (!idLogin || !name || !keterangan) {
      errors.push(`Baris ${index + 1}: ID, Nama, atau Keterangan kosong.`);
      return;
    }

    if (!isAdditionalVoter({ kelas: keterangan })) {
      errors.push(
        `Baris ${index + 1}: Keterangan "${keterangan}" merupakan kelas siswa. Gunakan selain kelas siswa (mis. Kepala Sekolah, Guru, TENDIK).`
      );
      return;
    }

    if (existingNisSet.has(idLogin)) {
      skippedCount += 1;
      return;
    }

    const tokenValid = optionalToken && /^\d{6}$/.test(optionalToken);
    const token = tokenValid ? optionalToken : generateSixDigitToken(existingTokens);

    existingNisSet.add(idLogin);
    existingTokens.add(token);

    added.push({
      id: getVoterDocIdFromNis(idLogin),
      nis: idLogin,
      name,
      kelas: keterangan,
      grade: extractGrade(keterangan),
      token,
      hasVoted: false,
    });
  });

  return { added, skippedCount, errors };
}

export function mergeDptbCsvVoters(existingVoters: Voter[], importedDptb: Voter[]): Voter[] {
  const existingNisSet = new Set(existingVoters.map((v) => v.nis.trim()));
  const existingIdSet = new Set(existingVoters.map((v) => v.id));
  const uniqueAdditions = importedDptb.filter(
    (v) => !existingNisSet.has(v.nis.trim()) && !existingIdSet.has(v.id)
  );
  return sortVotersOrdered([...uniqueAdditions, ...existingVoters]);
}

export function exportVotersCsv(voters: Voter[]): string {
  const sorted = sortVotersOrdered(voters);
  const header = 'NIS/NISN,Nama Lengkap,Kelas,Angkatan,Status Memilih,Waktu Memilih';
  const rows = sorted.map((v) => {
    const safeName = `"${v.name.replace(/"/g, '""')}"`;
    const safeKelas = `"${v.kelas.replace(/"/g, '""')}"`;
    const status = v.hasVoted ? 'Sudah Memilih' : 'Belum Memilih';
    const votedAt = v.votedAt ? new Date(v.votedAt).toLocaleString('id-ID') : '-';
    return `${v.nis},${safeName},${safeKelas},${v.grade},${status},"${votedAt}"`;
  });
  return [header, ...rows].join('\n');
}

export function resetElectionData(
  state: DatabaseState,
  actor: AdminUser,
  nowIso: string = new Date().toISOString()
): DatabaseState {
  const resetVoters = state.voters.map((v) => ({
    ...v,
    hasVoted: false,
    votedAt: undefined,
    votedCandidateId: undefined,
  }));

  const resetCandidates = state.candidates.map((c) => ({
    ...c,
    votes: 0,
  }));

  const auditLogs = addAuditLog(
    state.auditLogs,
    actor.fullName,
    actor.role,
    'RESET_ELECTION',
    'Mereset seluruh perolehan suara paslon dan status memilih DPT menjadi nol.',
    nowIso
  );

  return {
    ...state,
    voters: resetVoters,
    candidates: resetCandidates,
    auditLogs,
    lastUpdated: Date.now(),
  };
}

export type AdminPanelTab =
  | 'overview'
  | 'dpt'
  | 'sheets'
  | 'gas'
  | 'candidates'
  | 'staff'
  | 'settings'
  | 'audit';

const ADMIN_ALLOWED_TABS: AdminPanelTab[] = ['overview', 'dpt'];
const SUPERADMIN_ALLOWED_TABS: AdminPanelTab[] = [
  'overview',
  'dpt',
  'candidates',
  'staff',
  'settings',
  'sheets',
  'gas',
  'audit',
];

export function getAllowedAdminTabs(role: AdminRole): AdminPanelTab[] {
  return role === 'SUPERADMIN' ? [...SUPERADMIN_ALLOWED_TABS] : [...ADMIN_ALLOWED_TABS];
}

export function canAccessAdminTab(role: AdminRole, tab: AdminPanelTab): boolean {
  return role === 'SUPERADMIN'
    ? SUPERADMIN_ALLOWED_TABS.includes(tab)
    : ADMIN_ALLOWED_TABS.includes(tab);
}

export function canEditVotedCandidate(role: AdminRole): boolean {
  return role === 'SUPERADMIN';
}

export interface VoterEditPayload {
  nis: string;
  name: string;
  kelas: string;
  hasVoted: boolean;
  votedCandidateId?: string;
}

export function applyVoterEditInState(
  state: DatabaseState,
  voterId: string,
  payload: VoterEditPayload,
  actor: Pick<AdminUser, 'fullName' | 'role'>,
  nowIso: string = new Date().toISOString()
): { nextState: DatabaseState; auditAction: string; auditDetail: string } {
  const existing = state.voters.find((v) => v.id === voterId);
  if (!existing) {
    throw new Error('Data pemilih tidak ditemukan.');
  }

  const nis = payload.nis.trim();
  const name = payload.name.trim();
  const kelas = payload.kelas.trim();
  if (!nis || !name || !kelas) {
    throw new Error('NIS/NISN, Nama Lengkap, dan Kelas wajib diisi.');
  }

  const duplicateNis = state.voters.some((v) => v.nis === nis && v.id !== voterId);
  if (duplicateNis) {
    throw new Error(`NIS/NISN ${nis} sudah terdaftar di DPT.`);
  }

  const canModifyChoice = actor.role === 'SUPERADMIN';
  const wasVoted = existing.hasVoted;
  const prevCandidateId = existing.votedCandidateId;
  const nextHasVoted = Boolean(payload.hasVoted);

  let nextCandidateId: string | undefined;
  if (!nextHasVoted) {
    nextCandidateId = undefined;
  } else if (canModifyChoice) {
    const requestedId = payload.votedCandidateId?.trim() || undefined;
    if (requestedId && !state.candidates.some((c) => c.id === requestedId)) {
      throw new Error('Pasangan calon yang dipilih tidak ditemukan.');
    }
    nextCandidateId = requestedId;
  } else {
    nextCandidateId = wasVoted ? prevCandidateId : undefined;
  }

  const candidateChoiceChanged =
    (wasVoted ? prevCandidateId : undefined) !== (nextHasVoted ? nextCandidateId : undefined);

  let nextCandidates = state.candidates;
  if (candidateChoiceChanged) {
    nextCandidates = state.candidates.map((c) => {
      let votes = c.votes;
      if (wasVoted && prevCandidateId === c.id) {
        votes = Math.max(0, votes - 1);
      }
      if (nextHasVoted && nextCandidateId === c.id) {
        votes += 1;
      }
      return votes === c.votes ? c : { ...c, votes };
    });
  }

  const nextVoters = state.voters.map((v) =>
    v.id === voterId
      ? {
          ...v,
          nis,
          name,
          kelas,
          grade: extractGrade(kelas),
          hasVoted: nextHasVoted,
          votedAt: nextHasVoted ? v.votedAt || nowIso : undefined,
          votedCandidateId: nextCandidateId,
        }
      : v
  );

  let auditAction = 'UPDATE_VOTER';
  let auditDetail = `Memperbarui data pemilih ${name} (NIS/NISN ${nis}).`;

  if (canModifyChoice && nextHasVoted && nextCandidateId && nextCandidateId !== prevCandidateId) {
    const chosenCand = state.candidates.find((c) => c.id === nextCandidateId);
    const candLabel = chosenCand
      ? `Paslon 0${chosenCand.nomorUrut} (${chosenCand.ketuaName} & ${chosenCand.wakilName})`
      : nextCandidateId;
    auditAction = 'UPDATE_VOTER_VOTE_CHOICE';
    auditDetail = `Memperbarui data pemilih ${name} (NIS/NISN ${nis}) dan menetapkan pilihan suara ke ${candLabel}.`;
  } else if (wasVoted && !nextHasVoted) {
    auditDetail = `Memperbarui data pemilih ${name} (NIS/NISN ${nis}) dan membatalkan status sudah memilih.`;
  }

  const auditLogs = addAuditLog(
    state.auditLogs,
    actor.fullName,
    actor.role,
    auditAction,
    auditDetail,
    nowIso
  );

  return {
    nextState: {
      ...state,
      voters: nextVoters,
      candidates: nextCandidates,
      auditLogs,
      lastUpdated: Date.now(),
    },
    auditAction,
    auditDetail,
  };
}

export function deleteVotersByIds(voters: Voter[], idsToDelete: Set<string>): Voter[] {
  if (idsToDelete.size === 0) return voters;
  return voters.filter((v) => !idsToDelete.has(v.id));
}

export function normalizeWhatsappNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) {
    return `62${digits.slice(1)}`;
  }
  if (digits.startsWith('8')) {
    return `62${digits}`;
  }
  return digits;
}

export function maskWhatsappNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 4)}••••${digits.slice(-4)}`;
}

export function formatCameraPermissionError(
  errName: string,
  permissionPreviouslyBlocked: boolean
): string {
  if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
    return permissionPreviouslyBlocked
      ? 'Izin kamera diblokir di perangkat/browser. Tekan ikon gembok/izin di bilah alamat lalu pilih Izinkan Kamera, kemudian tekan Aktifkan Kamera lagi.'
      : 'Persetujuan kamera ditolak atau dibatalkan. Tekan Aktifkan Kamera lalu pilih Izinkan saat notifikasi izin kamera Laptop/HP muncul.';
  }
  if (errName === 'SecurityError') {
    return 'Akses kamera memerlukan konteks aman (HTTPS / izin frame kamera). Buka ulang halaman melalui HTTPS atau unggah gambar QR Kartu Pemilih.';
  }
  if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
    return 'Perangkat kamera tidak ditemukan pada Laptop/HP ini. Anda tetap dapat mengunggah gambar QR Kartu Pemilih.';
  }
  if (errName === 'NotReadableError' || errName === 'TrackStartError') {
    return 'Kamera sedang digunakan aplikasi lain. Tutup aplikasi kamera lain lalu tekan Aktifkan Kamera lagi.';
  }
  return 'Kamera tidak dapat diakses. Tekan Aktifkan Kamera untuk mencoba lagi atau unggah gambar QR Kartu Pemilih.';
}
