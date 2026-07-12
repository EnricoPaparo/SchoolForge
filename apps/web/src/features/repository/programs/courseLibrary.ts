import type { Firestore } from 'firebase/firestore';
import { listClasses } from '../classes/classesService.js';
import {
  getImportMeta,
  listLessons,
  listPrograms,
  listUdas,
  type ProgramItem,
} from './programsService.js';

/**
 * One card in the Didattica library (DUX-01). Deliberately flat and
 * self-contained: everything the card renders is here, so the view never
 * re-derives counts or resolves class names itself.
 *
 * `annoScolastico` is `null` when the active import carried no
 * `programma.md` metadata (or the program has no active import at all) —
 * the view shows "Senza anno" for that case.
 */
export type CourseCard = {
  programId: string;
  title: string;
  annoScolastico: string | null;
  classNames: string[];
  udaCount: number;
  lessonsTotal: number;
  lessonsDone: number;
  questionsTotal: number;
  /** False when the program has never been populated by a ZIP import yet. */
  hasImport: boolean;
};

/**
 * Loads the Didattica library exactly from data and services that already
 * exist (DUX-01) — no new Firestore document, index, Rule or Cloud
 * Function, and no Storage read (no Markdown, no pool files).
 *
 * Reads, deliberately matching the budget the current "Corsi" view
 * (`ProgramsView`) already spends so the two sections show identical
 * numbers during the coexistence migration:
 *   - `listPrograms` — 1 query (all programs of the owner)
 *   - `listClasses`  — 1 query (all classes, only to resolve class names)
 *   - per program that has an active import: `listUdas` + `listLessons` +
 *     `getImportMeta` — 3 reads, run in parallel.
 *
 * The per-program reads are necessary for the required per-card metrics
 * (UDA count, lezioni svolte/totali, numero domande) which live on the
 * UDA/lesson documents themselves — never on a denormalized counter — and
 * for the school year (on the import's `programmaMeta`). Storage content
 * and pools are never touched. Any cheaper aggregate would require a new
 * denormalized document/index, explicitly out of scope for DUX-01.
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
  const classNames = (program.classIds ?? [])
    .map((id) => classNameById.get(id))
    .filter((name): name is string => Boolean(name));

  if (!program.activeImportId) {
    return {
      programId: program.id,
      title: program.title,
      annoScolastico: null,
      classNames,
      udaCount: 0,
      lessonsTotal: 0,
      lessonsDone: 0,
      questionsTotal: 0,
      hasImport: false,
    };
  }

  const importId = program.activeImportId;
  const [udas, lessons, programmaMeta] = await Promise.all([
    listUdas(program.id, importId, db),
    listLessons(program.id, importId, db),
    getImportMeta(program.id, importId, db),
  ]);

  return {
    programId: program.id,
    title: program.title,
    annoScolastico: programmaMeta?.annoScolastico ?? null,
    classNames,
    udaCount: udas.length,
    lessonsTotal: lessons.length,
    lessonsDone: lessons.filter((l) => l.completed).length,
    questionsTotal: lessons.reduce((sum, l) => sum + (l.questionCount ?? 0), 0),
    hasImport: true,
  };
}
