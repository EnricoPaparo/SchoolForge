import type { Firestore } from 'firebase/firestore';
import { listClasses } from '../classes/classesService.js';
import { getImportMeta, listPrograms, type ProgramItem } from './programsService.js';

/** Statistics belong to the opened workspace, never to library reads. */
export type CourseStatistics = {
  udaCount: number;
  lessonsTotal: number;
  lessonsDone: number;
  questionsTotal: number;
};

/**
 * One card in the Didattica library (DUX-01). Deliberately flat and
 * self-contained: everything the card renders is here, so the view never
 * resolves class names itself. Structural statistics are loaded only on open.
 *
 * `annoScolastico` is `null` when the active import carried no
 * `programma.md` metadata (or the program has no active import at all) —
 * the view shows "Senza anno" for that case.
 */
export type CourseCard = {
  programId: string;
  title: string;
  annoScolastico: string | null;
  /** Assigned class ids (source of truth). Kept alongside the resolved names. */
  classIds: string[];
  classNames: string[];
  /** False when the program has never been populated by a ZIP import yet. */
  hasImport: boolean;
  /**
   * The program's active import id, carried through so the DUX-02 workspace
   * can load that course's UDA/lessons on open without re-reading the full
   * program list. `null` when the program has no active import.
   */
  activeImportId: string | null;
};

/**
 * Loads the Didattica library exactly from data and services that already
 * exist (DUX-01) — no new Firestore document, index, Rule or Cloud
 * Function, and no Storage read (no Markdown, no pool files).
 *
 * Read budget for the compact library (COURSE-CARDS-LITE-01):
 *   - `listPrograms` — 1 query (all programs of the owner)
 *   - `listClasses`  — 1 query (all classes, only to resolve class names)
 *   - per program that has an active import: `getImportMeta` — 1 read for
 *     the school year. No UDA, lesson, Storage or pool reads.
 *
 * No realtime listener: this is a one-shot read, re-run explicitly by the
 * view after a create/import/rename/delete.
 */
export async function loadCourseLibrary(ownerUid: string, db: Firestore): Promise<CourseCard[]> {
  const [programs, classes] = await Promise.all([listPrograms(db), listClasses(ownerUid, db)]);
  const classNameById = new Map(classes.map((c) => [c.id, c.name]));

  return Promise.all(programs.map((program) => buildCard(program, classNameById, db)));
}

async function buildCard(
  program: ProgramItem,
  classNameById: Map<string, string>,
  db: Firestore,
): Promise<CourseCard> {
  const classIds = program.classIds ?? [];
  const classNames = classIds
    .map((id) => classNameById.get(id))
    .filter((name): name is string => Boolean(name));

  if (!program.activeImportId) {
    return {
      programId: program.id,
      title: program.title,
      annoScolastico: null,
      classIds,
      classNames,
      hasImport: false,
      activeImportId: null,
    };
  }

  const importId = program.activeImportId;
  const programmaMeta = await getImportMeta(program.id, importId, db);

  return {
    programId: program.id,
    title: program.title,
    annoScolastico: programmaMeta?.annoScolastico ?? null,
    classIds,
    classNames,
    hasImport: true,
    activeImportId: importId,
  };
}
