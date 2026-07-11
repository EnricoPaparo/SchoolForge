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
  | 'uda.created'
  | 'uda.updated'
  | 'uda.deleted'
  | 'uda.reordered'
  | 'lesson.created'
  | 'lesson.completed'
  | 'lesson.updated'
  | 'lesson.deleted'
  | 'lesson.reordered'
  | 'class.created'
  | 'class.updated'
  | 'verification.created'
  | 'verification.updated'
  | 'verification.activated'
  | 'verification.visibilityChanged'
  | 'verification.onlineEnabledChanged'
  | 'verification.closed'
  | 'verification.deleted'
  | 'studentAccess.updated'
  | 'studentAccess.examModeUpdated'
  | 'student.approved'
  | 'student.blocked'
  | 'student.reset'
  | 'student.removed'
  | 'student.classAssigned'
  | 'program.classesUpdated';

export interface AuditEvent {
  actorUid: string;
  action: AuditAction;
  targetId: string | null;
  outcome: 'success' | 'failure';
  reason: string | null;
  timestamp: Timestamp;
}

// ─── M1-B — Repository import ────────────────────────────────────────────────

/**
 * `classIds` determines student visibility (M3-lite): a program with no
 * classes assigned (missing or empty array) is never visible to any
 * student, even if its `publicLessons` exist and the portal is active.
 * UDA/lezioni inherit visibility from the program — they never carry
 * their own class assignment. Programs created before this field existed
 * are read back with `classIds: []` (see programsService.listPrograms) —
 * never treated as "visible to everyone" by omission.
 */
export interface ProgramDoc {
  ownerUid: string;
  title: string;
  activeImportId: string | null;
  classIds: string[];
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
  /** Stable display order inside the program/import. Import assigns this from folder order. */
  order?: number;
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
  /** Stable display order inside the UDA. Import assigns this from filename order. */
  order?: number;
  poolStatus: 'absent' | 'valid' | 'invalid';
  questionCount: number;
  storageRef: string;
  poolStorageRef: string | null;
  /** Set by the teacher in M1-D to mark a lesson as completed. */
  completed?: boolean;
  completedAt?: Timestamp | null;
  /**
   * Parsed from the lesson's own optional YAML front matter at import time
   * (never required — see LessonMetadata). Absent on lessons imported
   * before this field existed; read back as `null`, never as "no title".
   */
  titolo?: string | null;
  sottotitolo?: string | null;
  difficolta?: string | null;
  concettiChiave?: string[];
  obiettivi?: string[];
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
 * Stored at publicLessons/{lessonId} (M3-lite, extended M3F-08) — read-only
 * projection of a lesson for the student portal. Written in the same commit
 * transaction that updates `activeImportId`, and re-created from scratch on
 * every re-import (stale entries from a previous import are deleted first),
 * so a student never sees a partial or superseded import.
 *
 * Deliberately excludes everything technical or pool-related: no
 * poolStatus, poolStorageRef, questionCount, or questionIndex reference.
 * `contentPath` only ever points at the lesson's own `.md` file, never at a
 * `.pool.md` file — it is kept only as a diagnostic/teacher-tooling
 * reference now (see below), not as something the student client reads.
 *
 * `content` (M3F-08): the lesson body Markdown itself — the exact text
 * rendered to the student, already split from front matter (see
 * `parseLessonMetadata`), never the pool, soluzioni, questionIndex or any
 * technical/private metadata. This is now the ONLY source the student
 * client reads (`StudentLessonsView`/`studentLessonsService` never call
 * Storage) — `storage.rules` (M3F-08) denies a student direct Storage read
 * even with a known `contentPath`. Every write path that creates/updates a
 * lesson body must keep this field in sync with what Storage stores at
 * `contentPath` (see `lessonContentSize.ts` for the size ceiling and
 * `publicLessonsBackfillService.ts` for migrating pre-M3F-08 documents).
 * Absent on a legacy document not yet migrated — always read through
 * `normalizeLessonContent()`, which treats a missing/non-string value as
 * "projection unavailable", never as an empty-but-valid body.
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
  /**
   * Didactic metadata parsed from the lesson's own front matter — never
   * technical, safe to expose to the student like filename/path already
   * are. Absent on lessons imported before this field existed.
   */
  titolo?: string | null;
  sottotitolo?: string | null;
  difficolta?: string | null;
  concettiChiave?: string[];
  obiettivi?: string[];
  order?: number;
  content?: string;
}

