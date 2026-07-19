import { useEffect, useRef, useState } from 'react';
import { IconFileText, IconTrash } from '../../components/icons.js';
import { ConfirmDialog } from '../../components/ConfirmDialog.js';
import {
  STUDENT_LESSON_NOTE_MAX_LENGTH,
  type LessonNotesController,
  type OpenNote,
} from './useLessonNotes.js';
import styles from './LessonNotesPanel.module.css';

/**
 * Maps a sanitized service error code to human copy. No raw Firebase message
 * is ever shown; `permission-denied` reads as "access no longer available"
 * (revoked/exam mode), everything else as a retry prompt.
 */
function errorText(note: OpenNote): string | null {
  if (note.errorCode == null) return null;
  switch (note.errorCode) {
    case 'permission-denied':
      return 'Accesso non più disponibile.';
    case 'content-too-long':
      return `Il testo supera i ${STUDENT_LESSON_NOTE_MAX_LENGTH.toLocaleString('it')} caratteri.`;
    default:
      return 'Errore. Riprova il salvataggio.';
  }
}

/** The three named save states (contract) plus a neutral empty string. */
function statusLabel(note: OpenNote): string {
  if (note.saveState === 'saving') return 'Salvataggio…';
  if (note.saveState === 'error') return 'Errore';
  if (!note.dirty && note.exists) return 'Salvato';
  return '';
}

interface BodyProps {
  note: OpenNote;
  controller: LessonNotesController;
  onRequestClose: () => void;
  onRequestDelete: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}

function useAutoFocus(
  note: OpenNote,
  textareaRef: React.RefObject<HTMLTextAreaElement>,
  fallbackRef: React.RefObject<HTMLElement>,
) {
  // Focus the textarea once the note is loaded; before then focus the header
  // so keyboard users land inside the surface immediately.
  useEffect(() => {
    if (note.loadState === 'loaded') textareaRef.current?.focus();
    else fallbackRef.current?.focus();
    // Only refocus when the target lesson or its load state changes.
  }, [note.publicLessonId, note.loadState, textareaRef, fallbackRef]);
}

function NoteEditor({ note, controller }: { note: OpenNote; controller: LessonNotesController }) {
  const counter = `${note.draft.length.toLocaleString('it')}/${STUDENT_LESSON_NOTE_MAX_LENGTH.toLocaleString('it')}`;
  const message = errorText(note);
  if (note.loadState === 'loading') {
    return (
      <p aria-busy="true" className="state-loading">
        Caricamento…
      </p>
    );
  }
  if (note.loadState === 'error') {
    return (
      <div className={styles.loadError}>
        <p role="alert" className="text-error">
          {message ?? 'Impossibile caricare gli appunti.'}
        </p>
        <button type="button" onClick={() => controller.open(note.identity)}>
          Riprova
        </button>
      </div>
    );
  }
  return (
    <>
      <label className={styles.visuallyHidden} htmlFor="lesson-note-textarea">
        Testo degli appunti
      </label>
      <textarea
        id="lesson-note-textarea"
        className={styles.textarea}
        value={note.draft}
        maxLength={STUDENT_LESSON_NOTE_MAX_LENGTH}
        onChange={(event) => controller.setDraft(event.target.value)}
        onBlur={() => controller.saveNow()}
        spellCheck
      />
      <div className={styles.footer}>
        <span className={styles.counter} aria-hidden="true">
          {counter}
        </span>
        {message && (
          <span role="alert" className="text-error">
            {message}
          </span>
        )}
      </div>
    </>
  );
}

