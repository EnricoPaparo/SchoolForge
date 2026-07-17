import { useEffect, useRef, useState } from 'react';
import { parsePool, serializePool, normalizeMaxCharacters } from '@schoolforge/lesson-contract';
import type { ParsedPool, PoolQuestion, PoolValidationError } from '@schoolforge/lesson-contract';
import type { LessonItem } from '../repository/programs/programsService.js';
import {
  deletePool,
  loadPool,
  savePool,
  PoolDeleteBlockedError,
  type PoolDeleteBlocker,
} from '../repository/pools/poolEditorService.js';
import { db, storage } from '../../lib/firebase.js';
import { IconPencil, IconPlus, IconTrash } from '../../components/icons.js';
import styles from './QuestionPoolEditor.module.css';

/**
 * Contextual question-pool editor for a single lesson. Originally extracted
 * from the legacy `DomandeView` (removed in DUX-04D); it is now the single
 * pool editor, mounted by the Didattica workspace's Domande tab — one editor,
 * services, validation and Markdown pool format.
 *
 * The parent must mount this component with a `key` that is unique per
 * lesson (e.g. `${programId}:${lesson.id}`) so a lesson change remounts it:
 * that is what invalidates the previous lesson's state and guarantees the
 * pool is read exactly once per lesson while it stays mounted. A stale
 * in-flight load can never write another lesson's panel — the effect's
 * cleanup flags itself cancelled, and the pool always belongs to the lesson
 * passed in props (never a different one).
 */

const POOL_TEMPLATE = `---
schema: schoolforge-pool/v1
questions: []
---
`;

const TIPO_LABELS: Record<string, string> = {
  aperta: 'Aperta',
  chiusa_singola: 'Chiusa (singola)',
  chiusa_multipla: 'Chiusa (multipla)',
};

export type PoolCountStatus = 'valid' | 'absent' | 'invalid';

export type QuestionPoolEditorProps = {
  programId: string;
  /** Null when the program has no active import — the lesson can have no pool. */
  importId: string | null;
  lesson: LessonItem;
  ownerUid: string;
  /** Called after a successful save/delete so the parent can update its own counters. */
  onPoolCountChange?: (questionCount: number, poolStatus: PoolCountStatus) => void;
  /** Reports whether there are unsaved edits, so the parent can guard navigation. */
  onDirtyChange?: (dirty: boolean) => void;
};

// ── Local draft type for the question editor form ─────────────────────────────

type QuestionDraft = {
  id: string;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  difficolta: '1' | '2' | '3';
  peso: '1' | '2' | '3';
  testo: string;
  /** Used only when tipo === 'aperta'. */
  soluzione: string;
  /**
   * EXAM-UX-03 — "Limite caratteri" per la sola domanda aperta. Stringa perché è
   * un input di testo: vuota = nessun limite esplicito (default 2000 a runtime).
   */
  maxCharacters: string;
  /** Used only when tipo !== 'aperta'. */
  opzioni: { id: string; testo: string }[];
  /** Selected option ids. For chiusa_singola at most one; chiusa_multipla any. */
  soluzioneIds: string[];
};

function optionIdFromIndex(index: number): string {
  return String.fromCharCode(97 + index);
}

function initDraft(q: PoolQuestion | null): QuestionDraft {
  if (!q) {
    return {
      id: '',
      tipo: 'aperta',
      difficolta: '1',
      peso: '1',
      testo: '',
      soluzione: '',
      maxCharacters: '',
      opzioni: [{ id: optionIdFromIndex(0), testo: '' }],
      soluzioneIds: [],
    };
  }
  const isChiusa = q.tipo === 'chiusa_singola' || q.tipo === 'chiusa_multipla';
  return {
    id: q.id,
    tipo: q.tipo,
    difficolta: String(q.difficolta) as '1' | '2' | '3',
    peso: String(q.peso) as '1' | '2' | '3',
    testo: q.testo,
    soluzione: q.tipo === 'aperta' ? q.soluzione : '',
    maxCharacters:
      q.tipo === 'aperta' && q.maxCharacters !== undefined ? String(q.maxCharacters) : '',
    opzioni: isChiusa ? q.opzioni.map((o) => ({ id: o.id, testo: o.testo })) : [],
    soluzioneIds: isChiusa ? (Array.isArray(q.soluzione) ? q.soluzione : [q.soluzione]) : [],
  };
}

