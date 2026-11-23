export const VOTER_SAVED_VOICE_TEXT = 'Pilihanmu sudah tersimpan, terima kasih';

export interface SpeechVoiceLike {
  name: string;
  lang: string;
  default?: boolean;
}

export interface SpeakMaleVoiceOptions {
  interrupt?: boolean;
  allowDeferredOnGesture?: boolean;
}

export type SpeakMaleVoiceResult = 'audio' | 'speech' | 'deferred' | 'skipped';

const MALE_VOICE_KEYWORDS = [
  'ardian',
  'male',
  'laki',
  'pria',
  'man',
  'mas',
  'pak',
  'bapak',
  'david',
  'daniel',
  'mark',
  'george',
  'alex',
  'ravi',
  'rizky',
  'agus',
  'budi',
  'andika',
  'charon',
  'fenrir',
  'puck',
];

const FEMALE_VOICE_KEYWORDS = [
  'gadis',
  'damayanti',
  'female',
  'wanita',
  'perempuan',
  'woman',
  'zira',
  'samantha',
  'karen',
  'victoria',
  'kore',
  'zephyr',
  'siti',
  'putri',
  'dewi',
  'sari',
];

export function buildWelcomeVoiceText(schoolName: string): string {
  const cleanSchool = schoolName.trim() || 'SMAN 1 Kabun';
  return `Selamat Datang di Aplikasi Pemilihan Ketua & Wakil Ketua OSIS ${cleanSchool}. Gunakan hak suara Anda secara langsung, bebas, rahasia, jujur, dan adil.`;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export function isLikelyMaleVoiceName(name: string): boolean {
  const lower = normalizeText(name);
  if (!lower) return false;
  return MALE_VOICE_KEYWORDS.some((kw) => lower.includes(kw));
}

export function isLikelyFemaleVoiceName(name: string): boolean {
  const lower = normalizeText(name);
  if (!lower) return false;
  return FEMALE_VOICE_KEYWORDS.some((kw) => lower.includes(kw));
}

function isIndonesianLang(lang: string): boolean {
  const lower = normalizeText(lang).replace(/_/g, '-');
  return lower === 'id' || lower.startsWith('id-');
}

export function selectPreferredIndonesianMaleVoice<T extends SpeechVoiceLike>(
  voices: readonly T[]
): T | null {
  if (!Array.isArray(voices) || voices.length === 0) return null;

  const indonesianVoices = voices.filter((v) => isIndonesianLang(v.lang));
  if (indonesianVoices.length === 0) {
    return null;
  }

  let bestVoice: T = indonesianVoices[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const voice of indonesianVoices) {
    let score = 0;
    const langLower = normalizeText(voice.lang).replace(/_/g, '-');
    if (langLower === 'id-id') score += 20;
    if (isLikelyMaleVoiceName(voice.name)) score += 100;
    if (isLikelyFemaleVoiceName(voice.name)) score -= 60;
    if (voice.default) score += 5;

    if (score > bestScore) {
      bestScore = score;
      bestVoice = voice;
    }
  }

  return bestVoice;
}

export function computeMaleSpeechParams(voiceName?: string): {
  lang: 'id-ID';
  rate: number;
  pitch: number;
  volume: number;
} {
  const explicitlyMale = voiceName ? isLikelyMaleVoiceName(voiceName) : false;
  return {
    lang: 'id-ID',
    rate: explicitlyMale ? 0.96 : 0.95,
    pitch: explicitlyMale ? 0.92 : 0.76,
    volume: 1,
  };
}

// --- Client-side Audio / TTS Runtime & Cache ---

const FALLBACK_SENTINEL = '__SPEECH_FALLBACK__';
const ttsDataUrlCache = new Map<string, string>();
const inFlightTtsRequests = new Map<string, Promise<string>>();

let sharedUnlockAudioCtx: AudioContext | null = null;
let activeAudioEl: HTMLAudioElement | null = null;
let activeUtterance: SpeechSynthesisUtterance | null = null;
let deferredGestureCleanup: (() => void) | null = null;
let speakRequestSeq = 0;

function dispatchVoiceEvent(
  text: string,
  engine: 'gemini-tts' | 'web-speech',
  status: 'played' | 'deferred' | 'error'
): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent('osis-voice-spoken', {
        detail: { text, engine, status, at: Date.now() },
      })
    );
  } catch {
    // Ignore custom event errors
  }
}

