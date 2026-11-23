import { initializeApp, onLog } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  disableNetwork,
  doc,
  enableNetwork,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  increment,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  AdminRole,
  AuditLogEntry,
  Candidate,
  DatabaseState,
  GradeLevel,
  ThemeSurface,
  Voter,
  VoterLoginMode,
} from '../types/evoting';
import {
  DPT_DISPLAY_LIMIT,
  getVoterDocIdFromNis,
  isAdditionalVoter,
  MAX_CSV_VOTERS,
} from '../utils/electionLogic';
import {
  buildSummaryCounters,
  chunkIntoBatches,
  deleteWorkspaceVoterCacheEntries,
  diffAuditLogsWithSyncCache,
  diffVotersWithSyncCache,
  FIRESTORE_CSV_BATCH_LIMIT,
  formatFirebaseAuthError,
  getQuotaCooldownUntilMs,
  hasCandidateChanged,
  hasElectionSummaryChanged,
  isFirestoreQuotaError,
  isQuotaCooldownActive,
  loadQuotaCooldownUntil,
  loadWorkspaceSyncCache,
  recordFirestoreQuotaOps,
  recordWorkspaceCsvImportCache,
  saveQuotaCooldownUntil,
  saveWorkspaceSyncCache,
  updateWorkspaceVoterCacheEntry,
} from '../utils/firebaseSyncLogic';
import { DEFAULT_THEME, resolveTheme } from '../utils/theme';

export const FIRESTORE_PROJECT_ID =
  (firebaseConfig as { projectId?: string }).projectId || 'gen-lang-client-0680921408';

export const FIRESTORE_DATABASE_ID =
  (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId ||
  'ai-studio-evotingosissiste-88f70507-a0c9-4611-90fb-cc689f7c3b12';

const app = initializeApp(firebaseConfig);
export const firestoreDb = getFirestore(app, FIRESTORE_DATABASE_ID);
export const auth = getAuth(app);

const ensuredProfileUids = new Set<string>();
type QuotaListener = (err: Error) => void;
const quotaWaiters = new Set<QuotaListener>();
const quotaSubscribers = new Set<(untilMs: number) => void>();

export function onFirestoreQuotaExhausted(cb: (untilMs: number) => void): () => void {
  quotaSubscribers.add(cb);
  return () => quotaSubscribers.delete(cb);
}

export async function resetFirestoreQuotaAndEnableNetwork(): Promise<void> {
  saveQuotaCooldownUntil(null);
  await enableNetwork(firestoreDb);
}

if (isQuotaCooldownActive(loadQuotaCooldownUntil())) {
  void disableNetwork(firestoreDb);
}

onLog(
  (log) => {
    if (isFirestoreQuotaError(log.message)) {
      const untilMs = getQuotaCooldownUntilMs();
      saveQuotaCooldownUntil(untilMs);
      void disableNetwork(firestoreDb);
      const err = new Error(
        log.message || 'FirebaseError: [code=resource-exhausted]: Quota limit exceeded.'
      );
      for (const rejectWaiter of Array.from(quotaWaiters)) {
        rejectWaiter(err);
      }
      for (const sub of Array.from(quotaSubscribers)) {
        sub(untilMs);
      }
    }
  },
  { level: 'error' }
);

async function runFirestoreWrite<T>(operation: () => Promise<T>, timeoutMs = 10000): Promise<T> {
  const cooldownUntil = loadQuotaCooldownUntil();
  if (isQuotaCooldownActive(cooldownUntil)) {
    void disableNetwork(firestoreDb);
    throw new Error(
      'FirebaseError: [code=resource-exhausted]: Quota limit exceeded. Auto-Sync dijeda hingga kuota harian direset.'
    );
  }

  let timer: number | undefined;
  let waiter: QuotaListener | undefined;

  try {
    const guardPromise = new Promise<never>((_, reject) => {
      waiter = (err: Error) => reject(err);
      quotaWaiters.add(waiter);
      if (typeof window !== 'undefined') {
        timer = window.setTimeout(() => {
          void disableNetwork(firestoreDb);
          reject(
            new Error(
              'Sinkronisasi Firestore melebihi batas waktu (kemungkinan kuota penulisan harian habis atau koneksi terputus).'
            )
          );
        }, timeoutMs);
      }
    });

    return await Promise.race([operation(), guardPromise]);
  } finally {
    if (timer !== undefined && typeof window !== 'undefined') {
      window.clearTimeout(timer);
    }
    if (waiter) {
      quotaWaiters.delete(waiter);
    }
  }
}

export const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'] as const;

const googleProvider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  googleProvider.addScope(scope);
}
googleProvider.setCustomParameters({ prompt: 'select_account' });

// In-memory cache ONLY for Google OAuth access token (never persist to localStorage/sessionStorage)
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  if (isQuotaCooldownActive(loadQuotaCooldownUntil())) {
    return;
  }
  try {
    await getDocFromServer(doc(firestoreDb, 'test', 'connection'));
    recordFirestoreQuotaOps({ reads: 1 }, 'Cek Koneksi Awal');
  } catch (error) {
    if (
      !isQuotaCooldownActive(loadQuotaCooldownUntil()) &&
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

if (!isQuotaCooldownActive(loadQuotaCooldownUntil())) {
  void testConnection();
}

export function initAuthListener(
  onUpdate: (state: { user: User | null; accessToken: string | null }) => void
): Unsubscribe {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      if (cachedAccessToken) {
        onUpdate({ user, accessToken: cachedAccessToken });
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onUpdate({ user, accessToken: null });
      }
    } else {
      cachedAccessToken = null;
      onUpdate({ user: null, accessToken: null });
    }
  });
}

export async function googleSignIn(
  loginHint?: string
): Promise<{ user: User; accessToken: string }> {
  try {
    isSigningIn = true;
    const customParams: Record<string, string> = { prompt: 'select_account' };
    if (loginHint && loginHint.trim()) {
      customParams.login_hint = loginHint.trim();
    }
    googleProvider.setCustomParameters(customParams);
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Gagal mendapatkan token akses Google Sheets dari sesi masuk.');
    }
    cachedAccessToken = credential.accessToken;
    await ensureUserProfile(result.user);
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (err) {
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    throw new Error(formatFirebaseAuthError(err, host));
  } finally {
    isSigningIn = false;
  }
}

export async function getAccessToken(): Promise<string | null> {
  return cachedAccessToken;
}

export async function googleSignOut(): Promise<void> {
  cachedAccessToken = null;
  await signOut(auth);
}

// --- Blueprint-Aligned Sanitization Helpers ---
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function sanitizeDocId(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned && ID_PATTERN.test(cleaned) ? cleaned : fallback;
}

function clampString(raw: string | undefined, maxLen: number, fallback = '-'): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return fallback.slice(0, maxLen);
  return trimmed.slice(0, maxLen);
}

function clampInt(val: number, min: number, max: number): number {
  const num = Number.isFinite(val) ? Math.round(val) : min;
  return Math.max(min, Math.min(max, num));
}

export interface SheetLinkDoc {
  id: string;
  ownerId: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetName: string;
  purpose: 'dpt_import' | 'results_export' | 'both';
  spreadsheetUrl: string;
  updatedAt?: unknown;
}

const DEFAULT_SCHOOL_LOGO = '/assets/aistudio/LOGO_SMANSA_3D_d5e941c9.png';
const DEFAULT_PASLON_PHOTO = '/src/assets/images/paslon_01_portrait_1794869429956.jpg';

function clampBoundedImageUrl(raw: string | undefined, maxLen: number, fallback: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed || trimmed.length > maxLen) return fallback;
  return trimmed;
}

