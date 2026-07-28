import {
  forwardRef,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './CourseWorkspace.module.css';

/** Distanza minima dai bordi del viewport. */
const VIEWPORT_MARGIN = 8;
/** Spazio tra il pulsante trigger e il menu. */
const ANCHOR_GAP = 4;

type Position = { left: number; top: number; maxHeight: number };

type ActionsMenuProps = {
  open: boolean;
  /** Pulsante «Azioni» a cui il menu resta ancorato. */
  anchorRef: RefObject<HTMLButtonElement | null>;
  /** Etichetta accessibile del menu (es. «Azioni corso»). */
  ariaLabel: string;
  /**
   * Invocato dal bubbling React dopo l'onClick della voce selezionata.
   * La chiusura non deve usare un listener DOM nativo sul nodo del menu:
   * quel listener precederebbe la delega eventi di React e potrebbe smontare
   * il portale prima che l'handler del pulsante venga eseguito.
   */
  onAction?: () => void;
  children: ReactNode;
};

/**
 * Menu «Azioni» renderizzato **fuori** dal contenitore scrollabile del workspace
 * tramite React portal su `document.body`, così nessun antenato con `overflow`
 * può ritagliarlo (il fix non è di z-index: un antenato che ritaglia lo farebbe
 * comunque). Resta ancorato al pulsante trigger:
 * - normalmente si apre **sotto**; se sotto non c'è spazio a sufficienza, **sopra**;
 * - non esce mai lateralmente dal viewport (clamp orizzontale);
 * - `max-height` + scroll interno **solo** se realmente più alto dello spazio.
 *
 * Non altera l'altezza né lo scroll del pannello UDA/lezioni (è su `body`).
 * Riposiziona su scroll/resize. La chiusura (click esterno, Escape con ripristino
 * del focus sul trigger, selezione di un'azione, cambio corso/UDA/lezione) è
 * gestita dal contenitore, che riceve il nodo del menu via `ref` inoltrato.
 */
export const ActionsMenu = forwardRef<HTMLDivElement, ActionsMenuProps>(function ActionsMenu(
  { open, anchorRef, ariaLabel, onAction, children },
  ref,
) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Position | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const compute = () => {
      const anchor = anchorRef.current;
      const menu = innerRef.current;
      if (!anchor || !menu) return;
      const rect = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const menuW = menu.offsetWidth;
      const menuH = menu.scrollHeight;

      // Orizzontale: allineato al bordo sinistro del trigger, ma sempre dentro
      // il viewport (clamp su entrambi i lati).
      let left = Math.min(rect.left, vw - menuW - VIEWPORT_MARGIN);
      left = Math.max(VIEWPORT_MARGIN, left);

      // Verticale: sotto se c'è spazio, altrimenti sopra; scegli il lato con più
      // spazio quando nessuno dei due basta.
      const spaceBelow = vh - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN;
      const spaceAbove = rect.top - ANCHOR_GAP - VIEWPORT_MARGIN;
      const openBelow = menuH <= spaceBelow || spaceBelow >= spaceAbove;
      const maxHeight = Math.max(0, openBelow ? spaceBelow : spaceAbove);
      const top = openBelow
        ? rect.bottom + ANCHOR_GAP
        : rect.top - ANCHOR_GAP - Math.min(menuH, maxHeight);

      setPos({ left, top, maxHeight });
    };
    compute();
    // Ancora sempre al trigger: riposiziona su qualunque scroll (anche di un
    // antenato: capture) e su resize del viewport.
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [open, anchorRef, children]);

  if (!open) return null;

  const setRefs = (node: HTMLDivElement | null) => {
    innerRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  return createPortal(
    <div
      ref={setRefs}
      role="menu"
      aria-label={ariaLabel}
      className={`${styles.menu} ${styles.menuPortal}`}
      onClick={(event) => {
        const item = (event.target as Element | null)?.closest<HTMLElement>('[role="menuitem"]');
        if (item && !item.matches(':disabled') && item.getAttribute('aria-disabled') !== 'true') {
          onAction?.();
        }
      }}
      style={{
        // Nascosto finché non è misurato, per evitare un flash in posizione 0,0.
        left: pos ? `${pos.left}px` : undefined,
        top: pos ? `${pos.top}px` : undefined,
        maxHeight: pos ? `${pos.maxHeight}px` : undefined,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
});
