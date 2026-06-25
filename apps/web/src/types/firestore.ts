import type { FieldValue, Timestamp } from 'firebase/firestore';

export interface OwnerSettings {
  ownerUid: string;
  createdAt: Timestamp;
}

export type AuditAction =
  | 'owner.created'
  | 'auth.signIn'
  | 'auth.signOut'
  | 'import.committed'
  | 'program.created'
  | 'program.updated'
  | 'lesson.completed'
  | 'class.created'
  | 'class.updated'
  | 'verification.created'
  | 'verification.updated'
  | 'verification.activated'
  | 'verification.closed';

export interface AuditEvent {
  actorUid: string;
  action: AuditAction;
  targetId: string | null;
  outcome: 'success' | 'failure';
  reason: string | null;
  timestamp: Timestamp;
}

// ─── M1-B — Repository import ────────────────────────────────────────────────

export interface ProgramDoc {
  ownerUid: string;
  title: string;
  activeImportId: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Stored at programs/{programId}/imports/{importId} */
export interface ImportDoc {
  ownerUid: string;
  programId: string;
  importId: string;
  programmaTitle: string;
  status: 'committed';
  importedAt: Timestamp;
  udaCount: number;
  lessonCount: number;
  questionCount: number;
  /** Pool/question-level issues (do not block structural import) */
  poolIssues: StoredValidationIssue[];
}

/** Stored at programs/{programId}/imports/{importId}/udas/{udaId} */
export interface UdaDoc {
  ownerUid: string;
  importId: string;
  dir: string;
  filename: string;
  storageBasePath: string;
  lessonCount: number;
}

/** Stored at programs/{programId}/imports/{importId}/lessons/{lessonId} */
export interface LessonDoc {
  ownerUid: string;
  importId: string;
  udaDir: string;
  path: string;
  filename: string;
  poolStatus: 'absent' | 'valid' | 'invalid';
  questionCount: number;
  storageRef: string;
  poolStorageRef: string | null;
  /** Set by the teacher in M1-D to mark a lesson as completed. */
  completed?: boolean;
  completedAt?: Timestamp | null;
}

/** Stored at programs/{programId}/imports/{importId}/questionIndex/{entryId} */
export interface QuestionIndexEntry {
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
}

/** Serialized form of a validation issue (Firestore-safe, no class instances). */
export interface StoredValidationIssue {
  level: string;
  path: string;
  field: string;
  code: string;
  message: string;
}

// ─── M2-A — Classes & Verifications ──────────────────────────────────────────

export type ClassDoc = {
  ownerUid: string;
  name: string;
  description: string | null;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
};

export type VerificationStatus = 'draft' | 'active' | 'closed';

export type VerificationQuestionRef = {
  lessonId: string;
  questionIndex: number; // position in pool
  questionText?: never; // NEVER store question text or solutions here
};

export type VerificationConfig = {
  title: string;
  classId: string | null;
  programId: string;
  importId: string;
  questionRefs: VerificationQuestionRef[];
  questionsPerStudent?: number | null;
};

/** Teacher-side full snapshot (owner-only, set at activation) */
export type VerificationTeacherSnapshot = {
  title: string;
  classId: string | null;
  className: string | null;
  programId: string;
  importId: string;
  questionRefs: VerificationQuestionRef[];
  activatedAt: Timestamp;
};

export type VerificationDoc = {
  ownerUid: string;
  status: VerificationStatus;
  config: VerificationConfig;
  teacherSnapshot: VerificationTeacherSnapshot | null; // set at activation
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
  activatedAt: Timestamp | FieldValue | null;
  closedAt: Timestamp | FieldValue | null;
};
