import { useEffect, useRef, useState } from 'react';
import { ActionsMenu } from './ActionsMenu.js';
import {
  IconBookOpen,
  IconCircleCheck,
  IconCircleX,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconEraser,
  IconEye,
  IconEyeOff,
  IconMoreHorizontal,
  IconRotateCcw,
  IconSend,
} from '../../components/icons.js';
import type { BatchAction } from '../repository/corrections/batchCorrectionActions.js';
import type { BatchReturnVisibilityAction } from '../repository/corrections/batchReturnVisibility.js';
import menuStyles from './CourseWorkspace.module.css';
import styles from './BatchActionsMobileMenu.module.css';

const VISIBILITY_ITEMS = [
  { action: 'show_return', label: 'Rendi visibili', Icon: IconEye },
  { action: 'hide_return', label: 'Nascondi allo studente', Icon: IconEyeOff },
  { action: 'show_solutions', label: 'Mostra soluzioni', Icon: IconBookOpen },
  { action: 'hide_solutions', label: 'Nascondi soluzioni', Icon: IconCircleX },
] as const;

export type BatchActionsMobileMenuProps = {
  /** Stessa condizione della toolbar desktop: non ne esiste una seconda. */
  disabled: boolean;
  /** Conteggio delle consegne selezionate, mostrato nel nome accessibile. */
  selectedCount: number;
  /** Cambia quando cambia la verifica: chiude il menu senza ricordare il livello. */
  contextKey: string;
  archiveExportBusy: boolean;
  onBatchAction: (action: BatchAction) => void;
  onVisibilityAction: (action: BatchReturnVisibilityAction) => void;
  onArchiveExport: () => void;
};

/**
 * UI-CONSEGNE-01 — su mobile le sei azioni massive non-IA vivono in un solo
 * menu, nello stesso ordine della toolbar desktop. Riusa il menu portalato
 * condiviso (`ActionsMenu`): nessuna nuova popup e nessun handler duplicato —
 * i callback sono esattamente quelli che invoca la toolbar desktop.
 *
 * «Visibilità» apre un secondo livello **nella stessa superficie**: niente menu
 * annidato in un altro portale e nessun pulsante dentro un pulsante. Il livello
 * torna sempre alla radice quando il menu si chiude.
 */
export function BatchActionsMobileMenu({
  disabled,
  selectedCount,
  contextKey,
  archiveExportBusy,
  onBatchAction,
  onVisibilityAction,
  onArchiveExport,
}: BatchActionsMobileMenuProps) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<'root' | 'visibility'>('root');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  function close(restoreFocus: boolean) {
    setOpen(false);
    setLevel('root');
    if (restoreFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    close(false);
    // Il cambio di verifica azzera menu e livello: nessuno stato residuo.
  }, [contextKey]);

  useEffect(() => {
    if (disabled) close(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      // Escape sul secondo livello torna alla radice; sulla radice chiude.
      if (level === 'visibility') {
        setLevel('root');
        return;
      }
      close(true);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, level]);

  const countSuffix = selectedCount > 0 ? ` (${selectedCount})` : '';

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        ref={triggerRef}
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Azioni selezionate${countSuffix}`}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <IconMoreHorizontal size={15} />
        <span>Azioni selezionate{countSuffix}</span>
      </button>
      <ActionsMenu
        open={open}
        anchorRef={triggerRef}
        ariaLabel={`Azioni selezionate${countSuffix}`}
        ref={menuRef}
        onAction={() => close(true)}
      >
        {level === 'root' ? (
          <>
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => onBatchAction('complete')}
            >
              <IconCircleCheck size={15} />
              <span>Completa</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => onBatchAction('return')}
            >
              <IconSend size={15} />
              <span>Restituisci</span>
            </button>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={false}
              disabled={disabled}
              onClick={() => setLevel('visibility')}
            >
              <IconEye size={15} />
              <span>Visibilità</span>
              <IconChevronRight size={14} />
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => onArchiveExport()}
            >
              {archiveExportBusy ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <IconDownload size={15} />
              )}
              <span>{archiveExportBusy ? 'Preparazione…' : 'PDF correzioni'}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => onBatchAction('reopen')}
            >
              <IconRotateCcw size={15} />
              <span>Riapri</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={menuStyles.menuDanger}
              disabled={disabled}
              onClick={() => onBatchAction('clear')}
            >
              <IconEraser size={15} />
              <span>Azzera</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded
              onClick={() => setLevel('root')}
            >
              <IconChevronLeft size={15} />
              <span>Visibilità</span>
            </button>
            {VISIBILITY_ITEMS.map(({ action, label, Icon }) => (
              <button
                key={action}
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => onVisibilityAction(action)}
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
            ))}
          </>
        )}
      </ActionsMenu>
    </div>
  );
}
