import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PROJECTOR_MODE_EVENT,
  PROJECTOR_MODE_STORAGE_KEY,
  loadProjectorMode,
  resolveFullscreenChangeTransition,
  resolveInitialProjectorMode,
  saveProjectorMode,
} from './projectorMode';

function syncDocumentProjectorAttr(active: boolean) {
  if (typeof document === 'undefined') return;
  if (active) {
    document.documentElement.setAttribute('data-projector', 'true');
  } else {
    document.documentElement.removeAttribute('data-projector');
  }
}

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    const hasNative =
      typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false;
    const active = resolveInitialProjectorMode(loadProjectorMode(), hasNative);
    syncDocumentProjectorAttr(active);
    return active;
  });

  const isFullscreenRef = useRef(isFullscreen);
  isFullscreenRef.current = isFullscreen;
  const sawNativeFullscreenRef = useRef<boolean>(
    typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false
  );

  useEffect(() => {
    syncDocumentProjectorAttr(isFullscreen);
  }, [isFullscreen]);

  // Best-effort re-enter native fullscreen if Proyektor mode persisted and user activation is available
  useEffect(() => {
    if (!isFullscreen || typeof document === 'undefined' || document.fullscreenElement) {
      return;
    }
    const navWithActivation = navigator as Navigator & {
      userActivation?: { isActive: boolean };
    };
    if (navWithActivation.userActivation && !navWithActivation.userActivation.isActive) {
      return;
    }
    const req = document.documentElement.requestFullscreen?.();
    if (req && typeof req.then === 'function') {
      req
        .then(() => {
          sawNativeFullscreenRef.current = true;
        })
        .catch(() => {
          // Browsers block un-gestured requestFullscreen after reload; CSS/layout Proyektor mode remains active
        });
    }
  }, [isFullscreen]);

  useEffect(() => {
    const onFsChange = () => {
      const hasNative = Boolean(document.fullscreenElement);
      const next = resolveFullscreenChangeTransition({
        persistedProjector: loadProjectorMode(),
        sawNativeFullscreen: sawNativeFullscreenRef.current,
        hasNativeFullscreen: hasNative,
      });
      sawNativeFullscreenRef.current = next.nextSawNativeFullscreen;
      if (next.nextProjector !== loadProjectorMode()) {
        saveProjectorMode(next.nextProjector);
      }
      setIsFullscreen(next.nextProjector);
    };

    const onProjectorEvent = (e: Event) => {
      const custom = e as CustomEvent<boolean>;
      if (typeof custom.detail === 'boolean') {
        setIsFullscreen(custom.detail);
      } else {
        setIsFullscreen(loadProjectorMode());
      }
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === PROJECTOR_MODE_STORAGE_KEY) {
        setIsFullscreen(loadProjectorMode());
      }
    };

    document.addEventListener('fullscreenchange', onFsChange);
    window.addEventListener(PROJECTOR_MODE_EVENT, onProjectorEvent);
    window.addEventListener('storage', onStorage);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      window.removeEventListener(PROJECTOR_MODE_EVENT, onProjectorEvent);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const currentlyActive = isFullscreenRef.current || Boolean(document.fullscreenElement);
    if (!currentlyActive) {
      saveProjectorMode(true);
      setIsFullscreen(true);
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
          sawNativeFullscreenRef.current = true;
        }
      } catch {
        // Fallback gracefully inside restricted iframe sandboxes while retaining Proyektor mode
      }
    } else {
      sawNativeFullscreenRef.current = false;
      saveProjectorMode(false);
      setIsFullscreen(false);
      try {
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen();
        }
      } catch {
        // Ignore native exit failure
      }
    }
  }, []);

  return { isFullscreen, toggleFullscreen };
}
