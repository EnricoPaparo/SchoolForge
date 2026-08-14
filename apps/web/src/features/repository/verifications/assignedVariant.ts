import type {
  SubmissionDoc,
  VerificationDistributionMode,
  VerificationTeacherQuestionSnapshot,
  VerificationTeacherSnapshot,
} from '../../../types/firestore.js';
import { normalizeDistributionMode } from './vexDistribution.js';

/**
 * VEX-02B — **risolutore canonico della variante**: unica fonte di verità su
 * *quali* domande dello snapshot docente si applicano a una singola consegna.
 * Riusato da correzione manuale, IA, restituzione ed export, così nessun flusso
 * ricalcola l'insieme in modo diverso (o, peggio, ricade sull'intero banco).
 *
 * Puro: non legge nulla, non muta gli input. Fail-closed: una configurazione o
 * un'assegnazione malformata **lancia**, non ricade mai sull'intero snapshot.
 *
 * - `same_questions` (o legacy senza modalità): tutte le domande dello snapshot,
 *   in ordine canonico; `assignedQuestionOrders` non è richiesto.
 * - `equivalent_variants`: `assignedQuestionOrders` obbligatorio; deve contenere
 *   **tutte** le `commonQuestionOrders` ed **esattamente una** alternativa per
 *   ciascun gruppo, senza order estranei/duplicati/inesistenti;
 *   `assignedAnswerKeys` obbligatorio e coerente.
 */

export class AssignedVariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssignedVariantError';
  }
}

type SnapshotLike = Pick<
  VerificationTeacherSnapshot,
  'distributionMode' | 'questions' | 'commonQuestionOrders' | 'equivalentGroups' | 'differentiation'
>;
type SubmissionLike = Pick<SubmissionDoc, 'assignedQuestionOrders' | 'assignedAnswerKeys'>;

function sortByOrder(
  questions: readonly VerificationTeacherQuestionSnapshot[],
): VerificationTeacherQuestionSnapshot[] {
  return [...questions].sort((a, b) => a.order - b.order);
}

/**
 * Restituisce le sole domande dello snapshot applicabili alla consegna, in
 * ordine canonico (ascendente per `order`). Vedi doc del modulo.
 */
