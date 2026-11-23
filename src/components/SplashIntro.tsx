import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Vote } from 'lucide-react';
import { unlockSpeechAndAudio } from '../utils/voiceNarrator';

interface SplashIntroProps {
  schoolName: string;
  logoUrl?: string;
  onComplete: () => void;
}

export function SplashIntro({ schoolName, logoUrl, onComplete }: SplashIntroProps) {
  const [exiting, setExiting] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const completedRef = useRef(false);

  const finishIntro = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    const fadeTimer = window.setTimeout(() => {
      setExiting(true);
    }, 1550);

    const doneTimer = window.setTimeout(() => {
      finishIntro();
    }, 1950);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
  }, [finishIntro]);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: exiting ? 0 : 1 }}
      transition={{ duration: 0.38, ease: 'easeOut' }}
      onPointerDown={() => unlockSpeechAndAudio()}
      role="status"
      aria-live="polite"
      aria-label={`Komisi Pemilihan Pengurus OSIS (KPPO) ${schoolName}`}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6 text-center text-white overflow-hidden"
      style={{ backgroundColor: 'var(--app-primary, #0F1E3D)' }}
    >
      {/* Subtle geometric radial glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          background:
            'radial-gradient(circle at 50% 42%, var(--app-accent, #D97706) 0%, transparent 58%)',
        }}
      />

      <div className="relative z-10 max-w-3xl w-full flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.72, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-white p-2 shadow-2xl flex items-center justify-center overflow-hidden mb-7"
        >
          {logoUrl && !logoError ? (
            <img
              src={logoUrl}
              alt={`Logo ${schoolName}`}
              onError={() => setLogoError(true)}
              className="w-full h-full object-contain"
            />
          ) : (
            <Vote className="w-10 h-10" style={{ color: 'var(--app-primary, #0F1E3D)' }} />
          )}
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.45 }}
          className="text-xs sm:text-sm font-mono font-bold tracking-[0.28em] uppercase mb-3"
          style={{ color: 'var(--app-accent, #FBBF24)' }}
        >
          SISTEM E-VOTING RESMI
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 16, letterSpacing: '0.08em' }}
          animate={{ opacity: 1, y: 0, letterSpacing: '0.02em' }}
          transition={{ delay: 0.3, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="text-xl sm:text-3xl md:text-4xl font-extrabold leading-tight tracking-tight text-balance text-white"
        >
          KOMISI PEMILIHAN PENGURUS OSIS (KPPO)
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.52, duration: 0.45 }}
          className="mt-2.5 text-lg sm:text-2xl font-bold tracking-wide"
          style={{ color: 'var(--app-accent, #FBBF24)' }}
        >
          {schoolName}
        </motion.p>

        {/* Animated Accent Bar */}
        <div className="mt-8 w-52 sm:w-64 h-1 rounded-full bg-white/15 overflow-hidden">
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: '0%' }}
            transition={{ delay: 0.25, duration: 1.25, ease: [0.22, 1, 0.36, 1] }}
            className="h-full w-full rounded-full"
            style={{ backgroundColor: 'var(--app-accent, #D97706)' }}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          unlockSpeechAndAudio();
          finishIntro();
        }}
        className="relative z-10 mt-10 px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
      >
        Masuk Aplikasi
      </button>
    </motion.div>
  );
}
