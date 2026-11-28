import { SEED_DATABASE, SEED_TIMESTAMP } from '../data/seedData';
import type {
  AdminRole,
  AdminUser,
  Candidate,
  DatabaseState,
  ElectionSettings,
  VoteReceipt,
  Voter,
} from '../types/evoting';
import { DEFAULT_THEME } from './theme';
import {
  loadPendingOfflineVotes,
  reconcilePendingVotesIntoDb,
} from './offlineVoteQueue';
import { shouldAcceptServerState } from './syncArbitration';

export const STORAGE_KEY = 'osis_evoting_db_v2';
export const SAME_TAB_EVENT = 'osis-evoting-storage-update';
export const ADMIN_SESSION_KEY = 'osis_evoting_admin_session_v1';

export interface StoredAdminSession {
  adminId: string;
  adminSnapshot: AdminUser;
  view: 'ADMIN' | 'MONITOR';
  previousViewBeforeMonitor?: 'LOGIN' | 'ADMIN_LOGIN' | 'VOTER' | 'ADMIN' | 'MONITOR';
}

export function normalizeDatabase(parsed: Partial<DatabaseState> | null | undefined): DatabaseState {
  if (!parsed || !Array.isArray(parsed.voters) || !Array.isArray(parsed.candidates)) {
    return SEED_DATABASE;
  }
  const rawAdmins =
    Array.isArray(parsed.admins) && parsed.admins.length > 0
      ? parsed.admins
      : SEED_DATABASE.admins;
  const admins = rawAdmins.map((admin) => {
    const seedMatch = SEED_DATABASE.admins.find((s) => s.id === admin.id);
    const isLegacyDefaultSuper =
      admin.id === 'adm_super' && admin.username === 'superadmin';
    const username = isLegacyDefaultSuper ? 'smansakabun' : admin.username;
    const password =
      isLegacyDefaultSuper && admin.password === 'super123'
        ? 'Smansakabun123!'
        : admin.password;
    const fullName =
      admin.id === 'adm_super' && admin.fullName === 'Drs. Rizky Pratama, M.Pd.'
        ? 'Tamtowi Yahya, S.Pd.'
        : admin.fullName;
    const whatsappNumber = admin.whatsappNumber ?? seedMatch?.whatsappNumber ?? '';
    return {
      ...admin,
      username,
      password,
      fullName,
      whatsappNumber,
    };
  });
  const candidates = parsed.candidates.map((c) => {
    const colorUpper = (c.accentColor || '').trim().toUpperCase();
    const shouldUpgradePaslon1Green =
      (c.id === 'paslon_1' || c.nomorUrut === 1) && (!colorUpper || colorUpper === '#1E3A5F');
    return shouldUpgradePaslon1Green ? { ...c, accentColor: '#059669' } : c;
  });
  const candidateIds = new Set(candidates.map((c) => c.id));
  const voters = parsed.voters.map((voter) => {
    if (!voter.hasVoted || voter.votedCandidateId) return voter;
    const seedVoter = SEED_DATABASE.voters.find((s) => s.id === voter.id);
    if (seedVoter?.votedCandidateId && candidateIds.has(seedVoter.votedCandidateId)) {
      return { ...voter, votedCandidateId: seedVoter.votedCandidateId };
    }
    return voter;
  });
  const rawLogo = (parsed.settings?.logoUrl || '').trim();
  const normalizedLogoUrl =
    !rawLogo || rawLogo === '/src/assets/images/school_osis_emblem_1794869431849.jpg'
      ? SEED_DATABASE.settings.logoUrl
      : rawLogo;

  const rawMode = parsed.settings?.voterLoginMode;
  const voterLoginMode =
    rawMode === 'QR_CODE' || rawMode === 'BOTH' || rawMode === 'NISN'
      ? rawMode
      : SEED_DATABASE.settings.voterLoginMode || 'QR_CODE';

  return {
    voters,
    candidates,
    admins,
    auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
    settings: {
      ...SEED_DATABASE.settings,
      ...(parsed.settings || {}),
      logoUrl: normalizedLogoUrl,
      voterLoginMode,
      theme: {
        ...DEFAULT_THEME,
        ...(parsed.settings?.theme || {}),
      },
    },
    lastUpdated: typeof parsed.lastUpdated === 'number' ? parsed.lastUpdated : Date.now(),
  };
}

