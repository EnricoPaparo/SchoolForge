import { useEffect, useState } from 'react';

/** Project mobile breakpoint (matches the 640px used across the student CSS). */
export const MOBILE_MAX_WIDTH = 640;

/**
 * Reactive `max-width` media-query hook. Returns true below the mobile
 * breakpoint and updates on viewport changes. SSR-safe default (false) — the
 * app is a client SPA, so `window` is always present at run time, but the
 * guard keeps it inert if ever rendered without a DOM.
 */
export function useIsMobile(maxWidth: number = MOBILE_MAX_WIDTH): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return isMobile;
}
