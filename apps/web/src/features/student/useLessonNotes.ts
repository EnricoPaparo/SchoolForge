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
  /** A save was requested while another write was in flight. */
  savePending: boolean;
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
  /** Retries only a failed load; concurrent/loaded entries are left untouched. */
  retryLoad: () => void;
  /** Unconditional close (callers apply the dirty guard before calling this). */
  close: () => void;
  /** Drops the local draft back to its last persisted baseline, then closes. */
  discardAndClose: () => boolean;
  setDraft: (text: string) => void;
  /** Attempt a save now (button / blur). Returns without writing when clean. */
  saveNow: () => void;
  remove: () => Promise<boolean>;
  /** True when the given lesson's note has unsaved local changes. */
  isDirty: (publicLessonId: string) => boolean;
  /** Best-effort mobile scroll memory (in memory only). */
  rememberScroll: (publicLessonId: string, scrollTop: number) => void;
  getRememberedScroll: (publicLessonId: string) => number;
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
  const performSaveRef = useRef<(publicLessonId: string) => Promise<void>>(async () => {});
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
      // Never start two writes for the same note. Remember the intent so the
      // latest draft is persisted once the current write settles.
      if (entry.saveState === 'saving') {
        entry.savePending = true;
        return;
      }
      clearTimer(publicLessonId);
      const draft = entry.draft;
      if (draft === entry.baseline) return; // no-op: nothing changed
      if (!entry.exists && draft === '') return; // never-persisted + empty: no write

      const seq = ++entry.saveSeq;
      entry.savePending = false;
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
        const saveLatest = cur.savePending && isDirtyEntry(cur);
        cur.savePending = false;
        bump();
        if (saveLatest) void performSaveRef.current(publicLessonId);
      } catch (err) {
        const cur = cacheRef.current.get(publicLessonId);
        if (!mountedRef.current || !cur || cur.saveSeq !== seq) return;
        cur.saveState = 'error';
        cur.savePending = false;
        cur.errorCode = err instanceof StudentLessonNoteError ? err.code : 'unavailable';
        // Draft and baseline are preserved: the text is never lost and the
        // note stays dirty, so manual retry remains available.
        bump();
      }
    },
    [db, clearTimer],
  );
  performSaveRef.current = performSave;

  const loadEntry = useCallback(
    (entry: NoteEntry) => {
      const { identity } = entry;
      const { publicLessonId } = identity;
      entry.loadState = 'loading';
      entry.errorCode = null;
      bump();
      void loadStudentLessonNote(identity.studentUid, publicLessonId, db)
        .then((result) => {
          const cur = cacheRef.current.get(publicLessonId);
          if (!mountedRef.current || cur !== entry || cur.loadState !== 'loading') return;
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
          cur.errorCode = null;
          bump();
        })
        .catch((err) => {
          const cur = cacheRef.current.get(publicLessonId);
          if (!mountedRef.current || cur !== entry || cur.loadState !== 'loading') return;
          cur.loadState = 'error';
          cur.errorCode = err instanceof StudentLessonNoteError ? err.code : 'unavailable';
          bump();
        });
    },
    [db],
  );

  const open = useCallback(
    (identity: StudentLessonNoteIdentity) => {
      const publicLessonId = identity.publicLessonId;
      setOpenLessonId(publicLessonId);
      const cached = cacheRef.current.get(publicLessonId);
      if (cached) {
        cached.identity = identity;
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
        savePending: false,
        scrollTop: 0,
      };
      cacheRef.current.set(publicLessonId, entry);
      loadEntry(entry);
    },
    [loadEntry],
  );

  const retryLoad = useCallback(() => {
    if (!openLessonId) return;
    const entry = cacheRef.current.get(openLessonId);
    if (!entry || entry.loadState !== 'error') return;
    loadEntry(entry);
  }, [openLessonId, loadEntry]);

  const close = useCallback(() => {
    setOpenLessonId(null);
  }, []);

  const discardAndClose = useCallback(() => {
    if (!openLessonId) return true;
    const entry = cacheRef.current.get(openLessonId);
    if (!entry) {
      setOpenLessonId(null);
      return true;
    }
    if (entry.saveState === 'saving') return false;
    clearTimer(openLessonId);
    entry.draft = entry.baseline;
    entry.saveState = 'idle';
    entry.errorCode = null;
    entry.savePending = false;
    bump();
    setOpenLessonId(null);
    return true;
  }, [openLessonId, clearTimer]);

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
          timersRef.current.delete(publicLessonId);
          void performSaveRef.current(publicLessonId);
        }, NOTE_AUTOSAVE_DELAY_MS);
        timersRef.current.set(publicLessonId, timer);
      }
      bump();
    },
    [openLessonId, clearTimer],
  );

  const saveNow = useCallback(() => {
    if (!openLessonId) return;
    void performSave(openLessonId);
  }, [openLessonId, performSave]);

  const remove = useCallback(async () => {
    const publicLessonId = openLessonId;
    if (!publicLessonId) return false;
    const entry = cacheRef.current.get(publicLessonId);
    if (!entry || entry.saveState === 'saving') return false;
    clearTimer(publicLessonId);
    const seq = ++entry.saveSeq;
    entry.saveState = 'saving';
    entry.errorCode = null;
    bump();
    try {
      await deleteStudentLessonNote(entry.identity.studentUid, publicLessonId, db);
      const cur = cacheRef.current.get(publicLessonId);
      if (!mountedRef.current || !cur || cur.saveSeq !== seq) return false;
      // Document is now absent; local state reset to empty/clean, panel stays open.
      cur.exists = false;
      cur.draft = '';
      cur.baseline = '';
      cur.saveState = 'idle';
      cur.errorCode = null;
      cur.savePending = false;
      bump();
      return true;
    } catch (err) {
      const cur = cacheRef.current.get(publicLessonId);
      if (!mountedRef.current || !cur || cur.saveSeq !== seq) return false;
      cur.saveState = 'error';
      cur.savePending = false;
      cur.errorCode = err instanceof StudentLessonNoteError ? err.code : 'unavailable';
      bump();
      return false;
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

  const getRememberedScroll = useCallback((publicLessonId: string) => {
    return cacheRef.current.get(publicLessonId)?.scrollTop ?? 0;
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
    retryLoad,
    close,
    discardAndClose,
    setDraft,
    saveNow,
    remove,
    isDirty,
    rememberScroll,
    getRememberedScroll,
  };
}
