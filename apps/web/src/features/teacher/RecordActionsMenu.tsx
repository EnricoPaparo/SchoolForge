import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconMoreHorizontal } from '../../components/icons.js';
import { ActionsMenu } from './ActionsMenu.js';
import menuStyles from './CourseWorkspace.module.css';
import styles from './RecordActionsMenu.module.css';

type RecordActionsMenuProps = {
  /** Nome accessibile del trigger e del menu. */
  ariaLabel: string;
  /** Testo contestuale mostrato dalla RecordCard quando il trigger riceve focus/hover. */
  cue?: string;
  children: ReactNode;
};

/**
 * Trigger condiviso dalle record card docente. Il menu è portalato tramite
 * ActionsMenu; la voce esegue prima il proprio handler React e soltanto dopo
 * chiude il menu attraverso il bubbling React.
 */
export function RecordActionsMenu({ ariaLabel, cue, children }: RecordActionsMenuProps) {
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
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={`${menuStyles.menuWrap} ${styles.wrapper}`}>
      <button
        type="button"
        ref={triggerRef}
        className={styles.trigger}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-record-card-cue={cue}
        onClick={() => setOpen((value) => !value)}
      >
        <IconMoreHorizontal size={15} />
        <span>Azioni</span>
      </button>
      <ActionsMenu
        open={open}
        anchorRef={triggerRef}
        ariaLabel={ariaLabel}
        ref={menuRef}
        onAction={() => setOpen(false)}
      >
        {children}
      </ActionsMenu>
    </div>
  );
}
