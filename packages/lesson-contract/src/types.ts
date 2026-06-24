export interface PoolValidationError {
  fileName: string | null;
  questionId: string | null;
  questionIndex: number | null;
  field: string;
  message: string;
}

export interface QuestionOption {
  id: string;
  testo: string;
}

interface PoolQuestionBase {
  id: string;
  tipo: string;
  difficolta: 1 | 2 | 3;
  peso: 1 | 2 | 3;
  testo: string;
  maxPoints: number;
}

export interface PoolQuestionAperta extends PoolQuestionBase {
  tipo: 'aperta';
  soluzione: string;
}

export interface PoolQuestionChiusaSingola extends PoolQuestionBase {
  tipo: 'chiusa_singola';
  opzioni: QuestionOption[];
  soluzione: [string];
}

export interface PoolQuestionChiusaMultipla extends PoolQuestionBase {
  tipo: 'chiusa_multipla';
  opzioni: QuestionOption[];
  soluzione: string[];
}

export type PoolQuestion =
  | PoolQuestionAperta
  | PoolQuestionChiusaSingola
  | PoolQuestionChiusaMultipla;

export interface ParsedPool {
  schema: 'schoolforge-pool/v1';
  questions: PoolQuestion[];
}

export type PoolParseResult =
  | { ok: true; pool: ParsedPool }
  | { ok: false; errors: PoolValidationError[] };
