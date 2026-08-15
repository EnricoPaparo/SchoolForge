import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import type { PublicVerificationQuestion, SubmissionDoc } from '../../types/firestore.js';
import type { StudentVerificationItem } from '../repository/verifications/studentVerificationsService.js';
import { loadSubmission } from './submissionsService.js';
import { startSubmission } from './submissionsService.js';
import {
  createAssignVerificationVariant,
  createResolveStudentVerificationPdf,
  type AssignVariantResponse,
} from './verificationVariantClient.js';

/**
 * VEX-02A / VDIF-04 — risoluzione dell'avvio e della ripresa dello svolgimento
 * studente in base ad `assignmentMode`, con **una sola fonte di verità** per gli
 * order: l'insieme assegnato dal server.
 *
 * - `same_questions`: flusso esistente, **nessuna** callable (crea/riprende la
 *   submission client-side; le domande sono quelle della proiezione).
 * - `server_resolved`: invoca la callable `assignVerificationVariant` (che crea o
 *   recupera atomicamente l'assegnazione), usa **esclusivamente** le domande
 *   sanitizzate e gli `assignedQuestionOrders` restituiti, poi legge la
 *   submission per ripristinare le risposte salvate. Mai `teacherSnapshot`, mai
 *   alternative non assegnate.
 *
 * Il secondo caso copre varianti equivalenti, differenziazione o entrambe senza
 * distinguerle: il client non sa — e non deve sapere — quale dei due meccanismi
 * abbia deciso il suo insieme di domande.
 *
 * La risposta della callable è validata **fail-closed**: modalità sconosciuta o
 * payload malformato ⇒ errore leggibile, **nessun** fallback a `same_questions`.
 */

/** Esito risolto: cosa passare a `OnlineExamView`. */
export interface ResolvedExam {
  submission: SubmissionDoc;
  questions: PublicVerificationQuestion[];
  /** Presente solo in `server_resolved`: l'insieme assegnato (order canonici). */
  assignedQuestionOrders?: number[];
}

export class VexExamError extends Error {
  constructor() {
    // VDIF-05 — il client non spiega mai allo studente quale meccanismo abbia
    // scelto le domande né perché un payload sia incoerente. Il dettaglio resta
    // nei test del contratto, non in una superficie osservabile.
    super('Impossibile caricare le domande della verifica. Riprova.');
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
  if (!resp || resp.assignmentMode !== 'server_resolved') {
    throw new VexExamError();
  }
  if (!Array.isArray(resp.assignedQuestionOrders) || resp.assignedQuestionOrders.length === 0) {
    throw new VexExamError();
  }
  if (!resp.assignedQuestionOrders.every((o) => Number.isInteger(o) && o >= 0)) {
    throw new VexExamError();
  }
  if (!Array.isArray(resp.questions)) {
    throw new VexExamError();
  }
  const assignedSet = new Set(resp.assignedQuestionOrders);
  const questionOrders = new Set<number>();
  const questions: PublicVerificationQuestion[] = [];
  for (const q of resp.questions) {
    if (!q || typeof q !== 'object') throw new VexExamError();
    for (const key of Object.keys(q)) {
      if (FORBIDDEN_QUESTION_KEYS.includes(key.toLowerCase())) {
        throw new VexExamError();
      }
    }
    if (!Number.isInteger(q.order) || !assignedSet.has(q.order)) {
      throw new VexExamError();
    }
    if (questionOrders.has(q.order)) throw new VexExamError();
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
    throw new VexExamError();
  }
  // Ordine canonico ascendente (lo shuffle visivo è responsabilità di OnlineExamView).
  return questions.sort((a, b) => a.order - b.order);
}

export interface VexExamDeps {
  /** Invoca la callable VEX. Iniettabile nei test. */
  assign: (verificationId: string) => Promise<AssignVariantResponse>;
  /** Risolve il PDF senza creare né modificare una submission. */
  resolvePdf: (verificationId: string) => Promise<AssignVariantResponse>;
  /** Carica la submission deterministica. Iniettabile nei test. */
  load: (verificationId: string, uid: string) => Promise<SubmissionDoc | null>;
}

/** Deps di produzione, montate su Firebase reale. La callable è creata **pigra**
 *  (solo al primo avvio VEX): un flusso `same_questions` non la tocca mai. */
export function productionVexExamDeps(functions: Functions, db: Firestore): VexExamDeps {
  let assignFn: ReturnType<typeof createAssignVerificationVariant> | null = null;
  let resolvePdfFn: ReturnType<typeof createResolveStudentVerificationPdf> | null = null;
  return {
    assign: (verificationId) => {
      assignFn ??= createAssignVerificationVariant(functions);
      return assignFn({ verificationId });
    },
    resolvePdf: (verificationId) => {
      resolvePdfFn ??= createResolveStudentVerificationPdf(functions);
      return resolvePdfFn({ verificationId });
    },
    load: (verificationId, uid) => loadSubmission(verificationId, uid, db),
  };
}

/** Domande personali per il PDF, validate con lo stesso contratto dell'esame. */
export async function resolveVexPdfQuestions(
  item: StudentVerificationItem,
  deps: VexExamDeps,
): Promise<PublicVerificationQuestion[]> {
  return validateAssignResponse(await deps.resolvePdf(item.id));
}

/**
 * Risolve l'avvio o la ripresa di una verifica `server_resolved`: callable →
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
    throw new VexExamError();
  }
  return { submission, questions, assignedQuestionOrders: [...resp.assignedQuestionOrders] };
}

/**
 * Avvio/ripresa `same_questions`: comportamento esistente invariato (crea la
 * submission se assente, poi la carica). **Nessuna** callable.
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
    throw new VexExamError();
  }
  return { submission, questions: item.questions };
}
