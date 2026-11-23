import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  ImagePlus,
  Loader2,
  RefreshCw,
  ScanLine,
} from 'lucide-react';

import { formatCameraPermissionError } from '../utils/electionLogic';
import {
  clearPersistentCameraSession,
  getLivePersistentStream,
  getPersistentCameraPrefs,
  loadDesiredCameraActive,
  releaseVoterStreamForOtherScanner,
  setPersistentCameraStream,
  shouldResumePersistentCamera,
  type CameraPersistKey,
} from '../utils/qrScannerSession';

interface BarcodeDetectorLike {
  detect: (source: HTMLCanvasElement | HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

interface CameraDeviceOption {
  deviceId: string;
  label: string;
}

interface VoterQrScannerProps {
  disabled?: boolean;
  persistKey?: CameraPersistKey;
  targetLabel?: string;
  uploadButtonLabel?: string;
  onScanPayload: (rawPayload: string) => void;
  onCameraError?: (message: string) => void;
}

export function VoterQrScanner({
  disabled = false,
  persistKey = 'voter',
  targetLabel = 'Kartu Pemilih',
  uploadButtonLabel = 'Unggah Gambar QR Kartu Pemilih',
  onScanPayload,
  onCameraError,
}: VoterQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const scanDetectedTimerRef = useRef<number | null>(null);
  const barcodeDetectorRef = useRef<BarcodeDetectorLike | null>(null);
  const lastDecodedRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });
  const frameCountRef = useRef(0);
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const onScanRef = useRef(onScanPayload);
  onScanRef.current = onScanPayload;

