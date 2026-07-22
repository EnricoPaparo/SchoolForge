import { parsePool } from '@schoolforge/lesson-contract';
import { parseLessonMetadata } from '../validation/lessonMetadata.js';
import { assertLessonContentSize } from '../programs/lessonContentSize.js';
import { newPublicLessonId } from '../programs/publicLessonId.js';
import { buildQuestionPreview, toDocId } from '../import/buildImportPayload.js';
import type { RawFile } from '../validation/types.js';
import type {
  LessonPayload,
  PublicLessonPayload,
  QuestionIndexPayload,
  UdaPayload,
} from '../import/types.js';
import { computeManifestHash } from './manifestHash.js';
import type { UdaImportCostModel, UdaImportPayload, ValidatedUdaArchive } from './types.js';

const LESSON_FILE_RE = /^lezione-\d{3}-.+\.md$/;
const POOL_FILE_RE = /\.pool\.md$/;

/**
 * Next UDA order: `max(existing) + 1`, or 0 for an empty import. Non-contiguous
 * orders are preserved (never compacted) — see uda-import-contract §7.3.
 */
export function nextUdaOrder(existingOrders: number[]): number {
  if (existingOrders.length === 0) return 0;
  return Math.max(...existingOrders) + 1;
}

/**
 * Pure builder for appending ONE validated UDA to an existing active import.
 * Mirrors `buildImportPayload` field-for-field (Firestore/editor types reused
 * verbatim) but is import-scoped: no ImportDoc, no activeImportId change. Only
 * call after `validateUdaArchive` returned ok. Assumes every pool is valid v2
 * (validation already blocked otherwise) and every lesson number is unique.
 */
