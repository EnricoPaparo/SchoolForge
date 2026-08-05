import { composeMarkdownWithFrontMatter } from '../validation/frontMatter.js';
import { newPublicLessonId } from '../programs/publicLessonId.js';
import {
  importStoragePath,
  lessonFileName,
  lessonFrontMatterFields,
  maxLessonNumber,
  maxLessonOrder,
  toDocId,
} from '../canonicalNaming.js';
import { computeStructureManifestHash } from './structureManifestHash.js';
import { assertNoTitleCollisions } from './validateStructureRoot.js';
import type {
  ExistingLessonForPlan,
  LessonStructureImportManifest,
  NormalizedLessonMetadata,
  PlannedLesson,
  StructureImportResult,
} from './types.js';

/**
 * STRUCTURE-IMPORT-01 — pure planner of a lesson append
 * (structure-metadata-import-roadmap.md §6, §7.2).
 *
 * Same contract as the UDA planner: it computes the whole manifest and performs
 * no I/O whatsoever. The destination UDA is resolved by the caller and passed
 * in, so nothing inside the file can redirect the import to another UDA.
 *
 * Every lesson is planned as a genuine skeleton: empty body, `poolStatus:
 * 'absent'`, `questionCount: 0`, `poolStorageRef: null`. No pool file is
 * planned, ever.
 *
 * One deliberate difference from `createLesson`: when computing the next
 * `order`, a lesson with no stored `order` falls back to its `lezione-XXX`
 * filename prefix — the same legacy source `reorderLesson` already trusts.
 * `createLesson` appends one lesson at a time, so treating a legacy lesson as
 * `-1` is harmless there; appending forty at once to a legacy UDA is not.
 *
 * Pure module: no Firebase, no React, no browser API, no network.
 */

export interface PlanLessonMetadataAppendInput {
  ownerUid: string;
  programId: string;
  importId: string;
  /** Destination UDA, already resolved by the caller. */
  udaId: string;
  udaDir: string;
  /** Validated entries, in file order — which is the append order. */
  lessons: readonly NormalizedLessonMetadata[];
  /** Every lesson already inside the destination UDA. */
  existingLessons: readonly ExistingLessonForPlan[];
}

export function planLessonMetadataAppend(
  input: PlanLessonMetadataAppendInput,
): StructureImportResult<LessonStructureImportManifest> {
  const { ownerUid, programId, importId, udaId, udaDir, lessons, existingLessons } = input;

  const titleCollision = assertNoTitleCollisions(
    lessons.map((lesson) => lesson.titolo),
    existingLessons
      .map((lesson) => lesson.titolo)
      .filter((titolo): titolo is string => typeof titolo === 'string'),
    'lesson',
  );
  if (titleCollision) return { ok: false, error: titleCollision };

  const takenDocIds = new Set(existingLessons.map((lesson) => lesson.lessonId));
  const takenStoragePaths = new Set(
    existingLessons
      .filter((lesson) => typeof lesson.filename === 'string' && lesson.filename.length > 0)
      .map((lesson) => importStoragePath(ownerUid, importId, `${udaDir}/${lesson.filename!}`)),
  );

  const baseNumber = maxLessonNumber(existingLessons);
  const baseOrder = maxLessonOrder(existingLessons, { legacyFilenameFallback: true });

  const planned: PlannedLesson[] = [];

  for (const [index, metadata] of lessons.entries()) {
    const filename = lessonFileName(baseNumber + 1 + index, metadata.titolo);
    const path = `${udaDir}/${filename}`;
    const storageRef = importStoragePath(ownerUid, importId, path);
    // Scoped by udaId, exactly like `createLesson`: lesson numbering restarts
    // per UDA, so two UDAs can legitimately share a lesson filename.
    const lessonId = `${udaId}_${toDocId(filename.replace(/\.md$/, ''))}`;
    const publicLessonId = newPublicLessonId(importId, lessonId);
    const order = baseOrder + 1 + index;

    if (takenDocIds.has(lessonId)) {
      return {
        ok: false,
        error: {
          code: 'document_id_collision',
          message: `La lezione «${metadata.titolo}» genererebbe un identificatore già in uso in questa UDA. Modifica il titolo e riprova.`,
          fileKind: 'lesson',
          index,
          field: 'titolo',
        },
      };
    }
    if (takenStoragePaths.has(storageRef)) {
      return {
        ok: false,
        error: {
          code: 'storage_path_collision',
          message: `La lezione «${metadata.titolo}» genererebbe un file già esistente in questa UDA. Modifica il titolo e riprova.`,
          fileKind: 'lesson',
          index,
          field: 'titolo',
        },
      };
    }
    takenDocIds.add(lessonId);
    takenStoragePaths.add(storageRef);

    const content = composeMarkdownWithFrontMatter(lessonFrontMatterFields(metadata), '');

    planned.push({
      index,
      lessonId,
      publicLessonId,
      filename,
      path,
      storageRef,
      order,
      content,
      metadata,
      doc: {
        ownerUid,
        importId,
        publicLessonId,
        udaDir,
        path,
        filename,
        order,
        poolStatus: 'absent',
        questionCount: 0,
        storageRef,
        poolStorageRef: null,
        titolo: metadata.titolo,
        sottotitolo: metadata.sottotitolo,
        difficolta: metadata.difficolta,
        concettiChiave: metadata.concettiChiave,
        obiettivi: metadata.obiettivi,
      },
      publicLesson: {
        ownerUid,
        programId,
        importId,
        udaId,
        udaDir,
        path,
        filename,
        contentPath: storageRef,
        order,
        completed: false,
        // Empty on purpose: the student-side filter for empty skeletons is
        // STRUCTURE-IMPORT-02B's business, not the planner's.
        content: '',
        titolo: metadata.titolo,
        sottotitolo: metadata.sottotitolo,
        difficolta: metadata.difficolta,
        concettiChiave: metadata.concettiChiave,
        obiettivi: metadata.obiettivi,
      },
    });
  }

  const manifestHash = computeStructureManifestHash({
    kind: 'lesson',
    programId,
    importId,
    udaId,
    documentIds: planned.map((lesson) => lesson.lessonId),
    projectionIds: planned.map((lesson) => lesson.publicLessonId),
    files: planned.map((lesson) => ({ path: lesson.storageRef, content: lesson.content })),
    orders: planned.map((lesson) => lesson.order),
  });

  return {
    ok: true,
    value: {
      kind: 'lesson',
      ownerUid,
      programId,
      importId,
      udaId,
      udaDir,
      lessons: planned,
      lessonIds: planned.map((lesson) => lesson.lessonId),
      publicLessonIds: planned.map((lesson) => lesson.publicLessonId),
      storagePaths: planned.map((lesson) => lesson.storageRef),
      // A single increment for the whole batch, as the contract requires —
      // never one `increment(1)` per lesson.
      lessonCountIncrement: planned.length,
      manifestHash,
    },
  };
}
