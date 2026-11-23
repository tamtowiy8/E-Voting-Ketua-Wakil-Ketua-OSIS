import { isValidGasWebAppUrl } from './gasGenerator';

export const DEFAULT_SYNC_EMAIL = 'tamtowiy8@gmail.com';
export const MASKED_SYNC_EMAIL_BAR = '***************';
export const DEFAULT_GAS_WEB_APP_URL =
  'https://script.google.com/macros/s/AKfycbwmz9Trc4Dd61rWMkAQFPovPt7GP1CFR0dj03ICccWqr3mNOoU5IPm2OnpyJZMw5sl6/exec';

export const STARTUP_SYNC_DISMISSED_KEY = 'osis_evoting_startup_sync_dismissed_v1';

export type StartupSyncStep = 'FIREBASE' | 'GAS' | null;

export interface StartupSyncEvaluationInput {
  hasFirebaseConnection: boolean;
  gasWebAppUrl: string;
  firebaseVerifiedInWizard: boolean;
  dismissedForSession: boolean;
}

export function resolveStartupSyncStep(input: StartupSyncEvaluationInput): StartupSyncStep {
  if (input.dismissedForSession) {
    return null;
  }

  const hasGasConnection = isValidGasWebAppUrl(input.gasWebAppUrl);
  const firebaseReady = input.hasFirebaseConnection || input.firebaseVerifiedInWizard;

  if (firebaseReady && hasGasConnection) {
    return null;
  }

  if (!firebaseReady) {
    return 'FIREBASE';
  }

  return 'GAS';
}

export function loadStartupSyncDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(STARTUP_SYNC_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveStartupSyncDismissed(dismissed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (dismissed) {
      window.sessionStorage.setItem(STARTUP_SYNC_DISMISSED_KEY, 'true');
    } else {
      window.sessionStorage.removeItem(STARTUP_SYNC_DISMISSED_KEY);
    }
  } catch {
    // Ignore storage error
  }
}