export function resolveAssignedQuestions(
  snapshot: SnapshotLike,
  submission: SubmissionLike,
): VerificationTeacherQuestionSnapshot[] {
  const mode: VerificationDistributionMode = normalizeDistributionMode(snapshot.distributionMode);
  const questions = snapshot.questions ?? [];
  const byOrder = new Map<number, VerificationTeacherQuestionSnapshot>();
  for (const question of questions) {
    if (!Number.isInteger(question.order) || byOrder.has(question.order)) {
      throw new AssignedVariantError(
        `Snapshot variante con order domanda non intero o duplicato: ${question.order}.`,
      );
    }
    byOrder.set(question.order, question);
  }

  // VDIF-04 — la presenza di `differentiation` rende la verifica **risolta dal
  // server** anche in `same_questions`: lo snapshot contiene le alternative
  // differenziate, e restituire tutte le domande significherebbe consegnare a
  // chi corregge un insieme che a quello studente non è mai stato servito. È
  // esattamente il caso in cui un ripiego «tutte le domande» sarebbe fail-open.
  const isDifferentiated = snapshot.differentiation != null;
  if (mode === 'same_questions' && !isDifferentiated) {
    // `assignedQuestionOrders` non è richiesto e viene ignorato.
    return sortByOrder(questions);
  }

  // Insieme assegnato dal server — validazione fail-closed.
  const assigned = submission.assignedQuestionOrders;
  if (!Array.isArray(assigned)) {
    throw new AssignedVariantError('Variante assegnata mancante per una verifica a varianti.');
  }
  if (questions.length > 0 && assigned.length === 0) {
    throw new AssignedVariantError('Variante assegnata vuota.');
  }

  // Order assegnati: interi, unici, esistenti nello snapshot.
  const assignedSet = new Set<number>();
  for (const order of assigned) {
    if (!Number.isInteger(order)) {
      throw new AssignedVariantError(`Order assegnato non intero: ${order}.`);
    }
    if (!byOrder.has(order)) {
      throw new AssignedVariantError(`Order assegnato inesistente nello snapshot: ${order}.`);
    }
    if (assignedSet.has(order)) {
      throw new AssignedVariantError(`Order assegnato duplicato: ${order}.`);
    }
    assignedSet.add(order);
  }

  const common = snapshot.commonQuestionOrders;
  const groups = snapshot.equivalentGroups ?? [];
  if (!Array.isArray(common) || !Array.isArray(groups)) {
    throw new AssignedVariantError('Struttura dei gruppi equivalenti mancante o non valida.');
  }
  // Senza differenziazione una verifica `equivalent_variants` senza gruppi non
  // ha senso: era già un errore prima di VDIF-04 e resta tale.
  if (!isDifferentiated && groups.length === 0) {
    throw new AssignedVariantError('Struttura dei gruppi equivalenti mancante o non valida.');
  }

  // Lo snapshot VEX deve essere una partizione chiusa: ogni domanda compare
  // una sola volta, come comune oppure come alternativa di un solo gruppo.
  const configuredOrders = new Set<number>();
  for (const order of common) {
    if (!Number.isInteger(order) || !byOrder.has(order) || configuredOrders.has(order)) {
      throw new AssignedVariantError(`Order comune non valido o duplicato: ${order}.`);
    }
    configuredOrders.add(order);
  }
  const groupIds = new Set<string>();
  for (const group of groups) {
    if (
      typeof group?.id !== 'string' ||
      group.id.trim().length === 0 ||
      groupIds.has(group.id) ||
      !Array.isArray(group.alternativeOrders) ||
      group.alternativeOrders.length === 0
    ) {
      throw new AssignedVariantError('Gruppo equivalente mancante, duplicato o senza alternative.');
    }
    groupIds.add(group.id);
    for (const order of group.alternativeOrders) {
      if (!Number.isInteger(order) || !byOrder.has(order) || configuredOrders.has(order)) {
        throw new AssignedVariantError(
          `Order alternativa non valido, duplicato o condiviso tra gruppi: ${order}.`,
        );
      }
      configuredOrders.add(order);
    }
  }
  // VDIF-04 — le alternative differenziate vivono in `questions[]` ma non fra le
  // comuni né dentro un gruppo: sono la quarta categoria ammessa, e solo se lo
  // snapshot le dichiara.
  const differentiatedAlternatives = new Set(
    snapshot.differentiation?.differentiatedAlternativeOrders ?? [],
  );
  for (const order of differentiatedAlternatives) {
    if (!Number.isInteger(order) || !byOrder.has(order) || configuredOrders.has(order)) {
      throw new AssignedVariantError(
        `Order alternativa differenziata non valido o già configurato altrove: ${order}.`,
      );
    }
    configuredOrders.add(order);
  }
  if (configuredOrders.size !== byOrder.size) {
    throw new AssignedVariantError(
      'Lo snapshot contiene domande estranee a comuni, gruppi equivalenti e alternative differenziate.',
    );
  }

  // Esattamente una alternativa per gruppo: vale sempre, differenziazione o no —
  // la differenziazione non tocca i gruppi VEX (insiemi disgiunti).
  for (const group of groups) {
    const picked = group.alternativeOrders.filter((o) => assignedSet.has(o));
    if (picked.length !== 1) {
      throw new AssignedVariantError(
        `Il gruppo ${group.id} deve avere esattamente una alternativa assegnata (trovate ${picked.length}).`,
      );
    }
  }

  if (!isDifferentiated) {
    // Senza differenziazione ogni comune è servita a tutti, e la dimensione
    // attesa è esatta: comportamento VEX invariato.
    for (const order of common) {
      if (!assignedSet.has(order)) {
        throw new AssignedVariantError(`Domanda comune ${order} assente dalla variante assegnata.`);
      }
    }
    if (assignedSet.size !== common.length + groups.length) {
      throw new AssignedVariantError(
        'La variante assegnata contiene order estranei o non coincide con comuni + gruppi.',
      );
    }
  } else {
    // Con la differenziazione una comune può essere **omessa** o **sostituita**:
    // la cardinalità non è più fissa. Ciò che resta vero, e che qui si verifica,
    // è che ogni order assegnato appartenga a una delle tre categorie dichiarate
    // dallo snapshot, e che l'insieme non sia vuoto.
    if (assignedSet.size === 0) {
      throw new AssignedVariantError('Variante assegnata vuota.');
    }
    const groupOrders = new Set(groups.flatMap((group) => group.alternativeOrders));
    const commonSet = new Set(common);
    for (const order of assignedSet) {
      if (
        !commonSet.has(order) &&
        !groupOrders.has(order) &&
        !differentiatedAlternatives.has(order)
      ) {
        throw new AssignedVariantError(
          `Order assegnato estraneo a comuni, gruppi e alternative differenziate: ${order}.`,
        );
      }
    }
  }

  // Mirror string server-only obbligatorio e identico all'insieme numerico.
  const keys = submission.assignedAnswerKeys;
  if (!Array.isArray(keys) || keys.length !== assignedSet.size) {
    throw new AssignedVariantError('assignedAnswerKeys incoerente con la variante assegnata.');
  }
  const keySet = new Set(keys);
  if (keySet.size !== keys.length) {
    throw new AssignedVariantError('assignedAnswerKeys contiene chiavi duplicate.');
  }
  for (const order of assignedSet) {
    if (!keySet.has(order.toString())) {
      throw new AssignedVariantError(
        `assignedAnswerKeys non contiene la chiave dell'order ${order}.`,
      );
    }
  }

  return sortByOrder(questions.filter((q) => assignedSet.has(q.order)));
}

/** `true` se la verifica usa le varianti equivalenti (routing). */
export function isEquivalentVariantsSnapshot(
  snapshot: Pick<SnapshotLike, 'distributionMode'>,
): boolean {
  return normalizeDistributionMode(snapshot.distributionMode) === 'equivalent_variants';
}

/**
 * VDIF-04 — `true` quando l'insieme assegnato è deciso dal **server** e
 * `assignedQuestionOrders` è quindi obbligatorio: varianti equivalenti, oppure
 * differenziazione, oppure entrambe.
 */
export function isServerResolvedSnapshot(
  snapshot: Pick<SnapshotLike, 'distributionMode' | 'differentiation'>,
): boolean {
  return (
    normalizeDistributionMode(snapshot.distributionMode) === 'equivalent_variants' ||
    snapshot.differentiation != null
  );
}