/** Filters out blank option rows and resolves which of the remaining ones are selected as soluzione. */
function computeFilledOpzioni(d: QuestionDraft): {
  opzioni: { id: string; testo: string }[];
  selectedSolutionIds: string[];
} {
  const opzioni = d.opzioni
    .map((o, index) => ({ id: optionIdFromIndex(index), testo: o.testo.trim() }))
    .filter((o) => o.testo !== '');
  const optionIds = new Set(opzioni.map((o) => o.id));
  const selectedSolutionIds = d.soluzioneIds
    .map((id) => id.trim())
    .filter((id) => optionIds.has(id));
  return { opzioni, selectedSolutionIds };
}

/** Converts a draft to a raw object suitable for pool insertion (validated downstream). */
function draftToRaw(d: QuestionDraft): Record<string, unknown> {
  const base = {
    id: d.id.trim(),
    tipo: d.tipo,
    difficolta: Number(d.difficolta),
    peso: Number(d.peso),
    testo: d.testo,
  };
  if (d.tipo === 'aperta') {
    // Include maxCharacters only when a valid integer 1..10000 was entered;
    // empty/invalid ⇒ omit (field stays absent → default 2000 at runtime).
    const maxCharacters = normalizeMaxCharacters(d.maxCharacters);
    return maxCharacters === undefined
      ? { ...base, soluzione: d.soluzione }
      : { ...base, soluzione: d.soluzione, maxCharacters };
  }
  const { opzioni, selectedSolutionIds } = computeFilledOpzioni(d);
  const soluzione =
    d.tipo === 'chiusa_singola' ? [selectedSolutionIds[0] ?? ''] : selectedSolutionIds;
  return { ...base, opzioni, soluzione };
}

/**
 * UX-level checks run before the serializePool/parsePool round-trip, so the teacher gets a
 * specific, actionable message instead of a raw schema-validation error. parsePool remains the
 * final source of truth — these checks mirror a subset of its rules in plain language.
 */
function validateDraft(d: QuestionDraft): string | null {
  if (d.id.trim() === '') return 'Inserisci un ID domanda.';
  if (d.testo.trim() === '') return 'Inserisci il testo della domanda.';

  if (d.tipo === 'aperta') {
    if (d.soluzione.trim() === '') return 'Inserisci la soluzione.';
    if (d.maxCharacters.trim() !== '' && normalizeMaxCharacters(d.maxCharacters) === undefined) {
      return 'Il limite caratteri deve essere un intero tra 1 e 10000.';
    }
    return null;
  }

  const { opzioni, selectedSolutionIds } = computeFilledOpzioni(d);
  if (opzioni.length < 2) return 'Inserisci almeno due risposte.';
  if (selectedSolutionIds.length === 0) return 'Seleziona almeno una risposta corretta.';
  if (d.tipo === 'chiusa_multipla' && selectedSolutionIds.length === opzioni.length) {
    return 'Lascia almeno una risposta non corretta.';
  }
  return null;
}

// ── Shared state types ─────────────────────────────────────────────────────────

type PoolState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'absent' }
  | { status: 'valid'; pool: ParsedPool }
  | { status: 'invalid'; errors: PoolValidationError[]; rawContent: string }
  | { status: 'error'; message: string };

// ── Sub-components ─────────────────────────────────────────────────────────────