function clearDeferredGestureHandler(): void {
  if (deferredGestureCleanup) {
    deferredGestureCleanup();
    deferredGestureCleanup = null;
  }
}

export function stopCurrentMaleVoice(): void {
  speakRequestSeq += 1;
  clearDeferredGestureHandler();
  if (activeAudioEl) {
    try {
      activeAudioEl.pause();
      activeAudioEl.currentTime = 0;
    } catch {
      // Ignore audio stop errors
    }
    activeAudioEl = null;
  }
  activeUtterance = null;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        window.speechSynthesis.cancel();
      }
    } catch {
      // Ignore speechSynthesis cancel errors
    }
  }
}

export function unlockSpeechAndAudio(): void {
  if (typeof window === 'undefined') return;
  const win = window as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  const Ctor = win.AudioContext || win.webkitAudioContext;
  if (Ctor) {
    try {
      if (!sharedUnlockAudioCtx) {
        sharedUnlockAudioCtx = new Ctor();
      }
      if (sharedUnlockAudioCtx.state === 'suspended') {
        void sharedUnlockAudioCtx.resume().catch(() => {});
      }
    } catch {
      // Ignore Web Audio unlock errors
    }
  }
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.getVoices();
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch {
      // Ignore speechSynthesis warm errors
    }
  }
}

async function fetchServerTtsDataUrl(text: string): Promise<string> {
  const key = text.trim();
  if (!key) return FALLBACK_SENTINEL;

  const cached = ttsDataUrlCache.get(key);
  if (cached) return cached;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return FALLBACK_SENTINEL;
  }

  const pending = inFlightTtsRequests.get(key);
  if (pending) return pending;

  const task = (async () => {
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: key }),
      });
      if (!res.ok) {
        ttsDataUrlCache.set(key, FALLBACK_SENTINEL);
        return FALLBACK_SENTINEL;
      }
      const data = (await res.json()) as {
        ok?: boolean;
        mimeType?: string;
        audioBase64?: string;
      };
      if (data?.ok && data.audioBase64) {
        const mime = data.mimeType || 'audio/wav';
        const dataUrl = `data:${mime};base64,${data.audioBase64}`;
        ttsDataUrlCache.set(key, dataUrl);
        return dataUrl;
      }
      ttsDataUrlCache.set(key, FALLBACK_SENTINEL);
      return FALLBACK_SENTINEL;
    } catch {
      return FALLBACK_SENTINEL;
    } finally {
      inFlightTtsRequests.delete(key);
    }
  })();

  inFlightTtsRequests.set(key, task);
  return task;
}

export async function prefetchMaleVoice(text: string): Promise<void> {
  if (typeof window === 'undefined' || !text.trim()) return;
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.getVoices();
    } catch {
      // Ignore
    }
  }
  await fetchServerTtsDataUrl(text);
}

function scheduleReplayOnFirstGesture(replay: () => void): void {
  if (typeof window === 'undefined') return;
  clearDeferredGestureHandler();

  let triggered = false;
  const onGesture = () => {
    if (triggered) return;
    triggered = true;
    clearDeferredGestureHandler();
    unlockSpeechAndAudio();
    replay();
  };

  const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'click'];
  events.forEach((evt) => window.addEventListener(evt, onGesture, { passive: true, once: true }));
  deferredGestureCleanup = () => {
    events.forEach((evt) => window.removeEventListener(evt, onGesture));
  };
}

async function resolveVoicesWithWait(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const synth = window.speechSynthesis;
  const initial = synth.getVoices();
  if (initial.length > 0) return initial;

  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener?.('voiceschanged', finish);
      resolve(synth.getVoices());
    };
    synth.addEventListener?.('voiceschanged', finish);
    window.setTimeout(finish, 250);
  });
}

