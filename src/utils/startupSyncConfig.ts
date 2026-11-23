import { isValidGasWebAppUrl } from './gasGenerator';

export const FIREBASE_PROJECT_ID = 'gen-lang-client-0680921408';
export const DEFAULT_SYNC_EMAIL = 'tamtowiy8@gmail.com';
export const MASKED_SYNC_EMAIL_BAR = '***************';
export const DEFAULT_GAS_WEB_APP_URL =
  'https://script.google.com/macros/s/AKfycbwmz9Trc4Dd61rWMkAQFPovPt7GP1CFR0dj03ICccWqr3mNOoU5IPm2OnpyJZMw5sl6/exec';

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
