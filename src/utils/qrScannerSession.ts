export type CameraPersistKey = 'voter' | 'none';

export const VOTER_CAMERA_ACTIVE_KEY = 'osis_voter_qr_camera_active_v1';

interface CameraSessionRecord {
  stream: MediaStream | null;
  desiredActive: boolean;
  facingMode: 'environment' | 'user';
  deviceId: string;
}

const voterSession: CameraSessionRecord = {
  stream: null,
  desiredActive: false,
  facingMode: 'environment',
  deviceId: '',
};

export function hasLiveVideoTrack(stream: MediaStream | null | undefined): stream is MediaStream {
  if (!stream) return false;
  return stream.getVideoTracks().some((track) => track.readyState === 'live');
}

export function shouldResumePersistentCamera(
  desiredActive: boolean,
  permissionState: PermissionState | 'unknown'
): boolean {
  return desiredActive && permissionState === 'granted';
}

export function loadDesiredCameraActive(persistKey: CameraPersistKey): boolean {
  if (persistKey !== 'voter') return false;
  if (voterSession.desiredActive) return true;
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(VOTER_CAMERA_ACTIVE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveDesiredCameraActive(persistKey: CameraPersistKey, active: boolean): void {
  if (persistKey !== 'voter') return;
  voterSession.desiredActive = active;
  if (typeof window === 'undefined') return;
  try {
    if (active) {
      window.sessionStorage.setItem(VOTER_CAMERA_ACTIVE_KEY, '1');
    } else {
      window.sessionStorage.removeItem(VOTER_CAMERA_ACTIVE_KEY);
    }
  } catch {
    // Ignore storage error
  }
}

export function getLivePersistentStream(persistKey: CameraPersistKey): MediaStream | null {
  if (persistKey !== 'voter') return null;
  if (hasLiveVideoTrack(voterSession.stream)) {
    return voterSession.stream;
  }
  voterSession.stream = null;
  return null;
}

export function getPersistentCameraPrefs(persistKey: CameraPersistKey): {
  facingMode: 'environment' | 'user';
  deviceId: string;
} {
  if (persistKey !== 'voter') {
    return { facingMode: 'environment', deviceId: '' };
  }
  return {
    facingMode: voterSession.facingMode,
    deviceId: voterSession.deviceId,
  };
}

export function setPersistentCameraStream(
  persistKey: CameraPersistKey,
  stream: MediaStream,
  facingMode: 'environment' | 'user',
  deviceId: string
): void {
  if (persistKey !== 'voter') return;
  if (voterSession.stream && voterSession.stream !== stream) {
    voterSession.stream.getTracks().forEach((track) => track.stop());
  }
  voterSession.stream = stream;
  voterSession.facingMode = facingMode;
  voterSession.deviceId = deviceId;
  saveDesiredCameraActive('voter', true);
}

export function clearPersistentCameraSession(
  persistKey: CameraPersistKey,
  stopTracks = true,
  clearDesired = true
): void {
  if (persistKey !== 'voter') return;
  if (stopTracks && voterSession.stream) {
    voterSession.stream.getTracks().forEach((track) => track.stop());
  }
  voterSession.stream = null;
  if (clearDesired) {
    saveDesiredCameraActive('voter', false);
  }
}

export function releaseVoterStreamForOtherScanner(): void {
  if (voterSession.stream) {
    voterSession.stream.getTracks().forEach((track) => track.stop());
    voterSession.stream = null;
  }
}
