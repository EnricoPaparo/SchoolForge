import { DialogShell } from './DialogShell.js';
import styles from './ConfirmDialog.module.css';

export { DialogShell };

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Annulla',
  danger,
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogShell title={title} onCancel={onCancel} busy={busy}>
      <p className={styles.message}>{message}</p>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={danger ? 'btn-danger' : 'btn-primary'}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Attendere…' : confirmLabel}
        </button>
      </div>
    </DialogShell>
  );
}
