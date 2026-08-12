import type { DocumentData } from 'firebase/firestore';

/**
 * Predicati **puri** condivisi dai parser fail-closed dei documenti owner-only.
 *
 * Estratti da `differentiationLabelsService` quando VDIF-02 ne ha avuto bisogno
 * per un secondo parser: due copie della stessa regola divergono al primo
 * ritocco, e questi controlli sono esattamente il punto in cui una divergenza
 * non si noterebbe finché non produce un documento accettato da un lettore e
 * rifiutato dall'altro.
 */

/**
 * Un `Timestamp` Firestore, riconosciuto dalla **forma** invece che da
 * `instanceof`: la stessa struttura arriva dal client SDK, dall'emulatore e dai
 * test, e un controllo di identità di classe li distinguerebbe senza motivo.
 *
 * Un sentinel `serverTimestamp()` non ancora risolto **non** passa — ed è
 * giusto: significherebbe leggere qualcosa che non è mai stato committato.
 */
export function isFirestoreTimestamp(value: unknown): value is { toMillis: () => number } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { seconds?: unknown; nanoseconds?: unknown; toMillis?: unknown };
  return (
    typeof candidate.seconds === 'number' &&
    Number.isFinite(candidate.seconds) &&
    typeof candidate.nanoseconds === 'number' &&
    Number.isFinite(candidate.nanoseconds) &&
    typeof candidate.toMillis === 'function'
  );
}

/**
 * `true` solo se il documento ha **esattamente** le chiavi attese: né una in
 * meno né una in più. `expected` va passato già ordinato.
 */
export function hasExactKeys(data: DocumentData, expected: readonly string[]): boolean {
  const keys = Object.keys(data).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

/** Intero finito `>= 0`: la forma ammessa per i contatori owner-only. */
export function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Identificatore usabile come segmento di path Firestore: stringa non vuota,
 * senza `/` e diversa dai due segmenti relativi. Non è una validazione
 * esaustiva del formato Firestore — è il minimo che impedisce a un valore
 * palesemente errato di diventare un percorso.
 */
export function isValidDocumentId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('/') &&
    value !== '.' &&
    value !== '..'
  );
}
