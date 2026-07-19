import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import {
  STUDENT_LESSON_NOTE_MAX_LENGTH,
  StudentLessonNoteError,
  createStudentLessonNote,
  deleteStudentLessonNote,
  loadStudentLessonNote,
  updateStudentLessonNote,
  type StudentLessonNoteErrorCode,
  type StudentLessonNoteIdentity,
} from './studentLessonNotesService.js';

/** Idle-save debounce: a save is attempted 15 s after the last edit. */
export const NOTE_AUTOSAVE_DELAY_MS = 15_000;

export { STUDENT_LESSON_NOTE_MAX_LENGTH };

type LoadState = 'loading' | 'loaded' | 'error';
type SaveState = 'idle' | 'saving' | 'error';

/**
 * Per-lesson in-memory cache entry. Never persisted (no localStorage/
 * sessionStorage/IndexedDB) — it lives only for the lifetime of the mounted
 * Didattica view. `baseline` is the last value read from or written to
 * Firestore; `draft` is the current textarea value. `dirty` is derived
 * (`draft !== baseline`), never stored. `scrollTop` is the best-effort mobile
 * scroll memory, in memory only.
 */
interface NoteEntry {
  identity: StudentLessonNoteIdentity;
  loadState: LoadState;
  /** Whether a Firestore document currently exists for this note. */
  exists: boolean;
  draft: string;
  baseline: string;
  saveState: SaveState;
  errorCode: StudentLessonNoteErrorCode | null;
  /** Monotonic counter: guards a stale in-flight save from clobbering newer state. */
  saveSeq: number;
  scrollTop: number;
}

/** Public snapshot of the currently-open note, for the panel/view to render. */
export interface OpenNote {
  identity: StudentLessonNoteIdentity;
  publicLessonId: string;
  loadState: LoadState;
  exists: boolean;
  draft: string;
  dirty: boolean;
  saveState: SaveState;
  errorCode: StudentLessonNoteErrorCode | null;
  /** True once a document exists OR the local draft has meaningful content. */
  canDelete: boolean;
  scrollTop: number;
}

export interface LessonNotesController {
  openLessonId: string | null;
  current: OpenNote | null;
  /** Opens the panel for a lesson, loading it once (cached thereafter). */
  open: (identity: StudentLessonNoteIdentity) => void;
  /** Unconditional close (callers apply the dirty guard before calling this). */
  close: () => void;
  setDraft: (text: string) => void;
  /** Attempt a save now (button / blur). Returns without writing when clean. */
  saveNow: () => void;
  remove: () => Promise<void>;
  /** True when the given lesson's note has unsaved local changes. */
  isDirty: (publicLessonId: string) => boolean;
  /** Best-effort mobile scroll memory (in memory only). */
  rememberScroll: (publicLessonId: string, scrollTop: number) => void;
}

function isDirtyEntry(entry: NoteEntry): boolean {
  return entry.draft !== entry.baseline;
}

/**
 * ANNOT-02 controller: the single source of truth for the student lesson-note
 * UI, shared by BOTH the desktop panel and the mobile view (never duplicated).
 *
 * Reads: exactly one `getDoc` on the first open of a lesson's note; reopening
 * the same note in the same session reuses the cached entry with no new read.
 * No listener, no polling, no prefetch. Saves: one write, coalesced to a
 * single in-flight write per note. Timers are cleaned up on context change and
 * unmount, so no background save fires after the view is torn down (e.g. when
 * Modalità verifica unmounts the Didattica view).
 */
