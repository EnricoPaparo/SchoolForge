import { useMemo, useRef } from 'react';
import type {
  EquivalentGroupConfig,
  VerificationDistributionMode,
  VerificationQuestionRef,
} from '../../types/firestore.js';
import {
  commonEntryIds,
  deriveVexSummary,
  validateEquivalentGroups,
  type VexWarning,
} from '../repository/verifications/vexGroups.js';
import { VexQuestionSelect } from './VexQuestionSelect.js';
import type { QuestionParticipation } from '../repository/verifications/questionParticipation.js';
import { IconCircleX, IconInfo, IconRotateCcw, IconTriangleAlert } from '../../components/icons.js';
import styles from './VexBuilder.module.css';

/**
 * VEX-01A — builder docente draft-time delle «Varianti equivalenti». Componente
 * **controllato**: modalità e gruppi vivono nel parent (VerificationsView) e
 * viaggiano nello stesso salvataggio bozza. Nessuna lettura/scrittura qui;
 * tutta la logica è pura (vexGroups). Nessun drag-and-drop.
 */
/**
 * Tipo **UI-only** per le domande mostrate nel builder. Aggrega i metadati del
 * `VerificationQuestionRef` con il `questionPreview` **già** caricato dal
 * questionIndex in VerificationsView. Non è un contratto Firestore: la preview
 * **non** entra in `config.equivalentGroups` né in `VerificationQuestionRef` e
 * **non** è persistita — serve solo a rendere leggibile l'anteprima.
 */
export interface VexBuilderQuestion {
  questionIndexEntryId: string;
  questionLocalId: string;
  /** Snippet breve dal questionIndex; può essere assente/vuoto (fallback su ID). */
  questionPreview?: string;
  udaDir: string;
  tipo: VerificationQuestionRef['tipo'];
  difficolta: VerificationQuestionRef['difficolta'];
  maxPoints: number;
}

export interface VexBuilderProps {
  distributionMode: VerificationDistributionMode;
  onModeChange: (mode: VerificationDistributionMode) => void;
  /** Domande selezionate nel picker (ordine di selezione), con anteprima UI. */
  selectedRefs: VexBuilderQuestion[];
  groups: EquivalentGroupConfig[];
  onGroupsChange: (groups: EquivalentGroupConfig[]) => void;
  /** Opzionale: se assente i warning basati sul numero studenti sono omessi. */
  studentCount?: number;
  participation?: ReadonlyMap<string, QuestionParticipation>;
}

function tipoLabel(tipo: VexBuilderQuestion['tipo']): string {
  return tipo === 'aperta'
    ? 'aperta'
    : tipo === 'chiusa_singola'
      ? 'chiusa singola'
      : 'chiusa multipla';
}

/** Testo principale leggibile: preview se presente, altrimenti l'ID come fallback. */
function previewText(q: VexBuilderQuestion): string {
  const p = q.questionPreview?.trim();
  return p && p.length > 0 ? p : q.questionLocalId;
}