export function loadDatabase(): DatabaseState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_DATABASE));
      return SEED_DATABASE;
    }
    const parsed = JSON.parse(raw) as Partial<DatabaseState>;
    const normalized = normalizeDatabase(parsed);
    if (!parsed || !Array.isArray(parsed.voters) || !Array.isArray(parsed.candidates)) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    }
    return reconcilePendingVotesIntoDb(normalized, loadPendingOfflineVotes());
  } catch {
    return reconcilePendingVotesIntoDb(SEED_DATABASE, loadPendingOfflineVotes());
  }
}

let latestLocalSavedTs = 0;

export function saveDatabase(nextState: DatabaseState, preserveTimestamp = false): DatabaseState {
  const stamped: DatabaseState = {
    ...normalizeDatabase(nextState),
    lastUpdated: preserveTimestamp && nextState.lastUpdated ? nextState.lastUpdated : Date.now(),
  };
  latestLocalSavedTs = stamped.lastUpdated;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped));
    window.dispatchEvent(new CustomEvent(SAME_TAB_EVENT, { detail: stamped }));
  } catch (err) {
    console.error('Gagal menyimpan database ke LocalStorage:', err);
  }
  return stamped;
}

export function subscribeDatabaseChanges(onChange: (nextState: DatabaseState) => void): () => void {
  const handleStorageEvent = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue) as Partial<DatabaseState>;
        onChange(normalizeDatabase(parsed));
      } catch {
        // Ignore malformed storage payload
      }
    }
  };

  const handleSameTabEvent = (e: Event) => {
    const custom = e as CustomEvent<DatabaseState>;
    if (custom.detail) {
      onChange(normalizeDatabase(custom.detail));
    } else {
      onChange(loadDatabase());
    }
  };

  window.addEventListener('storage', handleStorageEvent);
  window.addEventListener(SAME_TAB_EVENT, handleSameTabEvent);

  return () => {
    window.removeEventListener('storage', handleStorageEvent);
    window.removeEventListener(SAME_TAB_EVENT, handleSameTabEvent);
  };
}

// Persistent Admin Session helpers (prevents accidental logout on tab refresh/sleep/reconnect)
export function loadAdminSession(): StoredAdminSession | null {
  try {
    const raw = window.localStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAdminSession>;
    if (!parsed || !parsed.adminId || !parsed.adminSnapshot) return null;
    return {
      adminId: parsed.adminId,
      adminSnapshot: parsed.adminSnapshot,
      view: parsed.view === 'MONITOR' ? 'MONITOR' : 'ADMIN',
      previousViewBeforeMonitor: parsed.previousViewBeforeMonitor || 'ADMIN',
    };
  } catch {
    return null;
  }
}

export function saveAdminSession(session: StoredAdminSession): void {
  try {
    window.localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage quota error
  }
}

export function clearAdminSession(): void {
  try {
    window.localStorage.removeItem(ADMIN_SESSION_KEY);
  } catch {
    // Ignore
  }
}

// Cross-Device Server Synchronization (SSE + Fetch fallback — automatically disabled on static Netlify hosting)
type ServerBackendStatus = 'unknown' | 'express' | 'static';
let serverBackendStatus: ServerBackendStatus = 'unknown';
let probeBackendPromise: Promise<boolean> | null = null;

function isJsonResponse(res: Response): boolean {
  const contentType = res.headers.get('content-type');
  return Boolean(contentType && contentType.toLowerCase().includes('application/json'));
}

export function hasExpressBackend(): boolean {
  return serverBackendStatus === 'express';
}

export async function probeServerBackend(): Promise<boolean> {
  if (serverBackendStatus === 'express') return true;
  if (serverBackendStatus === 'static') return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }
  if (probeBackendPromise) {
    return probeBackendPromise;
  }

  probeBackendPromise = (async () => {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (!res.ok || !isJsonResponse(res)) {
        serverBackendStatus = 'static';
        return false;
      }
      const data = (await res.json()) as { ok?: boolean };
      if (data && data.ok === true) {
        serverBackendStatus = 'express';
        return true;
      }
      serverBackendStatus = 'static';
      return false;
    } catch {
      return false;
    } finally {
      probeBackendPromise = null;
    }
  })();

  return probeBackendPromise;
}

let localMutationInFlightCount = 0;

