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
  | 'program.deleted'
  | 'lesson.completed'
  | 'class.created'
  | 'class.updated'
  | 'verification.created'
  | 'verification.updated'
  | 'verification.activated'
  | 'verification.visibilityChanged'
  | 'verification.closed'
  | 'verification.deleted';

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

/** Didactic metadata parsed from an optional root-level programma.md. */
export interface ProgrammaMeta {
  annoScolastico: string | null;
  docente: string | null;
  materia: string | null;
  classe: string | null;
  descrizione: string | null;
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
  /** Parsed from the optional root-level programma.md. Null when the file was absent. */
  programmaMeta: ProgrammaMeta | null;
}

/** Stored at programs/{programId}/imports/{importId}/udas/{udaId} */
export interface UdaDoc {
  ownerUid: string;
  importId: string;
  dir: string;
  filename: string;
  storageBasePath: string;
  lessonCount: number;
  /** Didactic metadata parsed from the UDA's own front matter/body — never technical details. */
  descrizione: string | null;
  competenze: string[];
  obiettivi: string[];
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
  /** First 100 chars of the normalized question text — never the full text, solution, or answers. */
  questionPreview: string;
}

/**
 * Stored at publicLessons/{lessonId} (M3-lite) — read-only projection of a
 * lesson for the student portal. Written in the same commit transaction that
 * updates `activeImportId`, and re-created from scratch on every re-import
 * (stale entries from a previous import are deleted first), so a student
 * never sees a partial or superseded import.
 *
 * Deliberately excludes everything technical or pool-related: no
 * poolStatus, poolStorageRef, questionCount, or questionIndex reference.
 * `contentPath` only ever points at the lesson's own `.md` file, never at a
 * `.pool.md` file.
 */
export interface PublicLessonDoc {
  ownerUid: string;
  programId: string;
  importId: string;
  udaId: string;
  udaDir: string;
  path: string;
  filename: string;
  contentPath: string;
  createdAt: Timestamp | FieldValue;
}

// ─── M3-lite — Approved-student access model ─────────────────────────────────

/**
 * Stored at settings/studentAccess. Global switches gating the student
 * portal. `studentPortalEnabled` must be true for ANY student read
 * (publicLessons, publishedProjection, Storage lesson files) to succeed,
 * regardless of individual approval status. `newStudentRequestsEnabled` is
 * reserved for a future self-request flow — not implemented by this PR;
 * the teacher must create students/{uid} documents manually until then.
 */
export interface StudentAccessSettings {
  ownerUid: string;
  studentPortalEnabled: boolean;
  newStudentRequestsEnabled: boolean;
}

export type StudentStatus = 'pending' | 'approved' | 'blocked';

/**
 * Stored at students/{uid}, where {uid} is the student's Firebase Auth uid.
 * A Google-authenticated non-owner is only a *candidate* student until the
 * teacher approves them here — authentication alone never grants portal
 * reads. A missing document is treated as `pending` for authorization
 * purposes (Security Rules default-deny when it doesn't exist).
 * `classId` is reserved for future class-based lesson/verification
 * filtering — not implemented by this PR.
 */
export interface StudentDoc {
  uid: string;
  ownerUid: string;
  email: string;
  displayName: string | null;
  status: StudentStatus;
  classId: string | null;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
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

/**
 * Independent from `status` (M3-lite). Defaults to `hidden` on activation;
 * the teacher toggles it while the verification stays `active`. Only
 * `active` + `public` verifications are ever visible to a student.
 */
export type VerificationVisibility = 'hidden' | 'public';

export type VerificationQuestionRef = {
  /** Firestore document id of the questionIndex entry (stable, unique per question) */
  questionIndexEntryId: string;
  /** Human-readable identifiers for display and M2-C pool lookup */
  questionLocalId: string;
  udaDir: string;
  lessonFilename: string;
  poolStorageRef: string;
  /** Metadata snapshot at selection time */
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  difficolta: 1 | 2 | 3;
  peso: 1 | 2 | 3;
  maxPoints: number;
  // NEVER include: questionText, answers, correctAnswer, solution
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
  /**
   * Absent on verifications created before M3-lite — always read through
   * `normalizeVisibility()`, which treats a missing value as `hidden`.
   */
  visibility?: VerificationVisibility;
  config: VerificationConfig;
  teacherSnapshot: VerificationTeacherSnapshot | null; // set at activation
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
  activatedAt: Timestamp | FieldValue | null;
  closedAt: Timestamp | FieldValue | null;
};

/**
 * Safe per-question data for the student-facing published projection.
 * Never includes soluzione, poolStorageRef, questionLocalId or
 * questionIndexEntryId — only what's needed to render the student PDF.
 */
export type PublicVerificationQuestion = {
  order: number;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  maxPoints: number;
  testo: string;
  /** Present only for chiusa_singola / chiusa_multipla. id + testo only — no solution marker. */
  opzioni?: { id: string; testo: string }[];
};

/**
 * Stored at verifications/{verificationId}/publishedProjection/data.
 * Written atomically with `teacherSnapshot` at activation. Deliberately does
 * NOT duplicate `status`/`visibility` — Security Rules authorize reads of
 * this doc via a get() on the parent verification, so this projection can
 * never drift from the parent's actual state. Owner: full read/write.
 * Any other authenticated user: read-only, and only while the parent is
 * `active` + `public`.
 */
export type PublishedProjectionDoc = {
  ownerUid: string;
  title: string;
  className: string | null;
  questions: PublicVerificationQuestion[];
  activatedAt: Timestamp | FieldValue;
};
