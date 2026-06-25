import type { RawFile, ValidationIssue } from '../validation/types.js';

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
    storageBasePath: string;
    lessonCount: number;
  };
}

export interface LessonPayload {
  id: string;
  udaId: string;
  data: {
    ownerUid: string;
    importId: string;
    udaDir: string;
    path: string;
    filename: string;
    poolStatus: 'absent' | 'valid' | 'invalid';
    questionCount: number;
    storageRef: string;
    poolStorageRef: string | null;
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
}

export interface ImportPayload {
  importMeta: ImportMetaPayload;
  udas: UdaPayload[];
  lessons: LessonPayload[];
  questionIndex: QuestionIndexPayload[];
}
