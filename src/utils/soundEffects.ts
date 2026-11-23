const MONITOR_SOUND_PREF_KEY = 'osis_evoting_monitor_sound_v1';

let sharedAudioCtx: AudioContext | null = null;

function getAudioContextCtor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  return win.AudioContext || win.webkitAudioContext || null;
}

function getOrCreateAudioContext(): AudioContext | null {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  if (!sharedAudioCtx) {
    try {
      sharedAudioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  return sharedAudioCtx;
}

export function loadMonitorSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(MONITOR_SOUND_PREF_KEY);
    return raw === 'false' ? false : true;
  } catch {
    return true;
  }
}

export function saveMonitorSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MONITOR_SOUND_PREF_KEY, String(enabled));
  } catch {
    // Ignore storage error
  }
}

export function unlockMonitorAudio(): void {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {
      // Ignore autoplay lock until user gesture
    });
  }
}

/**
 * Synthesizes a crisp dual-tone "uang masuk / coin cha-ching" chime
 * using Web Audio API whenever an incoming vote is recorded on Live Monitor.
 */
export function playIncomingVoteCoinSound(delayMs = 0): boolean {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return false;

  try {
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }

    const start = ctx.currentTime + Math.max(0, delayMs) / 1000;

    // Master envelope gain
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.32, start);
    masterGain.connect(ctx.destination);

    // Note 1: Bright coin strike (B5 - 987.77 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(987.77, start);
    gain1.gain.setValueAtTime(0.0001, start);
    gain1.gain.exponentialRampToValueAtTime(0.65, start + 0.012);
    gain1.gain.exponentialRampToValueAtTime(0.001, start + 0.14);
    osc1.connect(gain1);
    gain1.connect(masterGain);
    osc1.start(start);
    osc1.stop(start + 0.16);

    // Note 2: Ascending cash-in resonance (E6 - 1318.51 Hz)
    const note2Start = start + 0.075;
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1318.51, note2Start);
    gain2.gain.setValueAtTime(0.0001, note2Start);
    gain2.gain.exponentialRampToValueAtTime(0.85, note2Start + 0.015);
    gain2.gain.exponentialRampToValueAtTime(0.001, note2Start + 0.42);
    osc2.connect(gain2);
    gain2.connect(masterGain);
    osc2.start(note2Start);
    osc2.stop(note2Start + 0.45);

    // Harmonic shimmer overtone (E7 - 2637.02 Hz) for metallic coin sparkle
    const oscShimmer = ctx.createOscillator();
    const gainShimmer = ctx.createGain();
    oscShimmer.type = 'sine';
    oscShimmer.frequency.setValueAtTime(2637.02, note2Start);
    gainShimmer.gain.setValueAtTime(0.0001, note2Start);
    gainShimmer.gain.exponentialRampToValueAtTime(0.28, note2Start + 0.01);
    gainShimmer.gain.exponentialRampToValueAtTime(0.001, note2Start + 0.28);
    oscShimmer.connect(gainShimmer);
    gainShimmer.connect(masterGain);
    oscShimmer.start(note2Start);
    oscShimmer.stop(note2Start + 0.3);

    return true;
  } catch {
    return false;
  }
}