async function speakViaBrowserSpeechSynthesis(
  text: string,
  seq: number,
  allowDeferredOnGesture: boolean
): Promise<SpeakMaleVoiceResult> {
  if (
    typeof window === 'undefined' ||
    !('speechSynthesis' in window) ||
    typeof SpeechSynthesisUtterance === 'undefined'
  ) {
    return 'skipped';
  }

  const synth = window.speechSynthesis;
  const voices = await resolveVoicesWithWait();
  if (seq !== speakRequestSeq) return 'skipped';

  const preferredVoice = selectPreferredIndonesianMaleVoice(voices);
  const params = computeMaleSpeechParams(preferredVoice?.name);

  if (synth.speaking || synth.pending) {
    synth.cancel();
  }
  if (synth.paused) {
    synth.resume();
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = params.lang;
  utterance.rate = params.rate;
  utterance.pitch = params.pitch;
  utterance.volume = params.volume;
  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }

  activeUtterance = utterance;

  return new Promise<SpeakMaleVoiceResult>((resolve) => {
    let resolved = false;
    let eventEmitted = false;
    const emitOnce = (status: 'played' | 'deferred' | 'error') => {
      if (eventEmitted) return;
      eventEmitted = true;
      dispatchVoiceEvent(text, 'web-speech', status);
    };
    const done = (result: SpeakMaleVoiceResult) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    utterance.onstart = () => {
      emitOnce('played');
      done('speech');
    };

    utterance.onend = () => {
      if (activeUtterance === utterance) {
        activeUtterance = null;
      }
      emitOnce('played');
      done('speech');
    };

    utterance.onerror = (ev) => {
      if (activeUtterance === utterance) {
        activeUtterance = null;
      }
      const errCode = (ev as unknown as { error?: string })?.error;
      if (errCode === 'not-allowed' && allowDeferredOnGesture && seq === speakRequestSeq) {
        emitOnce('deferred');
        scheduleReplayOnFirstGesture(() => {
          void speakMaleVoice(text, { interrupt: true, allowDeferredOnGesture: false });
        });
        done('deferred');
        return;
      }
      emitOnce('error');
      done('skipped');
    };

    try {
      synth.speak(utterance);
      // Fallback timer in case headless/platform speech engine starts silently without firing onstart promptly
      window.setTimeout(() => {
        if (!resolved && seq === speakRequestSeq) {
          emitOnce('played');
          done('speech');
        }
      }, 300);
    } catch {
      if (activeUtterance === utterance) {
        activeUtterance = null;
      }
      if (allowDeferredOnGesture && seq === speakRequestSeq) {
        emitOnce('deferred');
        scheduleReplayOnFirstGesture(() => {
          void speakMaleVoice(text, { interrupt: true, allowDeferredOnGesture: false });
        });
        done('deferred');
      } else {
        done('skipped');
      }
    }
  });
}

export async function speakMaleVoice(
  rawText: string,
  options: SpeakMaleVoiceOptions = {}
): Promise<SpeakMaleVoiceResult> {
  if (typeof window === 'undefined') return 'skipped';
  const text = rawText.trim();
  if (!text) return 'skipped';

  const { interrupt = true, allowDeferredOnGesture = false } = options;

  if (interrupt) {
    stopCurrentMaleVoice();
  } else {
    clearDeferredGestureHandler();
  }
  const mySeq = speakRequestSeq;

  const dataUrl = await fetchServerTtsDataUrl(text);
  if (mySeq !== speakRequestSeq) return 'skipped';

  if (dataUrl && dataUrl !== FALLBACK_SENTINEL) {
    try {
      const audio = new Audio(dataUrl);
      audio.preload = 'auto';
      activeAudioEl = audio;
      audio.onended = () => {
        if (activeAudioEl === audio) {
          activeAudioEl = null;
        }
      };
      await audio.play();
      dispatchVoiceEvent(text, 'gemini-tts', 'played');
      return 'audio';
    } catch (err) {
      if (activeAudioEl) {
        activeAudioEl = null;
      }
      const errName =
        err instanceof DOMException
          ? err.name
          : err && typeof err === 'object' && 'name' in err
            ? String((err as { name?: unknown }).name)
            : '';
      if (errName === 'NotAllowedError' && allowDeferredOnGesture && mySeq === speakRequestSeq) {
        dispatchVoiceEvent(text, 'gemini-tts', 'deferred');
        scheduleReplayOnFirstGesture(() => {
          void speakMaleVoice(text, { interrupt: true, allowDeferredOnGesture: false });
        });
        return 'deferred';
      }
      // Fall through cleanly to Web Speech API fallback on decode/playback error
    }
  }

  return speakViaBrowserSpeechSynthesis(text, mySeq, allowDeferredOnGesture);
}
