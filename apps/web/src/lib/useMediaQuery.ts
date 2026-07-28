import { useEffect, useState } from 'react';

/**
 * UI-CONSEGNE-01 — hook di sola presentazione per scegliere **quale** delle due
 * rappresentazioni di una collezione montare (tabella desktop o card mobile).
 *
 * Perché non solo CSS: nascondere una delle due con `display: none` lascerebbe
 * comunque entrambe nel DOM. Montandone una sola non esiste alcun duplicato —
 * né per gli screen reader, né per la navigazione da tastiera, né per i test.
 *
 * Non è un listener di dati: osserva la viewport, non Firestore. Nessuna
 * lettura, scrittura, query o costo. In un ambiente senza `matchMedia` (jsdom
 * di default, rendering non-browser) restituisce `false`, cioè la variante
 * desktop: un fallback esplicito, mai un valore indovinato.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/**
 * Breakpoint condiviso fra tabella e card delle collezioni operative: lo stesso
 * `44rem` già usato dalle record card, così le due soglie non possono divergere.
 */
export const MOBILE_VIEWPORT_QUERY = '(max-width: 44rem)';
