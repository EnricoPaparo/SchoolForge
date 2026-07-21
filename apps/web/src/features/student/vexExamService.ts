import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import type { PublicVerificationQuestion, SubmissionDoc } from '../../types/firestore.js';
import type { StudentVerificationItem } from '../repository/verifications/studentVerificationsService.js';
import { loadSubmission } from './submissionsService.js';
import { startSubmission } from './submissionsService.js';
import {
  createAssignVerificationVariant,
  type AssignVariantResponse,
} from './verificationVariantClient.js';

/**
 * VEX-02A — risoluzione dell'avvio/ripresa dello svolgimento studente in base a
 * `distributionMode`, con **una sola fonte di verità** per gli order: la variante
 * assegnata dal server.
 *
 * - `same_questions`: flusso esistente, **nessuna** callable VEX (crea/riprende
 *   la submission client-side; le domande sono quelle della proiezione).
 * - `equivalent_variants`: invoca la callable `assignVerificationVariant` (che
 *   crea/recupera atomicamente l'assegnazione), usa **esclusivamente** le domande
 *   sanitizzate e `assignedQuestionOrders` restituiti, poi legge la submission per
 *   ripristinare le risposte salvate. Mai `teacherSnapshot`, mai alternative.
 *
 * La risposta della callable è validata **fail-closed**: modalità sconosciuta o
 * payload malformato ⇒ errore leggibile, **nessun** fallback a `same_questions`.
 */

/** Esito risolto: cosa passare a `OnlineExamView`. */
export interface ResolvedExam {
  submission: SubmissionDoc;
  questions: PublicVerificationQuestion[];
  /** Presente solo in `equivalent_variants`: la variante assegnata (order canonici). */
  assignedQuestionOrders?: number[];
}

export class VexExamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VexExamError';
  }
}

/** Chiavi che non devono MAI comparire in una domanda lato studente. */
const FORBIDDEN_QUESTION_KEYS = ['soluzione', 'correctanswer', 'solution'];

/**
 * Validazione **fail-closed** della risposta della callable. Verifica modalità,
 * coerenza di `assignedQuestionOrders` con gli `order` delle domande, assenza di
 * qualsiasi campo soluzione. Qualsiasi anomalia ⇒ `VexExamError`.
 */
export function validateAssignResponse(resp: AssignVariantResponse): PublicVerificationQuestion[] {
  if (!resp || resp.distributionMode !== 'equivalent_variants') {
    throw new VexExamError('Risposta di assegnazione non valida.');
  }
  if (!Array.isArray(resp.assignedQuestionOrders) || resp.assignedQuestionOrders.length === 0) {
    throw new VexExamError('Assegnazione mancante o vuota.');
  }
  if (!resp.assignedQuestionOrders.every((o) => Number.isInteger(o) && o >= 0)) {
    throw new VexExamError('Order assegnati non validi.');
  }
  if (!Array.isArray(resp.questions)) {
    throw new VexExamError('Domande assegnate mancanti.');
  }
  const assignedSet = new Set(resp.assignedQuestionOrders);
  const questionOrders = new Set<number>();
  const questions: PublicVerificationQuestion[] = [];
  for (const q of resp.questions) {
    if (!q || typeof q !== 'object') throw new VexExamError('Domanda assegnata non valida.');
    for (const key of Object.keys(q)) {
      if (FORBIDDEN_QUESTION_KEYS.includes(key.toLowerCase())) {
        throw new VexExamError('La risposta contiene dati non ammessi.');
      }
    }
    if (!Number.isInteger(q.order) || !assignedSet.has(q.order)) {
      throw new VexExamError('Domanda non appartenente alla variante assegnata.');
    }
    if (questionOrders.has(q.order)) throw new VexExamError('Domanda assegnata duplicata.');
    questionOrders.add(q.order);
    questions.push({
      order: q.order,
      tipo: q.tipo,
      maxPoints: q.maxPoints,
      testo: q.testo,
      ...(q.opzioni ? { opzioni: q.opzioni } : {}),
      ...(q.maxCharacters !== undefined ? { maxCharacters: q.maxCharacters } : {}),
    });
  }
  // Copertura esatta: ogni order assegnato ha la sua domanda, senza estranei.
  if (questionOrders.size !== assignedSet.size) {
    throw new VexExamError('Le domande assegnate non coincidono con la variante.');
  }
  // Ordine canonico ascendente (lo shuffle visivo è responsabilità di OnlineExamView).
  return questions.sort((a, b) => a.order - b.order);
}

export interface VexExamDeps {
  /** Invoca la callable VEX. Iniettabile nei test. */
  assign: (verificationId: string) => Promise<AssignVariantResponse>;
  /** Carica la submission deterministica. Iniettabile nei test. */
  load: (verificationId: string, uid: string) => Promise<SubmissionDoc | null>;
}

/** Deps di produzione, montate su Firebase reale. La callable è creata **pigra**
 *  (solo al primo avvio VEX): un flusso `same_questions` non la tocca mai. */
export function productionVexExamDeps(functions: Functions, db: Firestore): VexExamDeps {
  let assignFn: ReturnType<typeof createAssignVerificationVariant> | null = null;
  return {
    assign: (verificationId) => {
      assignFn ??= createAssignVerificationVariant(functions);
      return assignFn({ verificationId });
    },
    load: (verificationId, uid) => loadSubmission(verificationId, uid, db),
  };
}

/**
 * Risolve l'avvio/ripresa di una verifica `equivalent_variants`: callable →
 * validazione fail-closed → lettura submission (per le risposte già salvate).
 * Usa **esclusivamente** le domande e gli order restituiti dal server.
 */
export async function resolveVexExam(
  item: StudentVerificationItem,
  uid: string,
  deps: VexExamDeps,
): Promise<ResolvedExam> {
  const resp = await deps.assign(item.id);
  const questions = validateAssignResponse(resp);
  const submission = await deps.load(item.id, uid);
  if (!submission || submission.status !== 'draft') {
    throw new VexExamError('Submission non disponibile dopo l’assegnazione.');
  }
  return { submission, questions, assignedQuestionOrders: [...resp.assignedQuestionOrders] };
}

/**
 * Avvio/ripresa `same_questions`: comportamento esistente invariato (crea la
 * submission se assente, poi la carica). **Nessuna** callable VEX.
 */
export async function resolveSameQuestionsExam(
  item: StudentVerificationItem,
  uid: string,
  db: Firestore,
): Promise<ResolvedExam> {
  await startSubmission(
    {
      verificationId: item.id,
      studentUid: uid,
      ownerUid: item.ownerUid,
      verificationTitle: item.title,
      className: item.className,
    },
    db,
  );
  const submission = await loadSubmission(item.id, uid, db);
  if (!submission) {
    throw new VexExamError('Impossibile avviare la verifica online.');
  }
  return { submission, questions: item.questions };
}