export function buildUdaImportPayload(params: {
  archive: ValidatedUdaArchive;
  files: RawFile[];
  ownerUid: string;
  programId: string;
  activeImportId: string;
  existingUdaOrders: number[];
}): UdaImportPayload {
  const { archive, files, ownerUid, programId, activeImportId, existingUdaOrders } = params;
  const filesMap = new Map(files.map((f) => [f.path, f.content]));
  const udaDir = archive.udaDir;
  const udaId = toDocId(udaDir);
  const newUdaOrder = nextUdaOrder(existingUdaOrders);
  const storageBasePath = `repository/${ownerUid}/imports/${activeImportId}/${udaDir}`;

  // Lessons in the archive's own central order (validation preserved it).
  const lessonFiles = files.filter(
    (f) =>
      f.path.startsWith(`${udaDir}/`) &&
      LESSON_FILE_RE.test(f.path.split('/').pop()!) &&
      !POOL_FILE_RE.test(f.path),
  );

  const udaFile = files.find((f) => f.path === `${udaDir}/${archive.udaFilename}`)!;

  const lessons: LessonPayload[] = [];
  const questionIndex: QuestionIndexPayload[] = [];
  const publicLessons: PublicLessonPayload[] = [];
  const storagePaths: Array<{ path: string; content: string }> = [];

  // UDA markdown is uploaded as-is.
  storagePaths.push({
    path: `${storageBasePath}/${archive.udaFilename}`,
    content: udaFile.content,
  });

  for (const [lessonIndex, lesson] of lessonFiles.entries()) {
    const lessonId = `${udaId}_${toDocId(lesson.path.split('/').pop()!.replace(/\.md$/, ''))}`;
    const publicLessonId = newPublicLessonId(activeImportId, lessonId);
    const storageRef = `repository/${ownerUid}/imports/${activeImportId}/${lesson.path}`;
    const poolPath = lesson.path.replace(/\.md$/, '.pool.md');
    const poolContent = filesMap.get(poolPath);
    const hasPool = poolContent !== undefined;
    const poolStorageRef = hasPool
      ? `repository/${ownerUid}/imports/${activeImportId}/${poolPath}`
      : null;

    let questionCount = 0;
    if (hasPool) {
      const parsed = parsePool(poolContent, poolPath);
      if (parsed.ok) {
        for (const q of parsed.pool.questions) {
          questionIndex.push({
            id: `${lessonId}_${toDocId(q.id)}`,
            data: {
              ownerUid,
              importId: activeImportId,
              udaDir,
              lessonPath: lesson.path,
              lessonFilename: lesson.path.split('/').pop()!,
              poolStorageRef: poolStorageRef!,
              questionLocalId: q.id,
              tipo: q.tipo as 'aperta' | 'chiusa_singola' | 'chiusa_multipla',
              difficolta: q.difficolta,
              maxPoints: q.maxPoints,
              questionPreview: buildQuestionPreview(q.testo),
            },
          });
          questionCount++;
        }
      }
      storagePaths.push({ path: poolStorageRef!, content: poolContent });
    }

    const { metadata, body } = parseLessonMetadata(lesson.content);
    assertLessonContentSize(body, lesson.path.split('/').pop()!);
    storagePaths.push({ path: storageRef, content: lesson.content });

    lessons.push({
      id: lessonId,
      udaId,
      data: {
        ownerUid,
        importId: activeImportId,
        publicLessonId,
        udaDir,
        path: lesson.path,
        filename: lesson.path.split('/').pop()!,
        order: lessonIndex,
        poolStatus: hasPool ? 'valid' : 'absent',
        questionCount,
        storageRef,
        poolStorageRef,
        titolo: metadata.titolo,
        sottotitolo: metadata.sottotitolo,
        difficolta: metadata.difficolta,
        concettiChiave: metadata.concettiChiave,
        obiettivi: metadata.obiettivi,
      },
    });

    publicLessons.push({
      id: publicLessonId,
      data: {
        ownerUid,
        programId,
        importId: activeImportId,
        udaId,
        udaDir,
        path: lesson.path,
        filename: lesson.path.split('/').pop()!,
        contentPath: storageRef,
        titolo: metadata.titolo,
        sottotitolo: metadata.sottotitolo,
        difficolta: metadata.difficolta,
        concettiChiave: metadata.concettiChiave,
        obiettivi: metadata.obiettivi,
        order: lessonIndex,
        completed: false,
        content: body,
      },
    });
  }

  // UDA doc metadata comes straight from the canonical validator result
  // (validateUda already parsed the front matter and the description fallback).
  const uda: UdaPayload = {
    id: udaId,
    data: {
      ownerUid,
      importId: activeImportId,
      dir: udaDir,
      filename: archive.udaFilename,
      order: newUdaOrder,
      storageBasePath,
      lessonCount: lessons.length,
      titolo: archive.udaMetadata.titolo ?? null,
      descrizione: archive.udaMetadata.descrizione,
      competenze: archive.udaMetadata.competenze,
      obiettivi: archive.udaMetadata.obiettivi,
    },
  };

  const manifestHash = computeManifestHash({
    activeImportId,
    udaId,
    storagePaths,
    lessonIds: lessons.map((l) => l.id),
    questionIndexIds: questionIndex.map((q) => q.id),
    publicLessonIds: publicLessons.map((p) => p.id),
    newUdaOrder,
  });

  return {
    uda,
    lessons,
    questionIndex,
    publicLessons,
    storagePaths,
    manifest: {
      udaId,
      udaDir,
      newUdaOrder,
      lessonIds: lessons.map((l) => l.id),
      questionIndexIds: questionIndex.map((q) => q.id),
      publicLessonIds: publicLessons.map((p) => p.id),
      storagePaths: storagePaths.map((s) => s.path),
      manifestHash,
    },
  };
}

/** Prudential operation counts for the attempt (uda-import-contract §13). */
export function estimateUdaImportCost(payload: UdaImportPayload): UdaImportCostModel {
  const firestoreWrites =
    payload.lessons.length +
    payload.questionIndex.length +
    payload.publicLessons.length +
    // uda doc + lease + attempt + import/program metadata + audit
    5;
  const storageUploads = payload.storagePaths.length;
  const stagedDocs = payload.lessons.length + payload.questionIndex.length;
  const technicalChunks = Math.max(1, Math.ceil(stagedDocs / 400));
  return { firestoreWrites, storageUploads, technicalChunks };
}