/**
 * Stored at settings/publicLessonsMigration (M3F-08). Owner-only marker so
 * `LessonsView` can decide whether to show the backfill trigger without
 * running a `getDocs` scan over every `publicLessons` document on each
 * mount — the expensive check the task explicitly asked to avoid. Written
 * only by `publicLessonsBackfillService.backfillPublicLessonsContent`, and
 * only after a run whose `failed` array is empty: any failure leaves the
 * document untouched (or absent), so the trigger stays visible and the
 * backfill can be rerun. There is currently only one migration this marker
 * tracks, so `publicLessonsContentVersion` is always `1` once set — a
 * future unrelated migration would use a different settings document, not
 * a second field here.
 */
export interface PublicLessonsMigrationDoc {
  publicLessonsContentVersion: 1;
  completedAt: Timestamp | FieldValue;
}

// ─── M3-lite — Approved-student access model ─────────────────────────────────

/**
 * Stored at settings/studentAccess. Global switches gating the student
 * portal. `studentPortalEnabled` must be true for ANY student read
 * (publicLessons, publishedProjection, Storage lesson files) to succeed,
 * regardless of individual approval status. `newStudentRequestsEnabled`
 * controls whether an unknown Google-authenticated non-owner may create
 * their own `students/{uid}` request (status `pending`) — see
 * studentsService.requestStudentAccess and RoleGate.
 *
 * `examMode` (M3F-07): absent on documents written before this milestone —
 * always read through `normalizeExamMode()` (examMode.ts), which treats a
 * missing/malformed value as disabled. When active for a class it hides
 * that class's Lezioni section in the student UI and denies Firestore
 * discovery of `programs`/`publicLessons` for that class (Security Rules).
 * Since M3F-08, Storage also denies the underlying Markdown read to any
 * non-owner unconditionally, so Modalità verifica is effective end-to-end.
 */
export interface StudentAccessSettings {
  ownerUid: string;
  studentPortalEnabled: boolean;
  newStudentRequestsEnabled: boolean;
  examMode?: {
    enabled: boolean;
    scope: 'all' | 'classes';
    classIds: string[];
    enabledAt: Timestamp | FieldValue | null;
  };
  updatedAt: Timestamp | FieldValue;
  updatedBy: string;
}

export type StudentStatus = 'pending' | 'approved' | 'blocked';

