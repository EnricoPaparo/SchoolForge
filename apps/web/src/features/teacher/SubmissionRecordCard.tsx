import { RecordCard } from '../../components/RecordCard.js';
import { RecordActionsMenu } from './RecordActionsMenu.js';
import {
  IconBookOpen,
  IconCalendar,
  IconCircleX,
  IconClipboardCheck,
  IconEye,
  IconEyeOff,
  IconFileCheck,
  IconTriangleAlert,
  IconTrash,
} from '../../components/icons.js';
import menuStyles from './CourseWorkspace.module.css';
import styles from './SubmissionRecordCard.module.css';

/** Stato di eliminabilità già derivato dal mirror di riga: nessuna lettura extra. */
export type SubmissionDeleteState = 'absent' | 'returned' | 'deletable';

export type SubmissionRecordCardProps = {
  studentName: string;
  /** Dettagli secondari già mostrati dalla tabella (valutate, numero eventi). */
  evaluatedLabel: string;
  stateLabel: string;
  score: string;
  visibility: { visibleToStudent: boolean; solutionsVisible: boolean } | null;
  submittedAt: string;
  selectable: boolean;
  selected: boolean;
  onToggleSelected: (selected: boolean) => void;
  /** Presente solo quando la riga desktop è realmente apribile. */
  onOpenCorrection?: () => void;
  eventsCount: number;
  onShowEvents: () => void;
  deleteState: SubmissionDeleteState;
  deleteDisabled: boolean;
  onDelete: () => void;
  /**
   * FORCE-SUBMIT-01 — spiegazione del perché «Chiudi e consegna» non è
   * disponibile, oppure `null` quando l'azione è eseguibile. Arriva dalla
   * **stessa** derivazione usata dalla tabella desktop.
   */
  forceSubmitBlockedLabel: string | null;
  onForceSubmit: () => void;
};

/**
 * UI-CONSEGNE-01 — rappresentazione mobile di **una riga** della tabella
 * consegne. Non possiede stato proprio: selezione, ordinamento e handler
 * arrivano dal monitor, esattamente come per la riga desktop, così le due
 * rappresentazioni non possono divergere.
 *
 * La card mobile è deliberatamente **neutra**: il tap sulla superficie non apre
 * nulla. Correzione, eventi, selezione ed eliminazione hanno controlli
 * espliciti e indipendenti, evitando conflitti fra gesture touch.
 */
export function SubmissionRecordCard({
  studentName,
  evaluatedLabel,
  stateLabel,
  score,
  visibility,
  submittedAt,
  selectable,
  selected,
  onToggleSelected,
  onOpenCorrection,
  eventsCount,
  onShowEvents,
  deleteState,
  deleteDisabled,
  onDelete,
  forceSubmitBlockedLabel,
  onForceSubmit,
}: SubmissionRecordCardProps) {
  return (
    <RecordCard
      recordLabel="Consegna"
      title={studentName}
      metaLine={
        <>
          <span>{evaluatedLabel}</span>
          <span aria-hidden="true"> · </span>
          <button
            type="button"
            className={styles.eventsLink}
            disabled={eventsCount === 0}
            onClick={(event) => {
              event.stopPropagation();
              onShowEvents();
            }}
          >
            {eventsCount} {eventsCount === 1 ? 'evento' : 'eventi'}
          </button>
        </>
      }
      actionLayout="submission"
      identityControl={
        // La checkbox è la stessa selezione della riga desktop.
        <label className={styles.selectLabel}>
          <input
            type="checkbox"
            aria-label={`Seleziona consegna — ${studentName}`}
            checked={selected}
            disabled={!selectable}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onToggleSelected(event.currentTarget.checked)}
          />
        </label>
      }
      metrics={[
        {
          label: 'Punteggio',
          icon: <IconClipboardCheck />,
          value: score,
        },
        {
          label: 'Visibilità',
          icon: <IconEye />,
          value: visibility ? (
            <span className={styles.visibilityIcons} aria-label="Stato visibilità restituzione">
              <span
                className={styles.visibilityIcon}
                title={
                  visibility.visibleToStudent
                    ? 'Restituzione visibile allo studente'
                    : 'Restituzione nascosta allo studente'
                }
                aria-label={
                  visibility.visibleToStudent
                    ? 'Restituzione visibile allo studente'
                    : 'Restituzione nascosta allo studente'
                }
              >
                {visibility.visibleToStudent ? <IconEye /> : <IconEyeOff />}
              </span>
              <span
                className={styles.visibilityIcon}
                title={
                  visibility.solutionsVisible
                    ? 'Soluzioni visibili allo studente'
                    : 'Soluzioni nascoste allo studente'
                }
                aria-label={
                  visibility.solutionsVisible
                    ? 'Soluzioni visibili allo studente'
                    : 'Soluzioni nascoste allo studente'
                }
              >
                {visibility.solutionsVisible ? <IconBookOpen /> : <IconCircleX />}
              </span>
            </span>
          ) : (
            <span aria-label="Visibilità non disponibile">—</span>
          ),
        },
        {
          label: 'Stato',
          icon: <IconTriangleAlert />,
          value: <span className={styles.stateValue}>{stateLabel}</span>,
        },
        {
          label: 'Consegna',
          icon: <IconCalendar />,
          value: <span className={styles.submittedAt}>{submittedAt}</span>,
        },
      ]}
      actions={
        onOpenCorrection || deleteState !== 'absent' ? (
          <RecordActionsMenu ariaLabel={`Azioni consegna — ${studentName}`}>
            {onOpenCorrection && (
              <button
                type="button"
                role="menuitem"
                title="Apri correzione"
                aria-label={`Apri correzione — ${studentName}`}
                onClick={onOpenCorrection}
              >
                <IconEye size={15} />
                <span>Apri correzione</span>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              title={forceSubmitBlockedLabel ?? 'Chiudi e consegna'}
              aria-label={
                forceSubmitBlockedLabel
                  ? `Chiudi e consegna non disponibile — ${studentName}: ${forceSubmitBlockedLabel}`
                  : `Chiudi e consegna — ${studentName}`
              }
              disabled={forceSubmitBlockedLabel !== null}
              onClick={onForceSubmit}
            >
              <IconFileCheck size={15} />
              <span>Chiudi e consegna</span>
            </button>
            {deleteState !== 'absent' &&
              (deleteState === 'returned' ? (
                <button
                  type="button"
                  role="menuitem"
                  className={menuStyles.menuDanger}
                  title="La correzione è già stata restituita: la consegna non è eliminabile."
                  aria-label={`Consegna non eliminabile (correzione restituita) — ${studentName}`}
                  disabled
                >
                  <IconTrash size={15} />
                  <span>Elimina consegna</span>
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className={menuStyles.menuDanger}
                  title="Elimina consegna"
                  aria-label={`Elimina consegna — ${studentName}`}
                  disabled={deleteDisabled}
                  onClick={onDelete}
                >
                  <IconTrash size={15} />
                  <span>Elimina consegna</span>
                </button>
              ))}
          </RecordActionsMenu>
        ) : undefined
      }
    />
  );
}
