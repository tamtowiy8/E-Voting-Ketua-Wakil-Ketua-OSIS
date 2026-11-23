import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminLoginPage } from './components/AdminLoginPage';
import { AdminPanel } from './components/AdminPanel';
import { FirestoreErrorBoundary } from './components/FirestoreErrorBoundary';
import { LiveMonitor } from './components/LiveMonitor';
import { LoadingOverlay } from './components/LoadingOverlay';
import { LoginPortal } from './components/LoginPortal';
import { ScrollToTopButton } from './components/ScrollToTopButton';
import { SplashIntro } from './components/SplashIntro';
import { StartupSyncModal } from './components/StartupSyncModal';
import { ToastContainer } from './components/ToastContainer';
import { VoterPortal } from './components/VoterPortal';
import { FirebaseProvider, useFirebaseAuth } from './context/FirebaseContext';
import { SEED_TIMESTAMP } from './data/seedData';
import {
  castVoteTransactionInFirestore,
  deleteVotersBatchFromFirestore,
  fetchCandidatesOnceFromFirestore,
  fetchVotersLimitedFromFirestore,
  importCsvVotersToFirestore,
  subscribeElectionWorkspace,
  syncSingleVoterToFirestore,
  syncSummaryAndCandidatesToFirestore,
  upsertVotersBatchToFirestore,
  verifyVoterLoginInFirestore,
  type CloudElectionSummary,
} from './services/firebaseClient';
import type {
  AdminUser,
  Candidate,
  DatabaseState,
  ElectionSettings,
  ToastMessage,
  VoteReceipt,
  Voter,
} from './types/evoting';
import {
  addAuditLog,
  applyVoterEditInState,
  castVoteInState,
  DPT_DISPLAY_LIMIT,
  generateId,
  getVoterDocIdFromNis,
  resetElectionData,
  type VoterEditPayload,
} from './utils/electionLogic';
import {
  formatFirestoreErrorMessage,
  isFirestoreQuotaError,
} from './utils/firebaseSyncLogic';
import {
  gasPing,
  gasPushState,
  loadGasConfig,
  saveGasConfig,
  type GasConfig,
} from './utils/gasClient';
import { isValidGasWebAppUrl } from './utils/gasGenerator';
import {
  DEFAULT_SYNC_EMAIL,
  resolveStartupSyncStep,
} from './utils/startupSyncConfig';
import {
  apiCastVote,
  apiEditVoter,
  apiFetchLatestState,
  apiLogAdminLogin,
  apiResetElection,
  apiRestoreDatabase,
  apiToggleSecretMode,
  apiUpdateAdmins,
  apiUpdateCandidates,
  apiUpdateSettings,
  apiUpdateVoters,
  clearAdminSession,
  hasExpressBackend,
  initServerSync,
  loadAdminSession,
  loadDatabase,
  probeServerBackend,
  saveAdminSession,
  saveDatabase,
  subscribeDatabaseChanges,
} from './utils/storage';
import {
  createOfflineReceipt,
  enqueuePendingOfflineVote,
  hasVoterPendingOfflineVote,
  isOfflineOrNetworkFailure,
  isOfflineVoteCompleted,
  loadPendingOfflineVotes,
  reconcilePendingVotesIntoDb,
  savePendingOfflineVotes,
  subscribeOfflineVoteQueue,
  type PendingOfflineVote,
} from './utils/offlineVoteQueue';
import {
  clearPersistedAdminTab,
  loadPersistedPublicMonitor,
  loadProjectorMode,
  savePersistedPublicMonitor,
  shouldSkipSplashForProjector,
} from './utils/projectorMode';
import { applyThemeToDocument, DEFAULT_THEME, resolveTheme } from './utils/theme';
import {
  buildWelcomeVoiceText,
  prefetchMaleVoice,
  speakMaleVoice,
} from './utils/voiceNarrator';

type ActiveView = 'LOGIN' | 'ADMIN_LOGIN' | 'VOTER' | 'ADMIN' | 'MONITOR';