/**
 * Stored at students/{uid}, where {uid} is the student's Firebase Auth uid.
 * A Google-authenticated non-owner is only a *candidate* student until the
 * teacher approves them here — authentication alone never grants portal
 * reads. A missing document is treated as `pending` for authorization
 * purposes (Security Rules default-deny when it doesn't exist).
 * `classId` is set by the teacher (M3L-A3); class-based lesson/verification
 * filtering itself is not implemented by this PR. `lastLoginAt` is set once
 * at the initial self-request — it is not refreshed on subsequent logins
 * (that would require a write rule or Cloud Function this PR intentionally
 * does not introduce).
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
  lastLoginAt: Timestamp | FieldValue;
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
  /**
   * M3-full: absent on verifications created before M3-full — always read
   * through `normalizeOnlineEnabled()`, which treats a missing value as
   * `false`. A verification is online-submittable only when
   * `status == 'active'` AND `onlineEnabled == true`.
   */
  onlineEnabled?: boolean;
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
 * Written atomically with `teacherSnapshot` at activation. Owner: full
 * read/write. Any other authenticated user: read-only, and only while
 * `visibility == 'public'` and (M3L-D) `classId` matches the student's own
 * class.
 *
 * `classId` and `visibility` ARE deliberately duplicated here from the
 * parent verification (an exception to this codebase's usual anti-drift
 * rule, e.g. `publicLessons` never copies a program's `classIds`) — a
 * student discovers matching verifications via a single `collectionGroup`
 * query on `publishedProjection` filtered by `classId` AND `visibility`
 * (the parent `verifications/{id}` document is never readable by a
 * student, so there is no other way to run that discovery query).
 * Empirically, Firestore's Security Rules can only validate a
 * `list`/collectionGroup request when every field the rule authorizes on is
 * also a field the query filters on — a cross-document `get()` back to the
 * parent (which works fine for a single-document `get`) fails `list`
 * validation here because the parent path segment isn't constrained by the
 * query. `visibility` therefore also stands in for `status`: it is kept
 * `'hidden'` on activation, mirrored on every `setVerificationVisibility`
 * toggle, and forced back to `'hidden'` on `closeVerification` — a closed
 * verification must never remain publicly readable via a stale mirror.
 * `classId: null` (verification never assigned to a class) is never visible
 * to any student, same as `ProgramDoc.classIds` — never "visible to
 * everyone" by omission.
 *
 * `onlineEnabled` (M3F-04 preflight) is mirrored from the parent verification
 * at activation, same reasoning as `classId`/`visibility`: the student's
 * "Svolgi online" button decision is made entirely from this projection
 * (StudentVerificationsView never reads the parent `verifications/{id}`), so
 * the field has to live here too. Absent on projections written before
 * M3F-04 — always read through `normalizeOnlineEnabled()`, which treats a
 * missing value as `false`. M3F-05 will add the teacher-facing toggle and
 * keep this mirror in sync the same way `setVerificationVisibility` keeps
 * `visibility` in sync; until then it is always written `false` at
 * activation (see `activateVerification`).
 */
export type PublishedProjectionDoc = {
  ownerUid: string;
  title: string;
  className: string | null;
  visibility: VerificationVisibility;
  classId: string | null;
  onlineEnabled?: boolean;
  questions: PublicVerificationQuestion[];
  activatedAt: Timestamp | FieldValue;
};

// ─── M3-full — Online submissions ────────────────────────────────────────────

/**
 * Answer value for a single question in a submission.
 * Keyed by `order.toString()` — 0-based internally, matching
 * `PublicVerificationQuestion.order` (set from the array index at
 * activation, see `activateVerification`). The UI displays `order + 1` as
 * the question number; storage itself stays 0-based throughout.
 */
export type AnswerValue =
  | { tipo: 'aperta'; testo: string }
  | { tipo: 'chiusa_singola'; selectedId: string | null }
  | { tipo: 'chiusa_multipla'; selectedIds: string[] };

/**
 * A single attention event recorded by the lightweight deterrence layer.
 * Stored in `attentionEvents[]` on SubmissionDoc.
 * `ts` is a client-side ms-epoch timestamp (not a Firestore Timestamp — kept
 * as a number to allow atomic `arrayUnion` appends without server round-trips).
 */
export type AttentionEventType =
  | 'fullscreen_exit'
  | 'copy_attempt'
  | 'cut_attempt'
  | 'paste_attempt'
  | 'context_menu_attempt'
  | 'drag_attempt'
  | 'tab_blur'
  | 'window_blur'
  | 'visibility_hidden';

export type AttentionEvent = {
  type: AttentionEventType;
  ts: number; // client ms epoch
};

/**
 * Stored at `submissions/{verificationId}_{studentUid}`.
 *
 * The doc id is deterministic: `${verificationId}_${studentUid}`. This
 * guarantees one-submission-per-(student, verification) without requiring
 * a query in Security Rules, which Firestore does not support.
 *
 * Lifecycle:
 *   - Created at `status: 'draft'` when the student opens the online exam.
 *   - Updated (still `draft`) on every autosave.
 *   - Atomically set to `status: 'submitted'` on final delivery, together
 *     with a matching SubmissionReceiptDoc (write batch).
 *   - Immutable once `submitted`; Security Rules deny any further update.
 *
 * The owner (teacher) can read all submissions for their verifications.
 * The student can read/write only while `status == 'draft'`; after submission
 * they read only the corresponding SubmissionReceiptDoc.
 *
 * `flagged` and `attentionEvents` may remain on the submitted document for the
 * teacher monitor and future correction flow. They are not exposed to students
 * after submission because students read only the matching SubmissionReceiptDoc.
 */
export type SubmissionDoc = {
  submissionId: string; // == Firestore doc id: `${verificationId}_${studentUid}`
  verificationId: string;
  studentUid: string;
  ownerUid: string;
  status: 'draft' | 'submitted';
  /** Sparse map of answers; only questions the student has touched are present. */
  answers: Record<string, AnswerValue>;
  /** Per-question "flag for review" markers; key = order.toString(). */
  flagged: Record<string, boolean>;
  /** Lightweight deterrence log; capped at 200 by Rules and respected by the M3F-04 UI. */
  attentionEvents: AttentionEvent[];
  /** Null until status becomes 'submitted'. Human-readable, e.g. "SF-2026-A3B7". */
  deliveryCode: string | null;
  /** Snapshot copied at creation time for the post-submission confirmation screen. */
  verificationTitle: string;
  className: string | null;
  startedAt: Timestamp;
  lastSavedAt: Timestamp | FieldValue;
  submittedAt: Timestamp | FieldValue | null;
};

/**
 * Stored at `submissionReceipts/{verificationId}_{studentUid}`.
 *
 * Written atomically with the final `SubmissionDoc` update in the same write
 * batch. Contains only the data the student needs to see on the confirmation
 * screen — no questions, no answers. The student reads this document after
 * submission; Security Rules deny them access to the full `SubmissionDoc`
 * once `status == 'submitted'`.
 */
export type SubmissionReceiptDoc = {
  submissionId: string; // == Firestore doc id (same as SubmissionDoc)
  verificationId: string;
  studentUid: string;
  ownerUid: string;
  verificationTitle: string;
  className: string | null;
  deliveryCode: string;
  submittedAt: Timestamp | FieldValue;
};
