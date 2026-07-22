import type { RawFile, UdaMetadata } from '../validation/types.js';
import type {
  LessonPayload,
  PublicLessonPayload,
  QuestionIndexPayload,
  UdaPayload,
} from '../import/types.js';

/**
 * Stable, user-actionable error codes for the local ZIP read + archive
 * validation phases (uda-import-contract §6, §14). Every blocking condition
 * maps to one code so the UI can render a specific message and tests can assert
 * the exact reason without matching prose.
 */
export type UdaArchiveErrorCode =
  | 'not_a_zip'
  | 'zip_too_large'
  | 'content_too_large'
  | 'file_too_large'
  | 'too_many_files'
  | 'unsafe_path'
  | 'symlink'
  | 'duplicate_entry'
  | 'unexpected_file'
  | 'encrypted_or_unreadable'
  | 'no_uda'
  | 'multiple_udas'
  | 'no_lessons'
  | 'too_many_lessons'
  | 'too_many_pools'
  | 'too_many_questions'
  | 'orphan_pool'
  | 'invalid_uda_metadata'
  | 'invalid_lesson_metadata'
  | 'invalid_pool'
  | 'duplicate_lesson_number';

export interface UdaArchiveError {
  code: UdaArchiveErrorCode;
  /** Human-readable, safe for UI (no stack, token, UID or full storage path). */
  message: string;
  /** Optional logical path the error refers to (e.g. the offending file). */
  path?: string;
}

/** Result of the strict, security-first ZIP read (no filesystem extraction). */
export type ReadUdaZipResult =
  | { ok: true; files: RawFile[]; compressedBytes: number; totalDecompressedBytes: number }
  | { ok: false; error: UdaArchiveError };

/** A validated archive ready for payload building — exactly one UDA. */
export interface ValidatedUdaArchive {
  udaDir: string;
  udaFilename: string;
  udaTitle: string | null;
  /** Full didactic metadata parsed by the canonical UDA validator. */
  udaMetadata: UdaMetadata;
  lessonCount: number;
  poolCount: number;
  questionCount: number;
  totalDecompressedBytes: number;
}

export type ValidateUdaArchiveResult =
  | { ok: true; archive: ValidatedUdaArchive }
  | { ok: false; error: UdaArchiveError };

/**
 * Pure payload for appending one UDA to an existing active import. Mirrors the
 * program-import payload shapes (so Firestore/editor types are reused verbatim)
 * but is import-scoped: no ImportDoc, no activeImportId change.
 */
export interface UdaImportPayload {
  uda: UdaPayload;
  lessons: LessonPayload[];
  questionIndex: QuestionIndexPayload[];
  publicLessons: PublicLessonPayload[];
  /** Storage paths that must NOT already exist (preflight) and that the attempt owns. */
  storagePaths: Array<{ path: string; content: string }>;
  /** Manifest for the attempt: every doc id / storage path the attempt creates. */
  manifest: UdaImportManifest;
}

export interface UdaImportManifest {
  udaId: string;
  udaDir: string;
  newUdaOrder: number;
  lessonIds: string[];
  questionIndexIds: string[];
  publicLessonIds: string[];
  storagePaths: string[];
  /** Deterministic fingerprint over active import + normalized manifest + content hashes. */
  manifestHash: string;
}

/** Prudential operation counts (uda-import-contract §13) — diagnostics, not a tariff. */
export interface UdaImportCostModel {
  firestoreWrites: number;
  storageUploads: number;
  technicalChunks: number;
}