export function initServerSync(onRemoteDb: (nextDb: DatabaseState) => void): () => void {
  let active = true;
  let lastVersion = 0;
  let lastAppliedTs = 0;
  let es: EventSource | null = null;
  let pollTimer: number | null = null;
  let listenersAttached = false;

  const applyServerPayload = (rawDb: Partial<DatabaseState> | undefined, version?: number) => {
    if (!active || !rawDb) return;
    const currentLocalTs = latestLocalSavedTs || loadDatabase().lastUpdated;
    const acceptable = shouldAcceptServerState({
      localLastUpdated: currentLocalTs,
      incomingLastUpdated: rawDb.lastUpdated,
      incomingVersion: version,
      lastAppliedVersion: lastVersion,
      seedTimestamp: SEED_TIMESTAMP,
      localMutationInFlight: localMutationInFlightCount > 0,
    });
    if (!acceptable) {
      return;
    }
    if (typeof version === 'number' && version > 0) {
      lastVersion = version;
    } else if (typeof rawDb.lastUpdated === 'number' && rawDb.lastUpdated === lastAppliedTs) {
      return;
    }
    if (typeof rawDb.lastUpdated === 'number') {
      lastAppliedTs = rawDb.lastUpdated;
    }
    const normalized = reconcilePendingVotesIntoDb(
      normalizeDatabase(rawDb),
      loadPendingOfflineVotes()
    );
    const saved = saveDatabase(normalized, true);
    onRemoteDb(saved);
  };

  const fetchLatest = async () => {
    if (!active || serverBackendStatus === 'static') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (!res.ok || !isJsonResponse(res)) {
        if (res.ok || res.status === 404) {
          serverBackendStatus = 'static';
        }
        return;
      }
      const data = (await res.json()) as { db?: DatabaseState; version?: number };
      applyServerPayload(data.db, data.version);
    } catch {
      // Offline / dev restart tolerance — keep local cache
    }
  };

  const handleResume = () => {
    if (document.visibilityState === 'visible') {
      void fetchLatest();
    }
  };

  void (async () => {
    const hasServer = await probeServerBackend();
    if (!active || !hasServer) return;

    void fetchLatest();

    if (typeof EventSource !== 'undefined') {
      es = new EventSource('/api/events');
      const handleEvent = (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data) as { db?: DatabaseState; version?: number };
          applyServerPayload(data.db, data.version);
        } catch {
          // Ignore invalid JSON
        }
      };
      es.addEventListener('init', handleEvent as EventListener);
      es.addEventListener('state', handleEvent as EventListener);
    }

    pollTimer = window.setInterval(() => {
      void fetchLatest();
    }, 5000);

    window.addEventListener('focus', fetchLatest);
    window.addEventListener('online', fetchLatest);
    document.addEventListener('visibilitychange', handleResume);
    listenersAttached = true;
  })();

  return () => {
    active = false;
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
    }
    if (listenersAttached) {
      window.removeEventListener('focus', fetchLatest);
      window.removeEventListener('online', fetchLatest);
      document.removeEventListener('visibilitychange', handleResume);
    }
    es?.close();
  };
}

async function postJson<T>(
  url: string,
  body: unknown,
  syncLocalOnSuccess = true
): Promise<T | null> {
  if (serverBackendStatus === 'static') {
    return null;
  }
  if (syncLocalOnSuccess) {
    localMutationInFlightCount += 1;
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status >= 500) {
      return null;
    }
    if (!isJsonResponse(res)) {
      if (res.status === 404 || res.ok) {
        serverBackendStatus = 'static';
      }
      return null;
    }
    const data = (await res.json()) as T & { ok?: boolean; db?: DatabaseState; version?: number };
    if (
      syncLocalOnSuccess &&
      res.ok &&
      data &&
      typeof data === 'object' &&
      data.ok !== false &&
      'db' in data &&
      data.db
    ) {
      const reconciled = reconcilePendingVotesIntoDb(
        normalizeDatabase(data.db),
        loadPendingOfflineVotes()
      );
      saveDatabase(reconciled, true);
    }
    return data;
  } catch {
    return null;
  } finally {
    if (syncLocalOnSuccess) {
      localMutationInFlightCount = Math.max(0, localMutationInFlightCount - 1);
    }
  }
}

