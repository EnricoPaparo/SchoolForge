import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import styles from './ConfirmDialog.module.css';

/**
 * Shared, teacher-independent accessible modal shell + confirm dialog.
 *
 * The teacher surfaces already ship a hardened `DialogShell`/`ConfirmDialog`
 * in `features/teacher/workspaceDialogs.tsx`, but that module transitively
 * imports the whole teacher service graph (programs/classes/editor) and is
 * styled from `DidatticaView.module.css`, so the student portal — which must
 * never import teacher features (see `StudentShell`) — cannot reuse it. This
 * component re-implements the exact same hardening in a self-contained,
 * portal-safe place: `role="dialog"` + `aria-modal` + `aria-labelledby`,
 * initial focus into the dialog, a Tab/Shift+Tab focus trap, focus restored
 * to the opener on unmount, and Escape/backdrop close (ignored while `busy`).
 */

/** Visible, non-disabled focusable descendants, in DOM order. */
function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.hasAttribute('disabled'));
}

export function DialogShell({
  title,
  children,
  onCancel,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
  busy?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (dialog) {
      const alreadyInside =
        document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)
          ? document.activeElement
          : null;
      (alreadyInside ?? focusableElements(dialog)[0] ?? dialog).focus();
    }
    return () => {
      triggerRef.current?.focus?.();
    };
  }, []);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      if (!busy) onCancel();
      return;
    }
    if (e.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = focusableElements(dialog);
    if (focusables.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement;
    const outside = !(active instanceof HTMLElement) || !dialog.contains(active);
    if (e.shiftKey && (active === first || outside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || outside)) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className={styles.backdrop}
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h3 id={titleId} className={styles.title}>
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

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
