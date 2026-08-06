/**
 * STRUCTURE-IMPORT-01 — shared types of the pure structural import layer.
 *
 * Everything here is serializable and free of Firebase values: no `Timestamp`,
 * no `FieldValue`, no `DocumentReference`. The manifests are what
 * STRUCTURE-IMPORT-02A/02B will consume to run the collision preflight, perform
 * the writes and, on failure, clean up exactly what the attempt owned.
 */

/** Which of the two file formats an error refers to. */
export type StructureImportFileKind = 'uda' | 'lesson';

/**
 * Stable, user-actionable error codes. Every blocking condition maps to one
 * code, so the future UI can render a specific message and tests can assert the
 * exact reason without matching prose.
 */
export type StructureImportErrorCode =
  // File-level (parser)
  | 'invalid_extension'
  | 'empty_file'
  | 'file_too_large'
  | 'invalid_encoding'
  | 'malformed_yaml'
  | 'multiple_documents'
  | 'duplicate_key'
  | 'alias_or_anchor'
  | 'custom_tag'
  | 'invalid_root'
  | 'missing_schema'
  | 'unknown_schema'
  // Formato semplice (STRUCTURE-IMPORT-SIMPLE-01)
  | 'unknown_format'
  | 'wrong_structure_kind'
  | 'malformed_fence'
  | 'orphan_line'
  | 'ambiguous_line'
  | 'unknown_label'
  | 'duplicate_section'
  | 'unbalanced_quotes'
  // Structure-level (validators)
  | 'unknown_property'
  | 'forbidden_property'
  | 'missing_field'
  | 'invalid_type'
  | 'empty_value'
  | 'value_too_long'
  | 'too_few_items'
  | 'too_many_items'
  | 'duplicate_title'
  | 'duplicate_title_in_destination'
  // Plan-level (planners)
  | 'document_id_collision'
  | 'storage_path_collision';

/**
 * A single blocking error. Human-readable and safe for the future UI: never a
 * stack trace, never the raw YAML, never a UID or a full Storage path.
 */
export interface StructureImportError {
  code: StructureImportErrorCode;
  /** Italian, teacher-facing, one sentence. */
  message: string;
  /** Which format was being read. */
  fileKind: StructureImportFileKind;
  /** Zero-based index of the offending entry, when the error is entry-scoped. */
  index?: number;
  /** Logical field or path (e.g. `competenze`, `obiettivi[2]`), when applicable. */
  field?: string;
  /**
   * Riga **1-based del testo incollato dal docente**, quando l'errore nasce da
   * una riga precisa. Il formato semplice si legge riga per riga, quindi «riga
   * 8» è l'informazione che permette davvero di correggere; per lo YAML resta
   * assente, come prima.
   */
  line?: number;
}

export type StructureImportResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StructureImportError };

// ── Normalized metadata ──────────────────────────────────────────────────────

/**
 * One validated UDA entry. Normalization is limited to an outer trim: no
 * truncation, no invented value, no reordering. `descrizione` is `null` when the
 * optional key is absent.
 */
export interface NormalizedUdaMetadata {
  titolo: string;
  descrizione: string | null;
  competenze: string[];
  obiettivi: string[];
}

/** One validated lesson entry. Same normalization rules as the UDA entry. */
export interface NormalizedLessonMetadata {
  titolo: string;
  sottotitolo: string | null;
  difficolta: string;
  concettiChiave: string[];
  obiettivi: string[];
}

// ── Planner input ────────────────────────────────────────────────────────────

/**
 * The subset of an existing UDA the planner needs: enough to compute the next
 * number/order and to detect a collision, never the whole document.
 */
export interface ExistingUdaForPlan {
  udaId: string;
  dir?: string | undefined;
  order?: number | undefined;
  titolo?: string | null | undefined;
}

/** The subset of an existing lesson the planner needs. Same reasoning. */
export interface ExistingLessonForPlan {
  lessonId: string;
  filename?: string | undefined;
  order?: number | undefined;
  titolo?: string | null | undefined;
}

// ── Planned artefacts ────────────────────────────────────────────────────────

/**
 * Pure projection of the `UdaDoc` the commit will write. Field-for-field
 * identical to what `createUda` produces, minus anything that only exists
 * server-side.
 */
