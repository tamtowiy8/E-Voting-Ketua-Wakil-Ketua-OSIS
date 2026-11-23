import { useState } from 'react';
import { Users } from 'lucide-react';

interface CandidateImageProps {
  src: string;
  alt: string;
  nomorUrut?: number;
  className?: string;
}

export function CandidateImage({ src, alt, nomorUrut, className = '' }: CandidateImageProps) {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-slate-100 via-slate-200 to-slate-100 text-slate-600 select-none ${className}`}
        role="img"
        aria-label={alt}
      >
        <Users className="w-10 h-10 text-[#1E3A5F] mb-2 opacity-80" aria-hidden="true" />
        {typeof nomorUrut === 'number' && (
          <span className="text-xs font-semibold tracking-wide text-slate-700">
            Pasangan Calon 0{nomorUrut}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={`object-cover object-top ${className}`}
    />
  );
}
