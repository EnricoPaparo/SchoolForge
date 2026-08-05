import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

/**
 * STRUCTURE-IMPORT-02B — mutua esclusione delle mutazioni di una singola UDA
 * mentre un import di lezioni è in volo.
 *
 * Il lease vive sul documento della UDA, non sull'import: due UDA diverse
 * possono essere popolate in parallelo, mentre creazione, riordino ed
 * eliminazione di lezioni **di quella** UDA sono bloccate. È la granularità più
 * stretta ottenibile senza toccare Rules, Function o indici — il campo sta
 * dentro `programs/{programId}/**`, già owner-only.
 *
 * Come per il lease dell'append UDA, questa è l'unica lettura aggiuntiva che le
 * mutazioni pagano, e solo quando il docente muta davvero: mai all'apertura
 * ordinaria di un corso.
 */

export const LESSON_APPEND_LEASE_FIELD = 'lessonAppendLease';

/** Finestra di validità del lease. Un lease scaduto non autorizza nulla. */
export const LESSON_LEASE_TTL_MS = 5 * 60 * 1000;

export const LESSON_APPEND_LEASE_BUSY_MESSAGE =
  'Importazione di lezioni in corso su questa UDA. Attendi il completamento e riprova.';

/**
 * Solleva quando un lease **non scaduto** è presente sulla UDA. Un lease
 * scaduto viene ignorato: il tentativo che lo deteneva non potrà più committare
 * (le precondizioni del commit lo rifiutano), quindi non ha senso bloccare il
 * docente a tempo indeterminato.
 */
export async function assertNoActiveLessonAppendLease(
  programId: string,
  importId: string,
  udaId: string,
  db: Firestore,
): Promise<void> {
  const snap = await getDoc(doc(db, `programs/${programId}/imports/${importId}/udas/${udaId}`));
  if (!snap.exists()) return;
  const lease = (snap.data() as Record<string, { expiresAt?: unknown } | undefined>)[
    LESSON_APPEND_LEASE_FIELD
  ];
  if (lease && typeof lease.expiresAt === 'number' && lease.expiresAt > Date.now()) {
    throw new Error(LESSON_APPEND_LEASE_BUSY_MESSAGE);
  }
}
