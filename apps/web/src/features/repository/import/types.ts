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
    }
  | {
      status: 'validation_failed';
      validationIssues: ValidationIssue[];
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
    difficolta: 1 | 2 | 3;
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
  status: 'committed';
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
