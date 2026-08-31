import { useEffect, useMemo, useRef, useState } from 'react';
import type { LessonMetadata } from '../repository/validation/types.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { functions } from '../../lib/firebase.js';
import { IconSparkles } from '../../components/icons.js';
import {
  createAiLessonCallables,
  type LessonUdaContext,
  type PoolModelProfile,
} from '../repository/pools/aiContentClient.js';
import { AiLessonGenerationDialog } from './AiLessonGenerationDialog.js';
import {
  AiCompleteLessonGenerationDialog,
  type CompleteLessonCompletionSummary,
  type CompleteLessonProgress as CompleteLessonDialogProgress,
} from './AiCompleteLessonGenerationDialog.js';
import { createMultiVisualClient } from '../repository/programs/multiVisualClient.js';
import {
  createCompleteLessonGenerationState,
  runCompleteLessonGeneration,
  type CompleteLessonGenerationState,
  type CompleteLessonProgress as CompleteLessonCoreProgress,
} from '../repository/programs/completeLessonGeneration.js';
import styles from './lessonEditors.module.css';

/**
 * AIGEN-03 — metadati di contesto della lezione (già in memoria) usati dal dialog
 * «Genera con IA». Il corpo attuale (`currentBody`) è fornito dall'editor stesso
 * (il draft corrente), non da qui: nessuna nuova lettura Storage/Firestore.
 */
export interface LessonAiButtonContext {
  titolo?: string | null;
  sottotitolo?: string | null;
  difficolta?: string | null;
  udaTitle?: string | null;
  concettiChiave?: string[];
  obiettivi?: string[];
  /** AIGEN-CONTEXT-01: indice compatto dell'UDA (dall'albero già in memoria). */
  udaContext?: LessonUdaContext | null;
  defaultModelProfile?: PoolModelProfile;
}

export interface CompleteLessonEditorContext {
  identity: { programId: string; importId: string; lessonId: string };
  existingVisualCount: number;
  /** Persistenza canonica awaitable: aggiorna il corpo senza smontare l'editor. */
  onPersistBody: (body: string) => Promise<void>;
  /** Rilegge il manifest autorevole dopo le promozioni concluse. */
  onRefreshVisuals: () => Promise<void>;
  /** Chiamato quando il docente chiude un riepilogo già applicato. */
  onFinished: () => void;
}

/**
 * Shared lesson editors for the Didattica workspace (DUX-04B): a Markdown
 * body editor with preview and a lesson-metadata form. Presentational and
 * self-contained (they own their draft, report `dirty`, and delegate the
 * actual save to the parent via `onSave`), so the workspace and any future
 * caller reuse the exact same UI over the single `repositoryEditorService`
 * implementation — no service logic is duplicated here.
 */

export type EditStatus = { busy: boolean; error: string | null; saved: boolean };