export function VexBuilder({
  distributionMode,
  onModeChange,
  selectedRefs,
  groups,
  onGroupsChange,
  studentCount,
  participation,
}: VexBuilderProps) {
  const creatingRef = useRef(false);

  const byId = useMemo(
    () => new Map(selectedRefs.map((r) => [r.questionIndexEntryId, r])),
    [selectedRefs],
  );
  const selectedIds = useMemo(
    () => selectedRefs.map((r) => r.questionIndexEntryId),
    [selectedRefs],
  );
  const commonIds = useMemo(() => commonEntryIds(selectedIds, groups), [selectedIds, groups]);
  const summary = useMemo(() => deriveVexSummary(selectedRefs, groups), [selectedRefs, groups]);
  const validation = useMemo(
    () => validateEquivalentGroups(selectedRefs, groups, studentCount),
    [selectedRefs, groups, studentCount],
  );
  const warningByGroup = useMemo(() => {
    const map = new Map<string, VexWarning[]>();
    for (const w of validation.warnings) {
      if (w.groupId) map.set(w.groupId, [...(map.get(w.groupId) ?? []), w]);
    }
    return map;
  }, [validation.warnings]);
  const globalWarnings = validation.warnings.filter((w) => !w.groupId);

  const isVex = distributionMode === 'equivalent_variants';

  function createGroup() {
    // Guardia doppio-click: due click nello stesso tick non creano due gruppi.
    if (creatingRef.current) return;
    creatingRef.current = true;
    void Promise.resolve().then(() => {
      creatingRef.current = false;
    });
    onGroupsChange([...groups, { id: crypto.randomUUID(), questionIndexEntryIds: [] }]);
  }

  function addAlternative(groupId: string, entryId: string) {
    if (!entryId) return;
    if (participation && participation.get(entryId) !== 'common_free') return;
    onGroupsChange(
      groups.map((g) =>
        g.id === groupId && !g.questionIndexEntryIds.includes(entryId)
          ? { ...g, questionIndexEntryIds: [...g.questionIndexEntryIds, entryId] }
          : g,
      ),
    );
  }

  function removeAlternative(groupId: string, entryId: string) {
    // Rimuovere l'ultima alternativa elimina automaticamente il gruppo.
    onGroupsChange(
      groups
        .map((g) =>
          g.id === groupId
            ? {
                ...g,
                questionIndexEntryIds: g.questionIndexEntryIds.filter((id) => id !== entryId),
              }
            : g,
        )
        .filter((g) => g.questionIndexEntryIds.length > 0),
    );
  }

  function deleteGroup(groupId: string) {
    // Le alternative del gruppo tornano comuni automaticamente (non più raggruppate).
    onGroupsChange(groups.filter((g) => g.id !== groupId));
  }

  return (
    <section className={styles.builder} aria-label="Distribuzione online">
      <h3 className={styles.heading}>Distribuzione online</h3>
      <div className={styles.modes} role="radiogroup" aria-label="Modalità di distribuzione">
        <label className={styles.mode} data-selected={!isVex}>
          <input
            type="radio"
            name="vex-distribution-mode"
            checked={!isVex}
            onChange={() => onModeChange('same_questions')}
          />
          <span className={styles.modeText}>
            <strong>Stesse domande, ordine casuale</strong>
            <span className={styles.modeDesc}>
              Tutti gli studenti ricevono le stesse domande. L'ordine è casuale e locale.
            </span>
          </span>
        </label>
        <label className={styles.mode} data-selected={isVex}>
          <input
            type="radio"
            name="vex-distribution-mode"
            checked={isVex}
            onChange={() => onModeChange('equivalent_variants')}
          />
          <span className={styles.modeText}>
            <strong>Varianti equivalenti</strong>
            <span className={styles.modeDesc}>
              Domande comuni a tutti + una alternativa per ogni gruppo.
            </span>
          </span>
        </label>
      </div>

      <p className={styles.orderNote}>
        <IconRotateCcw size={16} aria-hidden="true" />
        <span>
          In entrambe le modalità l'ordine delle domande resta comunque casuale a ogni apertura:
          cambia solo la disposizione visiva, non le domande assegnate.
        </span>
      </p>

      {isVex && (
        <div aria-label="Configurazione varianti equivalenti">
          <div className={styles.summary}>
            <div className={styles.stat}>
              <div className={styles.statN}>{summary.commonCount}</div>
              <div className={styles.statL}>Domande comuni</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statN}>{summary.groupsCount}</div>
              <div className={styles.statL}>Gruppi equivalenti</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statN}>{summary.questionsPerStudent}</div>
              <div className={styles.statL}>Domande per studente</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statN}>
                {summary.variantsPossible.capped
                  ? `>${summary.variantsPossible.value}`
                  : summary.variantsPossible.value}
              </div>
              <div className={styles.statL}>Varianti possibili</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statN}>{summary.maxPoints}</div>
              <div className={styles.statL}>Punteggio massimo</div>
            </div>
          </div>

          {validation.blocking.map((msg, i) => (
            <p key={`b-${i}`} className={`${styles.note} ${styles.err}`} role="alert">
              <IconCircleX size={16} aria-hidden="true" />
              <span>{msg}</span>
            </p>
          ))}
          {globalWarnings.map((w, i) => (
            <p key={`w-${i}`} className={`${styles.note} ${styles.warn}`} role="status">
              <IconTriangleAlert size={16} aria-hidden="true" />
              <span>{w.message}</span>
            </p>
          ))}

          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <h4>Domande comuni</h4>
            </div>
            {commonIds.length === 0 ? (
              <p className={styles.empty}>Nessuna domanda comune: sono tutte in un gruppo.</p>
            ) : (
              commonIds.map((id) => {
                const r = byId.get(id);
                if (!r) return null;
                return (
                  <div key={id} className={styles.alt}>
                    <span className={styles.qid}>{r.questionLocalId}</span>
                    <span className={styles.altText}>{previewText(r)}</span>
                    <span className={styles.tags}>
                      <span className={styles.tag}>{tipoLabel(r.tipo)}</span>
                      <span className={styles.tag}>{r.udaDir}</span>
                      <span className={styles.tag}>
                        diff {r.difficolta} · {r.maxPoints} pt
                      </span>
                    </span>
                    {participation?.get(id) === 'differentiated_base' && (
                      <span className={`${styles.note} ${styles.warn}`}>
                        Non disponibile: la domanda ha varianti per etichetta.
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <h4>Gruppi equivalenti</h4>
              <button type="button" className={styles.btn} onClick={createGroup}>
                + Crea gruppo
              </button>
            </div>

            {/* VEX-02C — avviso permanente (non bloccante): la precompilazione è
                tecnica (UDA + tipologia + difficoltà), non una garanzia
                pedagogica. Nessun popup/toast/conferma. */}
            <p className={styles.assistNote} role="note">
              <IconInfo size={16} aria-hidden="true" />
              <span>
                I gruppi sono precompilati usando UDA, tipologia e difficoltà. Verifica sempre che
                le domande siano realmente equivalenti dal punto di vista didattico.
              </span>
            </p>

            {groups.length === 0 ? (
              <p className={styles.empty}>
                Nessun gruppo. Crea un gruppo e aggiungi due o più domande equivalenti per far
                scegliere al sistema una alternativa per studente.
              </p>
            ) : (
              groups.map((group, index) => {
                const alts = group.questionIndexEntryIds
                  .map((id) => byId.get(id))
                  .filter((r): r is VexBuilderQuestion => r !== undefined);
                const first = alts[0];
                const invalid = alts.some(
                  (r) =>
                    first !== undefined &&
                    (r.udaDir !== first.udaDir ||
                      r.tipo !== first.tipo ||
                      r.difficolta !== first.difficolta),
                );
                const available = commonIds
                  .filter((id) => !participation || participation.get(id) === 'common_free')
                  .map((id) => byId.get(id)!)
                  .filter(Boolean);
                const groupWarnings = warningByGroup.get(group.id) ?? [];
                return (
                  <div key={group.id} className={styles.group} data-invalid={invalid}>
                    <div className={styles.groupHead}>
                      <span className={styles.groupTitle}>
                        Gruppo {index + 1} — una domanda estratta
                      </span>
                      <span className={styles.tag}>{alts.length} alternative</span>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnDanger}`}
                          aria-label={`Elimina gruppo ${index + 1}`}
                          onClick={() => deleteGroup(group.id)}
                        >
                          Elimina gruppo
                        </button>
                      </div>
                    </div>

                    {alts.map((r) => (
                      <div key={r.questionIndexEntryId} className={styles.alt}>
                        <span className={styles.qid}>{r.questionLocalId}</span>
                        <span className={styles.altText}>{previewText(r)}</span>
                        <span className={styles.tags}>
                          <span className={styles.tag}>{tipoLabel(r.tipo)}</span>
                          <span className={styles.tag}>{r.udaDir}</span>
                          <span className={styles.tag}>
                            diff {r.difficolta} · {r.maxPoints} pt
                          </span>
                        </span>
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className={styles.btn}
                            aria-label={`Rimuovi la domanda ${r.questionLocalId} dal gruppo ${index + 1}`}
                            onClick={() => removeAlternative(group.id, r.questionIndexEntryId)}
                          >
                            Rimuovi
                          </button>
                        </div>
                      </div>
                    ))}

                    <div className={styles.addForm}>
                      <VexQuestionSelect
                        label={`Aggiungi alternativa al gruppo ${index + 1}`}
                        options={available}
                        onSelect={(entryId) => addAlternative(group.id, entryId)}
                      />
                    </div>

                    {invalid && (
                      <p className={`${styles.note} ${styles.err}`} role="alert">
                        <IconCircleX size={16} aria-hidden="true" />
                        <span>
                          Le alternative devono avere stessa UDA, stesso tipo e stessa difficoltà.
                        </span>
                      </p>
                    )}
                    {groupWarnings.map((w, i) => (
                      <p key={`gw-${i}`} className={`${styles.note} ${styles.warn}`} role="status">
                        <IconTriangleAlert size={16} aria-hidden="true" />
                        <span>{w.message}</span>
                      </p>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </section>
  );
}
