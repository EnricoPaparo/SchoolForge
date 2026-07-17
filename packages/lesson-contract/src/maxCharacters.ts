/**
 * EXAM-UX-03 — limite caratteri delle risposte aperte.
 *
 * `maxCharacters` è opzionale sulla domanda aperta (chiave sorgente YAML
 * `maxCharacters`, coerente con `maxPoints`). Quando assente/nullo/legacy/non
 * valido, il limite **effettivo** applicato a runtime è il default 2000.
 * Riguarda soltanto le domande aperte.
 */

/** Limite effettivo di default quando `maxCharacters` non è specificato. */
export const DEFAULT_MAX_CHARACTERS = 2000;
/** Minimo consentito per un `maxCharacters` esplicito. */
export const MIN_MAX_CHARACTERS = 1;
/** Massimo consentito per un `maxCharacters` esplicito. */
export const MAX_MAX_CHARACTERS = 10000;

/**
 * Normalizza un valore candidato per la **persistenza**: ritorna un intero in
 * `[1, 10000]` se valido, altrimenti `undefined` (il campo resta assente).
 * Accetta stringhe numeriche (es. dall'input editor) oltre ai numeri.
 */
export function normalizeMaxCharacters(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return undefined;
  if (n < MIN_MAX_CHARACTERS || n > MAX_MAX_CHARACTERS) return undefined;
  return n;
}

/**
 * Limite **effettivo** a runtime: il valore normalizzato se valido, altrimenti
 * il default 2000. Usato da snapshot/OnlineExamView; non tronca mai dati già
 * salvati, definisce solo il tetto del nuovo input.
 */
export function effectiveMaxCharacters(value: unknown): number {
  return normalizeMaxCharacters(value) ?? DEFAULT_MAX_CHARACTERS;
}
