import { useMemo, useRef, useState } from 'react';
import { DialogShell } from '../../components/DialogShell.js';
import { IconCircleX, IconFileCheck, IconRotateCcw, IconTag } from '../../components/icons.js';
import type {
  DifferentiatedChoice,
  EquivalentGroupConfig,
  VerificationDifferentiationConfig,
} from '../../types/firestore.js';
import type { DifferentiationLabelItem } from '../repository/differentiation/differentiationLabelsService.js';
import type { QuestionIndexEntry } from '../repository/verifications/questionIndexService.js';
import { setDifferentiatedQuestion } from '../repository/verifications/differentiationConfig.js';
import { VexQuestionSelect } from './VexQuestionSelect.js';
import styles from './DifferentiationVariantsDialog.module.css';

type Props = {
  baseEntry: QuestionIndexEntry;
  labels: DifferentiationLabelItem[];
  questionIndex: QuestionIndexEntry[];
  selectedIds: ReadonlySet<string>;
  equivalentGroups: readonly EquivalentGroupConfig[];
  differentiation?: VerificationDifferentiationConfig;
  onCancel: () => void;
  onSave: (next: VerificationDifferentiationConfig | undefined) => void;
};

type Phase = 'edit' | 'confirm';

const TYPE_LABEL: Record<QuestionIndexEntry['tipo'], string> = {
  aperta: 'Aperta',
  chiusa_singola: 'Risposta singola',
  chiusa_multipla: 'Risposta multipla',
};

function initialChoices(
  config: VerificationDifferentiationConfig | undefined,
  baseId: string,
  labels: readonly DifferentiationLabelItem[],
): Record<string, DifferentiatedChoice> {
  const stored = config?.questions.find(
    (item) => item.baseQuestionIndexEntryId === baseId,
  )?.choices;
  return Object.fromEntries(
    labels.map((label) => [label.labelId, stored?.[label.labelId] ?? { kind: 'base' }]),
  );
}

function choicesKey(value: Record<string, DifferentiatedChoice>): string {
  return JSON.stringify(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([labelId, choice]) => [labelId, choice]),
  );
}