export async function apiFetchLatestState(): Promise<DatabaseState | null> {
  if (serverBackendStatus === 'static') {
    return null;
  }
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok || !isJsonResponse(res)) {
      if (res.status === 404 || res.ok) {
        serverBackendStatus = 'static';
      }
      return null;
    }
    const data = (await res.json()) as { db?: DatabaseState };
    if (!data?.db) return null;
    const reconciled = reconcilePendingVotesIntoDb(
      normalizeDatabase(data.db),
      loadPendingOfflineVotes()
    );
    return saveDatabase(reconciled, true);
  } catch {
    return null;
  }
}

export async function apiCastVote(
  voterId: string,
  candidateId: string
): Promise<{ ok: boolean; db?: DatabaseState; receipt?: VoteReceipt; error?: string } | null> {
  return postJson('/api/vote', { voterId, candidateId });
}

export async function apiUpdateVoters(
  voters: Voter[],
  actorName: string,
  actorRole: AdminRole | 'SYSTEM',
  action: string,
  detail: string
): Promise<{ ok: boolean; db?: DatabaseState } | null> {
  return postJson('/api/admin/voters', { voters, actorName, actorRole, action, detail });
}

export async function apiEditVoter(
  voterId: string,
  payload: {
    nis: string;
    name: string;
    kelas: string;
    hasVoted: boolean;
    votedCandidateId?: string;
  },
  actorName: string,
  actorRole: AdminRole
): Promise<{ ok: boolean; db?: DatabaseState; error?: string } | null> {
  return postJson(
    '/api/admin/voter-edit',
    {
      voterId,
      ...payload,
      actorName,
      actorRole,
    },
    false
  );
}

export async function apiUpdateCandidates(
  candidates: Candidate[],
  actorName: string,
  actorRole: AdminRole | 'SYSTEM',
  action: string,
  detail: string
): Promise<{ ok: boolean; db?: DatabaseState } | null> {
  return postJson('/api/admin/candidates', { candidates, actorName, actorRole, action, detail });
}

export async function apiUpdateAdmins(
  admins: AdminUser[],
  actorName: string,
  actorRole: AdminRole | 'SYSTEM',
  action: string,
  detail: string
): Promise<{ ok: boolean; db?: DatabaseState } | null> {
  return postJson('/api/admin/admins', { admins, actorName, actorRole, action, detail });
}

export async function apiUpdateSettings(
  settings: ElectionSettings,
  actorName: string,
  actorRole: AdminRole | 'SYSTEM',
  action: string,
  detail: string
): Promise<{ ok: boolean; db?: DatabaseState } | null> {
  return postJson('/api/admin/settings', { settings, actorName, actorRole, action, detail });
}

export async function apiRestoreDatabase(
  dbState: DatabaseState,
  preserveTimestamp = false
): Promise<{ ok: boolean; db?: DatabaseState } | null> {
  return postJson(
    '/api/admin/restore',
    { db: dbState, preserveTimestamp },
    !preserveTimestamp
  );
}

export async function apiLogAdminLogin(
  actorName: string,
  actorRole: AdminRole,
  detail: string
): Promise<{ ok: boolean; db?: DatabaseState } | null> {
  return postJson('/api/admin/login-log', { actorName, actorRole, detail }, false);
}

export async function apiAdminQrLogin(
  qrPayload: string
): Promise<{ ok: boolean; admin?: AdminUser; error?: string } | null> {
  return postJson('/api/admin/qr-login', { qrPayload }, false);
}

export async function apiResetElection(
  actor: AdminUser
): Promise<{ ok: boolean; db?: DatabaseState } | null> {
  return postJson('/api/admin/reset', { actor });
}

export async function apiToggleSecretMode(
  hideLiveResults: boolean,
  actorName: string,
  actorRole: AdminRole | 'SYSTEM'
): Promise<{ ok: boolean; db?: DatabaseState } | null> {
  return postJson('/api/monitor/secret-mode', { hideLiveResults, actorName, actorRole });
}

export async function apiRequestForgotPassword(
  username: string,
  whatsappNumber: string
): Promise<{
  ok: boolean;
  error?: string;
  db?: DatabaseState;
  maskedWhatsapp?: string;
  waUrl?: string;
  otpPreview?: string;
  adminFullName?: string;
  role?: AdminRole;
} | null> {
  return postJson('/api/admin/forgot-password/request', { username, whatsappNumber });
}

export async function apiResetForgotPassword(
  username: string,
  otp: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string; db?: DatabaseState } | null> {
  return postJson('/api/admin/forgot-password/reset', { username, otp, newPassword });
}
