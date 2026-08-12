import type { PoolDifficulty } from '@schoolforge/lesson-contract';
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
  | 'program.metadataUpdated'
  | 'program.deleted'
  | 'uda.created'
  | 'uda.updated'
  | 'uda.deleted'
  | 'uda.reordered'
  | 'lesson.created'
  | 'lesson.completed'
  /**
   * CONCEPT-MAP-02 — salvataggio della mappa concettuale di una lezione.
   * Nome in `camelCase` dopo il punto come tutte le azioni esistenti
   * (`program.metadataUpdated`, `verification.visibilityChanged`): la
   * coerenza del registro vale più di una sfumatura di leggibilità.
   */
  | 'lesson.conceptMapSaved'
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
  | 'verification.studentPdfEnabledChanged'
  | 'verification.closed'
  | 'verification.deleted'
  | 'submission.deleted'
  | 'studentAccess.updated'
  | 'studentAccess.examModeUpdated'
  | 'student.approved'
  | 'student.blocked'
  | 'student.reset'
  | 'student.removed'
  | 'student.classAssigned'
  /**
   * VDIF-01 — registro delle etichette operative del docente. Grafia
   * `oggetto.azionePassata` come tutte le azioni esistenti (`class.created`,
   * `verification.activated`). `targetId` è il `labelId`; `reason` resta
   * **sempre `null`**: `auditEvents` è owner-only, ma il nome dell'etichetta è
   * testo libero scelto dal docente e non ha motivo di transitare nei log.
   */
  | 'label.created'
  | 'label.updated'
  | 'label.deleted'
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
  /**
   * Import lifecycle state (HARD-02B-2 / HARD-F06). `'staging'` while the
   * import is being written (invisible — `program.activeImportId` still
   * points at the previous import), `'active'` once the atomic switch
   * promotes it, `'superseded'` (best-effort) once a later import replaces
   * it. Legacy imports carried `'committed'` (or had no status) and are
   * treated as `'active'` when they equal `program.activeImportId`, else
   * `'superseded'`. No automatic migration is performed.
   */
  status: 'staging' | 'active' | 'superseded' | 'committed';
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
  /**
   * Didactic UDA title from the front matter `titolo` (EXP-01). Optional and
   * backward-compatible: UDA documents written before this field was
   * persisted have no `titolo`, and readers fall back to a readable label
   * derived from `dir`. Never technical (never the `uda-XX-slug` dir).
   */
  titolo?: string | null;
}