function QuestionCard({
  q,
  index,
  onEdit,
  onDeleteRequest,
  deleteConfirm,
  deleting,
  deleteError,
  onDeleteConfirm,
  onDeleteCancel,
  disabled,
}: {
  q: PoolQuestion;
  index: number;
  onEdit: () => void;
  onDeleteRequest: () => void;
  deleteConfirm: boolean;
  deleting: boolean;
  deleteError: string | null;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  disabled: boolean;
}) {
  const hasOpzioni = q.tipo === 'chiusa_singola' || q.tipo === 'chiusa_multipla';
  const soluzioneDisplay =
    q.tipo === 'aperta'
      ? q.soluzione
      : Array.isArray(q.soluzione)
        ? q.soluzione.join(', ')
        : q.soluzione;

  return (
    <div className={styles.questionCard}>
      <div className={styles.questionHeader}>
        <span className={styles.questionNumber}>#{index + 1}</span>
        <span className={styles.questionId}>{q.id}</span>
        <span className={styles.questionTipo}>{TIPO_LABELS[q.tipo] ?? q.tipo}</span>
        <span className={styles.questionMeta}>
          Diff:&nbsp;{q.difficolta} · Peso:&nbsp;{q.peso} · Max:&nbsp;{q.maxPoints}&nbsp;pt
        </span>
        <div className={styles.questionCardActions}>
          <button
            type="button"
            className={styles.iconBtn}
            title="Modifica domanda"
            aria-label={`Modifica domanda ${q.id}`}
            onClick={onEdit}
            disabled={disabled}
          >
            <IconPencil size={12} />
          </button>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
            title="Elimina domanda"
            aria-label={`Elimina domanda ${q.id}`}
            onClick={onDeleteRequest}
            disabled={disabled || deleting}
          >
            <IconTrash size={12} />
          </button>
        </div>
      </div>

      <p className={styles.questionTesto}>{q.testo}</p>

      {hasOpzioni && (
        <ul className={styles.opzioniList}>
          {q.opzioni.map((o) => {
            const isSol = Array.isArray(q.soluzione)
              ? q.soluzione.includes(o.id)
              : q.soluzione === o.id;
            return (
              <li key={o.id} className={isSol ? styles.opzioneCorretta : undefined}>
                <span className={styles.opzioneId}>[{o.id}]</span> {o.testo}
              </li>
            );
          })}
        </ul>
      )}

      {soluzioneDisplay && (
        <div className={styles.soluzioneBlock}>
          <span className={styles.soluzioneLabel}>Soluzione:</span> {soluzioneDisplay}
        </div>
      )}

      {deleteConfirm && (
        <div className={styles.deleteConfirmInline} role="alert">
          <span className={styles.deleteConfirmMsg}>Eliminare questa domanda?</span>
          <div className={styles.deleteConfirmActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSm} btn-danger`}
              onClick={onDeleteConfirm}
              disabled={deleting}
            >
              {deleting ? 'Eliminazione…' : 'Elimina'}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSm}`}
              onClick={onDeleteCancel}
              disabled={deleting}
            >
              Annulla
            </button>
          </div>
          {deleteError && <p className={styles.errorMsg}>{deleteError}</p>}
        </div>
      )}
    </div>
  );
}

