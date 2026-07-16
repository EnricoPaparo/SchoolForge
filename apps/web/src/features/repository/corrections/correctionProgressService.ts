import { collection, getDocs, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { CorrectionDoc } from '../../../types/firestore.js';

/**
 * Progresso di valutazione per la colonna «Valutate» (M5-03): quante domande
 * hanno un punteggio su quante totali, per ciascuna consegna.
 */
export interface CorrectionProgress {
  /** Domande con `points !== null`. */
  evaluated: number;
  /** Domande totali della correzione. */
  total: number;
}

function progressOf(evaluations: CorrectionDoc['evaluations']): CorrectionProgress {
  const values = Object.values(evaluations ?? {});
  let evaluated = 0;
  for (const e of values) if (e.points !== null) evaluated++;
  return { evaluated, total: values.length };
}

/**
 * Legge in **una singola query mirata** le correzioni di una verifica (owner-only
 * per Security Rules) e ne ricava il progresso per `studentUid`. **Nessun
 * listener, nessun polling**: è una lettura una-tantum, invocata all'apertura del
 * monitor e ri-eseguita dopo un run IA. Filtra per `verificationId` (indice
 * a campo singolo automatico): nessun nuovo indice composito, nessuna Rule.
 * Le consegne senza documento correzione semplicemente non compaiono nella mappa
 * (la UI mostra «—» finché non esiste una correzione).
 */
export async function loadCorrectionProgressByStudent(
  verificationId: string,
  db: Firestore,
): Promise<Map<string, CorrectionProgress>> {
  const snap = await getDocs(
    query(collection(db, 'corrections'), where('verificationId', '==', verificationId)),
  );
  const byStudent = new Map<string, CorrectionProgress>();
  for (const d of snap.docs) {
    const data = d.data() as CorrectionDoc;
    byStudent.set(data.studentUid, progressOf(data.evaluations));
  }
  return byStudent;
}
