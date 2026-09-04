import { useEffect, useMemo, useReducer } from 'react';
import type { Firestore } from 'firebase/firestore';
import {
  loadStudentLibrary,
  loadStudentCourseLessons,
  type StudentLibraryResult,
  type StudentLesson,
  type StudentProgram,
} from '../repository/programs/studentLessonsService.js';

export const STUDENT_DIDATTICA_FRESHNESS_MS = 60_000;
type LibraryState = StudentLibraryResult | { status: 'loading' | 'error' };
type CourseState =
  | { status: 'idle' | 'loading' | 'error' }
  | { status: 'ok'; lessons: StudentLesson[] };

function isAccessError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'permission-denied' || error.code === 'unauthenticated')
  );
}

/** A mounted/authenticated view owns this cache; nothing survives unmount/logout.
 * Only the last selected course is retained. In-flight reads are coalesced, but
 * responses for a superseded selection or authorization context are not cached.
 */
export function useStudentDidattica(uid: string, db: Firestore, initialClassId?: string | null) {
  const [, render] = useReducer((n: number) => n + 1, 0);
  const session = useMemo(() => {
    let active = false;
    let generation = 0;
    let courseGeneration = 0;
    let library: LibraryState = { status: 'loading' };
    let selectedId: string | null = null;
    let course: CourseState = { status: 'idle' };
    let cache: { key: string; lessons: StudentLesson[]; at: number } | null = null;
    let attemptedAt = -Infinity;
    let metadataRequest: Promise<void> | null = null;
    let checkingMetadata = false;
    const pendingCourses = new Map<string, Promise<StudentLesson[]>>();
    let refreshing = false;
    let libraryError = false;
    // StrictMode can replay mount effects before the first request settles.
    // Every initial replay may reuse the verified seed without another student
    // read; only the first request accepted by the current mount consumes it.
    let initialAttemptSettled = false;
    const emit = () => {
      if (active) render();
    };
    const selectedProgram = () =>
      library.status === 'ok' ? (library.programs.find((p) => p.id === selectedId) ?? null) : null;
    const keyFor = (program: StudentProgram) =>
      JSON.stringify([
        uid,
        library.status === 'ok' ? library.classId : null,
        program.id,
        program.activeImportId,
      ]);
    const invalidate = () => {
      generation++;
      courseGeneration++;
      cache = null;
      course = { status: 'idle' };
      pendingCourses.clear();
    };
    const readCourse = async (force = false) => {
      const program = selectedProgram();
      if (!active || !program) return;
      const key = keyFor(program);
      if (!force && cache?.key === key && Date.now() - cache.at < STUDENT_DIDATTICA_FRESHNESS_MS) {
        course = { status: 'ok', lessons: cache.lessons };
        emit();
        return;
      }
      if (cache?.key !== key) cache = null;
      if (!cache) course = { status: 'loading' };
      const epoch = courseGeneration;
      let request = pendingCourses.get(key);
      if (!request) {
        request = loadStudentCourseLessons(program, db);
        pendingCourses.set(key, request);
      }
      emit();
      try {
        const lessons = await request;
        if (
          !active ||
          epoch !== courseGeneration ||
          selectedProgram() == null ||
          keyFor(selectedProgram()!) !== key
        )
          return;
        cache = { key, lessons, at: Date.now() };
        course = { status: 'ok', lessons };
      } catch (error) {
        if (
          !active ||
          epoch !== courseGeneration ||
          selectedProgram() == null ||
          keyFor(selectedProgram()!) !== key
        )
          return;
        cache = null;
        if (isAccessError(error)) invalidate();
        course = { status: 'error' };
      } finally {
        if (pendingCourses.get(key) === request) pendingCourses.delete(key);
        emit();
      }
    };
    const refresh = (force = false): Promise<void> => {
      if (metadataRequest) return metadataRequest;
      if (!active || (!force && Date.now() - attemptedAt < STUDENT_DIDATTICA_FRESHNESS_MS))
        return Promise.resolve();
      attemptedAt = Date.now();
      refreshing = true;
      checkingMetadata = true;
      const epoch = generation;
      const request = (async () => {
        try {
          const seed = initialAttemptSettled ? undefined : initialClassId;
          const next =
            seed === undefined
              ? await loadStudentLibrary(uid, db)
              : await loadStudentLibrary(uid, db, seed);
          if (!active || epoch !== generation) return;
          initialAttemptSettled = true;
          const previousClass = library.status === 'ok' ? library.classId : null;
          const previous = selectedProgram();
          library = next;
          libraryError = false;
          const current = selectedProgram();
          // Revalidate even a cached course while the library is open.
          if (
            next.status !== 'ok' ||
            previousClass !== next.classId ||
            (previous && (!current || previous.activeImportId !== current.activeImportId)) ||
            (cache && !next.programs.some((p) => keyFor(p) === cache?.key))
          ) {
            invalidate();
          }
          if (!current) selectedId = null;
          checkingMetadata = false;
          emit();
          await readCourse(force);
        } catch (error) {
          if (!active || epoch !== generation) return;
          initialAttemptSettled = true;
          cache = null;
          courseGeneration++;
          pendingCourses.clear();
          course = { status: 'error' };
          libraryError = true;
          // Access failures invalidate note identity as well. An ordinary
          // offline refresh hides stale lessons but preserves unsaved notes.
          if (isAccessError(error) || library.status !== 'ok') {
            invalidate();
            library = { status: 'error' };
          }
        }
      })();
      metadataRequest = request;
      void request.then(() => {
        if (metadataRequest === request) {
          metadataRequest = null;
          refreshing = false;
          checkingMetadata = false;
        }
        emit();
      });
      emit();
      return request;
    };
    return {
      get library() {
        return library;
      },
      get program() {
        return selectedProgram();
      },
      get course() {
        return course;
      },
      get refreshing() {
        return refreshing;
      },
      get libraryError() {
        return libraryError;
      },
      get contextVersion() {
        return generation;
      },
      refresh,
      open(programId: string) {
        selectedId = programId;
        course = { status: 'loading' };
        emit();
        if (checkingMetadata) return;
        if (
          (libraryError || Date.now() - attemptedAt >= STUDENT_DIDATTICA_FRESHNESS_MS) &&
          !metadataRequest
        ) {
          void refresh(libraryError);
        } else void readCourse();
      },
      back() {
        selectedId = null;
        course = { status: 'idle' };
        emit();
      },
      mount() {
        active = true;
        attemptedAt = -Infinity;
        void refresh();
        return () => {
          active = false;
          invalidate();
          metadataRequest = null;
          checkingMetadata = false;
        };
      },
    };
  }, [uid, db, initialClassId]);
  useEffect(() => session.mount(), [session]);
  return session;
}