  const [cameraState, setCameraState] = useState<'idle' | 'starting' | 'active' | 'error'>('idle');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>(() =>
    persistKey === 'voter' ? getPersistentCameraPrefs('voter').facingMode : 'environment'
  );
  const [cameras, setCameras] = useState<CameraDeviceOption[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string>(() =>
    persistKey === 'voter' ? getPersistentCameraPrefs('voter').deviceId : ''
  );
  const [scanDetectedFlash, setScanDetectedFlash] = useState(false);
  const [isDecodingImage, setIsDecodingImage] = useState(false);

  const stopCameraTracksOnly = useCallback((stopHardwareTracks = true) => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (stopHardwareTracks && streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const stopCamera = useCallback(() => {
    requestSeqRef.current += 1;
    clearPersistentCameraSession(persistKey, true, true);
    stopCameraTracksOnly(true);
    setCameraState((prev) => (prev === 'error' ? prev : 'idle'));
  }, [persistKey, stopCameraTracksOnly]);

  const emitScanIfFresh = useCallback((rawValue: string) => {
    const cleaned = rawValue.trim();
    if (!cleaned) return false;
    const now = Date.now();
    if (
      lastDecodedRef.current.value === cleaned &&
      now - lastDecodedRef.current.at < 2400
    ) {
      return false;
    }
    lastDecodedRef.current = { value: cleaned, at: now };
    setScanDetectedFlash(true);
    if (scanDetectedTimerRef.current !== null) {
      window.clearTimeout(scanDetectedTimerRef.current);
    }
    scanDetectedTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setScanDetectedFlash(false);
    }, 1200);
    onScanRef.current(cleaned);
    return true;
  }, []);

  const attachStreamAndStartScanLoop = useCallback(
    (stream: MediaStream, mySeq: number, preferredFacing: 'environment' | 'user') => {
      if (!mountedRef.current || mySeq !== requestSeqRef.current || !videoRef.current) {
        if (persistKey !== 'voter') {
          stream.getTracks().forEach((track) => track.stop());
        }
        return;
      }

      streamRef.current = stream;
      const activeTrack = stream.getVideoTracks()[0];
      const trackSettings = activeTrack?.getSettings?.();
      const resolvedDeviceId = trackSettings?.deviceId || '';
      if (resolvedDeviceId) {
        setActiveDeviceId(resolvedDeviceId);
      }
      if (persistKey === 'voter') {
        setPersistentCameraStream('voter', stream, preferredFacing, resolvedDeviceId);
      }

      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
        navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => {
            if (!mountedRef.current || mySeq !== requestSeqRef.current) return;
            const videoInputs = devices
              .filter((d) => d.kind === 'videoinput' && d.deviceId)
              .map((d, idx) => ({
                deviceId: d.deviceId,
                label: d.label || `Kamera ${idx + 1}`,
              }));
            setCameras(videoInputs);
          })
          .catch(() => {
            // Ignore enumerateDevices failure
          });
      }

      const video = videoRef.current;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', 'true');
      video.srcObject = stream;

      void video.play().catch((playErr) => {
        const playName =
          playErr instanceof DOMException
            ? playErr.name
            : playErr && typeof playErr === 'object' && 'name' in playErr
              ? String((playErr as { name?: unknown }).name)
              : '';
        if (playName && playName !== 'AbortError' && playName !== 'NotAllowedError') {
          console.warn('Video autoplay warning:', playErr);
        }
      });

      if (!mountedRef.current || mySeq !== requestSeqRef.current) {
        if (persistKey !== 'voter') {
          stream.getTracks().forEach((track) => track.stop());
        }
        streamRef.current = null;
        return;
      }

      setCameraState('active');

      if (!barcodeDetectorRef.current && typeof window !== 'undefined' && window.BarcodeDetector) {
        try {
          barcodeDetectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] });
        } catch {
          barcodeDetectorRef.current = null;
        }
      }

      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }

      let scanningFrame = false;
      timerRef.current = window.setInterval(async () => {
        if (scanningFrame) return;
        const v = videoRef.current;
        if (!v || v.readyState < 2 || v.videoWidth === 0 || v.videoHeight === 0) {
          return;
        }
        scanningFrame = true;
        try {
          frameCountRef.current += 1;
          const useCenterCrop =
            frameCountRef.current % 2 === 1 && v.videoWidth > 420 && v.videoHeight > 420;

          let targetCanvas: HTMLCanvasElement;
          let targetWidth: number;
          let targetHeight: number;
          let targetCtx: CanvasRenderingContext2D | null;

          if (useCenterCrop) {
            if (!cropCanvasRef.current) {
              cropCanvasRef.current = document.createElement('canvas');
            }
            const side = Math.round(Math.min(v.videoWidth, v.videoHeight) * 0.65);
            const sx = Math.max(0, Math.round((v.videoWidth - side) / 2));
            const sy = Math.max(0, Math.round((v.videoHeight - side) / 2));
            targetWidth = Math.min(540, side);
            targetHeight = targetWidth;
            targetCanvas = cropCanvasRef.current;
            if (targetCanvas.width !== targetWidth || targetCanvas.height !== targetHeight) {
              targetCanvas.width = targetWidth;
              targetCanvas.height = targetHeight;
            }
            targetCtx = targetCanvas.getContext('2d', { willReadFrequently: true });
            if (!targetCtx) return;
            targetCtx.drawImage(v, sx, sy, side, side, 0, 0, targetWidth, targetHeight);
          } else {
            if (!canvasRef.current) {
              canvasRef.current = document.createElement('canvas');
            }
            targetCanvas = canvasRef.current;
            const maxDim = 720;
            const scale = Math.min(1, maxDim / Math.max(v.videoWidth, v.videoHeight));
            targetWidth = Math.max(1, Math.round(v.videoWidth * scale));
            targetHeight = Math.max(1, Math.round(v.videoHeight * scale));
            if (targetCanvas.width !== targetWidth || targetCanvas.height !== targetHeight) {
              targetCanvas.width = targetWidth;
              targetCanvas.height = targetHeight;
            }
            targetCtx = targetCanvas.getContext('2d', { willReadFrequently: true });
            if (!targetCtx) return;
            targetCtx.drawImage(v, 0, 0, targetWidth, targetHeight);
          }

          if (barcodeDetectorRef.current) {
            try {
              const detected = await barcodeDetectorRef.current.detect(targetCanvas);
              const firstRaw = detected.find(
                (d) => typeof d.rawValue === 'string' && d.rawValue.trim()
              )?.rawValue;
              if (firstRaw) {
                emitScanIfFresh(firstRaw);
                return;
              }
            } catch {
              // Fall back cleanly to jsQR
            }
          }

          const imageData = targetCtx.getImageData(0, 0, targetWidth, targetHeight);
          const code = jsQR(imageData.data, targetWidth, targetHeight, {
            inversionAttempts: frameCountRef.current % 4 === 0 ? 'attemptBoth' : 'dontInvert',
          });
          if (code?.data) {
            emitScanIfFresh(code.data);
          }
        } finally {
          scanningFrame = false;
        }
      }, 110);
    },
    [emitScanIfFresh, persistKey]
  );

  const startCamera = useCallback(
    (preferredFacing: 'environment' | 'user' = facingMode, explicitDeviceId?: string) => {
      if (disabled) return;
      const mySeq = ++requestSeqRef.current;
      if (persistKey === 'none') {
        releaseVoterStreamForOtherScanner();
      } else {
        clearPersistentCameraSession(persistKey, true, false);
      }
      stopCameraTracksOnly(true);
      setCameraError(null);

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        const isInsecureContext =
          typeof window !== 'undefined' &&
          window.isSecureContext === false &&
          window.location.hostname !== 'localhost' &&
          window.location.hostname !== '127.0.0.1';
        const msg = isInsecureContext
          ? 'Akses kamera memerlukan koneksi aman (HTTPS). Buka aplikasi melalui HTTPS atau unggah gambar QR di bawah.'
          : 'Kamera perangkat tidak tersedia pada browser ini. Gunakan tombol Unggah Gambar QR di bawah.';
        setCameraError(msg);
        setCameraState('error');
        onCameraError?.(msg);
        return;
      }

      setCameraState('starting');

      // Call getUserMedia synchronously inside the user's click event stack
      // so Laptop/HP browsers immediately prompt the native camera permission dialog.
      const primaryVideoConstraint: MediaTrackConstraints = explicitDeviceId
        ? {
            deviceId: { exact: explicitDeviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          }
        : {
            facingMode: { ideal: preferredFacing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          };

      const primaryPromise = navigator.mediaDevices.getUserMedia({
        video: primaryVideoConstraint,
        audio: false,
      });

      void (async () => {
        try {
          let stream: MediaStream;
          try {
            stream = await primaryPromise;
          } catch (primaryErr) {
            const errName =
              primaryErr instanceof DOMException
                ? primaryErr.name
                : primaryErr && typeof primaryErr === 'object' && 'name' in primaryErr
                  ? String((primaryErr as { name?: unknown }).name)
                  : '';
            if (
              errName === 'NotAllowedError' ||
              errName === 'PermissionDeniedError' ||
              errName === 'SecurityError'
            ) {
              throw primaryErr;
            }
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          }

          attachStreamAndStartScanLoop(stream, mySeq, preferredFacing);
        } catch (err) {
          if (!mountedRef.current || mySeq !== requestSeqRef.current) return;
          clearPersistentCameraSession(persistKey, true, true);
          const errName =
            err instanceof DOMException
              ? err.name
              : err && typeof err === 'object' && 'name' in err
                ? String((err as { name?: unknown }).name)
                : '';

          let permissionPreviouslyBlocked = false;
          if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
            try {
              const status = await navigator.permissions.query({
                name: 'camera' as PermissionName,
              });
              permissionPreviouslyBlocked = status.state === 'denied';
            } catch {
              // Permissions API for camera not supported
            }
          }

          if (!mountedRef.current || mySeq !== requestSeqRef.current) return;
          const msg = formatCameraPermissionError(errName, permissionPreviouslyBlocked);
          setCameraError(msg);
          setCameraState('error');
          onCameraError?.(msg);
        }
      })();
    },
    [
      attachStreamAndStartScanLoop,
      disabled,
      facingMode,
      onCameraError,
      persistKey,
      stopCameraTracksOnly,
    ]
  );

  const startCameraRef = useRef(startCamera);
  startCameraRef.current = startCamera;

  // Keep camera alive across voter logins or auto-resume if permission was already granted
  useEffect(() => {
    mountedRef.current = true;
    const mySeq = ++requestSeqRef.current;

    if (persistKey === 'voter' && loadDesiredCameraActive('voter')) {
      const liveStream = getLivePersistentStream('voter');
      const prefs = getPersistentCameraPrefs('voter');
      if (liveStream) {
        attachStreamAndStartScanLoop(liveStream, mySeq, prefs.facingMode);
      } else if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
        void navigator.permissions
          .query({ name: 'camera' as PermissionName })
          .then((status) => {
            if (!mountedRef.current || mySeq !== requestSeqRef.current) return;
            if (shouldResumePersistentCamera(loadDesiredCameraActive('voter'), status.state)) {
              startCameraRef.current(prefs.facingMode, prefs.deviceId || undefined);
            }
          })
          .catch(() => {
            // Ignore Permissions API fallback
          });
      }
    }

    return () => {
      mountedRef.current = false;
      requestSeqRef.current += 1;
      if (scanDetectedTimerRef.current !== null) {
        window.clearTimeout(scanDetectedTimerRef.current);
      }
      const keepAlive = persistKey === 'voter' && loadDesiredCameraActive('voter');
      stopCameraTracksOnly(!keepAlive);
    };
  }, [attachStreamAndStartScanLoop, persistKey, stopCameraTracksOnly]);

  const handleToggleCamera = () => {
    if (cameraState === 'active' || cameraState === 'starting') {
      stopCamera();
    } else {
      startCamera(facingMode);
    }
  };

  const handleFlipCamera = () => {
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacing);

    if (cameras.length > 1) {
      const currentIdx = cameras.findIndex((c) => c.deviceId === activeDeviceId);
      const nextCam = cameras[(currentIdx + 1) % cameras.length];
      if (cameraState === 'active' || cameraState === 'error') {
        startCamera(nextFacing, nextCam.deviceId);
        return;
      }
    }

    if (cameraState === 'active') {
      startCamera(nextFacing);
    }
  };

  const handleQrImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsDecodingImage(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Gagal membaca file gambar QR.'));
        reader.onload = () => {
          if (typeof reader.result === 'string') resolve(reader.result);
          else reject(new Error('Format gambar tidak valid.'));
        };
        reader.readAsDataURL(file);
      });

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onerror = () => reject(new Error('Gambar tidak dapat dimuat.'));
        image.onload = () => resolve(image);
        image.src = dataUrl;
      });

      const maxDim = 960;
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const width = Math.max(1, Math.round((img.naturalWidth || 300) * scale));
      const height = Math.max(1, Math.round((img.naturalHeight || 300) * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        throw new Error('Gagal memproses kanvas gambar.');
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const imageData = ctx.getImageData(0, 0, width, height);
      const decoded = jsQR(imageData.data, width, height, { inversionAttempts: 'attemptBoth' });
      if (!decoded?.data) {
        const msg =
          'QR Code tidak terdeteksi pada gambar tersebut. Pastikan gambar Kartu Pemilih terlihat jelas.';
        setCameraError(msg);
        onCameraError?.(msg);
        return;
      }

      setCameraError(null);
      lastDecodedRef.current = { value: '', at: 0 };
      emitScanIfFresh(decoded.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal membaca QR Code dari gambar.';
      setCameraError(msg);
      onCameraError?.(msg);
    } finally {
      setIsDecodingImage(false);
    }
  };

  return (
    <div className="space-y-3.5" data-testid="voter-qr-scanner">
      {/* Camera Viewfinder */}
      <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          aria-label="Kamera pemindai QR Code Kartu Pemilih"
          className={`w-full h-full object-cover ${cameraState === 'active' ? 'opacity-100' : 'opacity-0'}`}
        />

        {/* Corner Reticle Overlay when active */}
        {cameraState === 'active' && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <div className="w-44 h-44 sm:w-48 sm:h-48 relative">
              <span
                className={`absolute top-0 left-0 w-7 h-7 border-t-4 border-l-4 rounded-tl-lg transition-colors ${
                  scanDetectedFlash ? 'border-emerald-400' : 'border-amber-400'
                }`}
              />
              <span
                className={`absolute top-0 right-0 w-7 h-7 border-t-4 border-r-4 rounded-tr-lg transition-colors ${
                  scanDetectedFlash ? 'border-emerald-400' : 'border-amber-400'
                }`}
              />
              <span
                className={`absolute bottom-0 left-0 w-7 h-7 border-b-4 border-l-4 rounded-bl-lg transition-colors ${
                  scanDetectedFlash ? 'border-emerald-400' : 'border-amber-400'
                }`}
              />
              <span
                className={`absolute bottom-0 right-0 w-7 h-7 border-b-4 border-r-4 rounded-br-lg transition-colors ${
                  scanDetectedFlash ? 'border-emerald-400' : 'border-amber-400'
                }`}
              />
              <div
                className={`absolute inset-x-3 top-1/2 -translate-y-1/2 h-0.5 ${
                  scanDetectedFlash ? 'bg-emerald-400' : 'bg-amber-400/80 animate-pulse'
                }`}
              />
            </div>

            {scanDetectedFlash && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-emerald-600/95 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm">
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>QR Terbaca, Memverifikasi...</span>
              </div>
            )}
          </div>
        )}

        {/* Inactive / Starting / Error Overlay */}
        {cameraState !== 'active' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center text-white bg-slate-900/95"
            aria-live="polite"
          >
            {cameraState === 'starting' ? (
              <>
                <Loader2 className="w-8 h-8 animate-spin text-amber-400 mb-2.5" aria-hidden="true" />
                <p className="text-sm font-bold">Meminta Izin Kamera...</p>
                <p className="text-xs text-slate-300 mt-1 max-w-xs leading-relaxed">
                  Tekan <strong>Izinkan / Allow</strong> pada notifikasi kamera Laptop atau HP Anda untuk memindai QR Code.
                </p>
              </>
            ) : cameraState === 'error' ? (
              <>
                <CameraOff className="w-8 h-8 text-amber-400 mb-2.5" aria-hidden="true" />
                <p className="text-sm font-bold">Kamera Belum Diizinkan / Tidak Aktif</p>
                <p className="text-xs text-slate-300 mt-1 max-w-xs leading-relaxed">
                  {cameraError || 'Kamera tidak tersedia. Coba aktifkan ulang atau unggah gambar QR.'}
                </p>
              </>
            ) : (
              <>
                <ScanLine className="w-8 h-8 text-amber-400 mb-2.5" aria-hidden="true" />
                <p className="text-sm font-bold">Pemindai QR Siap</p>
                <p className="text-xs text-slate-300 mt-1 max-w-xs leading-relaxed">
                  Tekan tombol <strong>Aktifkan Kamera</strong> lalu setujui izin kamera perangkat untuk memindai {targetLabel}.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Instructions */}
      <p className="text-xs text-slate-600 text-center leading-relaxed">
        Arahkan QR Code pada <strong>{targetLabel}</strong> ke dalam kotak kamera perangkat.
      </p>

      {/* Camera & Image Fallback Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          type="button"
          data-testid="activate-camera-btn"
          disabled={disabled || cameraState === 'starting'}
          onClick={handleToggleCamera}
          className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] disabled:opacity-60 text-white text-xs font-bold transition-colors whitespace-nowrap cursor-pointer"
        >
          {cameraState === 'active' ? (
            <>
              <CameraOff className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Hentikan Kamera</span>
            </>
          ) : cameraState === 'starting' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
              <span>Menunggu Izin...</span>
            </>
          ) : (
            <>
              <Camera className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Aktifkan Kamera</span>
            </>
          )}
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={handleFlipCamera}
          className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-800 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
        >
          <RefreshCw className="w-4 h-4 text-[var(--app-secondary)] shrink-0" aria-hidden="true" />
          <span>
            {cameras.length > 1
              ? `Ganti Kamera (${cameras.length})`
              : facingMode === 'environment'
                ? 'Kamera Belakang'
                : 'Kamera Depan'}
          </span>
        </button>
      </div>

      <div className="pt-1">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleQrImageUpload}
          className="hidden"
          aria-label={uploadButtonLabel}
        />
        <button
          type="button"
          disabled={disabled || isDecodingImage}
          onClick={() => fileInputRef.current?.click()}
          className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-60 text-slate-700 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
        >
          {isDecodingImage ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
              <span>Membaca Gambar QR...</span>
            </>
          ) : (
            <>
              <ImagePlus className="w-4 h-4 text-[var(--app-secondary)] shrink-0" aria-hidden="true" />
              <span>{uploadButtonLabel}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