export interface PlannedUdaDoc {
  ownerUid: string;
  importId: string;
  dir: string;
  filename: string;
  order: number;
  storageBasePath: string;
  lessonCount: 0;
  titolo: string;
  descrizione: string | null;
  competenze: string[];
  obiettivi: string[];
}

export interface PlannedUda {
  /** Position in the source file — the append order is the file order. */
  index: number;
  udaId: string;
  dir: string;
  filename: string;
  order: number;
  storageBasePath: string;
  /** Full canonical Storage path of the UDA's own Markdown file. */
  storagePath: string;
  /** Canonical Markdown: front matter only, body deliberately empty. */
  content: string;
  metadata: NormalizedUdaMetadata;
  doc: PlannedUdaDoc;
}

/** Pure projection of the `LessonDoc` the commit will write. */
export interface PlannedLessonDoc {
  ownerUid: string;
  importId: string;
  publicLessonId: string;
  udaDir: string;
  path: string;
  filename: string;
  order: number;
  poolStatus: 'absent';
  questionCount: 0;
  storageRef: string;
  poolStorageRef: null;
  titolo: string;
  sottotitolo: string | null;
  difficolta: string;
  concettiChiave: string[];
  obiettivi: string[];
}

/**
 * Pure projection of the `publicLessons` entry. `createdAt` is deliberately
 * absent: it is a server timestamp, produced at write time, and a pure planner
 * must never fabricate one.
 */
export interface PlannedPublicLessonDoc {
  ownerUid: string;
  programId: string;
  importId: string;
  udaId: string;
  udaDir: string;
  path: string;
  filename: string;
  contentPath: string;
  order: number;
  completed: false;
  /** Empty body: a structural import never carries content. */
  content: '';
  titolo: string;
  sottotitolo: string | null;
  difficolta: string;
  concettiChiave: string[];
  obiettivi: string[];
}

export interface PlannedLesson {
  index: number;
  lessonId: string;
  publicLessonId: string;
  filename: string;
  /** Import-relative path, `uda-XX-slug/lezione-XXX-slug.md`. */
  path: string;
  storageRef: string;
  order: number;
  content: string;
  metadata: NormalizedLessonMetadata;
  doc: PlannedLessonDoc;
  publicLesson: PlannedPublicLessonDoc;
}

// ── Manifests ────────────────────────────────────────────────────────────────

/**
 * The manifest fields that are not the serialization itself. Splitting the
 * type this way makes it impossible to forget that `manifestCanonical` is
 * derived from everything else and can never contain itself.
 */
export type ManifestBody<T> = Omit<T, 'manifestCanonical'>;

/**
 * Closed manifest of a UDA append attempt. Sufficient for 02A to preflight
 * collisions, know every id and Storage path the attempt creates, clean up
 * exactly those on failure, and derive the attempt's authoritative identity.
 */
export interface UdaStructureImportManifest {
  kind: 'uda';
  ownerUid: string;
  programId: string;
  importId: string;
  udas: PlannedUda[];
  /** Sorted, deduplicated — the exact cleanup surface. */
  udaIds: string[];
  storagePaths: string[];
  /**
   * Canonical, stable serialization of every other field of this manifest.
   *
   * **Not an identity by itself.** The authoritative identity of the attempt is
   * `SHA-256(manifestCanonical)`, computed by the 02A/02B runtime adapter via
   * Web Crypto before the lease, the staging and any write. Only that hash need
   * be persisted; this string does not have to be.
   */
  manifestCanonical: string;
}

/** Closed manifest of a lesson append attempt. Same reasoning, for 02B. */
export interface LessonStructureImportManifest {
  kind: 'lesson';
  ownerUid: string;
  programId: string;
  importId: string;
  udaId: string;
  udaDir: string;
  lessons: PlannedLesson[];
  lessonIds: string[];
  publicLessonIds: string[];
  storagePaths: string[];
  /** Single increment to apply to the parent UDA's `lessonCount`. */
  lessonCountIncrement: number;
  /**
   * Canonical, stable serialization of every other field of this manifest.
   *
   * **Not an identity by itself.** The authoritative identity of the attempt is
   * `SHA-256(manifestCanonical)`, computed by the 02A/02B runtime adapter via
   * Web Crypto before the lease, the staging and any write. Only that hash need
   * be persisted; this string does not have to be.
   */
  manifestCanonical: string;
}

export type StructureImportManifest = UdaStructureImportManifest | LessonStructureImportManifest;
