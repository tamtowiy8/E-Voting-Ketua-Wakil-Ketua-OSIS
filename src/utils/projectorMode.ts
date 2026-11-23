import type { AdminPanelTab } from './electionLogic';

export const PROJECTOR_MODE_STORAGE_KEY = 'evoting_projector_mode_v1';
export const ADMIN_ACTIVE_TAB_STORAGE_KEY = 'evoting_admin_active_tab_v1';
export const PUBLIC_MONITOR_VIEW_STORAGE_KEY = 'evoting_public_monitor_view_v1';
export const PROJECTOR_MODE_EVENT = 'osis-projector-mode-change';

const VALID_ADMIN_TABS: readonly AdminPanelTab[] = [
  'overview',
  'dpt',
  'candidates',
  'staff',
  'settings',
  'sheets',
  'gas',
  'audit',
];

export interface FullscreenTransitionInput {
  persistedProjector: boolean;
  sawNativeFullscreen: boolean;
  hasNativeFullscreen: boolean;
}

export interface FullscreenTransitionResult {
  nextProjector: boolean;
  nextSawNativeFullscreen: boolean;
}

/**
 * Resolves initial Proyektor state on load/refresh.
 * Preserves Proyektor mode across page reloads even when browser blocks
 * un-gestured native `requestFullscreen()` on initial mount.
 */
export function resolveInitialProjectorMode(
  persistedFlag: boolean,
  hasNativeFullscreen: boolean
): boolean {
  return Boolean(persistedFlag || hasNativeFullscreen);
}

/**
 * Handles browser `fullscreenchange` events without accidentally clearing
 * Proyektor mode right after a page refresh when native fullscreen was never active.
 */
export function resolveFullscreenChangeTransition(
  input: FullscreenTransitionInput
): FullscreenTransitionResult {
  if (input.hasNativeFullscreen) {
    return {
      nextProjector: true,
      nextSawNativeFullscreen: true,
    };
  }
  // User genuinely pressed Escape / browser exited native fullscreen after entering it
  if (input.sawNativeFullscreen) {
    return {
      nextProjector: false,
      nextSawNativeFullscreen: false,
    };
  }
  // Initial load or sandbox where native fullscreen wasn't entered — preserve persisted flag
  return {
    nextProjector: input.persistedProjector,
    nextSawNativeFullscreen: false,
  };
}

export function shouldSkipSplashForProjector(search: string, isProjectorActive: boolean): boolean {
  return search.includes('autostart=1') || Boolean(isProjectorActive);
}

export function isValidAdminPanelTab(value: string | null | undefined): value is AdminPanelTab {
  return Boolean(value && VALID_ADMIN_TABS.includes(value as AdminPanelTab));
}

export function loadProjectorMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PROJECTOR_MODE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveProjectorMode(active: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (active) {
      window.localStorage.setItem(PROJECTOR_MODE_STORAGE_KEY, 'true');
    } else {
      window.localStorage.removeItem(PROJECTOR_MODE_STORAGE_KEY);
    }
    window.dispatchEvent(new CustomEvent<boolean>(PROJECTOR_MODE_EVENT, { detail: active }));
  } catch {
    // Ignore storage restriction
  }
}

export function loadPersistedAdminTab(): AdminPanelTab | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ADMIN_ACTIVE_TAB_STORAGE_KEY);
    return isValidAdminPanelTab(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function savePersistedAdminTab(tab: AdminPanelTab): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ADMIN_ACTIVE_TAB_STORAGE_KEY, tab);
  } catch {
    // Ignore storage restriction
  }
}

export function clearPersistedAdminTab(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(ADMIN_ACTIVE_TAB_STORAGE_KEY);
  } catch {
    // Ignore storage restriction
  }
}

export function loadPersistedPublicMonitor(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PUBLIC_MONITOR_VIEW_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function savePersistedPublicMonitor(active: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (active) {
      window.localStorage.setItem(PUBLIC_MONITOR_VIEW_STORAGE_KEY, 'true');
    } else {
      window.localStorage.removeItem(PUBLIC_MONITOR_VIEW_STORAGE_KEY);
    }
  } catch {
    // Ignore storage restriction
  }
}
