import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from 'react';
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
  /**
   * Elemento su cui portare il focus all'apertura, al posto del primo
   * focalizzabile. **Opzionale e retrocompatibile**: senza questa prop il
   * comportamento resta identico, e nessun altro dialog cambia.
   *
   * Serve ai dialog **lunghi**: il focus automatico sul primo pulsante porta il
   * browser a scorrere fino al footer, e su uno schermo stretto il contenuto si
   * apre già scorso — il docente vede la fine di un riepilogo di cui non ha
   * ancora letto l'inizio. Il target va reso focalizzabile con `tabIndex={-1}`,
   * così riceve il focus programmatico **senza** entrare nell'ordine di Tab: un
   * paragrafo non deve diventare una tappa della navigazione da tastiera.
   *
   * Il focus è applicato con `preventScroll`, quindi il dialog resta a
   * `scrollTop` 0; il footer resta raggiungibile scorrendo, e il focus trap e il
   * ripristino del focus sul trigger sono invariati.
   */
  initialFocusRef?: RefObject<HTMLElement | null>;
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
  initialFocusRef,
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
      const requested = initialFocusRef?.current ?? null;
      if (current === null && requested !== null) {
        // `preventScroll`: il focus deve dire allo screen reader da dove
        // comincia il contenuto, non far scorrere il dialog. Restando a
        // `scrollTop` 0 il riepilogo si apre dall'inizio.
        requested.focus({ preventScroll: true });
      } else {
        (current ?? focusableElements(dialog)[0] ?? dialog).focus();
      }
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