function mergeSummaryIntoDb(
  current: DatabaseState,
  summary: CloudElectionSummary,
  pendingVotes: PendingOfflineVote[] = []
): DatabaseState {
  const resolvedTheme = resolveTheme({
    presetId: summary.themePresetId || current.settings.theme?.presetId || DEFAULT_THEME.presetId,
    primaryColor:
      summary.themePrimaryColor ||
      current.settings.theme?.primaryColor ||
      DEFAULT_THEME.primaryColor,
    secondaryColor:
      summary.themeSecondaryColor ||
      current.settings.theme?.secondaryColor ||
      DEFAULT_THEME.secondaryColor,
    accentColor:
      summary.themeAccentColor ||
      current.settings.theme?.accentColor ||
      DEFAULT_THEME.accentColor,
    surfaceMode:
      summary.themeSurfaceMode ||
      current.settings.theme?.surfaceMode ||
      DEFAULT_THEME.surfaceMode,
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

  const nextCandidates = summary.candidateVotes
    ? current.candidates.map((c) => {
        const cloudVotes =
          typeof summary.candidateVotes?.[c.id] === 'number'
            ? summary.candidateVotes[c.id]
            : c.votes;
        return {
          ...c,
          votes: cloudVotes + (pendingFirestoreDelta.get(c.id) || 0),
        };
      })
    : current.candidates;

  return {
    ...current,
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

export default function App() {
  return (
    <FirestoreErrorBoundary>
      <FirebaseProvider>
        <AppContent />
      </FirebaseProvider>
    </FirestoreErrorBoundary>
  );
}

function AppContent() {
  const [initialAdminSession] = useState(() => loadAdminSession());
  const [db, setDb] = useState<DatabaseState>(() => loadDatabase());
  const [showIntro, setShowIntro] = useState(
    () =>
      typeof window !== 'undefined' &&
      !shouldSkipSplashForProjector(window.location.search, loadProjectorMode())
  );
  const [view, setView] = useState<ActiveView>(() =>
    initialAdminSession
      ? initialAdminSession.view
      : loadPersistedPublicMonitor()
        ? 'MONITOR'
        : 'LOGIN'
  );
  const [previousViewBeforeMonitor, setPreviousViewBeforeMonitor] = useState<ActiveView>(() =>
    initialAdminSession?.previousViewBeforeMonitor || 'LOGIN'
  );
  const [activeVoterId, setActiveVoterId] = useState<string | null>(null);
  const [activeVoterSnapshot, setActiveVoterSnapshot] = useState<Voter | null>(null);
  const [activeAdminId, setActiveAdminId] = useState<string | null>(() =>
    initialAdminSession ? initialAdminSession.adminId : null
  );
  const [adminSnapshot, setAdminSnapshot] = useState<AdminUser | null>(() =>
    initialAdminSession ? initialAdminSession.adminSnapshot : null
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [logoutLoadingLabel, setLogoutLoadingLabel] = useState<string | null>(null);
  const [isRefreshingApp, setIsRefreshingApp] = useState(false);
  const refreshTimerRef = useRef<number | null>(null);
  const [localMutationCounter, setLocalMutationCounter] = useState(0);
  const [pendingOfflineVotes, setPendingOfflineVotes] = useState<PendingOfflineVote[]>(() =>
    loadPendingOfflineVotes()
  );

  const [gasConfigState, setGasConfigState] = useState<GasConfig>(() => loadGasConfig());
  const [firebaseVerifiedInWizard, setFirebaseVerifiedInWizard] = useState(false);
  const [startupDismissed, setStartupDismissed] = useState(false);

  const {
    user,
    accessToken,
    authReady,
    autoSyncEnabled,
    setAutoSyncEnabled,
    setSyncStatus,
    setLastCloudSyncAt,
    setSyncError,
    quotaExceeded,
    setQuotaExceeded,
    cloudSummary,
    setCloudSummary,
    clearQuotaLockAndEnableNetwork,
    signInWithGoogle,
  } = useFirebaseAuth();

  const prevFirebaseUidRef = useRef<string | null>(null);
  const prevAccessTokenRef = useRef<string | null>(null);
  useEffect(() => {
    const nextUid = user?.uid ?? null;
    const newlySignedIn = !prevFirebaseUidRef.current && Boolean(nextUid);
    const newlyAuthorizedSheets = !prevAccessTokenRef.current && Boolean(accessToken);
    if ((newlySignedIn || newlyAuthorizedSheets) && !isValidGasWebAppUrl(gasConfigState.webAppUrl)) {
      setStartupDismissed(false);
    }
    prevFirebaseUidRef.current = nextUid;
    prevAccessTokenRef.current = accessToken;
  }, [user?.uid, accessToken, gasConfigState.webAppUrl]);

  const dbRef = useRef(db);
  dbRef.current = db;
  const quotaExceededRef = useRef(quotaExceeded);
  quotaExceededRef.current = quotaExceeded;
  const pendingOfflineVotesRef = useRef(pendingOfflineVotes);
  pendingOfflineVotesRef.current = pendingOfflineVotes;
  const flushingQueueRef = useRef<boolean>(false);
  const lastSyncedTsRef = useRef<number>(0);
  const lastPulledTsRef = useRef<number>(0);
  const syncInFlightRef = useRef<boolean>(false);
  const quotaNotifiedRef = useRef<boolean>(false);
  const initialCandidatesFetchedUidRef = useRef<string | null>(null);

  const notify = useCallback(
    (type: 'success' | 'error' | 'info', title: string, description?: string) => {
      const id = generateId('toast');
      setToasts((prev) => [...prev.slice(-1), { id, type, title, description }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3200);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => {
    if (!quotaExceeded) {
      quotaNotifiedRef.current = false;
    }
  }, [quotaExceeded]);

  const handleCloudSyncFailure = useCallback(
    (err: unknown) => {
      const readable = formatFirestoreErrorMessage(err);
      setSyncStatus('error');
      setSyncError(readable);
      if (isFirestoreQuotaError(err)) {
        setQuotaExceeded(true);
        if (!quotaNotifiedRef.current) {
          quotaNotifiedRef.current = true;
          notifyRef.current(
            'error',
            'Kuota Harian Firestore Penuh',
            'Auto-Sync Firebase dijeda sementara hingga kuota reset besok. Data tetap tersimpan aman di server & lokal.'
          );
        }
      }
    },
    [setQuotaExceeded, setSyncError, setSyncStatus]
  );

  useEffect(() => {
    applyThemeToDocument(db.settings.theme);
  }, [db.settings.theme]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    savePersistedPublicMonitor(view === 'MONITOR');
  }, [view]);

  // Subscribe to LocalStorage changes across same-device tabs, offline queue updates, AND cross-device server SSE/polling
  useEffect(() => {
    const unsubQueue = subscribeOfflineVoteQueue((nextQueue) => {
      setPendingOfflineVotes(nextQueue);
    });
    const unsubStorage = subscribeDatabaseChanges((nextDb) => {
      setDb(reconcilePendingVotesIntoDb(nextDb, loadPendingOfflineVotes()));
    });
    const unsubServer = initServerSync((remoteDb) => {
      setDb(reconcilePendingVotesIntoDb(remoteDb, loadPendingOfflineVotes()));
    });
    const handleGasConfigChange = (e: Event) => {
      const custom = e as CustomEvent<GasConfig>;
      setGasConfigState(custom.detail || loadGasConfig());
    };
    window.addEventListener('osis-gas-config-change', handleGasConfigChange);
    return () => {
      unsubQueue();
      unsubStorage();
      unsubServer();
      window.removeEventListener('osis-gas-config-change', handleGasConfigChange);
    };
  }, []);

  const flushOfflineVotes = useCallback(async () => {
    if (flushingQueueRef.current) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const currentQueue = loadPendingOfflineVotes();
    if (currentQueue.length === 0) return;

    flushingQueueRef.current = true;
    try {
      const hasServer = hasExpressBackend() || (await probeServerBackend());
      const remainingQueue: PendingOfflineVote[] = [];
      let completedCount = 0;
      let serverProgressCount = 0;

      for (const item of currentQueue) {
        let syncedServer = item.syncedServer;
        let syncedFirestore = item.syncedFirestore;
        let lastError = item.lastError;

        if (!syncedServer) {
          if (!hasServer) {
            syncedServer = true;
          } else {
            const serverRes = await apiCastVote(item.voterId, item.candidateId);
            if (serverRes !== null) {
              if (serverRes.ok) {
                syncedServer = true;
                lastError = undefined;
                serverProgressCount += 1;
              } else if (
                serverRes.error &&
                /sudah menggunakan hak suara|tidak ditemukan/i.test(serverRes.error)
              ) {
                syncedServer = true;
                lastError = undefined;
              } else {
                lastError = serverRes.error || 'Gagal menyinkronkan suara ke server.';
              }
            }
          }
        }

        if (user && !quotaExceededRef.current && !syncedFirestore) {
          try {
            const txRes = await castVoteTransactionInFirestore(
              user,
              item.voterSnapshot,
              item.candidateId,
              item.votedAt
            );
            syncedFirestore = true;
            lastError = undefined;
            lastPulledTsRef.current = txRes.clientUpdatedAt;
            setLastCloudSyncAt(Date.now());
            setSyncStatus('synced');
            setSyncError(null);
          } catch (cloudErr) {
            const msg = cloudErr instanceof Error ? cloudErr.message : String(cloudErr);
            if (/sudah menggunakan hak suara|tidak ditemukan di firestore|belum tersedia/i.test(msg)) {
              syncedFirestore = true;
              lastError = undefined;
              if (/tidak ditemukan di firestore|belum tersedia/i.test(msg)) {
                void syncSummaryAndCandidatesToFirestore(user, loadDatabase()).catch(() => {});
              }
            } else if (isFirestoreQuotaError(cloudErr)) {
              handleCloudSyncFailure(cloudErr);
              lastError = 'Kuota Firestore penuh sementara.';
            } else {
              lastError = msg;
            }
          }
        }

        const requireFirestore = Boolean(user);
        const updatedItem: PendingOfflineVote = {
          ...item,
          syncedServer,
          syncedFirestore,
          attempts: item.attempts + 1,
          lastAttemptAt: Date.now(),
          lastError,
        };

        if (isOfflineVoteCompleted(updatedItem, requireFirestore, hasServer)) {
          completedCount += 1;
        } else {
          remainingQueue.push(updatedItem);
        }
      }

      savePendingOfflineVotes(remainingQueue);
      setPendingOfflineVotes(remainingQueue);

      if (completedCount > 0 || serverProgressCount > 0) {
        const latestServerDb = hasServer ? await apiFetchLatestState() : null;
        if (latestServerDb) {
          setDb(reconcilePendingVotesIntoDb(latestServerDb, remainingQueue));
        }
        const syncedTotal = completedCount > 0 ? completedCount : serverProgressCount;
        notifyRef.current(
          'success',
          'Sinkronisasi Offline Berhasil',
          hasServer
            ? `${syncedTotal} suara yang tersimpan offline telah otomatis dikirim ke server.`
            : `${syncedTotal} suara yang tersimpan offline telah otomatis disinkronkan ke cloud.`
        );
      }
    } finally {
      flushingQueueRef.current = false;
    }
  }, [user, setLastCloudSyncAt, setSyncStatus, setSyncError, handleCloudSyncFailure]);

  // Automatic flush triggers when internet connection returns or app becomes active
  useEffect(() => {
    const handleOnline = () => {
      void flushOfflineVotes();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void flushOfflineVotes();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [flushOfflineVotes]);

  // Periodic retry while pending offline votes exist (no polling when queue is empty)
  useEffect(() => {
    if (pendingOfflineVotes.length === 0) return;
    void flushOfflineVotes();
    const timer = window.setInterval(() => {
      void flushOfflineVotes();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [pendingOfflineVotes.length, authReady, user, quotaExceeded, flushOfflineVotes]);

  // 1. Real-time Count: subscribe ONLY to the 1 summary document `elections/{electionId}` (NO voters/votes collection snapshot!)
  useEffect(() => {
    if (!authReady || !user || quotaExceeded) {
      if (!authReady || !user) {
        setCloudSummary(null);
        initialCandidatesFetchedUidRef.current = null;
      }
      return;
    }

    const unsub = subscribeElectionWorkspace(
      user,
      (summary) => {
        setCloudSummary(summary);
        if (!summary) return;

        setSyncStatus('synced');
        setLastCloudSyncAt(Date.now());
        setSyncError(null);

        if (
          autoSyncEnabled &&
          !syncInFlightRef.current &&
          !quotaExceededRef.current &&
          typeof summary.clientUpdatedAt === 'number' &&
          summary.clientUpdatedAt > dbRef.current.lastUpdated &&
          summary.clientUpdatedAt !== lastPulledTsRef.current &&
          summary.clientUpdatedAt !== lastSyncedTsRef.current
        ) {
          const queueSnapshot = loadPendingOfflineVotes();
          const merged = reconcilePendingVotesIntoDb(
            mergeSummaryIntoDb(dbRef.current, summary, queueSnapshot),
            queueSnapshot
          );
          lastPulledTsRef.current = merged.lastUpdated;
          lastSyncedTsRef.current = merged.lastUpdated;
          const saved = saveDatabase(merged, true);
          setDb(saved);
        }
      },
      (err) => {
        handleCloudSyncFailure(err);
      }
    );

    return () => unsub();
  }, [
    authReady,
    user,
    autoSyncEnabled,
    quotaExceeded,
    setCloudSummary,
    setSyncStatus,
    setLastCloudSyncAt,
    setSyncError,
    handleCloudSyncFailure,
  ]);

  // 2. Fetch candidate list ONCE with getDocs (no onSnapshot on candidates) & max 20 voters only if local voters are empty
  useEffect(() => {
    if (!authReady || !user || quotaExceeded) return;
    if (initialCandidatesFetchedUidRef.current === user.uid) return;
    initialCandidatesFetchedUidRef.current = user.uid;

    void (async () => {
      try {
        const remoteCandidates = await fetchCandidatesOnceFromFirestore(user, dbRef.current.candidates);
        let nextDb = dbRef.current;
        let changed = false;

        if (
          remoteCandidates.length > 0 &&
          JSON.stringify(remoteCandidates) !== JSON.stringify(nextDb.candidates)
        ) {
          nextDb = { ...nextDb, candidates: remoteCandidates };
          changed = true;
        }

        if (nextDb.voters.length === 0) {
          const limitedVoters = await fetchVotersLimitedFromFirestore(user, DPT_DISPLAY_LIMIT);
          if (limitedVoters.length > 0) {
            nextDb = { ...nextDb, voters: limitedVoters };
            changed = true;
          }
        }

        if (changed) {
          const saved = saveDatabase(nextDb, true);
          setDb(saved);
        }
      } catch (err) {
        if (isFirestoreQuotaError(err)) {
          handleCloudSyncFailure(err);
        }
      }
    })();
  }, [authReady, user, quotaExceeded, handleCloudSyncFailure]);

  // 3. Fallback guard: only fetch candidate list ONCE per session if not yet loaded by Effect 2 (NO repeated reads per student login!)
  useEffect(() => {
    if (view !== 'VOTER' || !authReady || !user || quotaExceeded) return;
    if (initialCandidatesFetchedUidRef.current === user.uid && dbRef.current.candidates.length > 0) {
      return;
    }
    initialCandidatesFetchedUidRef.current = user.uid;
    void (async () => {
      try {
        const remoteCandidates = await fetchCandidatesOnceFromFirestore(user, dbRef.current.candidates);
        if (
          remoteCandidates.length > 0 &&
          JSON.stringify(remoteCandidates) !== JSON.stringify(dbRef.current.candidates)
        ) {
          const saved = saveDatabase({ ...dbRef.current, candidates: remoteCandidates }, true);
          setDb(saved);
        }
      } catch (err) {
        if (isFirestoreQuotaError(err)) {
          handleCloudSyncFailure(err);
        }
      }
    })();
  }, [view, authReady, user, quotaExceeded, handleCloudSyncFailure]);

  const commitDb = useCallback((nextState: DatabaseState): DatabaseState => {
    const saved = saveDatabase(nextState);
    setDb(saved);
    setLocalMutationCounter((c) => c + 1);
    return saved;
  }, []);

  // 4. Lightweight debounced push (ONLY summary doc + candidates, NEVER scanning all 999 voters)
  useEffect(() => {
    if (localMutationCounter <= 0 || !authReady || !user || !autoSyncEnabled || quotaExceeded) {
      return;
    }
    if (
      db.lastUpdated === lastSyncedTsRef.current ||
      db.lastUpdated === lastPulledTsRef.current
    ) {
      return;
    }

    const timer = window.setTimeout(async () => {
      if (!user || !autoSyncEnabled || syncInFlightRef.current || quotaExceededRef.current) return;
      if (lastSyncedTsRef.current === dbRef.current.lastUpdated) {
        setSyncStatus('synced');
        return;
      }
      syncInFlightRef.current = true;
      setSyncStatus('syncing');
      try {
        const res = await syncSummaryAndCandidatesToFirestore(user, dbRef.current);
        lastSyncedTsRef.current = res.clientUpdatedAt;
        setLastCloudSyncAt(Date.now());
        setSyncStatus('synced');
        setSyncError(null);
        setQuotaExceeded(false);
      } catch (err) {
        handleCloudSyncFailure(err);
      } finally {
        syncInFlightRef.current = false;
      }
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [
    localMutationCounter,
    db.lastUpdated,
    authReady,
    user,
    autoSyncEnabled,
    quotaExceeded,
    setSyncStatus,
    setLastCloudSyncAt,
    setSyncError,
    setQuotaExceeded,
    handleCloudSyncFailure,
  ]);

  const activeVoter = activeVoterId
    ? db.voters.find((v) => v.id === activeVoterId) || activeVoterSnapshot
    : null;

  // Keep admin logged in reliably using db lookup with snapshot fallback (never auto-logout on sync)
  const matchedAdmin = activeAdminId
    ? db.admins.find((a) => a.id === activeAdminId) || null
    : null;
  const activeAdmin = activeAdminId ? matchedAdmin || adminSnapshot : null;

  // Keep persisted admin session synchronized when view or admin details change
  useEffect(() => {
    if (matchedAdmin && matchedAdmin !== adminSnapshot) {
      setAdminSnapshot(matchedAdmin);
    }
  }, [matchedAdmin, adminSnapshot]);

  useEffect(() => {
    if (!activeAdminId || !activeAdmin) return;
    if (view === 'ADMIN' || view === 'MONITOR') {
      saveAdminSession({
        adminId: activeAdminId,
        adminSnapshot: activeAdmin,
        view,
        previousViewBeforeMonitor,
      });
    }
  }, [activeAdminId, activeAdmin, view, previousViewBeforeMonitor]);

  // 1-Read Firestore Voter Login Lookup (`getDoc(doc(..., 'voters', docId))`)
  const handleCloudLookupVoter = useCallback(
    async (nisInput: string) => {
      if (!user || quotaExceededRef.current) return null;
      return verifyVoterLoginInFirestore(user, nisInput);
    },
    [user]
  );

  const handleVoterLogin = (voter: Voter) => {
    setActiveVoterId(voter.id);
    setActiveVoterSnapshot(voter);
    setView('VOTER');
  };

  const handleAdminLogin = (admin: AdminUser) => {
    const nextLogs = addAuditLog(
      db.auditLogs,
      admin.fullName,
      admin.role,
      'ADMIN_LOGIN',
      `Login ke Panel Pengelola sebagai ${admin.role}.`
    );
    commitDb({ ...db, auditLogs: nextLogs });
    setActiveAdminId(admin.id);
    setAdminSnapshot(admin);
    setView('ADMIN');
    saveAdminSession({
      adminId: admin.id,
      adminSnapshot: admin,
      view: 'ADMIN',
      previousViewBeforeMonitor: 'ADMIN',
    });
    void apiLogAdminLogin(
      admin.fullName,
      admin.role,
      `Login ke Panel Pengelola sebagai ${admin.role}.`
    );
  };

  const persistOfflineVote = useCallback(
    (
      voterObj: Voter,
      candidateId: string,
      existingReceipt: VoteReceipt | null,
      flags: { syncedServer: boolean; syncedFirestore: boolean },
      errMsg?: string
    ): VoteReceipt => {
      const latestDb = loadDatabase();
      const nowIso = existingReceipt?.timestamp || new Date().toISOString();
      const baseVoterSnapshot: Voter = { ...voterObj, hasVoted: false };

      let nextState = latestDb;
      let receipt = existingReceipt;

      const existingLocalVoter = latestDb.voters.find((v) => v.id === voterObj.id);
      if (!existingLocalVoter) {
        const dbWithVoter: DatabaseState = {
          ...latestDb,
          voters: [...latestDb.voters, baseVoterSnapshot],
        };
        const castRes = castVoteInState(dbWithVoter, voterObj.id, candidateId, nowIso);
        nextState = castRes.nextState;
        if (!receipt) {
          receipt = castRes.receipt;
        }
      } else if (!existingLocalVoter.hasVoted) {
        const castRes = castVoteInState(latestDb, voterObj.id, candidateId, nowIso);
        nextState = castRes.nextState;
        if (!receipt) {
          receipt = castRes.receipt;
        }
      }

      if (!receipt) {
        receipt = createOfflineReceipt(voterObj, nowIso);
      }

      const offlineReceipt: VoteReceipt = { ...receipt, offlinePending: true };
      const queueEntry: PendingOfflineVote = {
        id: generateId('offline_vote'),
        voterId: voterObj.id,
        voterSnapshot: baseVoterSnapshot,
        candidateId,
        votedAt: nowIso,
        receipt: offlineReceipt,
        syncedServer: flags.syncedServer,
        syncedFirestore: flags.syncedFirestore,
        attempts: 0,
        createdAt: Date.now(),
        lastError: errMsg,
      };

      const nextQueue = enqueuePendingOfflineVote(loadPendingOfflineVotes(), queueEntry);
      savePendingOfflineVotes(nextQueue);
      setPendingOfflineVotes(nextQueue);

      const saved = saveDatabase(nextState);
      setDb(saved);
      setActiveVoterSnapshot({
        ...voterObj,
        hasVoted: true,
        votedAt: nowIso,
        votedCandidateId: candidateId,
      });

      return offlineReceipt;
    },
    []
  );

  const handleCastVote = async (candidateId: string): Promise<VoteReceipt | null> => {
    if (!activeVoterId) return null;
    const currentVoter = activeVoter;
    const latestLocalDb = loadDatabase();
    const localVoterRecord = latestLocalDb.voters.find((v) => v.id === activeVoterId);
    const voterExistsLocally = Boolean(localVoterRecord);
    const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const expressAvailable = isBrowserOffline ? hasExpressBackend() : await probeServerBackend();

    if (
      hasVoterPendingOfflineVote(
        pendingOfflineVotesRef.current,
        currentVoter?.nis || '',
        activeVoterId
      )
    ) {
      notify(
        'error',
        'Suara Sudah Tercatat',
        'Anda sudah menggunakan hak suara (tersimpan offline, menunggu sinkronisasi).'
      );
      return null;
    }

    try {
      // Case 1: Voter authenticated via 1-Read Firestore lookup without full local voters hydration
      if (!voterExistsLocally && currentVoter) {
        if (!isBrowserOffline && user && !quotaExceeded) {
          const nowIso = new Date().toISOString();
          syncInFlightRef.current = true;
          setSyncStatus('syncing');
          try {
            const txRes = await castVoteTransactionInFirestore(user, currentVoter, candidateId, nowIso);
            lastSyncedTsRef.current = txRes.clientUpdatedAt;
            lastPulledTsRef.current = txRes.clientUpdatedAt;
            setLastCloudSyncAt(Date.now());
            setSyncStatus('synced');
            setSyncError(null);

            const updatedVoter: Voter = {
              ...currentVoter,
              hasVoted: true,
              votedAt: nowIso,
              votedCandidateId: candidateId,
            };
            setActiveVoterSnapshot(updatedVoter);
            const latestDb = loadDatabase();
            const nextCandidates = latestDb.candidates.map((c) =>
              c.id === candidateId ? { ...c, votes: c.votes + 1 } : c
            );
            const saved = saveDatabase({ ...latestDb, candidates: nextCandidates }, true);
            setDb(saved);

            const receipt: VoteReceipt = {
              receiptCode: `VOT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
              timestamp: nowIso,
              voterName: currentVoter.name,
              voterNis: currentVoter.nis,
              voterClass: currentVoter.kelas,
            };
            notify('success', 'Suara Tercatat', 'Terima kasih, suara sah Anda telah disimpan.');
            return receipt;
          } catch (cloudErr) {
            const errMsg = cloudErr instanceof Error ? cloudErr.message : String(cloudErr);
            if (isOfflineOrNetworkFailure(cloudErr, !isBrowserOffline) || isFirestoreQuotaError(cloudErr)) {
              const offlineReceipt = persistOfflineVote(
                currentVoter,
                candidateId,
                null,
                { syncedServer: !expressAvailable, syncedFirestore: false },
                errMsg
              );
              notify(
                'info',
                'Suara Tersimpan Offline',
                'Koneksi terputus. Pilihan Anda disimpan di perangkat dan akan otomatis tersinkronisasi saat kembali online.'
              );
              return offlineReceipt;
            }
            throw cloudErr;
          } finally {
            syncInFlightRef.current = false;
          }
        }

        const offlineReceipt = persistOfflineVote(
          currentVoter,
          candidateId,
          null,
          { syncedServer: !expressAvailable, syncedFirestore: false }
        );
        notify(
          'info',
          'Suara Tersimpan Offline',
          'Perangkat sedang offline. Pilihan Anda disimpan di perangkat dan akan otomatis terkirim saat internet tersambung.'
        );
        return offlineReceipt;
      }

      // Case 2: Voter exists in local / Express database (plus atomic Firestore transaction when connected)
      const targetVoter = localVoterRecord || currentVoter;
      if (!targetVoter) {
        throw new Error('Data pemilih tidak ditemukan.');
      }
      if (localVoterRecord?.hasVoted) {
        notify(
          'error',
          'Pengiriman Suara Gagal',
          'Anda sudah menggunakan hak suara dan tidak dapat memilih ulang.'
        );
        return null;
      }

      // Case 2A: Express server backend is active & online
      if (expressAvailable && !isBrowserOffline) {
        const serverRes = await apiCastVote(activeVoterId, candidateId);
        if (serverRes) {
          if (!serverRes.ok || !serverRes.receipt) {
            if (serverRes.db) {
              setDb(reconcilePendingVotesIntoDb(serverRes.db, loadPendingOfflineVotes()));
            }
            notify('error', 'Pengiriman Suara Gagal', serverRes.error || 'Gagal mengirim suara.');
            return null;
          }

          const reconciledDb = reconcilePendingVotesIntoDb(
            serverRes.db || loadDatabase(),
            loadPendingOfflineVotes()
          );
          setDb(reconciledDb);
          const nextLocalTs = reconciledDb.lastUpdated;
          setLocalMutationCounter((c) => c + 1);

          let cloudPending = false;
          if (user && !quotaExceeded) {
            lastSyncedTsRef.current = nextLocalTs;
            syncInFlightRef.current = true;
            try {
              const txRes = await castVoteTransactionInFirestore(
                user,
                targetVoter,
                candidateId,
                serverRes.receipt.timestamp
              );
              lastSyncedTsRef.current = nextLocalTs;
              lastPulledTsRef.current = txRes.clientUpdatedAt;
              setLastCloudSyncAt(Date.now());
              setSyncStatus('synced');
            } catch (cloudErr) {
              const msg = cloudErr instanceof Error ? cloudErr.message : String(cloudErr);
              if (isFirestoreQuotaError(cloudErr)) {
                handleCloudSyncFailure(cloudErr);
                cloudPending = true;
              } else if (isOfflineOrNetworkFailure(cloudErr, !isBrowserOffline)) {
                cloudPending = true;
              } else if (
                !msg.includes('tidak ditemukan di Firestore') &&
                !msg.includes('belum tersedia')
              ) {
                console.warn('Firestore transaction warning:', msg);
              }
            } finally {
              syncInFlightRef.current = false;
            }
          }

          if (cloudPending) {
            const queuedReceipt = persistOfflineVote(
              targetVoter,
              candidateId,
              serverRes.receipt,
              { syncedServer: true, syncedFirestore: false }
            );
            notify(
              'info',
              'Suara Tersimpan & Antre Cloud',
              'Suara tersimpan di server lokal dan akan otomatis tersinkron ke cloud saat internet tersambung.'
            );
            return queuedReceipt;
          }

          notify('success', 'Suara Tercatat', 'Terima kasih, suara sah Anda telah disimpan.');
          return serverRes.receipt;
        }
      }

      // Case 2B: Static Netlify hosting while online -> commit locally, push to Firestore & Apps Script Spreadsheet
      if (!expressAvailable && !isBrowserOffline) {
        const { nextState, receipt } = castVoteInState(latestLocalDb, targetVoter.id, candidateId);
        const reconciledDb = reconcilePendingVotesIntoDb(nextState, loadPendingOfflineVotes());
        const saved = saveDatabase(reconciledDb);
        setDb(saved);
        setLocalMutationCounter((c) => c + 1);
        setActiveVoterSnapshot({
          ...targetVoter,
          hasVoted: true,
          votedAt: receipt.timestamp,
          votedCandidateId: candidateId,
        });

        let cloudPending = false;
        if (user && !quotaExceeded) {
          lastSyncedTsRef.current = saved.lastUpdated;
          syncInFlightRef.current = true;
          setSyncStatus('syncing');
          try {
            const txRes = await castVoteTransactionInFirestore(
              user,
              targetVoter,
              candidateId,
              receipt.timestamp
            );
            lastSyncedTsRef.current = saved.lastUpdated;
            lastPulledTsRef.current = txRes.clientUpdatedAt;
            setLastCloudSyncAt(Date.now());
            setSyncStatus('synced');
            setSyncError(null);
          } catch (cloudErr) {
            const msg = cloudErr instanceof Error ? cloudErr.message : String(cloudErr);
            if (isFirestoreQuotaError(cloudErr)) {
              handleCloudSyncFailure(cloudErr);
              cloudPending = true;
            } else if (isOfflineOrNetworkFailure(cloudErr, true)) {
              cloudPending = true;
            } else if (
              msg.includes('tidak ditemukan di Firestore') ||
              msg.includes('belum tersedia')
            ) {
              try {
                await syncSummaryAndCandidatesToFirestore(user, saved);
                setLastCloudSyncAt(Date.now());
                setSyncStatus('synced');
                setSyncError(null);
              } catch (summaryErr) {
                if (isFirestoreQuotaError(summaryErr)) {
                  handleCloudSyncFailure(summaryErr);
                  cloudPending = true;
                }
              }
            } else {
              console.warn('Firestore transaction warning:', msg);
            }
          } finally {
            syncInFlightRef.current = false;
          }
        }

        if (cloudPending) {
          const queuedReceipt = persistOfflineVote(
            targetVoter,
            candidateId,
            receipt,
            { syncedServer: true, syncedFirestore: false }
          );
          notify(
            'info',
            'Suara Tersimpan & Antre Cloud',
            'Suara tersimpan di perangkat dan akan otomatis tersinkron ke Firebase saat kuota/koneksi tersedia.'
          );
          return queuedReceipt;
        }

        notify('success', 'Suara Tercatat', 'Terima kasih, suara sah Anda telah disimpan.');
        return receipt;
      }

      // Case 2C: Network offline or Express server unreachable -> persist locally + queue for automatic online sync
      const offlineReceipt = persistOfflineVote(
        targetVoter,
        candidateId,
        null,
        { syncedServer: !expressAvailable, syncedFirestore: false }
      );
      notify(
        'info',
        'Suara Tersimpan Offline',
        'Koneksi terputus. Pilihan Anda aman di perangkat dan akan otomatis dikirim saat kembali online.'
      );
      return offlineReceipt;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mengirim suara.';
      notify('error', 'Pengiriman Suara Gagal', msg);
      return null;
    }
  };

  const handleVoterLogout = useCallback(() => {
    setLogoutLoadingLabel('Keluar dari Bilik Suara...');
    window.setTimeout(() => {
      setActiveVoterId(null);
      setActiveVoterSnapshot(null);
      setView('LOGIN');
      setLogoutLoadingLabel(null);
    }, 350);
  }, []);

  const handleAdminLogout = () => {
    setLogoutLoadingLabel('Keluar dari Panel Admin...');
    window.setTimeout(() => {
      clearAdminSession();
      clearPersistedAdminTab();
      savePersistedPublicMonitor(false);
      setActiveAdminId(null);
      setAdminSnapshot(null);
      setView('LOGIN');
      setLogoutLoadingLabel(null);
      notify('info', 'Keluar Panel Admin', 'Sesi pengelola telah diakhiri.');
    }, 350);
  };

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  const handleAppRefresh = useCallback(() => {
    if (isRefreshingApp) return;
    setIsRefreshingApp(true);
    refreshTimerRef.current = window.setTimeout(() => {
      window.location.reload();
    }, 3000);
  }, [isRefreshingApp]);

  const handleOpenLiveMonitor = () => {
    setPreviousViewBeforeMonitor(view === 'MONITOR' ? 'LOGIN' : view);
    setView('MONITOR');
  };

  const handleBackFromMonitor = () => {
    if (previousViewBeforeMonitor === 'ADMIN' && activeAdmin) {
      setView('ADMIN');
    } else if (previousViewBeforeMonitor === 'ADMIN_LOGIN') {
      setView('ADMIN_LOGIN');
    } else {
      setView('LOGIN');
    }
  };

  const handleToggleSecretMode = () => {
    const latestDb = loadDatabase();
    const nextHide = !latestDb.settings.hideLiveResults;
    const actorName = activeAdmin ? activeAdmin.fullName : 'Operator Live Monitor';
    const actorRole = activeAdmin ? activeAdmin.role : 'SYSTEM';
    const nextLogs = addAuditLog(
      latestDb.auditLogs,
      actorName,
      actorRole,
      'TOGGLE_SECRET_MODE',
      nextHide
        ? 'Menyembunyikan angka hasil pada Live Monitor.'
        : 'Menampilkan angka hasil pada Live Monitor.'
    );
    commitDb({
      ...latestDb,
      settings: { ...latestDb.settings, hideLiveResults: nextHide },
      auditLogs: nextLogs,
    });
    void apiToggleSecretMode(nextHide, actorName, actorRole);
    notify(
      'info',
      nextHide ? 'Mode Rahasia Aktif' : 'Hasil Ditampilkan',
      nextHide
        ? 'Hasil perolehan suara disembunyikan sementara.'
        : 'Hasil perolehan suara kini terlihat di Live Monitor.'
    );
  };

  // Optimized CSV Import handler (450-doc writeBatch + NIS doc ID + candidate reset + 1 summary doc update)
  const handleImportCsvVoters = async (
    importedVoters: Voter[],
    skippedCount: number
  ): Promise<void> => {
    if (!activeAdmin) return;
    const resetCandidates = db.candidates.map((c) => ({ ...c, votes: 0 }));
    const nextLogs = addAuditLog(
      db.auditLogs,
      activeAdmin.fullName,
      activeAdmin.role,
      'IMPORT_DPT_CSV',
      `Mengimpor ${importedVoters.length} pemilih baru dari CSV (${skippedCount} duplikat dilewati) & mereset perolehan suara ke 0.`
    );
    savePendingOfflineVotes([]);
    setPendingOfflineVotes([]);
    const saved = commitDb({
      ...db,
      voters: importedVoters,
      candidates: resetCandidates,
      auditLogs: nextLogs,
    });
    void apiRestoreDatabase(saved);

    if (user && autoSyncEnabled && !quotaExceeded) {
      syncInFlightRef.current = true;
      setSyncStatus('syncing');
      try {
        const res = await importCsvVotersToFirestore(user, importedVoters, saved);
        lastSyncedTsRef.current = saved.lastUpdated;
        lastPulledTsRef.current = res.clientUpdatedAt;
        setLastCloudSyncAt(Date.now());
        setSyncStatus('synced');
        setSyncError(null);
      } catch (err) {
        handleCloudSyncFailure(err);
      } finally {
        syncInFlightRef.current = false;
      }
    }
  };

  const handleUpdateVoters = (nextVoters: Voter[], action: string, detail: string) => {
    if (!activeAdmin) return;
    const prevVoters = db.voters;
    const nextLogs = addAuditLog(db.auditLogs, activeAdmin.fullName, activeAdmin.role, action, detail);
    const saved = commitDb({ ...db, voters: nextVoters, auditLogs: nextLogs });
    void apiUpdateVoters(nextVoters, activeAdmin.fullName, activeAdmin.role, action, detail);

    if (!user || !autoSyncEnabled || quotaExceeded) return;

    if (action === 'ADD_VOTER' && nextVoters.length > 0) {
      lastSyncedTsRef.current = saved.lastUpdated;
      void (async () => {
        syncInFlightRef.current = true;
        setSyncStatus('syncing');
        try {
          await syncSingleVoterToFirestore(user, nextVoters[0], saved);
          setLastCloudSyncAt(Date.now());
          setSyncStatus('synced');
          setSyncError(null);
        } catch (err) {
          handleCloudSyncFailure(err);
        } finally {
          syncInFlightRef.current = false;
        }
      })();
      return;
    }

    if (action === 'DELETE_VOTER' || action === 'BULK_DELETE_VOTERS') {
      const nextIds = new Set(nextVoters.map((v) => v.id));
      const deletedDocIds = prevVoters
        .filter((v) => !nextIds.has(v.id))
        .map((v) => getVoterDocIdFromNis(v.nis) || v.id);
      lastSyncedTsRef.current = saved.lastUpdated;
      void (async () => {
        syncInFlightRef.current = true;
        setSyncStatus('syncing');
        try {
          await deleteVotersBatchFromFirestore(user, deletedDocIds, saved);
          setLastCloudSyncAt(Date.now());
          setSyncStatus('synced');
          setSyncError(null);
        } catch (err) {
          handleCloudSyncFailure(err);
        } finally {
          syncInFlightRef.current = false;
        }
      })();
      return;
    }

    if (action === 'IMPORT_DPT_GOOGLE_SHEETS' || action === 'IMPORT_DPTB_CSV') {
      const prevIds = new Set(prevVoters.map((v) => v.id));
      const addedVoters = nextVoters.filter((v) => !prevIds.has(v.id));
      if (addedVoters.length > 0) {
        lastSyncedTsRef.current = saved.lastUpdated;
        void (async () => {
          syncInFlightRef.current = true;
          setSyncStatus('syncing');
          try {
            await upsertVotersBatchToFirestore(user, addedVoters, saved);
            setLastCloudSyncAt(Date.now());
            setSyncStatus('synced');
            setSyncError(null);
          } catch (err) {
            handleCloudSyncFailure(err);
          } finally {
            syncInFlightRef.current = false;
          }
        })();
      }
    }
  };

  const handleEditVoter = (voterId: string, payload: VoterEditPayload): boolean => {
    if (!activeAdmin) return false;
    try {
      const { nextState } = applyVoterEditInState(db, voterId, payload, activeAdmin);
      const saved = commitDb(nextState);
      if (user && autoSyncEnabled && !quotaExceeded) {
        lastSyncedTsRef.current = saved.lastUpdated;
        const editedVoter = saved.voters.find((v) => v.id === voterId);
        void (async () => {
          syncInFlightRef.current = true;
          setSyncStatus('syncing');
          try {
            if (editedVoter) {
              await syncSingleVoterToFirestore(user, editedVoter, saved);
            }
            await syncSummaryAndCandidatesToFirestore(user, saved);
            setLastCloudSyncAt(Date.now());
            setSyncStatus('synced');
            setSyncError(null);
          } catch (err) {
            handleCloudSyncFailure(err);
          } finally {
            syncInFlightRef.current = false;
          }
        })();
      }

      void (async () => {
        const serverRes = await apiEditVoter(
          voterId,
          payload,
          activeAdmin.fullName,
          activeAdmin.role
        );
        const serverDb = serverRes && serverRes.ok ? serverRes.db : undefined;
        const serverEditedVoter = serverDb?.voters.find((v) => v.id === voterId);
        const localEditedVoter = nextState.voters.find((v) => v.id === voterId);
        const serverInSync = Boolean(
          serverDb &&
            serverEditedVoter &&
            localEditedVoter &&
            serverEditedVoter.nis === localEditedVoter.nis &&
            serverEditedVoter.name === localEditedVoter.name &&
            serverEditedVoter.kelas === localEditedVoter.kelas &&
            serverEditedVoter.grade === localEditedVoter.grade &&
            serverEditedVoter.hasVoted === localEditedVoter.hasVoted &&
            (serverEditedVoter.votedCandidateId || undefined) ===
              (localEditedVoter.votedCandidateId || undefined) &&
            serverDb.voters.length === nextState.voters.length &&
            serverDb.candidates.map((c) => `${c.id}:${c.votes}`).join('|') ===
              nextState.candidates.map((c) => `${c.id}:${c.votes}`).join('|')
        );

        if (serverInSync && serverDb) {
          saveDatabase(serverDb, true);
          setDb(serverDb);
        } else {
          await apiRestoreDatabase(nextState);
        }
      })();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memperbarui data pemilih.';
      notify('error', 'Gagal Menyimpan Pemilih', msg);
      return false;
    }
  };

  const handleUpdateCandidates = (
    nextCandidates: Candidate[],
    action: string,
    detail: string
  ) => {
    if (!activeAdmin) return;
    const nextLogs = addAuditLog(db.auditLogs, activeAdmin.fullName, activeAdmin.role, action, detail);
    commitDb({ ...db, candidates: nextCandidates, auditLogs: nextLogs });
    void apiUpdateCandidates(nextCandidates, activeAdmin.fullName, activeAdmin.role, action, detail);
  };

  const handleUpdateAdmins = (nextAdmins: AdminUser[], action: string, detail: string) => {
    if (!activeAdmin) return;
    const nextLogs = addAuditLog(db.auditLogs, activeAdmin.fullName, activeAdmin.role, action, detail);
    commitDb({ ...db, admins: nextAdmins, auditLogs: nextLogs });
    void apiUpdateAdmins(nextAdmins, activeAdmin.fullName, activeAdmin.role, action, detail);
  };

  const handleUpdateSettings = (
    nextSettings: ElectionSettings,
    action: string,
    detail: string
  ) => {
    if (!activeAdmin) return;
    const nextLogs = addAuditLog(db.auditLogs, activeAdmin.fullName, activeAdmin.role, action, detail);
    commitDb({ ...db, settings: nextSettings, auditLogs: nextLogs });
    void apiUpdateSettings(nextSettings, activeAdmin.fullName, activeAdmin.role, action, detail);
  };

  const handleResetElection = () => {
    if (!activeAdmin) return;
    savePendingOfflineVotes([]);
    setPendingOfflineVotes([]);
    const nextState = resetElectionData(db, activeAdmin);
    const saved = commitDb(nextState);
    void apiResetElection(activeAdmin);

    if (user && autoSyncEnabled && !quotaExceeded) {
      lastSyncedTsRef.current = saved.lastUpdated;
      void (async () => {
        syncInFlightRef.current = true;
        setSyncStatus('syncing');
        try {
          await importCsvVotersToFirestore(user, saved.voters, saved);
          setLastCloudSyncAt(Date.now());
          setSyncStatus('synced');
          setSyncError(null);
        } catch (err) {
          handleCloudSyncFailure(err);
        } finally {
          syncInFlightRef.current = false;
        }
      })();
    }

    notify(
      'success',
      'Reset Data Berhasil',
      'Perolehan suara dan status memilih DPT telah dikosongkan.'
    );
  };

  const applyCloudRestore = useCallback(
    (nextDb: DatabaseState, logByAdmin: AdminUser | null = null) => {
      const targetLogs = logByAdmin
        ? addAuditLog(
            nextDb.auditLogs,
            logByAdmin.fullName,
            logByAdmin.role,
            'RESTORE_FROM_FIRESTORE',
            `Memuat ${nextDb.voters.length} DPT dan ${nextDb.candidates.length} Paslon tersinkron dari Firebase Firestore.`
          )
        : nextDb.auditLogs;
      const normalized = saveDatabase({ ...nextDb, auditLogs: targetLogs }, !logByAdmin);
      lastPulledTsRef.current = normalized.lastUpdated;
      lastSyncedTsRef.current = normalized.lastUpdated;
      setDb(normalized);
      void apiRestoreDatabase(normalized);
    },
    []
  );

  const handleRestoreFromCloud = (nextDb: DatabaseState) => {
    if (!activeAdmin) return;
    applyCloudRestore(nextDb, activeAdmin);
  };

  useEffect(() => {
    if (!showIntro) return;
    void prefetchMaleVoice(buildWelcomeVoiceText(db.settings.schoolName));
  }, [showIntro, db.settings.schoolName]);

  const handleSplashComplete = useCallback(() => {
    setShowIntro(false);
    const welcomeText = buildWelcomeVoiceText(dbRef.current.settings.schoolName);
    void speakMaleVoice(welcomeText, {
      interrupt: true,
      allowDeferredOnGesture: true,
    });
  }, []);

  const startupStep =
    !showIntro && authReady
      ? resolveStartupSyncStep({
          hasFirebaseConnection: Boolean(user),
          gasWebAppUrl: gasConfigState.webAppUrl,
          firebaseVerifiedInWizard,
          dismissedForSession: startupDismissed,
        })
      : null;

  const handleStartupConfirmFirebase = async () => {
    const res = await signInWithGoogle(DEFAULT_SYNC_EMAIL);
    setAutoSyncEnabled(true);
    setFirebaseVerifiedInWizard(true);
    setStartupDismissed(false);
    try {
      await clearQuotaLockAndEnableNetwork();
    } catch {
      // Ignore offline/network re-enable error during startup transition
    }
    notify(
      'success',
      'Google Sheets & Firebase Terhubung',
      `Akun ${res.user.displayName || 'pengelola'} terverifikasi. Lanjutkan konfirmasi Google Apps Script.`
    );
  };

  const handleStartupConfirmGas = async (url: string, skipPing = false) => {
    const cleanUrl = url.trim();
    let pingSchool = dbRef.current.settings.schoolName;
    if (!skipPing) {
      const info = await gasPing(cleanUrl);
      if (info.schoolName) {
        pingSchool = info.schoolName;
      }
    }
    const nextGasConfig: GasConfig = {
      webAppUrl: cleanUrl,
      autoSync: true,
      lastSyncedAt: skipPing ? null : Date.now(),
    };
    saveGasConfig(nextGasConfig);
    setGasConfigState(nextGasConfig);
    window.dispatchEvent(new CustomEvent('osis-gas-config-change', { detail: nextGasConfig }));
    notify(
      'success',
      'Backend Apps Script Terhubung',
      skipPing
        ? 'URL Web App Google Apps Script berhasil disimpan dan sinkronisasi otomatis diaktifkan.'
        : `Spreadsheet "${pingSchool}" terhubung ke Google Apps Script.`
    );
  };

  const handleStartupDismiss = () => {
    setStartupDismissed(true);
  };

  return (
    <>
      <GasAutoSyncController db={db} />
      {showIntro && (
        <SplashIntro
          schoolName={db.settings.schoolName}
          logoUrl={db.settings.logoUrl}
          onComplete={handleSplashComplete}
        />
      )}

      <StartupSyncModal
        step={startupStep}
        firebaseVerified={Boolean(user) || firebaseVerifiedInWizard}
        onConfirmFirebase={handleStartupConfirmFirebase}
        onConfirmGas={handleStartupConfirmGas}
        onDismiss={handleStartupDismiss}
      />

      {view === 'MONITOR' && (
        <LiveMonitor
          db={db}
          onToggleSecretMode={handleToggleSecretMode}
          onBack={handleBackFromMonitor}
        />
      )}

      {view === 'VOTER' && activeVoter && (
        <VoterPortal
          voter={activeVoter}
          candidates={db.candidates}
          settings={db.settings}
          onCastVote={handleCastVote}
          onLogout={handleVoterLogout}
        />
      )}

      {view === 'ADMIN' && activeAdmin && (
        <AdminPanel
          db={db}
          currentAdmin={activeAdmin}
          onUpdateVoters={handleUpdateVoters}
          onImportCsvVoters={handleImportCsvVoters}
          onEditVoter={handleEditVoter}
          onUpdateCandidates={handleUpdateCandidates}
          onUpdateAdmins={handleUpdateAdmins}
          onUpdateSettings={handleUpdateSettings}
          onRestoreFromCloud={handleRestoreFromCloud}
          onResetElection={handleResetElection}
          onOpenLiveMonitor={handleOpenLiveMonitor}
          onRefreshApp={handleAppRefresh}
          isRefreshingApp={isRefreshingApp}
          onLogout={handleAdminLogout}
          onNotify={notify}
        />
      )}

      {view === 'ADMIN_LOGIN' && (
        <AdminLoginPage
          db={db}
          onAdminLogin={handleAdminLogin}
          onDbUpdated={commitDb}
          onBackToVoterPortal={() => setView('LOGIN')}
          onOpenLiveMonitor={handleOpenLiveMonitor}
          onNotify={notify}
        />
      )}

      {(view === 'LOGIN' ||
        (view === 'VOTER' && !activeVoter) ||
        (view === 'ADMIN' && !activeAdmin)) && (
        <LoginPortal
          db={db}
          cloudSummary={cloudSummary}
          pendingOfflineVotes={pendingOfflineVotes}
          onCloudLookupVoter={user && !quotaExceeded ? handleCloudLookupVoter : undefined}
          onVoterLogin={handleVoterLogin}
          onOpenAdminLogin={() => setView('ADMIN_LOGIN')}
          onOpenLiveMonitor={handleOpenLiveMonitor}
          onNotify={notify}
        />
      )}

      <ScrollToTopButton resetKey={`${view}:${activeVoterId || ''}:${activeAdminId || ''}`} />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <LoadingOverlay
        visible={isRefreshingApp || Boolean(logoutLoadingLabel)}
        variant={isRefreshingApp ? 'fullscreen' : 'card'}
        label={isRefreshingApp ? 'Memuat Ulang Halaman Aplikasi...' : logoutLoadingLabel || ''}
        schoolName={db.settings.schoolName}
        logoUrl={db.settings.logoUrl}
        durationMs={3000}
      />
    </>
  );
}

function GasAutoSyncController({ db }: { db: DatabaseState }) {
  const [gasConfig, setGasConfig] = useState<GasConfig>(() => loadGasConfig());
  const dbRef = useRef(db);
  dbRef.current = db;
  const lastPushedRef = useRef<number>(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<GasConfig>;
      if (custom.detail) {
        setGasConfig(custom.detail);
      } else {
        setGasConfig(loadGasConfig());
      }
    };
    window.addEventListener('osis-gas-config-change', handler);
    return () => window.removeEventListener('osis-gas-config-change', handler);
  }, []);

  useEffect(() => {
    if (!gasConfig.autoSync || !isValidGasWebAppUrl(gasConfig.webAppUrl)) return;
    if (db.lastUpdated === SEED_TIMESTAMP || db.lastUpdated === lastPushedRef.current) return;

    const timer = window.setTimeout(async () => {
      try {
        await gasPushState(gasConfig.webAppUrl, dbRef.current);
        lastPushedRef.current = dbRef.current.lastUpdated;
        saveGasConfig({ ...gasConfig, lastSyncedAt: Date.now() });
      } catch (err) {
        console.error('GAS auto-sync error:', err);
      }
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [db.lastUpdated, gasConfig]);

  return null;
}
