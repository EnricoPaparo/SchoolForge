import type { PoolDifficulty } from '@schoolforge/lesson-contract';
import type { ProgrammaMetadata, RawFile, ValidationIssue } from '../validation/types.js';

export interface ImportRepositoryInput {
  ownerUid: string;
  programmaTitle: string;
  /** If provided, import is added to this program; otherwise a new program is created. */
  programId?: string | undefined;
  files: RawFile[];
}

export type ImportRepositoryResult =
  | {
      status: 'committed';
      programId: string;
      importId: string;
      /** All issues including pool/question (structural issues are absent — they would have blocked). */
      validationIssues: ValidationIssue[];
      udaCount: number;
      lessonCount: number;
      questionCount: number;
      /** School year already parsed during validation; no post-commit read is needed by the UI. */
      annoScolastico: string | null;
      /**
       * `true` when the atomic switch succeeded (import is live and correct)
       * but the deferred, best-effort cleanup of the previous import's stale
       * `publicLessons` did not complete. The import is NOT failed — the stale
       * projections are already invisible (query + Rules gate on
       * `activeImportId`). Cleanup is idempotent and retryable via
       * `retryStalePublicLessonsCleanup`. `false` when cleanup completed (or
       * there was nothing to clean up). See HARD-02B-2 / HARD-F06.
       */
      cleanupPending: boolean;
    }
  | {
      status: 'validation_failed';
      validationIssues: ValidationIssue[];
    }
  | {
      /**
       * A failure occurred BEFORE the atomic switch (validation-passing ZIP,
       * but Storage upload or chunked staging writes failed). The import was
       * NOT applied: `activeImportId` is unchanged, the previous course is
       * intact and still visible, and any staged orphan docs are invisible
       * (they carry the new, not-yet-active importId) and separately
       * cleanable. No fake rollback is performed. Retrying generates a fresh
       * importId. See HARD-02B-2 / HARD-F06.
       */
      status: 'not_applied';
      message: string;
    };

// ─── Internal payload (pure, no Firebase types) ───────────────────────────────

export interface UdaPayload {
  id: string;
  data: {
    ownerUid: string;
    importId: string;
    dir: string;
    filename: string;
    order: number;
    storageBasePath: string;
    lessonCount: number;
    titolo?: string | null;
    descrizione: string | null;
    competenze: string[];
    obiettivi: string[];
  };
}

export interface LessonPayload {
  id: string;
  udaId: string;
  data: {
    ownerUid: string;
    importId: string;
    /** Import-scoped id of this lesson's publicLessons projection (HARD-02B-1). */
    publicLessonId: string;
    udaDir: string;
    path: string;
    filename: string;
    order: number;
    poolStatus: 'absent' | 'valid' | 'invalid';
    questionCount: number;
    storageRef: string;
    poolStorageRef: string | null;
    /** Parsed from the lesson's own optional front matter — see LessonMetadata. */
    titolo: string | null;
    sottotitolo: string | null;
    difficolta: string | null;
    concettiChiave: string[];
    obiettivi: string[];
  };
}

/**
 * Public, read-only projection of a lesson for the student portal (M3-lite).
 * Deliberately excludes poolStatus, poolStorageRef, questionCount, or any
 * other pool-derived field — those live only in LessonPayload.
 */
export interface PublicLessonPayload {
  id: string;
  data: {
    ownerUid: string;
    programId: string;
    importId: string;
    udaId: string;
    udaDir: string;
    path: string;
    filename: string;
    /** Storage path of the lesson's own .md file — never a .pool.md path. */
    contentPath: string;
    /** Didactic, never technical — safe for the student projection. */
    titolo: string | null;
    sottotitolo: string | null;
    difficolta: string | null;
    concettiChiave: string[];
    obiettivi: string[];
    order: number;
    completed: boolean;
    /** The lesson body Markdown itself — see PublicLessonDoc.content. */
    content: string;
  };
}

export interface QuestionIndexPayload {
  id: string;
  data: {
    ownerUid: string;
    importId: string;
    udaDir: string;
    lessonPath: string;
    lessonFilename: string;
    poolStorageRef: string;
    questionLocalId: string;
    tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
    difficolta: PoolDifficulty;
    peso: 1 | 2 | 3;
    maxPoints: number;
    /** First 100 chars of the normalized question text — never the full text, solution, or answers. */
    questionPreview: string;
  };
}

export interface ImportMetaPayload {
  ownerUid: string;
  programId: string;
  importId: string;
  programmaTitle: string;
  /**
   * Import lifecycle state (HARD-02B-2). New imports are written as
   * `'staging'` (invisible: `activeImportId` still points at the previous
   * import), promoted to `'active'` by the atomic switch, and best-effort
   * marked `'superseded'` by the cleanup of a later import. Legacy imports
   * carried `'committed'` (or no status) and are treated as `'active'` when
   * they match `program.activeImportId`, else `'superseded'`.
   */
  status: 'staging' | 'active' | 'superseded';
  udaCount: number;
  lessonCount: number;
  questionCount: number;
  poolIssues: Array<{
    level: string;
    path: string;
    field: string;
    code: string;
    message: string;
  }>;
  /** Parsed from the optional root-level programma.md. Null when the file is absent. */
  programmaMeta: ProgrammaMetadata | null;
}

export interface ImportPayload {
  importMeta: ImportMetaPayload;
  udas: UdaPayload[];
  lessons: LessonPayload[];
  questionIndex: QuestionIndexPayload[];
  publicLessons: PublicLessonPayload[];
}
