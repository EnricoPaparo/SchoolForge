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
  IconFileCheck,
  IconEye,
  IconEyeOff,
  IconMoreHorizontal,
  IconRotateCcw,
  IconSend,
  IconSparkles,
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
  /** Disabilita l'apertura solo se non esistono righe selezionabili o durante un'operazione. */
  menuDisabled: boolean;
  /** Stessa condizione delle azioni massive desktop: richiede una selezione. */
  actionsDisabled: boolean;
  /** Conteggio delle consegne selezionate, mostrato nel nome accessibile. */
  selectedCount: number;
  allSelectableSelected: boolean;
  /** Cambia quando cambia la verifica: chiude il menu senza ricordare il livello. */
  contextKey: string;
  archiveExportBusy: boolean;
  aiCorrectionDisabled: boolean;
  onToggleSelectAll: () => void;
  onAiCorrection: () => void;
  onBatchAction: (action: BatchAction) => void;
  onVisibilityAction: (action: BatchReturnVisibilityAction) => void;
  /**
   * FORCE-SUBMIT-02 — quante righe selezionate sono davvero chiudibili. Stessa
   * derivazione della toolbar desktop e del dialog di conferma.
   */
  forceCloseEligibleCount: number;
  onForceClose: () => void;
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
  menuDisabled,
  actionsDisabled,
  selectedCount,
  allSelectableSelected,
  contextKey,
  archiveExportBusy,
  aiCorrectionDisabled,
  onToggleSelectAll,
  onAiCorrection,
  onBatchAction,
  onVisibilityAction,
  onArchiveExport,
  forceCloseEligibleCount,
  onForceClose,
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
    if (menuDisabled) close(false);
  }, [menuDisabled]);

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
        aria-label={`Azioni consegne${countSuffix}`}
        disabled={menuDisabled}
        onClick={() => setOpen((value) => !value)}
      >
        <IconMoreHorizontal size={15} />
        <span>Azioni{countSuffix}</span>
      </button>
      <ActionsMenu
        open={open}
        anchorRef={triggerRef}
        ariaLabel={`Azioni consegne${countSuffix}`}
        ref={menuRef}
        onAction={() => close(true)}
      >
        {level === 'root' ? (
          <>
            <button type="button" role="menuitem" onClick={onToggleSelectAll}>
              <IconCircleCheck size={15} />
              <span>{allSelectableSelected ? 'Deseleziona tutte' : 'Seleziona tutte'}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={actionsDisabled || aiCorrectionDisabled}
              onClick={onAiCorrection}
            >
              <IconSparkles size={15} />
              <span>Correggi con IA</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={actionsDisabled}
              onClick={() => onBatchAction('complete')}
            >
              <IconCircleCheck size={15} />
              <span>Completa</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={actionsDisabled}
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
              disabled={actionsDisabled}
              onClick={() => setLevel('visibility')}
            >
              <IconEye size={15} />
              <span>Visibilità</span>
              <IconChevronRight size={14} />
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={actionsDisabled}
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
              disabled={actionsDisabled}
              onClick={() => onBatchAction('reopen')}
            >
              <IconRotateCcw size={15} />
              <span>Riapri</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={menuStyles.menuDanger}
              disabled={actionsDisabled}
              onClick={() => onBatchAction('clear')}
            >
              <IconEraser size={15} />
              <span>Azzera</span>
            </button>
            {/*
             * FORCE-SUBMIT-02 — ultima voce del menu batch: su mobile non si
             * aggiunge un ottavo pulsante visibile. Stesso handler, stessa
             * eleggibilità e stessa conferma del desktop.
             */}
            <button
              type="button"
              role="menuitem"
              title={
                forceCloseEligibleCount === 0
                  ? 'Nessuna consegna selezionata è in bozza.'
                  : `Chiudi ${forceCloseEligibleCount} consegne`
              }
              aria-label={
                forceCloseEligibleCount === 0
                  ? 'Chiudi consegne non disponibile: nessuna consegna selezionata è in bozza.'
                  : `Chiudi consegne (${forceCloseEligibleCount})`
              }
              disabled={actionsDisabled || forceCloseEligibleCount === 0}
              onClick={onForceClose}
            >
              <IconFileCheck size={15} />
              <span>Chiudi consegne</span>
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
                disabled={actionsDisabled}
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
