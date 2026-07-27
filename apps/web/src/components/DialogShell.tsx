import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './DialogShell.module.css';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('disabled'));
}

export type DialogShellProps = {
  title: string;
  children: ReactNode;
  onCancel: () => void;
  busy?: boolean;
  variant?: 'default' | 'wide-scroll';
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  role?: 'dialog' | 'alertdialog';
};

/**
 * SchoolForge modal primitive shared by teacher and student surfaces.
 *
 * It owns the portal, viewport containment, backdrop, focus lifecycle and
 * dismissal policy. Feature dialogs only provide content and actions.
 */
export function DialogShell({
  title,
  children,
  onCancel,
  busy = false,
  variant = 'default',
  closeOnBackdrop = true,
  closeOnEscape = true,
  role = 'dialog',
}: DialogShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog) {
      const current =
        document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)
          ? document.activeElement
          : null;
      (current ?? focusableElements(dialog)[0] ?? dialog).focus();
    }

    return () => {
      triggerRef.current?.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();

    if (event.key === 'Escape') {
      if (!busy && closeOnEscape) onCancel();
      return;
    }
    if (event.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = focusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    const outside = !(active instanceof HTMLElement) || !dialog.contains(active);
    if (event.shiftKey && (active === first || outside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || outside)) {
      event.preventDefault();
      first.focus();
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={(event) => {
        event.stopPropagation();
        if (!busy && closeOnBackdrop) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className={`${styles.dialog} ${variant === 'wide-scroll' ? styles.dialogWideScroll : ''}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h3 id={titleId} className={styles.dialogTitle}>
          {title}
        </h3>
        {children}
      </div>
    </div>,
    document.body,
  );
}
