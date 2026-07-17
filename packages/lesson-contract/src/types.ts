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
  /**
   * EXAM-UX-03 — limite caratteri per la risposta aperta dello studente.
   * Chiave sorgente YAML identica al nome del campo (`maxCharacters`), coerente
   * con `maxPoints`. Intero 1–10000 quando presente; assente/legacy ⇒ il default
   * effettivo di runtime è 2000 (vedi `effectiveMaxCharacters`). Riguarda **solo**
   * le domande aperte; le chiuse non hanno questo campo.
   */
  maxCharacters?: number;
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
