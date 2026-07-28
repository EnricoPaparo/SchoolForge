import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActionsMenu } from './ActionsMenu.js';
import { IconMoreHorizontal } from '../../components/icons.js';
import menuStyles from './CourseWorkspace.module.css';
import styles from './VerificationsView.module.css';

/**
 * UI-VERIFICHE-06A — pulsante «Azioni» della card verifica, con lo **stesso**
 * menu portalato già usato per corso/UDA/lezione in Didattica (`ActionsMenu`):
 * apertura sotto il trigger o sopra se manca spazio, clamp nel viewport e render
 * su `document.body`, così l'`overflow: hidden` della card non può ritagliarlo.
 *
 * Ogni card possiede il proprio stato: non serve una mappa di id, e un cambio di
 * lista/sezione smonta il componente chiudendo naturalmente il menu.
 *
 * Il ciclo di vita replica quello del workspace: click esterno chiude, Escape
 * chiude e riporta il focus sul trigger, la selezione di una voce chiude. Gli
 * handler delle singole voci restano quelli esistenti: qui non se ne riscrive
 * nessuno.
 */
export function VerificationActionsMenu({
  ariaLabel,
  children,
}: {
  /** Nome accessibile del trigger e del menu (es. «Azioni verifica — Reti»). */
  ariaLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    // La selezione di una voce chiude il menu senza toccare i suoi handler:
    // l'azione parte comunque, questo listener si limita a chiudere.
    function onMenuClick(event: Event) {
      const target = event.target as Element | null;
      if (target?.closest('[role="menuitem"]')) setOpen(false);
    }
    const menu = menuRef.current;
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    menu?.addEventListener('click', onMenuClick);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      menu?.removeEventListener('click', onMenuClick);
    };
  }, [open]);

  return (
    <div className={menuStyles.menuWrap}>
      <button
        type="button"
        ref={triggerRef}
        className={styles.cardMenuBtn}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((value) => !value)}
      >
        <IconMoreHorizontal size={15} />
        <span>Azioni</span>
      </button>
      <ActionsMenu open={open} anchorRef={triggerRef} ariaLabel={ariaLabel} ref={menuRef}>
        {children}
      </ActionsMenu>
    </div>
  );
}