/** Desktop non-modal post-it panel. */
function DesktopPanel({
  note,
  controller,
  onRequestClose,
  onRequestDelete,
  textareaRef,
}: BodyProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useAutoFocus(note, textareaRef, closeRef);
  return (
    <aside
      className={styles.panel}
      aria-label="Appunti"
      onKeyDown={(e) => {
        // Non-modal panel: Escape closes (dirty guard applied in requestClose).
        if (e.key === 'Escape') {
          e.stopPropagation();
          onRequestClose();
        }
      }}
    >
      <header className={styles.header}>
        <span className={styles.headerIcon} aria-hidden="true">
          <IconFileText />
        </span>
        <h3 className={styles.title}>Appunti</h3>
        <span className={styles.status} role="status" aria-live="polite">
          {statusLabel(note)}
        </span>
        <button
          type="button"
          ref={closeRef}
          className={styles.closeBtn}
          aria-label="Chiudi appunti"
          onClick={onRequestClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className={styles.body}>
        <NoteEditor note={note} controller={controller} />
      </div>
      {note.loadState === 'loaded' && note.canDelete && (
        <div className={styles.panelActions}>
          <button
            type="button"
            className={styles.deleteBtn}
            onClick={onRequestDelete}
            disabled={note.saveState === 'saving'}
          >
            <IconTrash /> Elimina appunti
          </button>
        </div>
      )}
    </aside>
  );
}

/** Mobile full-width dedicated view. */
function MobileView({ note, controller, onRequestClose, onRequestDelete, textareaRef }: BodyProps) {
  const backRef = useRef<HTMLButtonElement>(null);
  useAutoFocus(note, textareaRef, backRef);
  return (
    <section
      className={styles.mobileView}
      aria-label="Appunti"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onRequestClose();
        }
      }}
    >
      <header className={styles.mobileHeader}>
        <button type="button" ref={backRef} className={styles.mobileBack} onClick={onRequestClose}>
          ← Torna alla lezione
        </button>
        <h3 className={styles.mobileTitle}>Appunti</h3>
        <span className={styles.status} role="status" aria-live="polite">
          {statusLabel(note)}
        </span>
      </header>
      <div className={styles.mobileBody}>
        <NoteEditor note={note} controller={controller} />
      </div>
      {note.loadState === 'loaded' && (
        <div className={styles.mobileActions}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => controller.saveNow()}
            disabled={note.saveState === 'saving' || !note.dirty}
          >
            Salva
          </button>
          {note.canDelete && (
            <button
              type="button"
              className={styles.deleteBtn}
              onClick={onRequestDelete}
              disabled={note.saveState === 'saving'}
            >
              <IconTrash /> Elimina appunti
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * ANNOT-02 lesson notes UI. Renders the desktop post-it `aside` or the mobile
 * dedicated view from the SAME controller state (never two independent
 * implementations). Owns only its own close/delete confirmation dialogs; the
 * lesson-navigation dirty guard lives in the parent (StudentDidatticaView).
 */
export function LessonNotesPanel({
  controller,
  isMobile,
}: {
  controller: LessonNotesController;
  isMobile: boolean;
}) {
  const note = controller.current;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!note) return null;

  function requestClose() {
    if (note!.dirty) setConfirmDiscard(true);
    else controller.close();
  }

  const body = isMobile ? (
    <MobileView
      note={note}
      controller={controller}
      onRequestClose={requestClose}
      onRequestDelete={() => setConfirmDelete(true)}
      textareaRef={textareaRef}
    />
  ) : (
    <DesktopPanel
      note={note}
      controller={controller}
      onRequestClose={requestClose}
      onRequestDelete={() => setConfirmDelete(true)}
      textareaRef={textareaRef}
    />
  );

  return (
    <>
      {body}
      {confirmDiscard && (
        <ConfirmDialog
          title="Modifiche non salvate"
          message="Ci sono modifiche non salvate agli appunti. Se esci ora le perdi."
          confirmLabel="Esci senza salvare"
          cancelLabel="Resta e continua"
          danger
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => {
            setConfirmDiscard(false);
            controller.close();
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Elimina appunti"
          message="Vuoi eliminare definitivamente questi appunti? L'operazione non è reversibile."
          confirmLabel="Elimina"
          danger
          error={note.saveState === 'error' ? errorText(note) : null}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            void controller.remove().finally(() => setConfirmDelete(false));
          }}
        />
      )}
    </>
  );
}