export interface CloudElectionSummary {
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
  voterLoginMode?: VoterLoginMode;
  candidateVotes?: Record<string, number>;
  gradeTotals?: Record<string, number>;
  gradeVoted?: Record<string, number>;
  clientUpdatedAt: number;
  status: 'draft' | 'active' | 'closed';
}

export async function ensureUserProfile(user: User, force = false): Promise<void> {
  const uid = sanitizeDocId(user.uid, 'user');
  if (!force && ensuredProfileUids.has(uid)) {
    return;
  }
  const path = `users/${uid}`;
  const ref = doc(firestoreDb, 'users', uid);
  try {
    const snap = await getDoc(ref);
    recordFirestoreQuotaOps({ reads: 1 }, 'Profil Akun Panitia');
    const displayName = clampString(user.displayName || user.email || 'Panitia OSIS', 120);
    const email = clampString(user.email || 'user@example.com', 160);
    if (!snap.exists()) {
      await runFirestoreWrite(() =>
        setDoc(ref, {
          uid,
          email,
          displayName,
          role: 'operator',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      recordFirestoreQuotaOps({ writes: 1 }, 'Profil Akun Panitia');
    } else {
      const existing = snap.data() as { email?: string; displayName?: string } | undefined;
      if (existing?.email !== email || existing?.displayName !== displayName) {
        await runFirestoreWrite(() =>
          setDoc(
            ref,
            {
              email,
              displayName,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          )
        );
        recordFirestoreQuotaOps({ writes: 1 }, 'Profil Akun Panitia');
      }
    }
    ensuredProfileUids.add(uid);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveSheetLinkToFirestore(
  user: User,
  link: Omit<SheetLinkDoc, 'id' | 'ownerId' | 'updatedAt'> & { id?: string }
): Promise<string> {
  const uid = sanitizeDocId(user.uid, 'user');
  const spreadsheetId = sanitizeDocId(link.spreadsheetId, 'sheet');
  const linkId = sanitizeDocId(link.id || `sheet_${spreadsheetId}`, 'sheet_link');
  const path = `users/${uid}/sheetLinks/${linkId}`;
  const ref = doc(firestoreDb, 'users', uid, 'sheetLinks', linkId);

  try {
    const snap = await getDoc(ref);
    recordFirestoreQuotaOps({ reads: 1 }, 'Tautan Google Sheets');
    const payload = {
      id: linkId,
      ownerId: uid,
      spreadsheetId,
      spreadsheetTitle: clampString(link.spreadsheetTitle, 200, 'Spreadsheet E-Voting'),
      sheetName: clampString(link.sheetName, 120, 'Sheet1'),
      purpose: link.purpose,
      spreadsheetUrl: clampString(
        link.spreadsheetUrl,
        300,
        `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
      ),
      updatedAt: serverTimestamp(),
    };
    if (!snap.exists()) {
      await runFirestoreWrite(() => setDoc(ref, { ...payload, createdAt: serverTimestamp() }));
    } else {
      await runFirestoreWrite(() => setDoc(ref, payload, { merge: true }));
    }
    recordFirestoreQuotaOps({ writes: 1 }, 'Tautan Google Sheets');
    return linkId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteSheetLinkFromFirestore(userId: string, linkId: string): Promise<void> {
  const uid = sanitizeDocId(userId, 'user');
  const cleanId = sanitizeDocId(linkId, 'sheet_link');
  const path = `users/${uid}/sheetLinks/${cleanId}`;
  try {
    await runFirestoreWrite(() => deleteDoc(doc(firestoreDb, 'users', uid, 'sheetLinks', cleanId)));
    recordFirestoreQuotaOps({ deletes: 1 }, 'Hapus Tautan Sheets');
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeSheetLinks(
  user: User,
  onLinks: (links: SheetLinkDoc[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const uid = sanitizeDocId(user.uid, 'user');
  const path = `users/${uid}/sheetLinks`;
  const q = query(collection(firestoreDb, 'users', uid, 'sheetLinks'), where('ownerId', '==', uid));
  let isFirstSnapshot = true;
  return onSnapshot(
    q,
    (snapshot) => {
      if (!snapshot.metadata.fromCache) {
        const readCount = isFirstSnapshot
          ? Math.max(1, snapshot.size)
          : snapshot.docChanges().filter((c) => c.type !== 'removed').length;
        if (readCount > 0) {
          recordFirestoreQuotaOps({ reads: readCount }, 'Tautan Google Sheets');
        }
      }
      isFirstSnapshot = false;
      const items: SheetLinkDoc[] = snapshot.docs.map((d) => {
        const data = d.data() as SheetLinkDoc;
        return {
          id: d.id,
          ownerId: data.ownerId,
          spreadsheetId: data.spreadsheetId,
          spreadsheetTitle: data.spreadsheetTitle,
          sheetName: data.sheetName,
          purpose: data.purpose,
          spreadsheetUrl: data.spreadsheetUrl,
          updatedAt: data.updatedAt,
        };
      });
      onLinks(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export function getUserElectionId(user: User): string {
  return sanitizeDocId(`osis_${user.uid.slice(0, 32)}`, 'osis_main');
}

export async function syncElectionToFirestore(
  user: User,
  dbState: DatabaseState
): Promise<{
  electionId: string;
  candidateCount: number;
  voterCount: number;
  auditCount: number;
  clientUpdatedAt: number;
}> {
  const uid = sanitizeDocId(user.uid, 'user');
  const electionId = getUserElectionId(user);
  const electionPath = `elections/${electionId}`;

  if (isQuotaCooldownActive(loadQuotaCooldownUntil())) {
    void disableNetwork(firestoreDb);
    handleFirestoreError(
      new Error(
        'FirebaseError: [code=resource-exhausted]: Quota limit exceeded. Auto-Sync dijeda hingga kuota harian direset.'
      ),
      OperationType.WRITE,
      electionPath
    );
  }

  if (!ensuredProfileUids.has(uid)) {
    await ensureUserProfile(user);
  }

  const counters = buildSummaryCounters(dbState.voters, dbState.candidates);
  const totalDpt = clampInt(counters.totalDpt, 0, 50000);
  const totalVoted = clampInt(counters.totalVoted, 0, 50000);
  const totalValidVotes = clampInt(counters.totalValidVotes, 0, 50000);
  const theme = resolveTheme(dbState.settings.theme);
  const clientUpdatedAt = clampInt(dbState.lastUpdated || Date.now(), 0, 9999999999999);

  const electionRef = doc(firestoreDb, 'elections', electionId);
  const baseElection = {
    id: electionId,
    ownerId: uid,
    schoolName: clampString(dbState.settings.schoolName, 160, 'SMA Negeri 1 Kabun'),
    academicYear: clampString(dbState.settings.academicYear, 40, '2026/2027'),
    electionTitle: clampString(
      dbState.settings.electionTitle,
      200,
      'Pemilihan Ketua & Wakil Ketua OSIS'
    ),
    isBoothOpen: Boolean(dbState.settings.isBoothOpen),
    hideLiveResults: Boolean(dbState.settings.hideLiveResults),
    totalDpt,
    totalVoted,
    totalValidVotes,
    startTime: clampString(dbState.settings.startTime, 40, '2026-01-01T07:00'),
    endTime: clampString(dbState.settings.endTime, 40, '2027-12-31T17:00'),
    logoUrl: clampBoundedImageUrl(dbState.settings.logoUrl, 250000, DEFAULT_SCHOOL_LOGO),
    themePresetId: clampString(theme.presetId, 60, DEFAULT_THEME.presetId),
    themePrimaryColor: clampString(theme.primaryColor, 20, DEFAULT_THEME.primaryColor),
    themeSecondaryColor: clampString(theme.secondaryColor, 20, DEFAULT_THEME.secondaryColor),
    themeAccentColor: clampString(theme.accentColor, 20, DEFAULT_THEME.accentColor),
    themeSurfaceMode: (['light', 'warm', 'cool'].includes(theme.surfaceMode)
      ? theme.surfaceMode
      : DEFAULT_THEME.surfaceMode) as ThemeSurface,
    voterLoginMode: (dbState.settings.voterLoginMode === 'QR_CODE' ||
    dbState.settings.voterLoginMode === 'BOTH' ||
    dbState.settings.voterLoginMode === 'NISN'
      ? dbState.settings.voterLoginMode
      : 'NISN') as VoterLoginMode,
    candidateVotes: counters.candidateVotes,
    gradeTotals: counters.gradeTotals,
    gradeVoted: counters.gradeVoted,
    clientUpdatedAt,
    status: (dbState.settings.isBoothOpen ? 'active' : 'draft') as 'draft' | 'active' | 'closed',
  };

  let existingElectionExists = false;
  let existingElectionData: Record<string, unknown> | undefined;
  try {
    const existingSnap = await getDoc(electionRef);
    recordFirestoreQuotaOps({ reads: 1 }, 'Backup Workspace (Hemat Read)');
    existingElectionExists = existingSnap.exists();
    existingElectionData = existingSnap.exists()
      ? (existingSnap.data() as Record<string, unknown>)
      : undefined;

    if (!existingElectionExists) {
      await runFirestoreWrite(() =>
        setDoc(electionRef, {
          ...baseElection,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      recordFirestoreQuotaOps({ writes: 1 }, 'Backup Workspace (Hemat Read)');
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, electionPath);
  }

  // Zero-read diff for voters & cached auditLogs; chunked in writeBatch of <= 450 ops
  const ops: Array<{
    kind: 'write' | 'delete';
    run: (batch: ReturnType<typeof writeBatch>) => void;
  }> = [];

  try {
    // 1. Candidates (tiny collection ~2-4 docs: diff changed/new/deleted)
    const existingCandidatesSnap = await getDocs(
      query(
        collection(firestoreDb, 'elections', electionId, 'candidates'),
        where('ownerId', '==', uid)
      )
    );
    recordFirestoreQuotaOps(
      { reads: Math.max(1, existingCandidatesSnap.size) },
      'Backup Workspace (Hemat Read)'
    );
    const nextCandidateIds = new Set(dbState.candidates.map((c) => sanitizeDocId(c.id, 'cand')));
    existingCandidatesSnap.docs.forEach((d) => {
      if (!nextCandidateIds.has(d.id)) {
        ops.push({ kind: 'delete', run: (batch) => batch.delete(d.ref) });
      }
    });

    const existingCandMap = new Map(
      existingCandidatesSnap.docs.map((d) => [d.id, d.data() as Record<string, unknown>])
    );
    for (const c of dbState.candidates) {
      const cid = sanitizeDocId(c.id, 'cand');
      const ref = doc(firestoreDb, 'elections', electionId, 'candidates', cid);
      const missions = (c.missions.length > 0 ? c.missions : ['Misi utama OSIS'])
        .slice(0, 20)
        .map((m) => clampString(m, 300, 'Misi OSIS'));
      const comparable = {
        nomorUrut: clampInt(c.nomorUrut, 1, 99),
        ketuaName: clampString(c.ketuaName, 120, 'Calon Ketua'),
        ketuaClass: clampString(c.ketuaClass, 60, 'XI'),
        wakilName: clampString(c.wakilName, 120, 'Calon Wakil'),
        wakilClass: clampString(c.wakilClass, 60, 'X'),
        photoUrl: clampBoundedImageUrl(c.photoUrl, 350000, DEFAULT_PASLON_PHOTO),
        vision: clampString(c.vision, 1000, 'Visi OSIS'),
        missions,
        votes: clampInt(c.votes, 0, 50000),
        accentColor: clampString(c.accentColor, 20, '#1E3A5F'),
      };
      const existingCand = existingCandMap.get(cid);
      if (existingCand && !hasCandidateChanged(existingCand, comparable)) {
        continue;
      }
      const payload = {
        id: cid,
        electionId,
        ownerId: uid,
        ...comparable,
        updatedAt: serverTimestamp(),
      };
      if (!existingCand) {
        ops.push({
          kind: 'write',
          run: (batch) => batch.set(ref, { ...payload, createdAt: serverTimestamp() }),
        });
      } else {
        ops.push({ kind: 'write', run: (batch) => batch.set(ref, payload, { merge: true }) });
      }
    }

    // 2. Voters (0 Firestore reads using local hash cache; writes only changed/new voters in <=450 batches)
    const syncCache = loadWorkspaceSyncCache(electionId);
    const voterEntries = dbState.voters.map((v) => ({
      docId: sanitizeDocId(getVoterDocIdFromNis(v.nis) || v.id, 'vtr'),
      voter: v,
    }));
    const voterDiff = diffVotersWithSyncCache(voterEntries, syncCache?.voterHashes);

    for (const delId of voterDiff.toDeleteIds) {
      const ref = doc(firestoreDb, 'elections', electionId, 'voters', delId);
      ops.push({ kind: 'delete', run: (batch) => batch.delete(ref) });
    }

    for (const { docId: vid, voter: v } of voterDiff.toWrite) {
      const ref = doc(firestoreDb, 'elections', electionId, 'voters', vid);
      const payload: Record<string, unknown> = {
        id: vid,
        electionId,
        ownerId: uid,
        nis: clampString(v.nis, 40, '000000'),
        name: clampString(v.name, 120, 'Siswa'),
        kelas: clampString(v.kelas, 60, 'X'),
        grade: (['X', 'XI', 'XII'].includes(v.grade) ? v.grade : 'X') as GradeLevel,
        hasVoted: Boolean(v.hasVoted),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (v.votedAt) {
        payload.votedAt = clampString(v.votedAt, 60);
      }
      if (v.hasVoted && v.votedCandidateId) {
        payload.votedCandidateId = sanitizeDocId(v.votedCandidateId, 'paslon');
      }
      ops.push({ kind: 'write', run: (batch) => batch.set(ref, payload) });
    }

    // 3. Audit logs (append-only, up to latest 100 entries; 0 reads when cache exists)
    const boundedLogs = dbState.auditLogs.slice(0, 100);
    const boundedLogIds = boundedLogs.map((l) => sanitizeDocId(l.id, 'log'));
    let knownLogIds = syncCache?.syncedLogIds;

    if (!knownLogIds) {
      const existingLogsSnap = await getDocs(
        query(
          collection(firestoreDb, 'elections', electionId, 'auditLogs'),
          where('ownerId', '==', uid)
        )
      );
      recordFirestoreQuotaOps(
        { reads: Math.max(1, existingLogsSnap.size) },
        'Backup Workspace (Hemat Read)'
      );
      knownLogIds = existingLogsSnap.docs.map((d) => d.id);
    }

    const logDiff = diffAuditLogsWithSyncCache(boundedLogIds, knownLogIds);
    for (const delLogId of logDiff.toDeleteIds) {
      const ref = doc(firestoreDb, 'elections', electionId, 'auditLogs', delLogId);
      ops.push({ kind: 'delete', run: (batch) => batch.delete(ref) });
    }

    const createLogIdSet = new Set(logDiff.toCreateIds);
    for (const l of boundedLogs) {
      const lid = sanitizeDocId(l.id, 'log');
      if (!createLogIdSet.has(lid)) continue; // auditLogs are immutable after create
      const ref = doc(firestoreDb, 'elections', electionId, 'auditLogs', lid);
      const actorRole: AdminRole | 'SYSTEM' =
        l.actorRole === 'SUPERADMIN' || l.actorRole === 'ADMIN' || l.actorRole === 'SYSTEM'
          ? l.actorRole
          : 'SYSTEM';
      ops.push({
        kind: 'write',
        run: (batch) =>
          batch.set(ref, {
            id: lid,
            electionId,
            ownerId: uid,
            timestamp: clampString(l.timestamp, 60, new Date().toISOString()),
            actorName: clampString(l.actorName, 120, 'Panitia OSIS'),
            actorRole,
            action: clampString(l.action, 80, 'EVENT'),
            detail: clampString(l.detail, 500, '-'),
            createdAt: serverTimestamp(),
          }),
      });
    }

    // Update parent election summary only if it already existed and either summary fields changed or subcollection ops occurred
    if (
      existingElectionExists &&
      (ops.length > 0 || hasElectionSummaryChanged(existingElectionData, baseElection))
    ) {
      ops.push({
        kind: 'write',
        run: (batch) =>
          batch.set(
            electionRef,
            { ...baseElection, updatedAt: serverTimestamp() },
            { merge: true }
          ),
      });
    }

    for (let i = 0; i < ops.length; i += FIRESTORE_CSV_BATCH_LIMIT) {
      const chunk = ops.slice(i, i + FIRESTORE_CSV_BATCH_LIMIT);
      const batch = writeBatch(firestoreDb);
      let chunkWrites = 0;
      let chunkDeletes = 0;
      chunk.forEach((op) => {
        op.run(batch);
        if (op.kind === 'delete') chunkDeletes += 1;
        else chunkWrites += 1;
      });
      await runFirestoreWrite(() => batch.commit());
      recordFirestoreQuotaOps(
        { writes: chunkWrites, deletes: chunkDeletes },
        'Backup Workspace (Hemat Read)'
      );
    }

    saveWorkspaceSyncCache(electionId, {
      voterHashes: voterDiff.nextHashes,
      syncedLogIds: logDiff.nextSyncedLogIds,
    });

    return {
      electionId,
      candidateCount: dbState.candidates.length,
      voterCount: dbState.voters.length,
      auditCount: boundedLogs.length,
      clientUpdatedAt,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${electionPath}/records`);
  }
}

export async function loadElectionFromFirestore(
  user: User,
  currentDb: DatabaseState
): Promise<DatabaseState | null> {
  const uid = sanitizeDocId(user.uid, 'user');
  const electionId = getUserElectionId(user);
  const electionPath = `elections/${electionId}`;

  try {
    const electionSnap = await getDoc(doc(firestoreDb, 'elections', electionId));
    recordFirestoreQuotaOps({ reads: 1 }, 'Pulihkan Workspace dari Cloud');
    if (!electionSnap.exists()) {
      return null;
    }
    const summary = electionSnap.data() as CloudElectionSummary;

    const candSnap = await getDocs(
      query(
        collection(firestoreDb, 'elections', electionId, 'candidates'),
        where('ownerId', '==', uid)
      )
    );
    recordFirestoreQuotaOps({ reads: Math.max(1, candSnap.size) }, 'Pulihkan Workspace dari Cloud');
    const voterSnap = await getDocs(
      query(
        collection(firestoreDb, 'elections', electionId, 'voters'),
        where('ownerId', '==', uid)
      )
    );
    recordFirestoreQuotaOps({ reads: Math.max(1, voterSnap.size) }, 'Pulihkan Workspace dari Cloud');
    const auditSnap = await getDocs(
      query(
        collection(firestoreDb, 'elections', electionId, 'auditLogs'),
        where('ownerId', '==', uid)
      )
    );
    recordFirestoreQuotaOps({ reads: Math.max(1, auditSnap.size) }, 'Pulihkan Workspace dari Cloud');

    const existingPhotos = new Map(currentDb.candidates.map((c) => [c.id, c.photoUrl]));
    const candidates: Candidate[] = candSnap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        const id = String(data.id || d.id);
        return {
          id,
          nomorUrut: Number(data.nomorUrut || 1),
          ketuaName: String(data.ketuaName || ''),
          ketuaClass: String(data.ketuaClass || ''),
          wakilName: String(data.wakilName || ''),
          wakilClass: String(data.wakilClass || ''),
          photoUrl:
            (typeof data.photoUrl === 'string' && data.photoUrl) ||
            existingPhotos.get(id) ||
            DEFAULT_PASLON_PHOTO,
          vision: String(data.vision || ''),
          missions: Array.isArray(data.missions) ? data.missions.map(String) : [],
          votes: Number(data.votes || 0),
          accentColor: String(data.accentColor || (Number(data.nomorUrut) === 1 ? '#059669' : '#1E3A5F')),
        };
      })
      .sort((a, b) => a.nomorUrut - b.nomorUrut);

    const existingTokens = new Map(currentDb.voters.map((v) => [v.id, v.token]));
    const voters: Voter[] = voterSnap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const id = String(data.id || d.id);
      return {
        id,
        nis: String(data.nis || ''),
        name: String(data.name || ''),
        kelas: String(data.kelas || ''),
        grade: (['X', 'XI', 'XII'].includes(String(data.grade)) ? data.grade : 'X') as GradeLevel,
        token: existingTokens.get(id) || '000000',
        hasVoted: Boolean(data.hasVoted),
        votedAt: typeof data.votedAt === 'string' ? data.votedAt : undefined,
        votedCandidateId:
          typeof data.votedCandidateId === 'string' && data.votedCandidateId
            ? data.votedCandidateId
            : undefined,
      };
    });

    const auditLogs: AuditLogEntry[] = auditSnap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        const role = String(data.actorRole || 'SYSTEM');
        return {
          id: String(data.id || d.id),
          timestamp: String(data.timestamp || ''),
          actorName: String(data.actorName || ''),
          actorRole: (role === 'SUPERADMIN' || role === 'ADMIN' || role === 'SYSTEM'
            ? role
            : 'SYSTEM') as AdminRole | 'SYSTEM',
          action: String(data.action || ''),
          detail: String(data.detail || ''),
        };
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const cacheDiff = diffVotersWithSyncCache(
      voters.map((v) => ({
        docId: sanitizeDocId(getVoterDocIdFromNis(v.nis) || v.id, 'vtr'),
        voter: v,
      })),
      null
    );
    saveWorkspaceSyncCache(electionId, {
      voterHashes: cacheDiff.nextHashes,
      syncedLogIds: auditSnap.docs.map((d) => d.id),
    });

    const resolvedTheme = resolveTheme({
      presetId: summary.themePresetId || currentDb.settings.theme?.presetId || DEFAULT_THEME.presetId,
      primaryColor:
        summary.themePrimaryColor ||
        currentDb.settings.theme?.primaryColor ||
        DEFAULT_THEME.primaryColor,
      secondaryColor:
        summary.themeSecondaryColor ||
        currentDb.settings.theme?.secondaryColor ||
        DEFAULT_THEME.secondaryColor,
      accentColor:
        summary.themeAccentColor ||
        currentDb.settings.theme?.accentColor ||
        DEFAULT_THEME.accentColor,
      surfaceMode:
        summary.themeSurfaceMode ||
        currentDb.settings.theme?.surfaceMode ||
        DEFAULT_THEME.surfaceMode,
    });

    return {
      ...currentDb,
      settings: {
        ...currentDb.settings,
        schoolName: summary.schoolName || currentDb.settings.schoolName,
        academicYear: summary.academicYear || currentDb.settings.academicYear,
        electionTitle: summary.electionTitle || currentDb.settings.electionTitle,
        logoUrl: summary.logoUrl || currentDb.settings.logoUrl,
        startTime: summary.startTime || currentDb.settings.startTime,
        endTime: summary.endTime || currentDb.settings.endTime,
        isBoothOpen: Boolean(summary.isBoothOpen),
        hideLiveResults: Boolean(summary.hideLiveResults),
        voterLoginMode:
          summary.voterLoginMode === 'QR_CODE' ||
          summary.voterLoginMode === 'BOTH' ||
          summary.voterLoginMode === 'NISN'
            ? summary.voterLoginMode
            : currentDb.settings.voterLoginMode || 'QR_CODE',
        theme: resolvedTheme,
      },
      candidates: candidates.length > 0 ? candidates : currentDb.candidates,
      voters: voters.length > 0 ? voters : currentDb.voters,
      auditLogs: auditLogs.length > 0 ? auditLogs : currentDb.auditLogs,
      lastUpdated:
        typeof summary.clientUpdatedAt === 'number' && summary.clientUpdatedAt > 0
          ? summary.clientUpdatedAt
          : Date.now(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, electionPath);
  }
}

export function subscribeElectionWorkspace(
  user: User,
  onSummary: (summary: CloudElectionSummary | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const electionId = getUserElectionId(user);
  const path = `elections/${electionId}`;
  return onSnapshot(
    doc(firestoreDb, 'elections', electionId),
    (snap) => {
      if (!snap.metadata.fromCache) {
        recordFirestoreQuotaOps({ reads: 1 }, 'Real-Time Count (1 Dokumen)');
      }
      if (!snap.exists()) {
        onSummary(null);
        return;
      }
      onSummary(snap.data() as CloudElectionSummary);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

function buildElectionSummaryBasePayload(uid: string, electionId: string, dbState: DatabaseState) {
  const counters = buildSummaryCounters(dbState.voters, dbState.candidates);
  const theme = resolveTheme(dbState.settings.theme);
  const clientUpdatedAt = clampInt(dbState.lastUpdated || Date.now(), 0, 9999999999999);
  return {
    id: electionId,
    ownerId: uid,
    schoolName: clampString(dbState.settings.schoolName, 160, 'SMA Negeri 1 Kabun'),
    academicYear: clampString(dbState.settings.academicYear, 40, '2026/2027'),
    electionTitle: clampString(
      dbState.settings.electionTitle,
      200,
      'Pemilihan Ketua & Wakil Ketua OSIS'
    ),
    isBoothOpen: Boolean(dbState.settings.isBoothOpen),
    hideLiveResults: Boolean(dbState.settings.hideLiveResults),
    totalDpt: clampInt(counters.totalDpt, 0, 50000),
    totalVoted: clampInt(counters.totalVoted, 0, 50000),
    totalValidVotes: clampInt(counters.totalValidVotes, 0, 50000),
    startTime: clampString(dbState.settings.startTime, 40, '2026-01-01T07:00'),
    endTime: clampString(dbState.settings.endTime, 40, '2027-12-31T17:00'),
    logoUrl: clampBoundedImageUrl(dbState.settings.logoUrl, 250000, DEFAULT_SCHOOL_LOGO),
    themePresetId: clampString(theme.presetId, 60, DEFAULT_THEME.presetId),
    themePrimaryColor: clampString(theme.primaryColor, 20, DEFAULT_THEME.primaryColor),
    themeSecondaryColor: clampString(theme.secondaryColor, 20, DEFAULT_THEME.secondaryColor),
    themeAccentColor: clampString(theme.accentColor, 20, DEFAULT_THEME.accentColor),
    themeSurfaceMode: (['light', 'warm', 'cool'].includes(theme.surfaceMode)
      ? theme.surfaceMode
      : DEFAULT_THEME.surfaceMode) as ThemeSurface,
    voterLoginMode: (dbState.settings.voterLoginMode === 'QR_CODE' ||
    dbState.settings.voterLoginMode === 'BOTH' ||
    dbState.settings.voterLoginMode === 'NISN'
      ? dbState.settings.voterLoginMode
      : 'NISN') as VoterLoginMode,
    candidateVotes: counters.candidateVotes,
    gradeTotals: counters.gradeTotals,
    gradeVoted: counters.gradeVoted,
    clientUpdatedAt,
    status: (dbState.settings.isBoothOpen ? 'active' : 'draft') as 'draft' | 'active' | 'closed',
  };
}

/**
 * 1. Optimized CSV Import:
 * - Zero full-collection reads of `voters`.
 * - Uses NIS/Token as the Firestore document ID.
 * - Splits uploads into `writeBatch` chunks of max 450 docs (999 rows -> 3 batches).
 * - Automatically updates the 1 summary doc (`totalDpt`, `totalVoted: 0`) & resets candidate votes to 0.
 */
export async function importCsvVotersToFirestore(
  user: User,
  importedVoters: Voter[],
  dbState: DatabaseState
): Promise<{
  electionId: string;
  uploadedCount: number;
  batchCount: number;
  clientUpdatedAt: number;
}> {
  const uid = sanitizeDocId(user.uid, 'user');
  const electionId = getUserElectionId(user);
  const electionRef = doc(firestoreDb, 'elections', electionId);
  const electionPath = `elections/${electionId}`;

  if (isQuotaCooldownActive(loadQuotaCooldownUntil())) {
    void disableNetwork(firestoreDb);
    handleFirestoreError(
      new Error('FirebaseError: [code=resource-exhausted]: Quota limit exceeded.'),
      OperationType.WRITE,
      electionPath
    );
  }

  if (!ensuredProfileUids.has(uid)) {
    await ensureUserProfile(user);
  }

  const cappedVoters = importedVoters.slice(0, MAX_CSV_VOTERS);
  const resetCandidates = dbState.candidates.map((c) => ({ ...c, votes: 0 }));
  const summaryBase = buildElectionSummaryBasePayload(uid, electionId, {
    ...dbState,
    voters: cappedVoters,
    candidates: resetCandidates,
    lastUpdated: dbState.lastUpdated || Date.now(),
  });

  try {
    // 1 read to ensure parent election doc exists before writing voter subcollection docs
    const summarySnap = await getDoc(electionRef);
    recordFirestoreQuotaOps({ reads: 1 }, 'Import CSV Pemilih (Batch ≤450)');
    if (!summarySnap.exists()) {
      await runFirestoreWrite(() =>
        setDoc(electionRef, {
          ...summaryBase,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      recordFirestoreQuotaOps({ writes: 1 }, 'Import CSV Pemilih (Batch ≤450)');
    }

    // Chunk voter writes at <= 450 operations per batch (e.g. 999 voters -> 3 batches)
    const voterBatches = chunkIntoBatches(cappedVoters, FIRESTORE_CSV_BATCH_LIMIT);
    let batchCount = 0;

    for (const chunk of voterBatches) {
      const batch = writeBatch(firestoreDb);
      for (const v of chunk) {
        const voterDocId = sanitizeDocId(getVoterDocIdFromNis(v.nis), 'vtr');
        const voterRef = doc(firestoreDb, 'elections', electionId, 'voters', voterDocId);
        batch.set(voterRef, {
          id: voterDocId,
          electionId,
          ownerId: uid,
          nis: clampString(v.nis, 40, '000000'),
          name: clampString(v.name, 120, 'Siswa'),
          kelas: clampString(v.kelas, 60, 'X'),
          grade: (['X', 'XI', 'XII'].includes(v.grade) ? v.grade : 'X') as GradeLevel,
          hasVoted: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await runFirestoreWrite(() => batch.commit());
      recordFirestoreQuotaOps({ writes: chunk.length }, 'Import CSV Pemilih (Batch ≤450)');
      batchCount += 1;
    }

    // Read only small candidates collection (~2-4 docs, never voters) so votes reset cleanly to 0
    const existingCandsSnap = await getDocs(
      query(
        collection(firestoreDb, 'elections', electionId, 'candidates'),
        where('ownerId', '==', uid)
      )
    );
    recordFirestoreQuotaOps(
      { reads: Math.max(1, existingCandsSnap.size) },
      'Import CSV Pemilih (Batch ≤450)'
    );
    const existingCandIds = new Set(existingCandsSnap.docs.map((d) => d.id));

    const finalBatch = writeBatch(firestoreDb);
    let finalOps = 0;

    for (const c of resetCandidates) {
      const cid = sanitizeDocId(c.id, 'cand');
      const candRef = doc(firestoreDb, 'elections', electionId, 'candidates', cid);
      const missions = (c.missions.length > 0 ? c.missions : ['Misi utama OSIS'])
        .slice(0, 20)
        .map((m) => clampString(m, 300, 'Misi OSIS'));
      const candPayload = {
        id: cid,
        electionId,
        ownerId: uid,
        nomorUrut: clampInt(c.nomorUrut, 1, 99),
        ketuaName: clampString(c.ketuaName, 120, 'Calon Ketua'),
        ketuaClass: clampString(c.ketuaClass, 60, 'XI'),
        wakilName: clampString(c.wakilName, 120, 'Calon Wakil'),
        wakilClass: clampString(c.wakilClass, 60, 'X'),
        photoUrl: clampBoundedImageUrl(c.photoUrl, 350000, DEFAULT_PASLON_PHOTO),
        vision: clampString(c.vision, 1000, 'Visi OSIS'),
        missions,
        votes: 0,
        accentColor: clampString(c.accentColor, 20, '#1E3A5F'),
        updatedAt: serverTimestamp(),
      };
      if (!existingCandIds.has(cid)) {
        finalBatch.set(candRef, { ...candPayload, createdAt: serverTimestamp() });
      } else {
        finalBatch.set(candRef, candPayload, { merge: true });
      }
      finalOps += 1;
    }

    finalBatch.set(
      electionRef,
      {
        ...summaryBase,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    finalOps += 1;

    await runFirestoreWrite(() => finalBatch.commit());
    recordFirestoreQuotaOps({ writes: finalOps }, 'Import CSV Pemilih (Batch ≤450)');
    batchCount += 1;

    recordWorkspaceCsvImportCache(
      electionId,
      cappedVoters.map((v) => ({
        docId: sanitizeDocId(getVoterDocIdFromNis(v.nis), 'vtr'),
        voter: {
          ...v,
          hasVoted: false,
          votedAt: undefined,
          votedCandidateId: undefined,
        },
      }))
    );

    return {
      electionId,
      uploadedCount: cappedVoters.length,
      batchCount,
      clientUpdatedAt: summaryBase.clientUpdatedAt,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${electionPath}/csv_import`);
  }
}

/**
 * 1b. Limited Voter Table Query (max 20 reads instead of loading 999 voters).
 */
export async function fetchVotersLimitedFromFirestore(
  user: User,
  maxDocs: number = DPT_DISPLAY_LIMIT
): Promise<Voter[]> {
  const uid = sanitizeDocId(user.uid, 'user');
  const electionId = getUserElectionId(user);
  const path = `elections/${electionId}/voters`;

  try {
    const q = query(
      collection(firestoreDb, 'elections', electionId, 'voters'),
      where('ownerId', '==', uid),
      limit(Math.max(1, Math.min(DPT_DISPLAY_LIMIT, maxDocs)))
    );
    const snap = await getDocs(q);
    recordFirestoreQuotaOps({ reads: Math.max(1, snap.size) }, 'Muat Tabel DPT (Limit 20)');
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: String(data.id || d.id),
        nis: String(data.nis || ''),
        name: String(data.name || ''),
        kelas: String(data.kelas || ''),
        grade: (['X', 'XI', 'XII'].includes(String(data.grade)) ? data.grade : 'X') as GradeLevel,
        token: '000000',
        hasVoted: Boolean(data.hasVoted),
        votedAt: typeof data.votedAt === 'string' ? data.votedAt : undefined,
        votedCandidateId:
          typeof data.votedCandidateId === 'string' && data.votedCandidateId
            ? data.votedCandidateId
            : undefined,
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

/**
 * 2. Voter Login Verification (Strictly max 1 Read via direct document ID lookup by NIS/Token).
 */
export async function verifyVoterLoginInFirestore(
  user: User,
  nisInput: string
): Promise<{ found: boolean; voter?: Voter; alreadyVoted?: boolean }> {
  const electionId = getUserElectionId(user);
  const voterDocId = sanitizeDocId(getVoterDocIdFromNis(nisInput), 'vtr');
  const voterRef = doc(firestoreDb, 'elections', electionId, 'voters', voterDocId);
  const path = `elections/${electionId}/voters/${voterDocId}`;

  try {
    const snap = await getDoc(voterRef);
    recordFirestoreQuotaOps({ reads: 1 }, 'Login Pemilih (1 getDoc)');
    if (!snap.exists()) {
      return { found: false };
    }
    const data = snap.data() as Record<string, unknown>;
    const alreadyVoted = Boolean(data.hasVoted);
    const voter: Voter = {
      id: String(data.id || snap.id),
      nis: String(data.nis || nisInput.trim()),
      name: String(data.name || ''),
      kelas: String(data.kelas || ''),
      grade: (['X', 'XI', 'XII'].includes(String(data.grade)) ? data.grade : 'X') as GradeLevel,
      token: '000000',
      hasVoted: alreadyVoted,
      votedAt: typeof data.votedAt === 'string' ? data.votedAt : undefined,
      votedCandidateId:
        typeof data.votedCandidateId === 'string' && data.votedCandidateId
          ? data.votedCandidateId
          : undefined,
    };
    return {
      found: true,
      voter,
      alreadyVoted,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

/**
 * 3a. Single getDocs fetch for Candidates (no onSnapshot on candidates).
 */
export async function fetchCandidatesOnceFromFirestore(
  user: User,
  fallbackCandidates: Candidate[] = []
): Promise<Candidate[]> {
  const uid = sanitizeDocId(user.uid, 'user');
  const electionId = getUserElectionId(user);
  const path = `elections/${electionId}/candidates`;

  try {
    const candSnap = await getDocs(
      query(
        collection(firestoreDb, 'elections', electionId, 'candidates'),
        where('ownerId', '==', uid)
      )
    );
    recordFirestoreQuotaOps({ reads: Math.max(1, candSnap.size) }, 'Muat Paslon (1× getDocs)');
    if (candSnap.empty) {
      return fallbackCandidates;
    }
    const fallbackPhotos = new Map(fallbackCandidates.map((c) => [c.id, c.photoUrl]));
    return candSnap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        const id = String(data.id || d.id);
        return {
          id,
          nomorUrut: Number(data.nomorUrut || 1),
          ketuaName: String(data.ketuaName || ''),
          ketuaClass: String(data.ketuaClass || ''),
          wakilName: String(data.wakilName || ''),
          wakilClass: String(data.wakilClass || ''),
          photoUrl:
            (typeof data.photoUrl === 'string' && data.photoUrl) ||
            fallbackPhotos.get(id) ||
            DEFAULT_PASLON_PHOTO,
          vision: String(data.vision || ''),
          missions: Array.isArray(data.missions) ? data.missions.map(String) : [],
          votes: Number(data.votes || 0),
          accentColor: String(data.accentColor || (Number(data.nomorUrut) === 1 ? '#059669' : '#1E3A5F')),
        };
      })
      .sort((a, b) => a.nomorUrut - b.nomorUrut);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

/**
 * 3b. Atomic Voting Transaction:
 * - Verifies voter hasn't voted yet.
 * - Updates voter doc to `hasVoted: true` (`sudah_memilih: true`).
 * - Atomically increments `totalVoted` (+1), `totalValidVotes` (+1),
 *   `candidateVotes.<cid>` (+1), and `gradeVoted.<grade>` (+1) on the 1 summary doc,
 *   plus candidate `votes` (+1).
 */
export async function castVoteTransactionInFirestore(
  user: User,
  voter: Pick<Voter, 'id' | 'nis' | 'name' | 'kelas' | 'grade'>,
  candidateId: string,
  nowIso: string
): Promise<{ clientUpdatedAt: number }> {
  const electionId = getUserElectionId(user);
  const voterDocId = sanitizeDocId(
    getVoterDocIdFromNis(voter.nis) || voter.id,
    'vtr'
  );
  const cid = sanitizeDocId(candidateId, 'cand');
  const voterRef = doc(firestoreDb, 'elections', electionId, 'voters', voterDocId);
  const electionRef = doc(firestoreDb, 'elections', electionId);
  const candRef = doc(firestoreDb, 'elections', electionId, 'candidates', cid);
  const clientUpdatedAt = Date.now();
  const safeGrade: GradeLevel =
    voter.grade === 'XII' ? 'XII' : voter.grade === 'XI' ? 'XI' : 'X';
  const summaryGradeBucket = isAdditionalVoter(voter) ? 'DPTB' : safeGrade;

  let txReads = 0;
  let txWrites = 0;

  try {
    await runFirestoreWrite(() =>
      runTransaction(firestoreDb, async (tx) => {
        const voterSnap = await tx.get(voterRef);
        const candSnap = await tx.get(candRef);
        txReads += 2;

        if (!voterSnap.exists()) {
          throw new Error('Data pemilih tidak ditemukan di Firestore.');
        }
        const voterData = voterSnap.data() as Record<string, unknown>;
        if (Boolean(voterData.hasVoted)) {
          throw new Error('Anda sudah menggunakan hak suara. Setiap pemilih hanya dapat memilih satu kali.');
        }

        const safeVotedAt = clampString(nowIso, 60, new Date().toISOString());
        tx.update(voterRef, {
          hasVoted: true,
          votedAt: safeVotedAt,
          votedCandidateId: cid,
          updatedAt: serverTimestamp(),
        });

        tx.update(electionRef, {
          totalVoted: increment(1),
          totalValidVotes: increment(1),
          [`candidateVotes.${cid}`]: increment(1),
          [`gradeVoted.${summaryGradeBucket}`]: increment(1),
          clientUpdatedAt,
          updatedAt: serverTimestamp(),
        });

        txWrites = 2;
        if (candSnap.exists()) {
          tx.update(candRef, {
            votes: increment(1),
            updatedAt: serverTimestamp(),
          });
          txWrites += 1;
        }
      })
    );
    recordFirestoreQuotaOps(
      { reads: txReads, writes: txWrites },
      'Voting (runTransaction)'
    );
    updateWorkspaceVoterCacheEntry(electionId, voterDocId, {
      nis: voter.nis,
      name: voter.name,
      kelas: voter.kelas,
      grade: safeGrade,
      hasVoted: true,
      votedAt: clampString(nowIso, 60, new Date().toISOString()),
      votedCandidateId: cid,
    });
    return { clientUpdatedAt };
  } catch (error) {
    if (txReads > 0) {
      recordFirestoreQuotaOps({ reads: txReads }, 'Voting (runTransaction)');
    }
    handleFirestoreError(error, OperationType.WRITE, `elections/${electionId}/voters/${voterDocId}`);
  }
}

/**
 * Lightweight sync: updates ONLY the 1 summary doc (+ small candidate docs),
 * NEVER scanning the `voters` collection (`getDocs(voters)`).
 */
export async function syncSummaryAndCandidatesToFirestore(
  user: User,
  dbState: DatabaseState
): Promise<{ clientUpdatedAt: number }> {
  const uid = sanitizeDocId(user.uid, 'user');
  const electionId = getUserElectionId(user);
  const electionRef = doc(firestoreDb, 'elections', electionId);
  const electionPath = `elections/${electionId}`;

  if (isQuotaCooldownActive(loadQuotaCooldownUntil())) {
    void disableNetwork(firestoreDb);
    handleFirestoreError(
      new Error('FirebaseError: [code=resource-exhausted]: Quota limit exceeded.'),
      OperationType.WRITE,
      electionPath
    );
  }

  if (!ensuredProfileUids.has(uid)) {
    await ensureUserProfile(user);
  }

  const summaryBase = buildElectionSummaryBasePayload(uid, electionId, dbState);

  try {
    const existingSnap = await getDoc(electionRef);
    recordFirestoreQuotaOps({ reads: 1 }, 'Sync Ringkasan & Paslon');

    if (!existingSnap.exists()) {
      await runFirestoreWrite(() =>
        setDoc(electionRef, {
          ...summaryBase,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      recordFirestoreQuotaOps({ writes: 1 }, 'Sync Ringkasan & Paslon');
    }

    const existingCandidatesSnap = await getDocs(
      query(
        collection(firestoreDb, 'elections', electionId, 'candidates'),
        where('ownerId', '==', uid)
      )
    );
    recordFirestoreQuotaOps(
      { reads: Math.max(1, existingCandidatesSnap.size) },
      'Sync Ringkasan & Paslon'
    );

    const batch = writeBatch(firestoreDb);
    let opsWrites = 0;
    let opsDeletes = 0;

    const nextCandidateIds = new Set(dbState.candidates.map((c) => sanitizeDocId(c.id, 'cand')));
    existingCandidatesSnap.docs.forEach((d) => {
      if (!nextCandidateIds.has(d.id)) {
        batch.delete(d.ref);
        opsDeletes += 1;
      }
    });

    const existingCandMap = new Map(
      existingCandidatesSnap.docs.map((d) => [d.id, d.data() as Record<string, unknown>])
    );

    for (const c of dbState.candidates) {
      const cid = sanitizeDocId(c.id, 'cand');
      const ref = doc(firestoreDb, 'elections', electionId, 'candidates', cid);
      const missions = (c.missions.length > 0 ? c.missions : ['Misi utama OSIS'])
        .slice(0, 20)
        .map((m) => clampString(m, 300, 'Misi OSIS'));
      const comparable = {
        nomorUrut: clampInt(c.nomorUrut, 1, 99),
        ketuaName: clampString(c.ketuaName, 120, 'Calon Ketua'),
        ketuaClass: clampString(c.ketuaClass, 60, 'XI'),
        wakilName: clampString(c.wakilName, 120, 'Calon Wakil'),
        wakilClass: clampString(c.wakilClass, 60, 'X'),
        photoUrl: clampBoundedImageUrl(c.photoUrl, 350000, DEFAULT_PASLON_PHOTO),
        vision: clampString(c.vision, 1000, 'Visi OSIS'),
        missions,
        votes: clampInt(c.votes, 0, 50000),
        accentColor: clampString(c.accentColor, 20, '#1E3A5F'),
      };
      const existingCand = existingCandMap.get(cid);
      if (existingCand && !hasCandidateChanged(existingCand, comparable)) {
        continue;
      }
      const payload = {
        id: cid,
        electionId,
        ownerId: uid,
        ...comparable,
        updatedAt: serverTimestamp(),
      };
      if (!existingCand) {
        batch.set(ref, { ...payload, createdAt: serverTimestamp() });
      } else {
        batch.set(ref, payload, { merge: true });
      }
      opsWrites += 1;
    }

    if (
      existingSnap.exists() &&
      (opsWrites + opsDeletes > 0 ||
        hasElectionSummaryChanged(existingSnap.data() as Record<string, unknown>, summaryBase))
    ) {
      batch.set(
        electionRef,
        {
          ...summaryBase,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      opsWrites += 1;
    }

    if (opsWrites + opsDeletes > 0) {
      await runFirestoreWrite(() => batch.commit());
      recordFirestoreQuotaOps(
        { writes: opsWrites, deletes: opsDeletes },
        'Sync Ringkasan & Paslon'
      );
    }

    return { clientUpdatedAt: summaryBase.clientUpdatedAt };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, electionPath);
  }
}

/**
 * Single-voter sync (add/edit 1 voter + update summary counters),
 * avoiding 999-voter collection scans.
 */
export async function syncSingleVoterToFirestore(
  user: User,
  voter: Voter,
  dbState: DatabaseState
): Promise<{ clientUpdatedAt: number }> {
  const uid = sanitizeDocId(user.uid, 'user');
  const electionId = getUserElectionId(user);
  const voterDocId = sanitizeDocId(getVoterDocIdFromNis(voter.nis) || voter.id, 'vtr');
  const voterRef = doc(firestoreDb, 'elections', electionId, 'voters', voterDocId);
  const electionRef = doc(firestoreDb, 'elections', electionId);

  const summaryBase = buildElectionSummaryBasePayload(uid, electionId, dbState);

  try {
    const electionSnap = await getDoc(electionRef);
    recordFirestoreQuotaOps({ reads: 1 }, 'Update 1 Pemilih');

    if (!electionSnap.exists()) {
      await runFirestoreWrite(() =>
        setDoc(electionRef, {
          ...summaryBase,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      recordFirestoreQuotaOps({ writes: 1 }, 'Update 1 Pemilih');
    }

    const batch = writeBatch(firestoreDb);
    const payload: Record<string, unknown> = {
      id: voterDocId,
      electionId,
      ownerId: uid,
      nis: clampString(voter.nis, 40, '000000'),
      name: clampString(voter.name, 120, 'Siswa'),
      kelas: clampString(voter.kelas, 60, 'X'),
      grade: (['X', 'XI', 'XII'].includes(voter.grade) ? voter.grade : 'X') as GradeLevel,
      hasVoted: Boolean(voter.hasVoted),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (voter.votedAt) {
      payload.votedAt = clampString(voter.votedAt, 60);
    }
    if (voter.hasVoted && voter.votedCandidateId) {
      payload.votedCandidateId = sanitizeDocId(voter.votedCandidateId, 'paslon');
    }

    batch.set(voterRef, payload);

    batch.set(
      electionRef,
      {
        ...summaryBase,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    await runFirestoreWrite(() => batch.commit());
    recordFirestoreQuotaOps({ writes: 2 }, 'Update 1 Pemilih');
    updateWorkspaceVoterCacheEntry(electionId, voterDocId, voter);

    return { clientUpdatedAt: summaryBase.clientUpdatedAt };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `elections/${electionId}/voters/${voterDocId}`);
  }
}

export async function upsertVotersBatchToFirestore(
  user: User,
  votersToUpsert: Voter[],
  dbState: DatabaseState
): Promise<{ clientUpdatedAt: number }> {
  const uid = sanitizeDocId(user.uid, 'user');
  const electionId = getUserElectionId(user);
  const electionRef = doc(firestoreDb, 'elections', electionId);
  const summaryBase = buildElectionSummaryBasePayload(uid, electionId, dbState);

  try {
    const electionSnap = await getDoc(electionRef);
    recordFirestoreQuotaOps({ reads: 1 }, 'Import DPT Sheets (Batch ≤450)');
    if (!electionSnap.exists()) {
      await runFirestoreWrite(() =>
        setDoc(electionRef, {
          ...summaryBase,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      recordFirestoreQuotaOps({ writes: 1 }, 'Import DPT Sheets (Batch ≤450)');
    }

    const chunks = chunkIntoBatches(votersToUpsert, FIRESTORE_CSV_BATCH_LIMIT);
    for (const chunk of chunks) {
      const batch = writeBatch(firestoreDb);
      for (const v of chunk) {
        const voterDocId = sanitizeDocId(getVoterDocIdFromNis(v.nis) || v.id, 'vtr');
        const voterRef = doc(firestoreDb, 'elections', electionId, 'voters', voterDocId);
        const payload: Record<string, unknown> = {
          id: voterDocId,
          electionId,
          ownerId: uid,
          nis: clampString(v.nis, 40, '000000'),
          name: clampString(v.name, 120, 'Siswa'),
          kelas: clampString(v.kelas, 60, 'X'),
          grade: (['X', 'XI', 'XII'].includes(v.grade) ? v.grade : 'X') as GradeLevel,
          hasVoted: Boolean(v.hasVoted),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (v.votedAt) payload.votedAt = clampString(v.votedAt, 60);
        if (v.hasVoted && v.votedCandidateId) {
          payload.votedCandidateId = sanitizeDocId(v.votedCandidateId, 'paslon');
        }
        batch.set(voterRef, payload);
      }
      await runFirestoreWrite(() => batch.commit());
      recordFirestoreQuotaOps({ writes: chunk.length }, 'Import DPT Sheets (Batch ≤450)');
    }

    await runFirestoreWrite(() =>
      setDoc(
        electionRef,
        {
          ...summaryBase,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    );
    recordFirestoreQuotaOps({ writes: 1 }, 'Import DPT Sheets (Batch ≤450)');

    for (const v of votersToUpsert) {
      const voterDocId = sanitizeDocId(getVoterDocIdFromNis(v.nis) || v.id, 'vtr');
      updateWorkspaceVoterCacheEntry(electionId, voterDocId, v);
    }

    return { clientUpdatedAt: summaryBase.clientUpdatedAt };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `elections/${electionId}/voters`);
  }
}

export async function deleteVotersBatchFromFirestore(
  user: User,
  deletedVoterIds: string[],
  dbState: DatabaseState
): Promise<{ clientUpdatedAt: number }> {
  const uid = sanitizeDocId(user.uid, 'user');
  const electionId = getUserElectionId(user);
  const electionRef = doc(firestoreDb, 'elections', electionId);
  const summaryBase = buildElectionSummaryBasePayload(uid, electionId, dbState);

  try {
    const cleanIds = deletedVoterIds.map((vid) => sanitizeDocId(vid, 'vtr'));
    const chunks = chunkIntoBatches(cleanIds, FIRESTORE_CSV_BATCH_LIMIT);
    for (const chunk of chunks) {
      const batch = writeBatch(firestoreDb);
      for (const cleanId of chunk) {
        batch.delete(doc(firestoreDb, 'elections', electionId, 'voters', cleanId));
      }
      await runFirestoreWrite(() => batch.commit());
      recordFirestoreQuotaOps({ deletes: chunk.length }, 'Hapus Pemilih (Batch)');
    }

    await runFirestoreWrite(() =>
      setDoc(
        electionRef,
        {
          ...summaryBase,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    );
    recordFirestoreQuotaOps({ writes: 1 }, 'Hapus Pemilih (Batch)');
    deleteWorkspaceVoterCacheEntries(electionId, cleanIds);

    return { clientUpdatedAt: summaryBase.clientUpdatedAt };
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `elections/${electionId}/voters`);
  }
}
