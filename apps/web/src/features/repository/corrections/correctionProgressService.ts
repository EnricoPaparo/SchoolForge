import { collection, getDocs, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { CorrectionDoc, CorrectionStatus } from '../../../types/firestore.js';

/**
 * Progresso di una correzione per la tabella «Consegne online» (M5-03/M5-04):
 * quante domande sono valutate su quante totali (colonna «Valutate»), più lo
 * `status` e i totali già derivati sul documento correzione — usati da M5-04
 * per calcolare l'eleggibilità delle azioni massive
 * (Completa/Riapri/Restituisci/Azzera)
 * **senza** letture aggiuntive. Tutto proviene dalla stessa singola query
 * owner-only di M5-03.
 */
export interface CorrectionProgress {
  /** Stato del ciclo di vita della correzione. */
  status: CorrectionStatus;
  /** Domande con `points !== null`. */
  evaluated: number;
  /** Domande totali della correzione. */
  total: number;
  /** Somma dei punti assegnati (derivato sul documento correzione). */
  totalPoints: number;
  /** Somma dei `maxPoints` (derivato). */
  maxPoints: number;
  /** Percentuale derivata; `null` solo quando `maxPoints === 0`. */
  percentage: number | null;
  /**
   * `true` se c'è qualcosa da azzerare (M5-04C): almeno un `points !== null`,
   * oppure un feedback per domanda, oppure `generalFeedback` non vuoto. Deriva
   * dalla **stessa** lettura owner-only, senza query aggiuntive.
   */
  hasContent: boolean;
}

/** `true` quando la correzione ha almeno una domanda e tutte sono valutate. */
export function isFullyEvaluated(progress: CorrectionProgress): boolean {
  return progress.total > 0 && progress.evaluated === progress.total;
}

/** `true` se la correzione è azzerabile ora (in_progress e con contenuto). */
export function isClearable(progress: CorrectionProgress): boolean {
  return progress.status === 'in_progress' && progress.hasContent;
}

function progressOf(data: CorrectionDoc): CorrectionProgress {
  const values = Object.values(data.evaluations ?? {});
  let evaluated = 0;
  let hasFeedback = false;
  for (const e of values) {
    if (e.points !== null) evaluated++;
    if (typeof e.feedback === 'string' && e.feedback.length > 0) hasFeedback = true;
  }
  const hasGeneral =
    typeof data.generalFeedback === 'string' && data.generalFeedback.trim().length > 0;
  return {
    status: data.status,
    evaluated,
    total: values.length,
    totalPoints: data.totalPoints,
    maxPoints: data.maxPoints,
    percentage: data.percentage,
    hasContent: evaluated > 0 || hasFeedback || hasGeneral,
  };
}

/**
 * Legge in **una singola query mirata** le correzioni di una verifica (owner-only
 * per Security Rules) e ne ricava il progresso per `studentUid`. **Nessun
 * listener, nessun polling**: è una lettura una-tantum, invocata all'apertura del
 * monitor e ri-eseguita dopo un run IA o un'azione massiva. Filtra per
 * `verificationId` (indice a campo singolo automatico): nessun nuovo indice
 * composito, nessuna Rule. Le consegne senza documento correzione semplicemente
 * non compaiono nella mappa (la UI mostra «—» finché non esiste una correzione).
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
    byStudent.set(data.studentUid, progressOf(data));
  }
  return byStudent;
}
