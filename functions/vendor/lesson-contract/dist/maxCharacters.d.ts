/**
 * EXAM-UX-03 — limite caratteri delle risposte aperte.
 *
 * `maxCharacters` è opzionale nel Markdown della domanda aperta. Quando
 * assente, il parser V2 espone come limite effettivo il default 2000.
 * Riguarda soltanto le domande aperte.
 */
/** Limite effettivo di default quando `maxCharacters` non è specificato. */
export declare const DEFAULT_MAX_CHARACTERS = 2000;
/** Minimo consentito per un `maxCharacters` esplicito. */
export declare const MIN_MAX_CHARACTERS = 1;
/** Massimo consentito per un `maxCharacters` esplicito. */
export declare const MAX_MAX_CHARACTERS = 10000;
/**
 * Normalizza un valore candidato per la **persistenza**: ritorna un intero in
 * `[1, 10000]` se valido, altrimenti `undefined` (il campo resta assente).
 * Accetta stringhe numeriche (es. dall'input editor) oltre ai numeri.
 */
export declare function normalizeMaxCharacters(value: unknown): number | undefined;
/**
 * Limite **effettivo** a runtime: il valore normalizzato se valido, altrimenti
 * il default 2000. Non tronca mai dati già
 * salvati, definisce solo il tetto del nuovo input.
 */
export declare function effectiveMaxCharacters(value: unknown): number;
//# sourceMappingURL=maxCharacters.d.ts.map