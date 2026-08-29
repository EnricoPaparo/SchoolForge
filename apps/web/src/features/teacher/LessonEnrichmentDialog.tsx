import { useState } from 'react';
import type { Functions } from 'firebase/functions';
import { DialogShell } from '../../components/DialogShell.js';
import type { LessonVisualItem } from '../../types/firestore.js';
import { LessonMultiVisualWorkflowDialog } from './LessonMultiVisualWorkflowDialog.js';
import { LessonVisualUploadDialog } from './LessonVisualUploadDialog.js';
import styles from './LessonEnrichmentDialog.module.css';

type EnrichmentMode = 'choice' | 'generate' | 'upload';

export function LessonEnrichmentDialog({
  functions,
  identity,
  lessonAi,
  existingCount,
  currentVisuals,
  legacySingular,
  headings,
  onRefresh,
  onClose,
}: {
  functions: Functions;
  identity: { programId: string; importId: string; lessonId: string };
  lessonAi: {
    titolo?: string | null;
    sottotitolo?: string | null;
    difficolta?: string | null;
    concettiChiave?: string[];
    obiettivi?: string[];
    udaTitle?: string | null;
    udaContext?: unknown;
  };
  existingCount: number;
  currentVisuals: LessonVisualItem[];
  legacySingular?: boolean;
  headings: { text: string; index: number }[];
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<EnrichmentMode>('choice');

  if (mode === 'generate') {
    return (
      <LessonMultiVisualWorkflowDialog
        functions={functions}
        identity={identity}
        lessonAi={lessonAi}
        existingCount={existingCount}
        currentVisuals={currentVisuals}
        legacySingular={legacySingular}
        headings={headings}
        onRefresh={onRefresh}
        onClose={onClose}
      />
    );
  }

  if (mode === 'upload') {
    return (
      <LessonVisualUploadDialog
        functions={functions}
        identity={identity}
        headings={headings}
        currentVisuals={currentVisuals}
        onRefresh={onRefresh}
        onBack={() => setMode('choice')}
        onClose={onClose}
      />
    );
  }

  return (
    <DialogShell title="Arricchisci la lezione" onCancel={onClose} variant="wide-scroll">
      <p className={styles.intro}>Scegli come aggiungere un supporto visivo alla lezione.</p>
      <div className={styles.choices}>
        <button type="button" className={styles.choice} onClick={() => setMode('generate')}>
          <strong>Genera con IA</strong>
          <span>Prepara proposte didattiche e genera fino a tre immagini.</span>
        </button>
        <button type="button" className={styles.choice} onClick={() => setMode('upload')}>
          <strong>Carica immagine</strong>
          <span>Usa un file PNG, JPEG o WebP già disponibile.</span>
        </button>
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={onClose}>
          Annulla
        </button>
      </div>
    </DialogShell>
  );
}
