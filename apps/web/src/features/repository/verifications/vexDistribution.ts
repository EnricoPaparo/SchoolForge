import type { VerificationDistributionMode } from '../../../types/firestore.js';

/**
 * VEX-01A — normalizzazione **centralizzata** della modalità di distribuzione.
 * Unica fonte di verità: la UI e i service non devono duplicare controlli
 * stringa. Fail-closed su valore sconosciuto (nessun fallback silenzioso).
 */

export const VEX_DISTRIBUTION_MODES: readonly VerificationDistributionMode[] = [
  'same_questions',
  'equivalent_variants',
];

/** Messaggio leggibile per un `distributionMode` sconosciuto. */
export const VEX_UNKNOWN_MODE_MESSAGE =
  'Modalità di distribuzione della verifica non riconosciuta. Aggiorna l’app o ricrea la verifica.';

/**
 * Restituisce la modalità normalizzata (fail-closed):
 * - **solo `undefined`** ⇒ `'same_questions'` (documento legacy senza il campo:
 *   assenza vera del campo = comportamento di oggi);
 * - valore valido ⇒ se stesso;
 * - **qualsiasi altro valore presente** — `null`, stringa vuota, stringhe
 *   sconosciute, array, oggetti, numeri, ecc. — ⇒ lancia. Nessuna
 *   normalizzazione silenziosa di valori malformati.
 */
export function normalizeDistributionMode(value: unknown): VerificationDistributionMode {
  if (value === undefined) return 'same_questions';
  if (value === 'same_questions' || value === 'equivalent_variants') return value;
  throw new Error(VEX_UNKNOWN_MODE_MESSAGE);
}

/** `true` se il valore normalizzato è `equivalent_variants` (non lancia mai su assente). */
export function isEquivalentVariants(value: unknown): boolean {
  return normalizeDistributionMode(value) === 'equivalent_variants';
}
