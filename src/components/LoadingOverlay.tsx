import { useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, RefreshCw, Vote } from 'lucide-react';

interface LoadingOverlayProps {
  visible: boolean;
  label?: string;
  variant?: 'card' | 'fullscreen';
  schoolName?: string;
  logoUrl?: string;
  durationMs?: number;
}

export function LoadingOverlay({
  visible,
  label = 'Memproses...',
  variant = 'card',
  schoolName = 'SMA Negeri 1 Kabun',
  logoUrl,
  durationMs = 3000,
}: LoadingOverlayProps) {
  const [logoError, setLogoError] = useState(false);

  if (!visible) return null;

  if (variant === 'fullscreen') {
    const durationSec = Math.max(0.5, durationMs / 1000);
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        role="status"
        aria-live="polite"
        aria-busy="true"
        data-testid="fullpage-refresh-overlay"
        className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-[var(--app-primary,#0F1E3D)] text-white p-6 overflow-hidden select-none"
      >
        {/* Subtle radial highlight */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_50%_45%,var(--app-accent,#D97706)_0%,transparent_60%)]"
        />

        <div className="relative z-10 flex flex-col items-center text-center max-w-md w-full">
          {/* Animated orbital spinner around school emblem */}
          <div className="relative w-28 h-28 flex items-center justify-center mb-7">
            <motion.div
              aria-hidden="true"
              animate={{ rotate: 360 }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-0 rounded-full border-4 border-white/15 border-t-[var(--app-accent,#D97706)]"
            />
            <motion.div
              aria-hidden="true"
              animate={{ rotate: -360 }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-2 rounded-full border-2 border-dashed border-white/25"
            />
            <div className="w-16 h-16 rounded-2xl bg-white p-2 shadow-2xl flex items-center justify-center overflow-hidden">
              {logoUrl && !logoError ? (
                <img
                  src={logoUrl}
                  alt={`Logo ${schoolName}`}
                  onError={() => setLogoError(true)}
                  className="w-full h-full object-contain"
                />
              ) : (
                <Vote className="w-8 h-8 text-[var(--app-primary,#0F1E3D)]" aria-hidden="true" />
              )}
            </div>
          </div>

          <div className="inline-flex items-center gap-2 text-xs font-mono font-bold tracking-[0.22em] uppercase text-[var(--app-accent,#FBBF24)] mb-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            <span>MEMUAT ULANG SISTEM</span>
          </div>

          <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">
            {label}
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 mt-1.5">
            Menyegarkan seluruh halaman {schoolName}...
          </p>

          {/* 3-Second Animated Progress Bar */}
          <div className="mt-7 w-full max-w-xs h-2 rounded-full bg-white/15 overflow-hidden">
            <motion.div
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: durationSec, ease: 'easeInOut' }}
              className="h-full rounded-full bg-[var(--app-accent,#D97706)]"
            />
          </div>
          <p className="text-[11px] font-mono text-slate-300 mt-2.5 tabular-nums">
            Sinkronisasi tampilan selesai dalam beberapa detik...
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 backdrop-blur-[2px] p-4"
    >
      <div className="bg-white border border-slate-200 rounded-2xl px-6 py-5 shadow-2xl flex items-center gap-3.5 max-w-xs w-full">
        <div className="w-10 h-10 rounded-xl bg-[var(--app-primary)]/10 text-[var(--app-primary)] flex items-center justify-center shrink-0">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 truncate">{label}</p>
          <p className="text-xs text-slate-500 mt-0.5">Mohon tunggu sebentar...</p>
        </div>
      </div>
    </div>
  );
}
