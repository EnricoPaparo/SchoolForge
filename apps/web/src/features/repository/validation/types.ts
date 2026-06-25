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

export interface LessonResult {
  /** Full path relative to import root */
  path: string;
  filename: string;
  /** true when the lesson file itself is structurally valid; pool errors do not affect this */
  valid: boolean;
  poolStatus: PoolStatus;
  issues: ValidationIssue[];
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
}

export interface ImportValidationResult extends ValidationResult {
  /** valid = true when no programma/uda/lezione issues; pool/question issues do not block */
  udas: UdaResult[];
}