export function useLessonNotes(db: Firestore): LessonNotesController {
  const cacheRef = useRef<Map<string, NoteEntry>>(new Map());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const mountedRef = useRef(true);
  const [openLessonId, setOpenLessonId] = useState<string | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const clearTimer = useCallback((publicLessonId: string) => {
    const timer = timersRef.current.get(publicLessonId);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(publicLessonId);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      // Cancel every pending autosave so no write is issued after unmount.
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const performSave = useCallback(
    async (publicLessonId: string) => {
      const entry = cacheRef.current.get(publicLessonId);
      if (!entry) return;
      clearTimer(publicLessonId);
      // One in-flight write per note; a change during a write is picked up by
      // the next save cycle (blur / button / re-armed timer), never a second
      // concurrent write.
      if (entry.saveState === 'saving') return;
      const draft = entry.draft;
      if (draft === entry.baseline) return; // no-op: nothing changed
      if (!entry.exists && draft === '') return; // never-persisted + empty: no write

      const seq = ++entry.saveSeq;
      entry.saveState = 'saving';
      entry.errorCode = null;
      bump();
      try {
        if (entry.exists) {
          await updateStudentLessonNote(entry.identity.studentUid, publicLessonId, draft, db);
        } else {
          await createStudentLessonNote(entry.identity, draft, db);
        }
        const cur = cacheRef.current.get(publicLessonId);
        // Ignore a superseded response (entry replaced) — never let an old
        // write's success overwrite a newer local state.
        if (!mountedRef.current || !cur || cur.saveSeq !== seq) return;
        cur.baseline = draft; // baseline advances only to the text actually sent
        cur.exists = true;
        cur.saveState = 'idle';
        cur.errorCode = null;
        bump();
      } catch (err) {
        const cur = cacheRef.current.get(publicLessonId);
        if (!mountedRef.current || !cur || cur.saveSeq !== seq) return;
        cur.saveState = 'error';
        cur.errorCode = err instanceof StudentLessonNoteError ? err.code : 'unavailable';
        // Draft and baseline are preserved: the text is never lost and the
        // note stays dirty, so manual retry remains available.
        bump();
      }
    },
    [db, clearTimer],
  );

  const open = useCallback(
    (identity: StudentLessonNoteIdentity) => {
      const publicLessonId = identity.publicLessonId;
      setOpenLessonId(publicLessonId);
      if (cacheRef.current.has(publicLessonId)) {
        bump();
        return; // already cached — no second read
      }
      const entry: NoteEntry = {
        identity,
        loadState: 'loading',
        exists: false,
        draft: '',
        baseline: '',
        saveState: 'idle',
        errorCode: null,
        saveSeq: 0,
        scrollTop: 0,
      };
      cacheRef.current.set(publicLessonId, entry);
      bump();
      void loadStudentLessonNote(identity.studentUid, publicLessonId, db)
        .then((result) => {
          const cur = cacheRef.current.get(publicLessonId);
          if (!mountedRef.current || !cur || cur.loadState !== 'loading') return;
          if (result.state === 'existing') {
            cur.exists = true;
            cur.draft = result.note.content;
            cur.baseline = result.note.content;
          } else {
            cur.exists = false;
            cur.draft = '';
            cur.baseline = '';
          }
          cur.loadState = 'loaded';
          bump();
        })
        .catch((err) => {
          const cur = cacheRef.current.get(publicLessonId);
          if (!mountedRef.current || !cur || cur.loadState !== 'loading') return;
          cur.loadState = 'error';
          cur.errorCode = err instanceof StudentLessonNoteError ? err.code : 'unavailable';
          bump();
        });
    },
    [db],
  );

  const close = useCallback(() => {
    setOpenLessonId(null);
  }, []);

  const setDraft = useCallback(
    (text: string) => {
      const publicLessonId = openLessonId;
      if (!publicLessonId) return;
      const entry = cacheRef.current.get(publicLessonId);
      if (!entry || entry.loadState !== 'loaded') return;
      entry.draft = text;
      // A fresh edit clears a previous error indicator and re-arms the idle
      // autosave timer from scratch.
      if (entry.saveState === 'error') {
        entry.saveState = 'idle';
        entry.errorCode = null;
      }
      clearTimer(publicLessonId);
      if (isDirtyEntry(entry)) {
        const timer = setTimeout(() => {
          void performSave(publicLessonId);
        }, NOTE_AUTOSAVE_DELAY_MS);
        timersRef.current.set(publicLessonId, timer);
      }
      bump();
    },
    [openLessonId, clearTimer, performSave],
  );

  const saveNow = useCallback(() => {
    if (!openLessonId) return;
    void performSave(openLessonId);
  }, [openLessonId, performSave]);

  const remove = useCallback(async () => {
    const publicLessonId = openLessonId;
    if (!publicLessonId) return;
    const entry = cacheRef.current.get(publicLessonId);
    if (!entry) return;
    clearTimer(publicLessonId);
    const seq = ++entry.saveSeq;
    entry.saveState = 'saving';
    entry.errorCode = null;
    bump();
    try {
      await deleteStudentLessonNote(entry.identity.studentUid, publicLessonId, db);
      const cur = cacheRef.current.get(publicLessonId);
      if (!mountedRef.current || !cur || cur.saveSeq !== seq) return;
      // Document is now absent; local state reset to empty/clean, panel stays open.
      cur.exists = false;
      cur.draft = '';
      cur.baseline = '';
      cur.saveState = 'idle';
      cur.errorCode = null;
      bump();
    } catch (err) {
      const cur = cacheRef.current.get(publicLessonId);
      if (!mountedRef.current || !cur || cur.saveSeq !== seq) return;
      cur.saveState = 'error';
      cur.errorCode = err instanceof StudentLessonNoteError ? err.code : 'unavailable';
      bump();
    }
  }, [openLessonId, db, clearTimer]);

  const isDirty = useCallback((publicLessonId: string) => {
    const entry = cacheRef.current.get(publicLessonId);
    return entry ? isDirtyEntry(entry) : false;
  }, []);

  const rememberScroll = useCallback((publicLessonId: string, scrollTop: number) => {
    const entry = cacheRef.current.get(publicLessonId);
    if (entry) entry.scrollTop = scrollTop;
  }, []);

  const entry = openLessonId ? cacheRef.current.get(openLessonId) : undefined;
  const current: OpenNote | null =
    openLessonId && entry
      ? {
          identity: entry.identity,
          publicLessonId: openLessonId,
          loadState: entry.loadState,
          exists: entry.exists,
          draft: entry.draft,
          dirty: isDirtyEntry(entry),
          saveState: entry.saveState,
          errorCode: entry.errorCode,
          canDelete: entry.exists || entry.draft.trim().length > 0,
          scrollTop: entry.scrollTop,
        }
      : null;

  return {
    openLessonId,
    current,
    open,
    close,
    setDraft,
    saveNow,
    remove,
    isDirty,
    rememberScroll,
  };
}
