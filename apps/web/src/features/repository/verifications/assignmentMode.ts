import type { VerificationAssignmentMode } from '../../../types/firestore.js';
import { normalizeDistributionMode } from './vexDistribution.js';

/**
 * VDIF-04 — **unico** punto in cui si decide da quale canale arrivano le domande
 * di una verifica, e **unico** punto in cui vive la compatibilità legacy.
 *
 * Prima di VDIF-04 il portale studente instradava su `distributionMode`. Da qui
 * in avanti instrada su `assignmentMode`, e il campo vecchio non è più
 * consultato per il routing. Le proiezioni scritte prima di VDIF-04 non hanno il
 * campo nuovo: la loro modalità si deriva da `distributionMode`, che per quelle
 * verifiche è ancora esattamente equivalente (`equivalent_variants` ⇒
 * server-resolved, tutto il resto ⇒ client-side). Nessuna migrazione, nessuna
 * riscrittura di documenti già congelati.
 *
 * La derivazione sta **qui e solo qui**: sparpagliare un `if
 * (distributionMode === …)` nelle viste significherebbe che fra un anno una
 * schermata instrada in un modo e un'altra in un altro, e nessuno se ne accorge
 * finché uno studente non riceve le domande sbagliate.
 */

export const VERIFICATION_ASSIGNMENT_MODES: readonly VerificationAssignmentMode[] = [
  'same_questions',
  'server_resolved',
];

export const UNKNOWN_ASSIGNMENT_MODE_MESSAGE =
  'Modalità di assegnazione della verifica non riconosciuta. Aggiorna l’app e riprova.';

/**
 * Modalità normalizzata, fail-closed:
 * - valore valido ⇒ se stesso;
 * - **assente** ⇒ derivata da `distributionMode` (proiezione legacy);
 * - qualunque altro valore presente ⇒ **lancia**. Un valore che non si capisce
 *   non può diventare `same_questions` per ripiego: sarebbe il ripiego che
 *   mostra allo studente domande che non gli sono state assegnate.
 */
export function normalizeAssignmentMode(
  assignmentMode: unknown,
  distributionMode: unknown,
): VerificationAssignmentMode {
  if (assignmentMode === undefined) {
    return normalizeDistributionMode(distributionMode) === 'equivalent_variants'
      ? 'server_resolved'
      : 'same_questions';
  }
  if (assignmentMode === 'same_questions' || assignmentMode === 'server_resolved') {
    return assignmentMode;
  }
  throw new Error(UNKNOWN_ASSIGNMENT_MODE_MESSAGE);
}

/**
 * Regola di derivazione **congelata all'attivazione** (roadmap §5.D.5b):
 * `server_resolved` se esiste VEX **oppure** differenziazione; `same_questions`
 * solo quando non esiste nessuno dei due.
 */
export function deriveAssignmentMode(input: {
  distributionMode: unknown;
  hasDifferentiation: boolean;
}): VerificationAssignmentMode {
  return normalizeDistributionMode(input.distributionMode) === 'equivalent_variants' ||
    input.hasDifferentiation
    ? 'server_resolved'
    : 'same_questions';
}
