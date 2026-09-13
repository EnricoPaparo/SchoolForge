import { DialogShell } from '../../components/DialogShell.js';

export type LessonPdfProgress =
  | { phase: 'running'; message: string }
  | { phase: 'complete'; message: string }
  | { phase: 'error'; message: string };

export function LessonPdfProgressDialog({
  progress,
  onClose,
}: {
  progress: LessonPdfProgress;
  onClose: () => void;
}) {
  const busy = progress.phase === 'running';
  return (
    <DialogShell title="Scarica PDF" busy={busy} onCancel={onClose}>
      <div
        role={progress.phase === 'error' ? 'alert' : 'status'}
        aria-live="polite"
        aria-busy={busy}
        className={
          busy ? 'state-loading loading-row' : progress.phase === 'error' ? 'text-error' : undefined
        }
      >
        {busy && <span className="spinner" aria-hidden="true" />}
        <span>{progress.message}</span>
      </div>
      {!busy && (
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Chiudi
          </button>
        </div>
      )}
    </DialogShell>
  );
}
