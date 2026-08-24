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
export type PoolDifficulty = 1 | 2 | 3 | 4 | 5;
interface PoolQuestionBase {
    id: string;
    tipo: string;
    difficolta: PoolDifficulty;
    testo: string;
    maxPoints: number;
}
export interface PoolQuestionAperta extends PoolQuestionBase {
    tipo: 'aperta';
    soluzione: string;
    /**
     * EXAM-UX-03 — limite caratteri per la risposta aperta dello studente.
     * Chiave sorgente YAML identica al nome del campo (`maxCharacters`), coerente
     * con `maxPoints`. Nel Markdown è opzionale e, quando presente, è un intero
     * 1–10000. Nel modello parsed è sempre il limite effettivo: 2000 quando la
     * chiave sorgente manca. Riguarda solo le aperte.
     */
    maxCharacters: number;
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
export type PoolQuestion = PoolQuestionAperta | PoolQuestionChiusaSingola | PoolQuestionChiusaMultipla;
export interface ParsedPool {
    schema: 'schoolforge-pool/v2';
    questions: PoolQuestion[];
}
export type PoolParseResult = {
    ok: true;
    pool: ParsedPool;
} | {
    ok: false;
    errors: PoolValidationError[];
};
export {};
//# sourceMappingURL=types.d.ts.map