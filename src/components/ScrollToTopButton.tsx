import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';

interface ScrollToTopButtonProps {
  resetKey?: string;
}

const SCROLL_SHOW_THRESHOLD = 40;

export function ScrollToTopButton({ resetKey }: ScrollToTopButtonProps) {
  const [visible, setVisible] = useState(false);
  const activeScrollerRef = useRef<HTMLElement | null>(null);

  const evaluateScroll = useCallback(() => {
    const scrollers = Array.from(
      document.querySelectorAll<HTMLElement>('[data-page-scroller="true"]')
    );
    const active = scrollers.find((el) => el.scrollHeight > el.clientHeight && el.scrollTop > 0)
      || activeScrollerRef.current
      || scrollers[0]
      || null;

    if (active && document.contains(active)) {
      activeScrollerRef.current = active;
      setVisible(active.scrollTop > SCROLL_SHOW_THRESHOLD);
      return;
    }

    setVisible(window.scrollY > SCROLL_SHOW_THRESHOLD);
  }, []);

  useEffect(() => {
    const handleScroll = (e: Event) => {
      const target = e.target;
      if (target instanceof HTMLElement && target.dataset.pageScroller === 'true') {
        activeScrollerRef.current = target;
        setVisible(target.scrollTop > SCROLL_SHOW_THRESHOLD);
        return;
      }
      if (target === document || target === window) {
        setVisible(window.scrollY > SCROLL_SHOW_THRESHOLD);
      }
    };

    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', evaluateScroll);
    evaluateScroll();

    return () => {
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', evaluateScroll);
    };
  }, [evaluateScroll]);

  useEffect(() => {
    activeScrollerRef.current = null;
    const raf = window.requestAnimationFrame(() => {
      evaluateScroll();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [resetKey, evaluateScroll]);

  const handleScrollToTop = () => {
    const scrollers = Array.from(
      document.querySelectorAll<HTMLElement>('[data-page-scroller="true"]')
    );
    if (activeScrollerRef.current && document.contains(activeScrollerRef.current)) {
      activeScrollerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
    scrollers.forEach((el) => {
      if (el.scrollTop > 0) {
        el.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    if (window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={handleScrollToTop}
      aria-label="Gulir ke paling atas"
      title="Gulir ke paling atas"
      className="no-print fixed bottom-6 right-6 z-40 w-11 h-11 rounded-xl bg-[var(--app-primary)] hover:bg-[var(--app-secondary)] text-white shadow-lg border border-white/25 flex items-center justify-center transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
    >
      <ArrowUp className="w-5 h-5" style={{ color: 'var(--app-accent)' }} aria-hidden="true" />
    </button>
  );
}