function QuestionEditorForm({
  initial,
  existingIds,
  onSave,
  onCancel,
  saving,
  error,
}: {
  initial: PoolQuestion | null;
  existingIds: string[];
  onSave: (draft: QuestionDraft) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const [draft, setDraft] = useState<QuestionDraft>(() => initDraft(initial));

  function setField<K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function handleTipoChange(tipo: QuestionDraft['tipo']) {
    setDraft((prev) => ({
      ...prev,
      tipo,
      // Ensure at least one opzione when switching to a chiusa type
      opzioni:
        (tipo === 'chiusa_singola' || tipo === 'chiusa_multipla') && prev.opzioni.length === 0
          ? [{ id: optionIdFromIndex(0), testo: '' }]
          : prev.opzioni,
      // Reset soluzione selections — they may no longer match the new type's constraints
      soluzioneIds: [],
    }));
  }

  function addOpzione() {
    setDraft((prev) => {
      const nextId = optionIdFromIndex(prev.opzioni.length);
      return { ...prev, opzioni: [...prev.opzioni, { id: nextId, testo: '' }] };
    });
  }

  function removeOpzione(index: number) {
    setDraft((prev) => {
      const nextOpzioni = prev.opzioni.filter((_, i) => i !== index);
      const nextSoluzioneIds = nextOpzioni
        .map((option, nextIndex) => ({
          oldId: option.id,
          newId: optionIdFromIndex(nextIndex),
        }))
        .filter((option) => prev.soluzioneIds.includes(option.oldId))
        .map((option) => option.newId);
      return {
        ...prev,
        opzioni: nextOpzioni.map((option, nextIndex) => ({
          ...option,
          id: optionIdFromIndex(nextIndex),
        })),
        soluzioneIds: nextSoluzioneIds,
      };
    });
  }

  function updateOpzioneText(index: number, value: string) {
    setDraft((prev) => {
      const newOpzioni = prev.opzioni.map((o, i) => (i === index ? { ...o, testo: value } : o));
      return { ...prev, opzioni: newOpzioni };
    });
  }

  function toggleSoluzione(optId: string) {
    setDraft((prev) => {
      if (prev.tipo === 'chiusa_singola') {
        return { ...prev, soluzioneIds: [optId] };
      }
      // chiusa_multipla — toggle
      const has = prev.soluzioneIds.includes(optId);
      return {
        ...prev,
        soluzioneIds: has
          ? prev.soluzioneIds.filter((id) => id !== optId)
          : [...prev.soluzioneIds, optId],
      };
    });
  }

  const isChiusa = draft.tipo === 'chiusa_singola' || draft.tipo === 'chiusa_multipla';
  const isNew = initial === null;

  return (
    <div className={styles.questionFormCard}>
      <h3 className={styles.questionFormTitle}>
        {isNew ? 'Nuova domanda' : `Modifica domanda — ${initial.id}`}
      </h3>

      <p className={styles.formInfoNote}>
        Le modifiche ai pool valgono per le verifiche create da ora in poi. Le verifiche già
        attivate usano uno snapshot.
      </p>

      <div className={styles.questionForm}>
        {/* Row: id + tipo */}
        <div className={styles.formRow}>
          <label className={styles.formLabel}>
            ID
            <input
              className={styles.formInput}
              type="text"
              value={draft.id}
              onChange={(e) => setField('id', e.target.value)}
              placeholder="es. q1"
              disabled={!isNew} // id is immutable when editing
              aria-label="ID domanda"
            />
          </label>

          <label className={styles.formLabel}>
            Tipo
            <select
              className={styles.formSelect}
              value={draft.tipo}
              onChange={(e) => handleTipoChange(e.target.value as QuestionDraft['tipo'])}
              aria-label="Tipo domanda"
            >
              <option value="aperta">Aperta</option>
              <option value="chiusa_singola">Chiusa (singola)</option>
              <option value="chiusa_multipla">Chiusa (multipla)</option>
            </select>
          </label>

          <label className={styles.formLabel}>
            Difficoltà
            <select
              className={styles.formSelect}
              value={draft.difficolta}
              onChange={(e) =>
                setField('difficolta', e.target.value as QuestionDraft['difficolta'])
              }
              aria-label="Difficoltà"
            >
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>

          <label className={styles.formLabel}>
            Peso
            <select
              className={styles.formSelect}
              value={draft.peso}
              onChange={(e) => setField('peso', e.target.value as QuestionDraft['peso'])}
              aria-label="Peso"
            >
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
        </div>

        {/* Testo */}
        <label className={styles.formLabelBlock}>
          Testo
          <textarea
            className={styles.formTextarea}
            value={draft.testo}
            onChange={(e) => setField('testo', e.target.value)}
            rows={3}
            aria-label="Testo domanda"
          />
        </label>

        {/* Soluzione — aperta */}
        {draft.tipo === 'aperta' && (
          <label className={styles.formLabelBlock}>
            Soluzione
            <textarea
              className={styles.formTextarea}
              value={draft.soluzione}
              onChange={(e) => setField('soluzione', e.target.value)}
              rows={2}
              aria-label="Soluzione"
            />
          </label>
        )}

        {/* EXAM-UX-03 — limite caratteri risposta (solo aperta) */}
        {draft.tipo === 'aperta' && (
          <label className={styles.formLabelBlock}>
            Limite caratteri
            <input
              type="number"
              className={styles.formInput}
              value={draft.maxCharacters}
              onChange={(e) => setField('maxCharacters', e.target.value)}
              min={1}
              max={10000}
              step={1}
              placeholder="2000"
              aria-label="Limite caratteri"
              aria-describedby="maxCharactersHelp"
            />
            <span id="maxCharactersHelp" className={styles.formHint}>
              Se vuoto, verrà applicato il limite predefinito di 2000 caratteri.
            </span>
          </label>
        )}

        {/* Opzioni + soluzione — chiuse */}
        {isChiusa && (
          <div className={styles.opzioniSection}>
            <div className={styles.opzioniHeader}>
              <span className={styles.formLabel}>
                Opzioni
                {draft.tipo === 'chiusa_singola' && (
                  <span className={styles.formHint}> — seleziona la risposta corretta</span>
                )}
                {draft.tipo === 'chiusa_multipla' && (
                  <span className={styles.formHint}> — seleziona una o più risposte corrette</span>
                )}
              </span>
            </div>

            {draft.opzioni.map((o, i) => {
              const optionId = optionIdFromIndex(i);
              return (
                <div key={i} className={styles.opzioneRow}>
                  {/* Soluzione selector */}
                  {draft.tipo === 'chiusa_singola' ? (
                    <input
                      type="radio"
                      name={`sol-${initial?.id ?? 'new'}`}
                      checked={draft.soluzioneIds[0] === optionId}
                      onChange={() => toggleSoluzione(optionId)}
                      aria-label={`Seleziona come risposta corretta ${optionId}`}
                      className={styles.opzioneRadio}
                    />
                  ) : (
                    <input
                      type="checkbox"
                      checked={draft.soluzioneIds.includes(optionId)}
                      onChange={() => toggleSoluzione(optionId)}
                      aria-label={`Seleziona come risposta corretta ${optionId}`}
                      className={styles.opzioneCheckbox}
                    />
                  )}

                  <span className={styles.opzioneLetter} aria-hidden="true">
                    {optionId.toUpperCase()}
                  </span>
                  <input
                    type="text"
                    className={`${styles.formInput} ${styles.opzioneTestoInput}`}
                    value={o.testo}
                    onChange={(e) => updateOpzioneText(i, e.target.value)}
                    placeholder={`Risposta ${optionId.toUpperCase()}`}
                    aria-label={`Risposta ${optionId.toUpperCase()}`}
                  />
                  <button
                    type="button"
                    className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                    onClick={() => removeOpzione(i)}
                    aria-label={`Rimuovi risposta ${optionId}`}
                    disabled={draft.opzioni.length <= 1}
                  >
                    <IconTrash size={11} />
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
              onClick={addOpzione}
            >
              <IconPlus size={11} /> Aggiungi opzione
            </button>
          </div>
        )}

        {error && <p className={styles.errorMsg}>{error}</p>}

        <div className={styles.formActions}>
          <button
            type="button"
            className={`${styles.btn} btn-success`}
            onClick={() => onSave(draft)}
            disabled={saving}
          >
            {saving ? 'Salvataggio…' : 'Salva domanda'}
          </button>
          <button type="button" className={styles.btn} onClick={onCancel} disabled={saving}>
            Annulla
          </button>
        </div>

        {/* Notify about duplicates when editing existing id collision */}
        {!isNew && existingIds.filter((id) => id === draft.id).length > 1 && (
          <p className={styles.errorMsg}>ID duplicato nel pool.</p>
        )}
      </div>
    </div>
  );
}

// ── Main editor ──────────────────────────────────────────────────────────────

export function QuestionPoolEditor({
  programId,
  importId,
  lesson,
  ownerUid,
  onPoolCountChange,
  onDirtyChange,
}: QuestionPoolEditorProps) {
  const [poolState, setPoolState] = useState<PoolState>({ status: 'idle' });
  const [reloadNonce, setReloadNonce] = useState(0);

  // YAML editor
  const [editorOpen, setEditorOpen] = useState(false);
  const [yamlDraft, setYamlDraft] = useState('');
  const [yamlBaseline, setYamlBaseline] = useState('');
  const [yamlParseErrors, setYamlParseErrors] = useState<PoolValidationError[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Pool-level delete flow
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBlockers, setDeleteBlockers] = useState<PoolDeleteBlocker[] | null>(null);

  // Question editor: 'new' = creating; an id = editing; null = closed
  const [editingQuestionId, setEditingQuestionId] = useState<string | 'new' | null>(null);
  const [questionSaving, setQuestionSaving] = useState(false);
  const [questionSaveError, setQuestionSaveError] = useState<string | null>(null);

  // Per-question delete confirmation
  const [deleteConfirmQuestionId, setDeleteConfirmQuestionId] = useState<string | null>(null);
  const [deletingQuestionId, setDeletingQuestionId] = useState<string | null>(null);
  const [questionDeleteError, setQuestionDeleteError] = useState<string | null>(null);

  const onPoolCountChangeRef = useRef(onPoolCountChange);
  onPoolCountChangeRef.current = onPoolCountChange;

  // ── Load the pool once (per lesson mount / explicit reload) ──────────────
  useEffect(() => {
    let cancelled = false;
    setPoolState({ status: 'loading' });
    setEditorOpen(false);
    setEditingQuestionId(null);
    setDeleteConfirm(false);
    setDeleteBlockers(null);

    async function run() {
      if (!importId) {
        if (cancelled) return;
        setPoolState({ status: 'absent' });
        setYamlDraft(POOL_TEMPLATE);
        setYamlBaseline(POOL_TEMPLATE);
        return;
      }
      try {
        const result = await loadPool({ programId, importId, lessonId: lesson.id, db, storage });
        if (cancelled) return;
        if (result.status === 'valid') {
          const serialized = serializePool(result.pool);
          setPoolState({ status: 'valid', pool: result.pool });
          setYamlDraft(serialized);
          setYamlBaseline(serialized);
        } else if (result.status === 'invalid') {
          setPoolState({ status: 'invalid', errors: result.errors, rawContent: result.rawContent });
          setYamlDraft(result.rawContent);
          setYamlBaseline(result.rawContent);
        } else {
          setPoolState({ status: 'absent' });
          setYamlDraft(POOL_TEMPLATE);
          setYamlBaseline(POOL_TEMPLATE);
        }
      } catch (err) {
        if (cancelled) return;
        setPoolState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Errore caricamento pool.',
        });
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [programId, importId, lesson.id, reloadNonce]);

  // ── Dirty reporting ──────────────────────────────────────────────────────
  const dirty = editingQuestionId !== null || (editorOpen && yamlDraft !== yamlBaseline);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // Ensure a stale "dirty" is cleared if the editor unmounts (lesson change).
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  function openEditor() {
    setYamlParseErrors([]);
    setSaveError(null);
    if (poolState.status === 'valid') {
      const serialized = serializePool(poolState.pool);
      setYamlDraft(serialized);
      setYamlBaseline(serialized);
    }
    setEditorOpen(true);
  }

  /** Applies a saved pool to local state and notifies the parent of the new count. */
  function applyPoolUpdate(newPool: ParsedPool) {
    const serialized = serializePool(newPool);
    setPoolState({ status: 'valid', pool: newPool });
    setYamlDraft(serialized);
    setYamlBaseline(serialized);
    onPoolCountChangeRef.current?.(newPool.questions.length, 'valid');
  }

  async function handleSaveYaml() {
    if (!importId) return;
    setYamlParseErrors([]);
    setSaveError(null);

    const parseResult = parsePool(yamlDraft, lesson.filename);
    if (!parseResult.ok) {
      setYamlParseErrors(parseResult.errors);
      return;
    }
    setSaving(true);
    try {
      await savePool({
        programId,
        importId,
        lessonId: lesson.id,
        pool: parseResult.pool,
        ownerUid,
        db,
        storage,
      });
      applyPoolUpdate(parseResult.pool);
      setEditorOpen(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Errore durante il salvataggio.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePool() {
    if (!importId) return;
    setDeleting(true);
    setDeleteError(null);
    setDeleteBlockers(null);
    try {
      await deletePool({ programId, importId, lessonId: lesson.id, ownerUid, db, storage });
      setPoolState({ status: 'absent' });
      setYamlDraft(POOL_TEMPLATE);
      setYamlBaseline(POOL_TEMPLATE);
      setDeleteConfirm(false);
      setEditorOpen(false);
      onPoolCountChangeRef.current?.(0, 'absent');
    } catch (err) {
      if (err instanceof PoolDeleteBlockedError) {
        setDeleteBlockers(err.blockers);
        setDeleteConfirm(false);
      } else {
        setDeleteError(err instanceof Error ? err.message : "Errore durante l'eliminazione.");
      }
    } finally {
      setDeleting(false);
    }
  }

  async function handleSaveQuestion(draft: QuestionDraft) {
    if (!importId || poolState.status !== 'valid') return;

    const uxError = validateDraft(draft);
    if (uxError) {
      setQuestionSaveError(uxError);
      return;
    }

    const existing = poolState.pool.questions;
    const raw = draftToRaw(draft);

    let newQuestions: unknown[];
    if (editingQuestionId === 'new') {
      if (existing.some((q) => q.id === raw['id'])) {
        setQuestionSaveError(`ID "${String(raw['id'])}" già presente nel pool.`);
        return;
      }
      newQuestions = [...existing, raw];
    } else {
      newQuestions = existing.map((q) => (q.id === editingQuestionId ? raw : q));
    }

    const candidatePool = { schema: poolState.pool.schema, questions: newQuestions };
    const serialized = serializePool(candidatePool as ParsedPool);
    const parseResult = parsePool(serialized, lesson.filename);
    if (!parseResult.ok) {
      setQuestionSaveError(
        parseResult.errors
          .map((e) => `${e.questionId ? `[${e.questionId}] ` : ''}${e.field}: ${e.message}`)
          .join(' | '),
      );
      return;
    }

    setQuestionSaving(true);
    setQuestionSaveError(null);
    try {
      await savePool({
        programId,
        importId,
        lessonId: lesson.id,
        pool: parseResult.pool,
        ownerUid,
        db,
        storage,
      });
      applyPoolUpdate(parseResult.pool);
      setEditingQuestionId(null);
    } catch (err) {
      setQuestionSaveError(err instanceof Error ? err.message : 'Errore durante il salvataggio.');
    } finally {
      setQuestionSaving(false);
    }
  }

  async function handleDeleteQuestion(questionId: string) {
    if (!importId || poolState.status !== 'valid') return;

    const newQuestions = poolState.pool.questions.filter((q) => q.id !== questionId);
    const candidatePool: ParsedPool = { schema: poolState.pool.schema, questions: newQuestions };

    setDeletingQuestionId(questionId);
    setQuestionDeleteError(null);
    try {
      await savePool({
        programId,
        importId,
        lessonId: lesson.id,
        pool: candidatePool,
        ownerUid,
        db,
        storage,
      });
      applyPoolUpdate(candidatePool);
      setDeleteConfirmQuestionId(null);
    } catch (err) {
      setQuestionDeleteError(err instanceof Error ? err.message : "Errore durante l'eliminazione.");
    } finally {
      setDeletingQuestionId(null);
    }
  }

  const anyQuestionEditorOpen = editingQuestionId !== null;

  // ── Render ────────────────────────────────────────────────────────────────
  if (poolState.status === 'idle' || poolState.status === 'loading') {
    return (
      <p aria-busy="true" className={styles.mutedMsg}>
        Caricamento pool…
      </p>
    );
  }

  if (poolState.status === 'error') {
    return (
      <div className={styles.absentState} role="alert">
        <p className={styles.errorMsg}>{poolState.message}</p>
        <button
          type="button"
          className={`${styles.btn} btn-primary`}
          onClick={() => setReloadNonce((n) => n + 1)}
        >
          Riprova
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Pool absent */}
      {poolState.status === 'absent' && !editorOpen && (
        <div className={styles.absentState}>
          <p>Nessun pool di domande per questa lezione.</p>
          <button
            type="button"
            className={`${styles.btn} btn-success`}
            onClick={openEditor}
            disabled={!importId}
          >
            Crea pool
          </button>
        </div>
      )}

      {/* Pool invalid */}
      {poolState.status === 'invalid' && !editorOpen && (
        <div className={styles.invalidState}>
          <p className={styles.invalidTitle}>Il pool contiene errori di validazione:</p>
          <ul className={styles.errorList}>
            {poolState.errors.map((e, i) => (
              <li key={i}>
                {e.questionId ? `[${e.questionId}] ` : ''}
                {e.field}: {e.message}
              </li>
            ))}
          </ul>
          <button type="button" className={`${styles.btn} btn-primary`} onClick={openEditor}>
            Modifica YAML
          </button>
        </div>
      )}

      {/* Pool valid — question list */}
      {poolState.status === 'valid' && !editorOpen && (
        <div className={styles.questionList}>
          <div className={styles.poolMeta}>
            <span className={styles.poolCount}>{poolState.pool.questions.length} domande</span>
            <div className={styles.poolMetaActions}>
              {!anyQuestionEditorOpen && (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSm} btn-primary`}
                  onClick={() => {
                    setEditingQuestionId('new');
                    setQuestionSaveError(null);
                  }}
                >
                  <IconPlus size={12} /> Nuova domanda
                </button>
              )}
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={openEditor}
                disabled={anyQuestionEditorOpen}
              >
                Modifica YAML
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.iconBtnDanger}`}
                onClick={() => {
                  setDeleteConfirm(true);
                  setDeleteError(null);
                  setDeleteBlockers(null);
                }}
                disabled={anyQuestionEditorOpen}
              >
                Elimina pool
              </button>
            </div>
          </div>

          {/* Pool-level delete confirmation */}
          {deleteConfirm && (
            <div className={styles.deleteConfirmBox} role="alert">
              <p className={styles.deleteConfirmMsg}>
                Eliminare il pool di domande di questa lezione? L&apos;operazione non è reversibile.
              </p>
              <div className={styles.deleteConfirmActions}>
                <button
                  type="button"
                  className={`${styles.btn} btn-danger`}
                  onClick={() => void handleDeletePool()}
                  disabled={deleting}
                >
                  {deleting ? 'Eliminazione…' : 'Elimina'}
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => setDeleteConfirm(false)}
                  disabled={deleting}
                >
                  Annulla
                </button>
              </div>
              {deleteError && <p className={styles.errorMsg}>{deleteError}</p>}
            </div>
          )}

          {deleteBlockers && (
            <div className={styles.blockersBox} role="alert">
              <p className={styles.deleteConfirmMsg}>
                Impossibile eliminare il pool: le seguenti bozze di verifica lo utilizzano:
              </p>
              <ul className={styles.blockersList}>
                {deleteBlockers.map((b) => (
                  <li key={b.verificationId}>{b.title}</li>
                ))}
              </ul>
              <button type="button" className={styles.btn} onClick={() => setDeleteBlockers(null)}>
                Chiudi
              </button>
            </div>
          )}

          {/* New question form at top */}
          {editingQuestionId === 'new' && (
            <QuestionEditorForm
              initial={null}
              existingIds={poolState.pool.questions.map((q) => q.id)}
              onSave={(draft) => void handleSaveQuestion(draft)}
              onCancel={() => {
                setEditingQuestionId(null);
                setQuestionSaveError(null);
              }}
              saving={questionSaving}
              error={questionSaveError}
            />
          )}

          {poolState.pool.questions.map((q, i) => {
            if (editingQuestionId === q.id) {
              return (
                <QuestionEditorForm
                  key={q.id}
                  initial={q}
                  existingIds={poolState.pool.questions.map((qq) => qq.id)}
                  onSave={(draft) => void handleSaveQuestion(draft)}
                  onCancel={() => {
                    setEditingQuestionId(null);
                    setQuestionSaveError(null);
                  }}
                  saving={questionSaving}
                  error={questionSaveError}
                />
              );
            }
            return (
              <QuestionCard
                key={q.id}
                q={q}
                index={i}
                onEdit={() => {
                  setEditingQuestionId(q.id);
                  setQuestionSaveError(null);
                  setDeleteConfirmQuestionId(null);
                }}
                onDeleteRequest={() => {
                  setDeleteConfirmQuestionId(q.id);
                  setQuestionDeleteError(null);
                }}
                deleteConfirm={deleteConfirmQuestionId === q.id}
                deleting={deletingQuestionId === q.id}
                deleteError={deleteConfirmQuestionId === q.id ? questionDeleteError : null}
                onDeleteConfirm={() => void handleDeleteQuestion(q.id)}
                onDeleteCancel={() => setDeleteConfirmQuestionId(null)}
                disabled={anyQuestionEditorOpen}
              />
            );
          })}

          {poolState.pool.questions.length === 0 && editingQuestionId !== 'new' && (
            <p className={styles.mutedMsg}>Il pool non contiene ancora domande.</p>
          )}
        </div>
      )}

      {/* YAML editor */}
      {editorOpen && (
        <div className={styles.yamlEditor}>
          <p className={styles.yamlHint}>
            Modifica il file YAML del pool. Il contenuto verrà validato prima del salvataggio.
          </p>
          <textarea
            className={styles.yamlTextarea}
            value={yamlDraft}
            onChange={(e) => setYamlDraft(e.target.value)}
            rows={20}
            spellCheck={false}
            aria-label="YAML del pool"
          />
          {yamlParseErrors.length > 0 && (
            <ul className={styles.errorList} role="alert">
              {yamlParseErrors.map((e, i) => (
                <li key={i}>
                  {e.questionId ? `[${e.questionId}] ` : ''}
                  {e.field}: {e.message}
                </li>
              ))}
            </ul>
          )}
          {saveError && <p className={styles.errorMsg}>{saveError}</p>}
          <div className={styles.yamlActions}>
            <button
              type="button"
              className={`${styles.btn} btn-success`}
              onClick={() => void handleSaveYaml()}
              disabled={saving}
            >
              {saving ? 'Salvataggio…' : 'Salva'}
            </button>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                setEditorOpen(false);
                setYamlDraft(yamlBaseline);
                setYamlParseErrors([]);
                setSaveError(null);
              }}
              disabled={saving}
            >
              Annulla
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
