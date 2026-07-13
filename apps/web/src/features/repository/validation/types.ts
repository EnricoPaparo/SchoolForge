export type ValidationLevel = 'programma' | 'uda' | 'lezione' | 'pool' | 'question';

export interface ValidationIssue {
  level: ValidationLevel;
  /** Logical path within the import (e.g. "uda-01-reti/lezione-001-http.pool.md") */
  path: string;
  /** Field name or dotted path (e.g. "competenze", "questions[0].difficolta") */
  field: string;
  /** Stable error code */
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/** A single file in the import manifest: relative path and raw string content. */
export interface RawFile {
  /** Path relative to the import root, e.g. "uda-01-reti/lezione-001-http.md" */
  path: string;
  content: string;
}

export type PoolStatus = 'absent' | 'valid' | 'invalid';

/**
 * Didactic metadata parsed from a lesson's own optional YAML front matter.
 * Every field is optional — missing or malformed front matter never raises
 * a validation issue, it just yields this same empty shape (see
 * lessonMetadata.ts). Never technical: no durata_minuti, no pool/question data.
 */
export interface LessonMetadata {
  titolo: string | null;
  sottotitolo: string | null;
  difficolta: string | null;
  concettiChiave: string[];
  obiettivi: string[];
}

export interface LessonResult {
  /** Full path relative to import root */
  path: string;
  filename: string;
  /** true when the lesson file itself is structurally valid; pool errors do not affect this */
  valid: boolean;
  poolStatus: PoolStatus;
  issues: ValidationIssue[];
  metadata: LessonMetadata;
}

/** Didactic metadata for a UDA, shown to the teacher in the info panel — never technical details. */
export interface UdaMetadata {
  /**
   * Didactic title from the UDA front matter (EXP-01). Optional and
   * backward-compatible: a UDA imported/created before this field was
   * persisted has no `titolo` — readers fall back to a readable label
   * derived from the technical `dir` (see `resolveUdaTitle`).
   */
  titolo?: string | null;
  descrizione: string | null;
  competenze: string[];
  obiettivi: string[];
}

export interface UdaResult {
  /** Top-level directory path */
  dir: string;
  filename: string;
  /** true when UDA front matter is valid; lesson/pool issues do not affect this */
  valid: boolean;
  lessons: LessonResult[];
  /** UDA-level issues only (not lesson/pool issues) */
  issues: ValidationIssue[];
  metadata: UdaMetadata;
}

/** Didactic metadata parsed from an optional root-level programma.md. */
export interface ProgrammaMetadata {
  annoScolastico: string | null;
  docente: string | null;
  materia: string | null;
  classe: string | null;
  descrizione: string | null;
}

export interface ImportValidationResult extends ValidationResult {
  /** valid = true when no programma/uda/lezione issues; pool/question issues do not block */
  udas: UdaResult[];
  /** Parsed from the optional root-level programma.md. Null when the file is absent. */
  programma: ProgrammaMetadata | null;
}
