import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { User } from 'firebase/auth';
import {
  googleSignIn,
  googleSignOut,
  initAuthListener,
  onFirestoreQuotaExhausted,
  resetFirestoreQuotaAndEnableNetwork,
  type CloudElectionSummary,
} from '../services/firebaseClient';
import {
  formatFirestoreErrorMessage,
  isQuotaCooldownActive,
  loadQuotaCooldownUntil,
} from '../utils/firebaseSyncLogic';

export type FirebaseSyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

const AUTO_SYNC_PREF_KEY = 'osis_evoting_firebase_autosync_v1';

function loadAutoSyncPref(): boolean {
  try {
    const raw = window.localStorage.getItem(AUTO_SYNC_PREF_KEY);
    return raw !== 'false';
  } catch {
    return true;
  }
}

interface FirebaseContextValue {
  user: User | null;
  accessToken: string | null;
  authReady: boolean;
  needsGoogleAuth: boolean;
  isSigningIn: boolean;
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (enabled: boolean) => void;
  syncStatus: FirebaseSyncStatus;
  setSyncStatus: (status: FirebaseSyncStatus) => void;
  lastCloudSyncAt: number | null;
  setLastCloudSyncAt: (ts: number | null) => void;
  syncError: string | null;
  setSyncError: (err: string | null) => void;
  quotaExceeded: boolean;
  setQuotaExceeded: (exceeded: boolean) => void;
  cloudSummary: CloudElectionSummary | null;
  setCloudSummary: Dispatch<SetStateAction<CloudElectionSummary | null>>;
  clearQuotaLockAndEnableNetwork: () => Promise<void>;
  signInWithGoogle: (loginHint?: string) => Promise<{ user: User; accessToken: string }>;
  signOutGoogle: () => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabledState] = useState<boolean>(() => loadAutoSyncPref());
  const initialCooldownActive = isQuotaCooldownActive(loadQuotaCooldownUntil());
  const [syncStatus, setSyncStatus] = useState<FirebaseSyncStatus>(() =>
    initialCooldownActive ? 'error' : 'idle'
  );
  const [lastCloudSyncAt, setLastCloudSyncAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(() =>
    initialCooldownActive ? formatFirestoreErrorMessage('resource-exhausted') : null
  );
  const [quotaExceeded, setQuotaExceeded] = useState<boolean>(initialCooldownActive);
  const [cloudSummary, setCloudSummary] = useState<CloudElectionSummary | null>(null);

  useEffect(() => {
    const unsubAuth = initAuthListener(({ user: nextUser, accessToken: nextToken }) => {
      setUser(nextUser);
      setAccessToken(nextToken);
      setAuthReady(true);
      if (!nextUser) {
        setCloudSummary(null);
        const cooldown = isQuotaCooldownActive(loadQuotaCooldownUntil());
        setQuotaExceeded(cooldown);
        setSyncStatus(cooldown ? 'error' : 'idle');
        setSyncError(cooldown ? formatFirestoreErrorMessage('resource-exhausted') : null);
      }
    });

    const unsubQuota = onFirestoreQuotaExhausted(() => {
      setQuotaExceeded(true);
      setSyncStatus('error');
      setSyncError(formatFirestoreErrorMessage('resource-exhausted'));
    });

    return () => {
      unsubAuth();
      unsubQuota();
    };
  }, []);

  const setAutoSyncEnabled = (enabled: boolean) => {
    setAutoSyncEnabledState(enabled);
    try {
      window.localStorage.setItem(AUTO_SYNC_PREF_KEY, String(enabled));
    } catch {
      // Ignore storage quota error
    }
  };

  const clearQuotaLockAndEnableNetwork = async () => {
    setQuotaExceeded(false);
    setSyncError(null);
    setSyncStatus('idle');
    await resetFirestoreQuotaAndEnableNetwork();
  };

  const signInWithGoogle = async (loginHint?: string) => {
    setIsSigningIn(true);
    try {
      const result = await googleSignIn(loginHint);
      setUser(result.user);
      setAccessToken(result.accessToken);
      return result;
    } finally {
      setIsSigningIn(false);
    }
  };

  const signOutGoogle = async () => {
    await googleSignOut();
    setUser(null);
    setAccessToken(null);
    setCloudSummary(null);
    const cooldown = isQuotaCooldownActive(loadQuotaCooldownUntil());
    setQuotaExceeded(cooldown);
    setSyncStatus(cooldown ? 'error' : 'idle');
    setLastCloudSyncAt(null);
    setSyncError(cooldown ? formatFirestoreErrorMessage('resource-exhausted') : null);
  };

  const needsGoogleAuth = !user || !accessToken;

  return (
    <FirebaseContext.Provider
      value={{
        user,
        accessToken,
        authReady,
        needsGoogleAuth,
        isSigningIn,
        autoSyncEnabled,
        setAutoSyncEnabled,
        syncStatus,
        setSyncStatus,
        lastCloudSyncAt,
        setLastCloudSyncAt,
        syncError,
        setSyncError,
        quotaExceeded,
        setQuotaExceeded,
        cloudSummary,
        setCloudSummary,
        clearQuotaLockAndEnableNetwork,
        signInWithGoogle,
        signOutGoogle,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebaseAuth(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebaseAuth must be used inside FirebaseProvider.');
  }
  return ctx;
}