export function linesToArray(value: string): string[] {
  return value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function StatusLine({ status, dirty }: { status: EditStatus; dirty: boolean }) {
  if (status.busy)
    return (
      <span aria-busy="true" className={styles.statusMuted}>
        Salvataggio…
      </span>
    );
  if (status.error)
    return (
      <span role="alert" className="text-error">
        {status.error}
      </span>
    );
  if (dirty) return <span className={styles.statusMuted}>Modifiche non salvate</span>;
  if (status.saved) return <span className={styles.statusSaved}>Salvato</span>;
  return null;
}

// ── Markdown body editor (Contenuto) ─────────────────────────────────────────

export function MarkdownBodyEditor({
  initial,
  status,
  onSave,
  onCancel,
  onDirtyChange,
  lessonAi,
  completeLesson,
}: {
  initial: string;
  status: EditStatus;
  onSave: (body: string) => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
  /** AIGEN-03 — abilita «Genera con IA» (solo in modifica corpo Markdown). */
  lessonAi?: LessonAiButtonContext;
  completeLesson?: CompleteLessonEditorContext;
}) {
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState<'editor' | 'preview'>('editor');
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [completeApplied, setCompleteApplied] = useState(false);
  const completeStateRef = useRef<CompleteLessonGenerationState | null>(null);
  const dirty = draft !== initial;
  const aiCallables = useMemo(() => createAiLessonCallables(functions), []);

  function adaptProgress(
    progress: CompleteLessonCoreProgress,
    onProgress: (progress: CompleteLessonDialogProgress) => void,
  ) {
    switch (progress.phase) {
      case 'saving_body':
        onProgress({ stage: 'content', label: progress.message });
        break;
      case 'planning_images':
        onProgress({ stage: 'analysis', label: progress.message });
        break;
      case 'generating_image':
      case 'promoting_image':
        onProgress({
          stage: 'images',
          current: progress.current,
          total: progress.total,
          label: progress.message,
        });
        break;
      case 'completed':
      case 'partial_failure':
        onProgress({ stage: 'finalizing', label: progress.message });
        break;
    }
  }

  async function runCompleteDraft(
    body: string,
    onProgress: (progress: CompleteLessonDialogProgress) => void,
  ): Promise<CompleteLessonCompletionSummary> {
    if (!lessonAi || !completeLesson) throw new Error('complete_lesson_unavailable');
    if (!completeStateRef.current) {
      completeStateRef.current = createCompleteLessonGenerationState({
        identity: completeLesson.identity,
        body,
        visualContext: {
          titolo: lessonAi.titolo,
          sottotitolo: lessonAi.sottotitolo,
          difficolta: lessonAi.difficolta,
          concettiChiave: lessonAi.concettiChiave ?? [],
          obiettivi: lessonAi.obiettivi ?? [],
          udaTitle: lessonAi.udaTitle,
          udaContext: lessonAi.udaContext,
        },
        contentRequestId: crypto.randomUUID(),
      });
    }
    const client = createMultiVisualClient(functions);
    const result = await runCompleteLessonGeneration(
      completeStateRef.current,
      {
        persistBody: ({ body: canonicalBody }) => completeLesson.onPersistBody(canonicalBody),
        authorizeVisualPlan: (input) => client.authorize(input),
        generateVisualSlot: (input) => client.generateSlot(input),
        promoteVisualSlot: (input) => client.promoteSlot(input),
      },
      {
        onProgress: (progress) => adaptProgress(progress, onProgress),
        onStateChange: (state) => {
          completeStateRef.current = state;
        },
      },
    );
    completeStateRef.current = result.state;
    const plan = result.state.plan;
    if (!plan) {
      // Persist/authorize possono essere ritentati dalla stessa callback: lo state
      // conserva il corpo già scritto e non richiama mai il generatore testuale.
      throw new Error('complete_lesson_plan_unavailable');
    }
    const imagesApplied = plan.slots.filter((slot) => Boolean(slot.promotedAssetId)).length;
    const imagesSkipped = plan.slots.filter(
      (slot) => slot.decision !== 'image' || slot.state === 'abandoned',
    ).length;
    const imagesFailed = plan.slots.filter(
      (slot) => slot.decision === 'image' && !slot.promotedAssetId && slot.state !== 'abandoned',
    ).length;
    const actualCosts = [
      plan.settlement.proposalActualCost,
      ...plan.settlement.slots.map((slot) => slot.actualCost),
    ];
    const actualCostMicroUsd = actualCosts.some((cost) => cost === null)
      ? null
      : actualCosts.reduce<number>((total, cost) => total + (cost ?? 0), 0);
    if (imagesApplied > 0) await completeLesson.onRefreshVisuals();
    setCompleteApplied(true);

    const canRetry =
      !result.ok && imagesFailed > 0 && !result.failures.some((failure) => failure.terminal);
    return {
      imagesApplied,
      imagesSkipped,
      imagesFailed,
      actualCostMicroUsd,
      message: result.ok
        ? undefined
        : 'Il contenuto è salvo; puoi ritentare solo le immagini mancanti.',
      ...(canRetry
        ? {
            retry: (nextProgress: (progress: CompleteLessonDialogProgress) => void) =>
              runCompleteDraft(body, nextProgress),
          }
        : {}),
    };
  }

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  return (
    <div className={styles.editor} role="group" aria-label="Modifica contenuto">
      {aiDialogOpen && lessonAi && (
        <AiLessonGenerationDialog
          context={{
            titolo: lessonAi.titolo ?? null,
            sottotitolo: lessonAi.sottotitolo ?? null,
            difficolta: lessonAi.difficolta ?? null,
            udaTitle: lessonAi.udaTitle ?? null,
            udaContext: lessonAi.udaContext ?? null,
            concettiChiave: lessonAi.concettiChiave ?? [],
            obiettivi: lessonAi.obiettivi ?? [],
            // Il corpo attuale è il draft locale corrente (contesto per il modello).
            currentBody: draft,
          }}
          callables={aiCallables}
          {...(lessonAi.defaultModelProfile
            ? { defaultModelProfile: lessonAi.defaultModelProfile }
            : {})}
          onUseDraft={(body) => setDraft(body)}
          onClose={() => setAiDialogOpen(false)}
        />
      )}
      {completeDialogOpen && lessonAi && completeLesson && (
        <AiCompleteLessonGenerationDialog
          context={{
            titolo: lessonAi.titolo ?? null,
            sottotitolo: lessonAi.sottotitolo ?? null,
            difficolta: lessonAi.difficolta ?? null,
            udaTitle: lessonAi.udaTitle ?? null,
            udaContext: lessonAi.udaContext ?? null,
            concettiChiave: lessonAi.concettiChiave ?? [],
            obiettivi: lessonAi.obiettivi ?? [],
            currentBody: draft,
          }}
          callables={aiCallables}
          {...(lessonAi.defaultModelProfile
            ? { defaultModelProfile: lessonAi.defaultModelProfile }
            : {})}
          onCompleteDraft={runCompleteDraft}
          onClose={() => {
            setCompleteDialogOpen(false);
            if (completeApplied) completeLesson.onFinished();
          }}
        />
      )}
      <div className={styles.editorTabs} role="tablist" aria-label="Editor contenuto">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'editor'}
          className={`${styles.editorTab}${tab === 'editor' ? ` ${styles.editorTabActive}` : ''}`}
          onClick={() => setTab('editor')}
        >
          Editor
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'preview'}
          className={`${styles.editorTab}${tab === 'preview' ? ` ${styles.editorTabActive}` : ''}`}
          onClick={() => setTab('preview')}
        >
          Anteprima
        </button>
      </div>

      {tab === 'editor' ? (
        <textarea
          className={styles.textarea}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={18}
          aria-label="Corpo Markdown"
        />
      ) : (
        <div className={styles.preview}>
          <MarkdownRenderer markdown={draft} />
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className="btn-success"
          disabled={status.busy}
          onClick={() => onSave(draft)}
        >
          {status.busy ? 'Salvataggio…' : status.error ? 'Riprova' : 'Salva'}
        </button>
        <button type="button" onClick={onCancel} disabled={status.busy}>
          Annulla
        </button>
        {lessonAi && (
          <button
            type="button"
            onClick={() => setAiDialogOpen(true)}
            disabled={status.busy}
            title="Genera una bozza con l’IA"
          >
            <IconSparkles size={14} /> Genera contenuto IA
          </button>
        )}
        {lessonAi && completeLesson && (
          <button
            type="button"
            onClick={() => {
              completeStateRef.current = null;
              setCompleteApplied(false);
              setCompleteDialogOpen(true);
            }}
            disabled={status.busy || completeLesson.existingVisualCount > 0}
            title={
              completeLesson.existingVisualCount > 0
                ? 'Rimuovi prima le immagini esistenti per generare una lezione completa.'
                : 'Genera contenuto e immagini con un unico flusso'
            }
          >
            <IconSparkles size={14} /> Genera completa con IA
          </button>
        )}
        <StatusLine status={status} dirty={dirty} />
      </div>
    </div>
  );
}

// ── Lesson metadata form (Informazioni) ──────────────────────────────────────

const EMPTY: LessonMetadata = {
  titolo: null,
  sottotitolo: null,
  difficolta: null,
  concettiChiave: [],
  obiettivi: [],
};

function toDraft(m: LessonMetadata) {
  return {
    titolo: m.titolo ?? '',
    sottotitolo: m.sottotitolo ?? '',
    difficolta: m.difficolta ?? '',
    concettiChiave: m.concettiChiave.join('\n'),
    obiettivi: m.obiettivi.join('\n'),
  };
}

export function LessonMetadataForm({
  initial,
  status,
  onSave,
  onCancel,
  onDirtyChange,
}: {
  initial: LessonMetadata;
  status: EditStatus;
  onSave: (fields: LessonMetadata) => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => toDraft(initial));
  const baseline = toDraft(initial);
  const dirty =
    draft.titolo !== baseline.titolo ||
    draft.sottotitolo !== baseline.sottotitolo ||
    draft.difficolta !== baseline.difficolta ||
    draft.concettiChiave !== baseline.concettiChiave ||
    draft.obiettivi !== baseline.obiettivi;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  function set<K extends keyof typeof draft>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    onSave({
      titolo: draft.titolo.trim() || null,
      sottotitolo: draft.sottotitolo.trim() || null,
      difficolta: draft.difficolta.trim() || null,
      concettiChiave: linesToArray(draft.concettiChiave),
      obiettivi: linesToArray(draft.obiettivi),
    });
  }

  return (
    <form
      className={styles.editor}
      role="group"
      aria-label="Modifica informazioni"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className={styles.field}>
        Titolo
        <input
          type="text"
          value={draft.titolo}
          onChange={(e) => set('titolo', e.target.value)}
          aria-label="Titolo lezione"
        />
      </label>
      <label className={styles.field}>
        Sottotitolo
        <input
          type="text"
          value={draft.sottotitolo}
          onChange={(e) => set('sottotitolo', e.target.value)}
          aria-label="Sottotitolo lezione"
        />
      </label>
      <label className={styles.field}>
        Difficoltà
        <input
          type="text"
          value={draft.difficolta}
          onChange={(e) => set('difficolta', e.target.value)}
          aria-label="Difficoltà lezione"
        />
      </label>
      <label className={styles.field}>
        Concetti chiave (uno per riga)
        <textarea
          rows={3}
          value={draft.concettiChiave}
          onChange={(e) => set('concettiChiave', e.target.value)}
          aria-label="Concetti chiave lezione"
        />
      </label>
      <label className={styles.field}>
        Obiettivi (uno per riga)
        <textarea
          rows={3}
          value={draft.obiettivi}
          onChange={(e) => set('obiettivi', e.target.value)}
          aria-label="Obiettivi lezione"
        />
      </label>

      <div className={styles.actions}>
        <button type="submit" className="btn-success" disabled={status.busy}>
          {status.busy ? 'Salvataggio…' : status.error ? 'Riprova' : 'Salva'}
        </button>
        <button type="button" onClick={onCancel} disabled={status.busy}>
          Annulla
        </button>
        <StatusLine status={status} dirty={dirty} />
      </div>
    </form>
  );
}

export { EMPTY as EMPTY_LESSON_METADATA_DRAFT };