/** Stored at programs/{programId}/imports/{importId}/lessons/{lessonId} */
export interface LessonDoc {
  ownerUid: string;
  importId: string;
  udaDir: string;
  path: string;
  filename: string;
  /**
   * Import-scoped id of this lesson's `publicLessons` projection
   * (`${importId}_${lessonId}`), written from HARD-02B-1 onward. Absent on
   * lessons imported before HARD-02B-1: those projections use the bare
   * `lessonId` and are resolved via `resolvePublicLessonId` (never a second
   * Firestore lookup). See `programs/publicLessonId.ts`.
   */
  publicLessonId?: string;
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
   * CONCEPT-MAP-02 — copia **autorevole** della mappa concettuale, dentro la
   * sottocollezione owner-only. È la sorgente da cui la proiezione studente
   * viene sincronizzata, mai il contrario.
   *
   * Assente su ogni lezione che non ha (ancora) una mappa: nessuna migrazione,
   * e un documento legacy senza il campo è valido. Quando presente è una
   * stringa non vuota entro `MAX_CONCEPT_MAP_BYTES` (32.000 byte UTF-8) — vedi
   * `conceptMapContract.ts`, che è l'unico punto in cui il vincolo è deciso.
   * Il valore non viene mai normalizzato: si legge attraverso
   * `readPrivateConceptMap`, che tratta assente/malformato come `null` e mai
   * come mappa vuota.
   */
  conceptMapMarkdown?: string;
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
  /** POOL-SIMPLE v2: integer 1–5. `maxPoints` is always derived as `maxPoints === difficolta`. */
  difficolta: PoolDifficulty;
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
 * client reads (`StudentDidatticaView`/`studentLessonsService` never call
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
  /** Teacher-managed completion state; absent on legacy projections means false. */
  completed?: boolean;
  content?: string;
  /**
   * CONCEPT-MAP-02 — proiezione studente della mappa concettuale, presente
   * **soltanto** quando `completed === true` e una mappa privata valida esiste
   * davvero.
   *
   * La visibilità è un confine **dati**, non una condizione di interfaccia:
   * finché la lezione non è svolta il campo non deve esistere in questo
   * documento, così uno studente non può leggerlo nemmeno con un `get()`
   * diretto. Le Security Rules difendono lo stesso invariante — un documento
   * con `completed != true` che contenga il campo è rifiutato in scrittura — e
   * `readPublicConceptMap` lo riapplica in lettura per difesa in profondità.
   *
   * Smarcare la lezione **rimuove** il campo nella stessa transazione.
   * Proiezioni legacy prive del campo restano valide, senza migrazione.
   */
  conceptMapMarkdown?: string;
}

/**
 * Stored at settings/publicLessonsMigration (M3F-08). Owner-only marker so
 * the Didattica maintenance notice can decide whether to show the backfill trigger without
 * running a `getDocs` scan over every `publicLessons` document on each
 * mount — the expensive check the task explicitly asked to avoid. Written
 * only by `publicLessonsBackfillService.backfillPublicLessonsContent`, and
 * only after a run whose `failed` array is empty: any failure leaves the
 * document untouched (or absent), so the trigger stays visible and the
 * backfill can be rerun. Version 2 also synchronizes the teacher-managed
 * lesson completion flag used by the read-only student progress bar.
 */
export interface PublicLessonsMigrationDoc {
  publicLessonsContentVersion: 2;
  completedAt: Timestamp | FieldValue;
}

// ─── ANNOT-01 — Student personal lesson notes ────────────────────────────────

/**
 * Stored at `students/{studentUid}/lessonNotes/{publicLessonId}` — a single,
 * strictly personal text note a student keeps for one public lesson (at most
 * one document per (student, lesson) pair, enforced by the deterministic
 * path). Never readable or writable by the teacher/owner or any other
 * student (see `firestore.rules` — the parent `students/{uid}` rules do NOT
 * propagate to this subcollection). Every operation is additionally denied
 * while Modalità verifica applies to the student's class.
 *
 * `lessonId` is deliberately absent: `PublicLessonDoc` carries no canonical
 * lesson-identity field of its own — the lesson's identity IS its
 * `publicLessons` document id (`publicLessonId`). ANNOT-00's proposed
 * `lessonId` field was resolved during ANNOT-01 to that document id rather
 * than duplicating an unverifiable identity the Security Rules could never
 * check (see `documentazione/student-notes-contract.md` §4). `programId`
 * and `importId` are the ones the Rules can verify against the associated
 * `publicLessons/{publicLessonId}` projection, and are the only identity
 * fields kept beyond the two the path already pins.
 *
 * `content` is the ONLY mutable field (plus `updatedAt`): a plain string of
 * at most 20 000 characters, never the lesson body, title, class, name,
 * email, pool, questions or solutions. No projection of didactic data is
 * duplicated here.
 */
export interface StudentLessonNoteDoc {
  /** == `{studentUid}` in the path == `request.auth.uid`; immutable. */
  studentUid: string;
  /** == the Firestore document id == the associated `publicLessons` id; immutable. */
  publicLessonId: string;
  /** == `programId` of the associated `publicLessons/{publicLessonId}`; immutable. */
  programId: string;
  /** == the program's `activeImportId` and the associated publicLesson's `importId`; immutable. */
  importId: string;
  /** The note text. String, at most 20 000 characters. The only content field. */
  content: string;
  /** `request.time` at creation; immutable thereafter. */
  createdAt: Timestamp | FieldValue;
  /** `request.time` at every write (create and update). */
  updatedAt: Timestamp | FieldValue;
}

/**
 * Lightweight per-course index stored at
 * `students/{studentUid}/lessonNoteIndexes/{programId}`. It contains only
 * identifiers for lessons whose persisted note has non-blank content; never
 * note text or duplicated personal/didactic data.
 */
export interface StudentLessonNoteIndexDoc {
  /** == `{studentUid}` in the path == `request.auth.uid`; immutable. */
  studentUid: string;
  /** == `{programId}` in the path; immutable. */
  programId: string;
  /** Current active import of the program. */
  importId: string;
  /** Unique public lesson ids with a persisted, trim-non-empty note; max 500. */
  lessonIds: string[];
  /** `request.time` at every create/update. */
  updatedAt: Timestamp | FieldValue;
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
 * filtering itself is not implemented by this PR.
 *
 * Access telemetry (TWU-01):
 * - `lastLoginAt` / `createdAt` are stamped once at the initial self-request.
 *   They represent **when access was requested**, not a real portal entry, and
 *   are surfaced in the teacher UI as "Richiesta accesso".
 * - `firstPortalAccessAt` (optional) is stamped the first time the approved
 *   student actually opens the portal; once present it is immutable.
 * - `lastPortalAccessAt` (optional) is stamped on that same first entry and
 *   refreshed on every subsequent real entry.
 * Legacy documents predating TWU-01 have neither portal field; the teacher UI
 * shows "—" for them until the student's next real access. The student writes
 * these two fields client-side under a tightly-scoped Security Rule; no Cloud
 * Function, listener or polling is involved.
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
  /** TWU-01: first real portal entry after approval; immutable once set. */
  firstPortalAccessAt?: Timestamp | FieldValue;
  /** TWU-01: most recent real portal entry; refreshed each entry. */
  lastPortalAccessAt?: Timestamp | FieldValue;
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

// ─── VDIF-01 — Registro etichette operative (owner-only) ─────────────────────

/**
 * Stored at `differentiationLabels/{labelId}`.
 *
 * Etichetta operativa **privata del docente**: serve al sistema solo per sapere
 * *quale versione servire*, mai *perché*. Owner-only in lettura e scrittura;
 * nessun campo di questo documento raggiunge mai una superficie leggibile dallo
 * studente (contratto §4 e §5.D.5c di `verifiche-differenziate-roadmap.md`).
 *
 * **Contratto chiuso a otto chiavi.** Non esistono `color`, `note`,
 * `description`, `category`, `priority` o `order`: ognuno sarebbe l'appiglio per
 * scriverci una motivazione, ed è esattamente ciò che il principio «nessun dato
 * sanitario o certificativo nel database» vieta.
 */
export interface DifferentiationLabelDoc {
  /** `== {labelId}` del path. Opaco (`crypto.randomUUID()`), mai derivato dal nome. */
  labelId: string;
  ownerUid: string;
  /** Forma canonica mostrata al docente (vedi `normalizeLabelName`). */
  name: string;
  /** Forma normalizzata usata **solo** per unicità e confronto (`computeNameKey`). */
  nameKey: string;
  /** Assegnazioni studente correnti. VDIF-02 lo muove; VDIF-01 lo crea a 0 e lo rispetta. */
  assignedCount: number;
  /** Verifiche in bozza che riferiscono l'etichetta. VDIF-03/04 lo muovono. */
  draftUsageCount: number;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

/**
 * Stored at `differentiationLabelNames/{reservationId}`, where
 * `reservationId = hex(SHA-256(UTF8(ownerUid + U+0000 + nameKey)))`.
 *
 * È il documento che rende l'unicità del nome **autorevole**: la creazione
 * avviene nella stessa transazione dell'etichetta, quindi due tentativi
 * concorrenti sullo stesso `nameKey` non possono riuscire entrambi. Il nome non
 * compare mai in chiaro nel path — un path finisce in log, errori e tracce di
 * rete, e l'hash lo impedisce per costruzione.
 *
 * Contratto chiuso a quattro chiavi. `update` è **sempre negato**: una
 * prenotazione si crea e si rilascia, non si muta.
 */
export interface DifferentiationLabelNameReservationDoc {
  ownerUid: string;
  /** Etichetta che detiene la prenotazione. */
  labelId: string;
  /** `nameKey` prenotato, per dimostrare la coerenza con l'etichetta. */
  nameKey: string;
  createdAt: Timestamp | FieldValue;
}

/**
 * Stored at `studentLabelAssignments/{studentUid}` (VDIF-02).
 *
 * Relazione **privata del docente** «questo studente ha questa etichetta».
 * Owner-only in lettura e scrittura: nessuno studente — nemmeno il proprietario
 * dello `studentUid` — può leggerla, e nessun campo raggiunge una superficie
 * student-readable.
 *
 * **L'assenza del documento significa «Nessuna etichetta».** Non esiste un
 * `labelId: null`: sarebbe un secondo modo di dire la stessa cosa, e ogni
 * lettore dovrebbe gestirne due. L'id deterministico garantisce da solo
 * l'invariante «al massimo una etichetta per studente», senza query di unicità.
 *
 * Il **nome** dell'etichetta non è duplicato qui: si unisce in memoria via
 * `labelId`, così una rinomina si riflette senza toccare una sola assegnazione.
 */
export interface StudentLabelAssignmentDoc {
  /** `== {studentUid}` del path, **immutabile**. */
  studentUid: string;
  ownerUid: string;
  /** Id di una `DifferentiationLabelDoc` esistente dello stesso owner. Mai vuoto, mai `null`. */
  labelId: string;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

export type VerificationStatus = 'draft' | 'active' | 'closed';
export type PublishedVerificationStatus = Exclude<VerificationStatus, 'draft'>;

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
  /** POOL-SIMPLE v2: integer 1–5, frozen at selection. `maxPoints === difficolta`. */
  difficolta: PoolDifficulty;
  maxPoints: number;
  // NEVER include: questionText, answers, correctAnswer, solution
};

/**
 * VEX — modalità di distribuzione online (§ vex-contract.md).
 * `same_questions`: tutti ricevono le stesse domande, ordine casuale locale
 * (comportamento attuale, invariato). `equivalent_variants`: domande comuni +
 * una alternativa per gruppo (assegnazione server-side, NON in VEX-01A).
 */
export type VerificationDistributionMode = 'same_questions' | 'equivalent_variants';

/**
 * VEX — gruppo di alternative equivalenti nel draft. Referenzia
 * `questionIndexEntryId` STABILI (non `order`, che esiste solo dopo
 * l'attivazione). `id` generato client-side con `crypto.randomUUID()`,
 * immutabile dopo la creazione.
 */
export type EquivalentGroupConfig = {
  id: string;
  questionIndexEntryIds: string[];
};

/**
 * UI-VERIFICHE-06B — una UDA del perimetro didattico della verifica. Contratto
 * **chiuso**: solo titoli, mai identificativi, ordini, testi, soluzioni o
 * metadati tecnici (vedi `topicOutline.ts` per l'elenco esplicito di ciò che è
 * vietato). Identico per docente e studente.
 */
export type VerificationTopicUda = {
  udaTitle: string;
  /** Titoli delle lezioni da cui proviene almeno una domanda selezionata. */
  lessonTitles: string[];
};

export type VerificationConfig = {
  title: string;
  classId: string | null;
  programId: string;
  importId: string;
  /**
   * UI-VERIFICHE-06B — giorno didattico della verifica, formato esatto
   * `YYYY-MM-DD` (mai un `Timestamp`: è un giorno, non un istante). Obbligatorio
   * per le verifiche create da qui in avanti e modificabile finché la verifica è
   * in bozza. Assente sui documenti precedenti: nessuna migrazione, nessun
   * fallback: la card legacy omette semplicemente la data.
   */
  verificationDate?: string;
  /**
   * UI-VERIFICHE-06B — perimetro didattico mantenuto coerente con la selezione
   * delle domande nello **stesso** salvataggio della bozza (nessuna write
   * dedicata). All'attivazione viene ricostruito e rivalidato autorevolmente dai
   * dati canonici del corso: il valore del client non è mai la fonte di verità.
   */
  topicOutline?: VerificationTopicUda[];
  questionRefs: VerificationQuestionRef[];
  /**
   * VEX (VEX-01A): assente su draft/documenti legacy ⇒ normalizzato a
   * `same_questions` (vedi `normalizeDistributionMode`). Un valore presente ma
   * sconosciuto è un errore leggibile, mai un fallback silenzioso.
   */
  distributionMode?: VerificationDistributionMode;
  /**
   * VEX: presente solo in `equivalent_variants`; assente ⇔ `[]`. In
   * `same_questions` i gruppi possono restare salvati nel draft ma sono
   * inattivi e ignorati da attivazione/snapshot.
   */
  equivalentGroups?: EquivalentGroupConfig[];
  // `questionsPerStudent` RIMOSSO in VEX-01A: campo mai usato, assorbito dal
  // modello VEX (le domande per studente sono derivate, non configurabili).
};

/**
 * A single question, fully embedded (owner-only, set at activation) so the
 * teacher's own PDF downloads (normal + solutions) for an `active`/`closed`
 * verification never need to re-read the current pool file from Storage.
 * Deliberately minimal: only what `downloadStudentPdf`/
 * `downloadTeacherSolutionsPdf` actually render — no `poolStorageRef`,
 * `questionLocalId` or `questionIndexEntryId` (those stay on
 * `VerificationQuestionRef`/`config.questionRefs`, which remains the
 * tracking/compatibility record, not the PDF data source once this field is
 * present). Frozen at activation; never rewritten afterwards (Security
 * Rules already forbid any post-activation update to `teacherSnapshot` as a
 * whole — see `firestore.rules`, `verifications/{docId}` update rules).
 */
export type VerificationTeacherQuestionSnapshot = {
  order: number;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  maxPoints: number;
  testo: string;
  /**
   * POOL-SIMPLE v2: integer difficulty 1–5, frozen from the selected
   * `VerificationQuestionRef` at activation and shown in the teacher correction
   * workspace. `maxPoints === difficolta`. Kept owner-only here; deliberately
   * NOT copied into the public projection. There is no `peso` (removed in
   * POOL-SIMPLE-02) and no legacy fallback — every V2 snapshot carries it.
   */
  difficolta: PoolDifficulty;
  /** Present only for chiusa_singola / chiusa_multipla. id + testo only. */
  opzioni?: { id: string; testo: string }[];
  /** string for aperta/chiusa_singola, string[] for chiusa_multipla. */
  soluzione: string | string[];
  /**
   * EXAM-UX-03 — limite caratteri della risposta aperta, congelato dal pool
   * all'attivazione. Presente solo per `aperta` e solo se impostato; assente/
   * legacy ⇒ default effettivo 2000. Mai riscritto dopo l'attivazione.
   */
  maxCharacters?: number;
};

/**
 * VEX — gruppo equivalente congelato nello snapshot: le alternative espresse
 * come `order` (0-based) dentro `questions[]`. Popolato all'attivazione dalla
 * conversione entryId→order (VEX-01B). Preparazione tipi in VEX-01A.
 */
export type EquivalentGroupSnapshot = {
  id: string;
  alternativeOrders: number[];
};

/** Teacher-side full snapshot (owner-only, set at activation) */
export type VerificationTeacherSnapshot = {
  title: string;
  classId: string | null;
  className: string | null;
  programId: string;
  importId: string;
  /** UI-VERIFICHE-06B — congelata all'attivazione, come gli altri dati didattici. */
  verificationDate?: string;
  /** UI-VERIFICHE-06B — perimetro ricostruito autorevolmente e congelato. */
  topicOutline?: VerificationTopicUda[];
  questionRefs: VerificationQuestionRef[];
  /**
   * VEX: modalità con cui la verifica è stata attivata. Assente su snapshot
   * legacy ⇒ `same_questions`. In `same_questions` `equivalentGroups` è ignorato.
   */
  distributionMode?: VerificationDistributionMode;
  /** VEX: order (0-based) delle domande comuni (assegnate a tutti). */
  commonQuestionOrders?: number[];
  /** VEX: presente solo in `equivalent_variants`. */
  equivalentGroups?: EquivalentGroupSnapshot[];
  /**
   * Absent on verifications activated before this field existed (legacy) —
   * those keep resolving PDFs from `questionRefs` + the current Storage
   * pool files (see `resolvePdfSource`/`loadSelectedQuestions*` in
   * `VerificationsView.tsx`). Every verification activated from now on
   * always has this populated; `questionRefs` is kept alongside it purely
   * for tracking/compatibility, not as a PDF data source once `questions`
   * is present.
   */
  questions?: VerificationTeacherQuestionSnapshot[];
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
  /**
   * M3F-09: controls exclusively whether a student may download the
   * verification PDF (`StudentVerificationsView` "Scarica PDF") — entirely
   * independent of `onlineEnabled`, `visibility`, and `status`. Absent on
   * verifications created before this field existed — always read through
   * `normalizeStudentPdfEnabled()`, which treats a missing value as `false`
   * (fail-closed). Unlike `visibility`/`onlineEnabled`, the teacher may
   * toggle this while the verification is `draft`, `active`, or `closed` —
   * it never reopens a closed verification or makes a hidden/draft one
   * visible: `studentPdfEnabled == true` only matters once the verification
   * is otherwise `active` + `visibility == 'public'` + assigned to the
   * student's class (see `PublishedProjectionDoc.studentPdfEnabled`, the
   * mirror the student client actually reads). Never affects the teacher's
   * own PDF downloads (`downloadStudentPdf`/`downloadTeacherSolutionsPdf`),
   * which stay owner-only and ungated by this field.
   */
  studentPdfEnabled?: boolean;
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
  /**
   * EXAM-UX-03 — limite caratteri della risposta aperta (solo `aperta`, solo se
   * impostato). Copiato dal pool all'attivazione; assente/legacy ⇒ OnlineExamView
   * usa il default 2000.
   */
  maxCharacters?: number;
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
 * query. M4-LIFE-01 duplicates `status` too, but only for UI semantics:
 * legacy missing means `active`, while `closeVerification` writes `closed`
 * and preserves the independently controlled visibility. Submission Rules
 * still read the parent and require it to be active.
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
  /** Absent on legacy projections; normalized to `active` by student readers. */
  status?: PublishedVerificationStatus;
  classId: string | null;
  onlineEnabled?: boolean;
  /**
   * Mirrored from the parent verification (M3F-09), same reasoning as
   * `onlineEnabled`/`visibility`: the student's "Scarica PDF" button
   * decision is made entirely from this projection
   * (`StudentVerificationsView` never reads the parent `verifications/{id}`
   * document). Absent on projections written before M3F-09 — always read
   * through `normalizeStudentPdfEnabled()`, which treats a missing value as
   * `false`. Kept in sync by `setVerificationStudentPdfEnabled` whenever the
   * projection already exists (i.e. the verification has been activated at
   * least once); a still-`draft` verification has no projection document
   * yet, so there is nothing to mirror until activation writes it.
   */
  studentPdfEnabled?: boolean;
  /**
   * VEX (VEX-02A): modalità di distribuzione, rispecchiata all'attivazione così
   * che il portale studente sappia instradare il flusso (callable VEX vs
   * client-only) SENZA leggere il documento verifica owner-only. Assente su
   * proiezioni legacy ⇒ `same_questions` (normalizzata fail-closed alla lettura).
   * In `equivalent_variants` `questions` contiene **solo le domande comuni**: le
   * domande effettivamente assegnate arrivano esclusivamente dalla callable.
   */
  distributionMode?: VerificationDistributionMode;
  /**
   * UI-VERIFICHE-06B — giorno didattico (`YYYY-MM-DD`), rispecchiato
   * all'attivazione come `className`/`title`: la card studente lo mostra senza
   * mai leggere il documento verifica owner-only. Assente sulle proiezioni
   * precedenti e sulle verifiche legacy senza data ⇒ semplicemente omesso.
   */
  verificationDate?: string;
  /**
   * UI-VERIFICHE-06B — perimetro didattico. È **lo stesso identico dato** dello
   * snapshot docente: contiene solo titoli UDA/lezione, quindi non esiste una
   * versione ridotta per lo studente. In `equivalent_variants` descrive l'unione
   * delle lezioni di tutte le domande selezionate, comuni e alternative: è quindi
   * identico per tutti gli studenti e non rivela la variante assegnata.
   */
  topicOutline?: VerificationTopicUda[];
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
export type SubmissionCorrectionSummary = {
  totalPoints: number;
  maxPoints: number;
  percentage: number | null;
};

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
  /**
   * Ultimo salvataggio **reale dello studente**. FORCE-SUBMIT-01 non lo tocca:
   * una chiusura forzata dal docente non è un salvataggio, e sovrascriverlo
   * cancellerebbe l'unica traccia di quanto fosse vecchia la versione acquisita.
   */
  lastSavedAt: Timestamp | FieldValue;
  submittedAt: Timestamp | FieldValue | null;
  /**
   * FORCE-SUBMIT-01 — presente **solo** quando la consegna è stata acquisita e
   * chiusa dal docente («Chiudi e consegna») invece che inviata dallo studente.
   * Assente su ogni consegna normale: il campo è un marcatore, non un flag, e
   * l'unico valore ammesso è il letterale `true` (mai `false`).
   *
   * Server-only: lo scrive esclusivamente la callable `forceSubmitSubmission`
   * tramite Admin SDK. Le Security Rules non lo includono in nessun key-set
   * consentito al client, quindi né lo studente né il docente possono crearlo,
   * modificarlo o rimuoverlo con una scrittura diretta.
   */
  forcedByTeacher?: true;

  /**
   * FORCE-SUBMIT-02 — marcatori della **chiusura programmata**, scritti insieme
   * dalla callable `scheduleForceCloseSubmissions` e rimossi nello stesso update
   * che consegna la bozza (o quando la programmazione decade).
   *
   * Server-only esattamente come `forcedByTeacher`: i key-set chiusi delle Rules
   * non li includono, quindi lo studente non può crearli, modificarli né
   * rimuoverli — ma **può leggerli** sulla propria bozza, ed è così che il
   * portale mostra il banner di preavviso senza alcun listener aggiuntivo.
   *
   * Vivono e muoiono insieme: o ci sono tutti e tre, o non c'è nessuno.
   * Presenti solo mentre `status === 'draft'`.
   */
  forceCloseRequestId?: string;
  /** Istante oltre il quale la task server-side acquisisce la bozza. */
  forceCloseDeadline?: Timestamp;
  /** Istante in cui il docente ha programmato la chiusura. */
  forceCloseRequestedAt?: Timestamp;
  /**
   * VEX (VEX-01B): presente SOLO in `equivalent_variants`. Scritto UNA SOLA
   * VOLTA dal server (callable `assignVerificationVariant`, Admin SDK) al primo
   * avvio: gli `order` (0-based) effettivamente assegnati allo studente
   * (comuni + una alternativa per gruppo). Mai riscritto; il client non può
   * crearlo, modificarlo o rimuoverlo (Firestore Rules). Assente ⇒ non ancora
   * assegnata (o modalità `same_questions`, dove il campo non esiste).
   */
  assignedQuestionOrders?: number[];
  /**
   * VEX (VEX-02A): mirror **string** di `assignedQuestionOrders`
   * (`order.toString()`), scritto insieme ad esso dalla callable. Server-only,
   * come `assignedQuestionOrders`. Esiste per un solo motivo: le Firestore Rules
   * non sanno convertire numeri→stringa né iterare, quindi non possono validare
   * che le chiavi di `answers`/`flagged` (stringhe) siano un sottoinsieme di
   * `assignedQuestionOrders` (numeri). Con questo mirror le Rules impongono
   * `answers.keys().hasOnly(assignedAnswerKeys)`. Presente ⇔ `equivalent_variants`.
   */
  assignedAnswerKeys?: string[];
  /** Teacher-controlled public lifecycle mirror; absent on legacy submissions means `submitted`. */
  correctionStatus?: SubmissionCorrectionStatus;
  correctionStatusUpdatedAt?: Timestamp | FieldValue;
  /** Owner-only monitor mirror. Never copied to the student-readable receipt. */
  correctionSummary?: SubmissionCorrectionSummary;
  correctionSummaryUpdatedAt?: Timestamp | FieldValue;
};

export type SubmissionCorrectionStatus = 'submitted' | 'in_progress' | 'completed' | 'returned';

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
  /**
   * FORCE-SUBMIT-01 — mirror del marcatore sulla submission, scritto nella
   * stessa transazione. Serve allo studente, che dopo la consegna può leggere
   * soltanto questo documento: è così che il portale sa mostrare «Consegna
   * acquisita dal docente» invece della conferma di invio ordinaria.
   * Server-only e assente sulle consegne normali, come sulla submission.
   */
  forcedByTeacher?: true;
  /** Same minimal lifecycle mirror as SubmissionDoc; never contains scores or feedback. */
  correctionStatus?: SubmissionCorrectionStatus;
  correctionStatusUpdatedAt?: Timestamp | FieldValue;
};

// ─── M4-00 — Correction contract ─────────────────────────────────────────────
//
// Defines the canonical data shape for manual correction of submitted
// online submissions. M4-00 is contract-only: no service layer, no
// Security Rules, no UI. See `documentazione/api-contract.md` §M4-00 and
// `documentazione/m4-correzione-ux-concept.md` for the approved UX and
// product decisions this contract encodes; see `documentazione/
// piano-implementazione.md` §M4-01 for the exact scope of what reads/writes
// these documents next.

/**
 * Canonical lifecycle of a correction (D-M4-03). There is no `'none'`/
 * `'to_correct'` status: when no `CorrectionDoc` exists yet for a submitted
 * submission, the UI derives "Da correggere" itself (see
 * `deriveCorrectionUiStatus` in `correctionContract.ts`) rather than a
 * placeholder document being created. The first status a `CorrectionDoc`
 * is ever created with is always `'in_progress'`.
 */
export type CorrectionStatus = 'in_progress' | 'completed' | 'returned';

/**
 * The evaluation of a single question, keyed by `order.toString()` on
 * `CorrectionDoc.evaluations` — the exact same key space as
 * `SubmissionDoc.answers` and `PublicVerificationQuestion.order`. `order` is
 * therefore the one stable identity a `QuestionEvaluation` is ever linked
 * to: it is frozen at verification activation (`publishedProjection.
 * questions[i].order`) and never depends on the current state of the
 * source pool, which may have been edited or deleted since (D-M4-04).
 *
 * `maxPoints` is copied once, when the `CorrectionDoc` is first created,
 * from `publishedProjection.questions[order].maxPoints` — never from the
 * live pool, and never recomputed afterwards even if the (immutable, once
 * activated) verification's projection could theoretically be re-read.
 * This keeps a correction fully self-contained for scoring math without
 * embedding the question text, options, or the teacher's solution — those
 * stay in `teacherSnapshot`/`publishedProjection`, which the correction
 * workspace reads alongside (never through) this document.
 */
export type QuestionEvaluation = {
  order: number;
  /**
   * `null` = not yet evaluated. Distinguishing "not evaluated" from a
   * legitimate `0` is required for `isCorrectionComplete` (D-M4-06): a
   * question deliberately scored `0` counts as evaluated, `null` never
   * does.
   */
  points: number | null;
  /** Frozen at correction creation — see the type-level doc above. */
  maxPoints: number;
  feedback?: string;
};

/**
 * Stored at `corrections/{submissionId}` — deliberately the same
 * deterministic id as the `SubmissionDoc` it corrects (D-M4-01), not
 * `${verificationId}_${studentUid}` spelled out again: the two are the same
 * string by construction (`SubmissionDoc.submissionId`), and reusing it
 * keeps a 1:1 relationship enforceable by path alone, the same reasoning
 * `submissions`/`submissionReceipts` already use for
 * (verificationId, studentUid) uniqueness.
 *
 * Never contains the submission's `answers`, `attentionEvents`, or any
 * question text/options/solution (D-M4-02): those are read by the
 * correction workspace directly from `SubmissionDoc` (owner-only, still
 * readable after `submitted`) and `teacherSnapshot`/`publishedProjection`.
 * This document is scoring/workflow state only.
 *
 * `totalPoints`, `maxPoints` and `percentage` are always derived — see
 * `computeCorrectionTotals` in `correctionContract.ts` — never written
 * freehand by a caller (D-M4-07).
 */
export type CorrectionDoc = {
  submissionId: string; // == Firestore doc id, == SubmissionDoc.submissionId
  verificationId: string;
  studentUid: string;
  ownerUid: string;
  status: CorrectionStatus;
  /** Sparse-in-principle, dense in practice: one entry per question in the projection. Key = order.toString(). */
  evaluations: Record<string, QuestionEvaluation>;
  generalFeedback: string | null;
  /** Derived — sum of non-null `evaluations[*].points`. Never written directly. */
  totalPoints: number;
  /** Derived — sum of `evaluations[*].maxPoints`. Never written directly. */
  maxPoints: number;
  /** Derived, rounded — see `computeCorrectionTotals`. `null` only when `maxPoints === 0`. */
  percentage: number | null;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
  /** Set on the transition to `'completed'`; cleared back to `null` on reopen. */
  completedAt: Timestamp | FieldValue | null;
  /** Set on the transition to `'returned'`; cleared back to `null` on reopen. */
  returnedAt: Timestamp | FieldValue | null;
  /**
   * Persistent, minimal counter incremented every time the correction is
   * reopened (`completed`/`returned` → `in_progress`). Starts at `0` on
   * creation and never resets. This is how M4-01's service layer
   * distinguishes "first-pass compilation" (`reopenCount === 0`, no
   * `correctionEvents` written on save, however many times the docente
   * saves) from "editing after a reopen" (`reopenCount > 0`, a save that
   * actually changes an evaluation writes a `'scoreAdjusted'` event
   * alongside the update, atomically) — see `isReopenedCorrection` in
   * `correctionContract.ts`.
   */
  reopenCount: number;
};

/**
 * A single question's before/after delta — only ever recorded when
 * `points` and/or `feedback` actually changed. See
 * `computeQuestionEvaluationDeltas` in `correctionContract.ts`.
 */
export type QuestionEvaluationDelta = {
  order: number;
  previousPoints: number | null;
  nextPoints: number | null;
  previousFeedback?: string;
  nextFeedback?: string;
};

/**
 * Append-only audit trail (D-M4-10) for state changes that happen after a
 * correction has already left `'in_progress'` once — i.e. reopening a
 * `completed`/`returned` correction, returning it, or adjusting scores on a
 * correction that has `reopenCount > 0`. Routine progress on the first pass
 * (`reopenCount === 0`, saving scores question by question) does **not**
 * produce events: that would turn this into an autosave log, which
 * D-M4-12 explicitly rules out. `'hidden'` is deliberately not a member of
 * `CorrectionEventType` — showing/hiding a returned correction
 * (`CorrectionReturnDoc.visibleToStudent`) is formalized in M4-00, but the
 * docente-facing hide action and its audit story are not, and are left to
 * M4-01 rather than named here ambiguously.
 *
 * Deliberately minimal — the state transition plus, only when relevant,
 * the specific fields that changed. Never the full `evaluations` map or
 * the submission. Never updated or deleted once written.
 */
export type CorrectionEventType = 'reopened' | 'scoreAdjusted' | 'returned' | 'correctionCleared';

/** Stored at `correctionEvents/{eventId}` — `eventId` is an auto-generated id, not deterministic (many events per correction). */
export type CorrectionEventDoc = {
  correctionId: string; // == submissionId == CorrectionDoc doc id, denormalized for a simple equality query
  ownerUid: string;
  type: CorrectionEventType;
  actorUid: string;
  previousStatus: CorrectionStatus | null;
  nextStatus: CorrectionStatus;
  reason: string | null;
  /**
   * Only the questions whose `points` and/or `feedback` actually changed
   * since the correction was last saved — never the full `evaluations`
   * map. Absent/empty for a pure status transition with no accompanying
   * score edit (e.g. `'reopened'` with nothing changed yet, or `'returned'`
   * with no last-minute edit).
   */
  questionDeltas?: QuestionEvaluationDelta[];
  /** Present only when `CorrectionDoc.generalFeedback` changed in the same write. */
  generalFeedbackDelta?: { previous: string | null; next: string | null };
  timestamp: Timestamp | FieldValue;
};

/**
 * Per-question recap embedded in `CorrectionReturnDoc` — deliberately a
 * self-sufficient copy (question text/options/student answer/score), not a
 * reference into `SubmissionDoc`/`teacherSnapshot`/`publishedProjection`:
 * those may become unreadable to the student by the time they read this
 * projection (verification closed/hidden, Modalità verifica active, etc.),
 * and a returned result must remain readable regardless. `correctAnswer` is
 * copied from the immutable teacher snapshot on return and is physically
 * removed only when the teacher explicitly hides solutions — see
 * `CorrectionReturnDoc.solutionsVisible`.
 */
export type CorrectionReturnQuestionView = {
  order: number;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  testo: string;
  /** Present only for chiusa_singola/chiusa_multipla. id + testo only — never which option is correct. */
  opzioni?: { id: string; testo: string }[];
  /** Copied from the submission's `answers[order]` at return time. `null` if the student left the question blank. */
  studentAnswer: AnswerValue | null;
  /**
   * Always a definite number once returned — never `null`. A correction
   * must be `completed` (every question evaluated) before it can be
   * returned (see `isValidCorrectionStatusTransition`), so there is no
   * "returned but still ungraded" state to represent here.
   */
  points: number;
  maxPoints: number;
  feedback?: string;
  /**
   * Present only while `CorrectionReturnDoc.solutionsVisible === true` for
   * this question's snapshot. `string` for aperta/chiusa_singola, `string[]`
   * for chiusa_multipla — same shape as
   * `VerificationTeacherQuestionSnapshot.soluzione`.
   */
  correctAnswer?: string | string[];
};

/**
 * Self-sufficient, write-only-from-the-teacher projection the student reads
 * once a correction is `'returned'` (D-M4-09). Never depends on
 * `publishedProjection`/`teacherSnapshot` being readable at read time — the
 * verification may since have been closed, hidden, or made unreachable by
 * Modalità verifica; the returned result must not go blank because of that.
 * Everything the student needs to see (§6 of
 * `m4-correzione-ux-concept.md`) is embedded directly: question text,
 * options, the student's own answer, per-question score/feedback, and
 * totals. Solutions are included by default from the immutable teacher
 * snapshot and can subsequently be hidden independently by the teacher.
 *
 * Stored at `correctionReturns/{submissionId}` — same deterministic id
 * space as `corrections`/`submissions`. Written only by the teacher's
 * "return" action and by the two explicit `solutionsVisible` toggles below
 * (never by the student, never continuously); the student only ever reads
 * it, the same relationship `submissionReceipts` already has to
 * `submissions`.
 */
export type CorrectionReturnDoc = {
  correctionId: string; // == submissionId
  verificationId: string;
  studentUid: string;
  ownerUid: string;
  verificationTitle: string;
  className: string | null;
  /**
   * UI-VERIFICHE-06B — giorno didattico e perimetro didattico **copiati dal
   * `teacherSnapshot` congelato** alla restituzione, non referenziati.
   *
   * Stessa ragione per cui `questions` è una copia autosufficiente: una
   * correzione restituita deve restare leggibile e completa anche quando la
   * verifica è stata chiusa o nascosta e non compare più nella lista pubblica
   * dello studente. Dipendere dalla `publishedProjection` significherebbe far
   * sparire data e argomenti proprio nel momento in cui servono di più.
   *
   * `topicOutline` resta il perimetro **generale** della verifica (soli titoli
   * UDA/lezione): non dice nulla sulla variante assegnata, mentre `questions`
   * continua a contenere esclusivamente la variante di questo studente.
   *
   * Assenti sui documenti restituiti prima di questo campo, e su verifiche il
   * cui snapshot non li ha: nessuna migrazione, nessun fallback da titoli o
   * domande, nessun dato inventato.
   */
  verificationDate?: string;
  topicOutline?: VerificationTopicUda[];
  submittedAt: Timestamp | FieldValue;
  returnedAt: Timestamp | FieldValue;
  questions: CorrectionReturnQuestionView[];
  generalFeedback: string | null;
  totalPoints: number;
  maxPoints: number;
  percentage: number | null;
  /**
   * Whether the student can currently read this projection at all
   * (M4-01 Security Rules will gate the `read` on this field). Lets the
   * docente hide a restituted result without deleting it or losing the
   * scoring data — e.g. to correct a mistake before the student re-reads
   * it. Independent of `CorrectionDoc.status`: a correction can be
   * `returned` with `visibleToStudent: false`.
   */
  visibleToStudent: boolean;
  /**
   * Whether `questions[*].correctAnswer` is currently populated on this
   * document. M4-01's service must keep this in sync by construction:
   * flipping to `true` explicitly rewrites every question with its frozen
   * `correctAnswer`; flipping to `false` explicitly **removes** the field
   * from every question in the same write — never a client-side-only
   * hide. This field always reflects what is actually stored, so Security
   * Rules never need to inspect `questions[*]` to decide what the student
   * may read.
   */
  solutionsVisible: boolean;
  /**
   * M4-01: bumped by every write to this document (return, reopen-hides-it,
   * `setReturnVisibleToStudent`, `setSolutionsVisible`) — a plain technical
   * bookkeeping timestamp, not part of the M4-00 UX-facing contract.
   */
  updatedAt: Timestamp | FieldValue;
};
