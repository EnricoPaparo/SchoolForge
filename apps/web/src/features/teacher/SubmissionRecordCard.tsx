import { RecordCard } from '../../components/RecordCard.js';
import { RecordActionsMenu } from './RecordActionsMenu.js';
import {
  IconBookOpen,
  IconCircleX,
  IconClipboardCheck,
  IconEye,
  IconEyeOff,
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
  metaLine: string;
  stateLabel: string;
  score: string;
  visibility: { visibleToStudent: boolean; solutionsVisible: boolean } | null;
  submittedAt: string;
  selectable: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  /** Presente solo quando la riga desktop è realmente apribile. */
  onOpenCorrection?: () => void;
  eventsCount: number;
  onShowEvents: () => void;
  deleteState: SubmissionDeleteState;
  deleteDisabled: boolean;
  onDelete: () => void;
};

/**
 * UI-CONSEGNE-01 — rappresentazione mobile di **una riga** della tabella
 * consegne. Non possiede stato proprio: selezione, ordinamento e handler
 * arrivano dal monitor, esattamente come per la riga desktop, così le due
 * rappresentazioni non possono divergere.
 *
 * La superficie apribile e i controlli interni sono elementi **fratelli**
 * (contratto `RecordCard`): checkbox e menu non annidano pulsanti dentro
 * pulsanti e non fanno partire l'apertura della correzione.
 */
export function SubmissionRecordCard({
  studentName,
  metaLine,
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
}: SubmissionRecordCardProps) {
  return (
    <RecordCard
      recordLabel="Consegna"
      title={studentName}
      metaLine={metaLine}
      actionLayout="submission"
      openLabel={onOpenCorrection ? `Apri correzione — ${studentName}` : undefined}
      onOpen={onOpenCorrection}
      identityControl={
        // La checkbox è la stessa selezione della riga desktop; vive fuori dalla
        // superficie apribile, quindi spuntarla non apre mai la correzione.
        <label className={styles.selectLabel}>
          <input
            type="checkbox"
            aria-label={`Seleziona consegna — ${studentName}`}
            checked={selected}
            disabled={!selectable}
            onChange={onToggleSelected}
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
          // Fascia a larghezza piena: icona + testo, mai il solo colore.
          label: 'Stato',
          icon: <IconTriangleAlert />,
          value: <span className={styles.stateValue}>{stateLabel}</span>,
        },
      ]}
      statusControl={<span className={styles.submittedAt}>{submittedAt}</span>}
      actions={
        <RecordActionsMenu ariaLabel={`Azioni consegna — ${studentName}`}>
          <button
            type="button"
            role="menuitem"
            title="Visualizza eventi"
            aria-label={`Eventi di attenzione — ${studentName}`}
            disabled={eventsCount === 0}
            onClick={onShowEvents}
          >
            <IconTriangleAlert size={15} />
            <span>Visualizza eventi ({eventsCount})</span>
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
      }
    />
  );
}