export function DifferentiationVariantsDialog({
  baseEntry,
  labels,
  questionIndex,
  selectedIds,
  equivalentGroups,
  differentiation,
  onCancel,
  onSave,
}: Props) {
  const baselineRef = useRef(initialChoices(differentiation, baseEntry.id, labels));
  const [choices, setChoices] = useState(baselineRef.current);
  const [phase, setPhase] = useState<Phase>('edit');
  const submittingRef = useRef(false);
  const dirty = choicesKey(choices) !== choicesKey(baselineRef.current);
  const vexIds = useMemo(
    () => new Set(equivalentGroups.flatMap((group) => group.questionIndexEntryIds)),
    [equivalentGroups],
  );
  const sortedLabels = useMemo(
    () => [...labels].sort((a, b) => a.name.localeCompare(b.name, 'it')),
    [labels],
  );

  function requestClose() {
    if (dirty) setPhase('confirm');
    else onCancel();
  }

  function save() {
    if (submittingRef.current) return;
    if (
      Object.values(choices).some(
        (choice) => choice.kind === 'alternative' && !choice.questionIndexEntryId,
      )
    )
      return;
    submittingRef.current = true;
    onSave(setDifferentiatedQuestion(differentiation, baseEntry.id, choices));
  }

  if (phase === 'confirm') {
    return (
      <DialogShell
        title="Modifiche non salvate"
        role="alertdialog"
        variant="wide-scroll"
        onCancel={() => setPhase('edit')}
      >
        <p>Vuoi salvare le varianti prima di chiudere?</p>
        <div className={`dialog-actions ${styles.actions}`}>
          <button type="button" onClick={() => setPhase('edit')}>
            <IconRotateCcw size={16} aria-hidden="true" /> Continua a modificare
          </button>
          <button type="button" className="btn-danger" onClick={onCancel}>
            <IconCircleX size={16} aria-hidden="true" /> Abbandona modifiche
          </button>
          <button type="button" className="btn-primary" onClick={save}>
            <IconFileCheck size={16} aria-hidden="true" /> Salva e chiudi
          </button>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell title="Varianti della domanda" variant="wide-scroll" onCancel={requestClose}>
      <header className={styles.baseHeader}>
        <span>Domanda #{baseEntry.questionLocalId}</span>
        <span>{TYPE_LABEL[baseEntry.tipo]}</span>
        <span>Difficoltà {baseEntry.difficolta}</span>
      </header>
      <section className={styles.baseCard} aria-label="Domanda base">
        <strong>Domanda base</strong>
        <p>{baseEntry.questionPreview || 'Anteprima non disponibile.'}</p>
        <small>
          La soluzione completa resta nel pool owner-only e non viene caricata da questa schermata.
        </small>
      </section>

      {sortedLabels.length === 0 ? (
        <p className="state-empty">Crea prima un'etichetta nella sezione Studenti.</p>
      ) : (
        <div className={styles.labelList}>
          {sortedLabels.map((label) => {
            const choice = choices[label.labelId] ?? { kind: 'base' as const };
            const usedBySameLabel = new Set(
              differentiation?.questions
                .filter((item) => item.baseQuestionIndexEntryId !== baseEntry.id)
                .map((item) => item.choices[label.labelId])
                .filter(
                  (item): item is Extract<DifferentiatedChoice, { kind: 'alternative' }> =>
                    item?.kind === 'alternative',
                )
                .map((item) => item.questionIndexEntryId) ?? [],
            );
            const alternatives = questionIndex
              .filter(
                (entry) =>
                  entry.lessonFilename === baseEntry.lessonFilename &&
                  entry.udaDir === baseEntry.udaDir &&
                  entry.id !== baseEntry.id &&
                  !selectedIds.has(entry.id) &&
                  !vexIds.has(entry.id) &&
                  !usedBySameLabel.has(entry.id),
              )
              .map((entry) => ({
                questionIndexEntryId: entry.id,
                questionLocalId: entry.questionLocalId,
                questionPreview: entry.questionPreview,
                udaDir: entry.udaDir,
                tipo: entry.tipo,
                difficolta: entry.difficolta,
                maxPoints: entry.maxPoints,
              }));
            const selectedAlternative =
              choice.kind === 'alternative'
                ? questionIndex.find((entry) => entry.id === choice.questionIndexEntryId)
                : undefined;
            if (
              selectedAlternative &&
              !alternatives.some((entry) => entry.questionIndexEntryId === selectedAlternative.id)
            ) {
              alternatives.unshift({
                questionIndexEntryId: selectedAlternative.id,
                questionLocalId: selectedAlternative.questionLocalId,
                questionPreview: selectedAlternative.questionPreview,
                udaDir: selectedAlternative.udaDir,
                tipo: selectedAlternative.tipo,
                difficolta: selectedAlternative.difficolta,
                maxPoints: selectedAlternative.maxPoints,
              });
            }
            return (
              <section key={label.labelId} className={styles.labelCard}>
                <h4>
                  <IconTag size={16} aria-hidden="true" /> {label.name}
                </h4>
                <div
                  className={styles.choiceGrid}
                  role="radiogroup"
                  aria-label={`Scelta per ${label.name}`}
                >
                  {(['base', 'alternative', 'none'] as const).map((kind) => (
                    <label key={kind}>
                      <input
                        type="radio"
                        name={`choice-${label.labelId}`}
                        checked={choice.kind === kind}
                        onChange={() =>
                          setChoices((current) => ({
                            ...current,
                            [label.labelId]:
                              kind === 'alternative'
                                ? { kind, questionIndexEntryId: '' }
                                : { kind },
                          }))
                        }
                      />
                      {kind === 'base'
                        ? 'Base'
                        : kind === 'alternative'
                          ? 'Alternativa'
                          : 'Nessuna'}
                    </label>
                  ))}
                </div>
                {choice.kind === 'alternative' && (
                  <div className={styles.alternativePicker}>
                    {choice.questionIndexEntryId && (
                      <p>
                        Selezionata:{' '}
                        {questionIndex.find((entry) => entry.id === choice.questionIndexEntryId)
                          ?.questionPreview ?? choice.questionIndexEntryId}
                      </p>
                    )}
                    <VexQuestionSelect
                      label={`Scegli alternativa per ${label.name}`}
                      options={alternatives}
                      onSelect={(questionIndexEntryId) =>
                        setChoices((current) => ({
                          ...current,
                          [label.labelId]: { kind: 'alternative', questionIndexEntryId },
                        }))
                      }
                    />
                    {alternatives.length === 0 && !choice.questionIndexEntryId && (
                      <p className={styles.emptyHint}>
                        Nessuna domanda disponibile nella stessa lezione: le domande comuni e VEX
                        non sono utilizzabili.
                      </p>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <div className={`dialog-actions ${styles.actions}`}>
        <button type="button" onClick={requestClose}>
          <IconCircleX size={16} aria-hidden="true" /> Annulla
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={Object.values(choices).some(
            (choice) => choice.kind === 'alternative' && !choice.questionIndexEntryId,
          )}
          onClick={save}
        >
          <IconFileCheck size={16} aria-hidden="true" /> Salva varianti
        </button>
      </div>
    </DialogShell>
  );
}
