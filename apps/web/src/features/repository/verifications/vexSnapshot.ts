import type {
  EquivalentGroupConfig,
  EquivalentGroupSnapshot,
  VerificationQuestionRef,
} from '../../../types/firestore.js';

/**
 * VEX-01A — conversione **pura** `questionIndexEntryId → order` per il futuro
 * `teacherSnapshot` (usata da VEX-01B all'attivazione). Non legge nulla: opera
 * sui `questionRefs` già congelati (il cui `order` è l'indice nell'array, come
 * `activateVerification` assegna gli order della proiezione) e sui gruppi draft.
 *
 * Fail-closed: riferimento mancante, duplicato tra gruppi, gruppo incompatibile
 * o copertura incompleta ⇒ lancia. Ordine deterministico.
 */

export interface EquivalentSnapshotParts {
  commonQuestionOrders: number[];
  equivalentGroups: EquivalentGroupSnapshot[];
}

export class VexSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VexSnapshotError';
  }
}

/**
 * Costruisce `commonQuestionOrders` + `equivalentGroups` (order-based) dai
 * `questionRefs` congelati e dai `groups` (entryId). L'`order` di ogni domanda
 * è la sua **posizione** in `questionRefs` (0-based), coerente con la proiezione.
 */
export function buildEquivalentSnapshotParts(
  questionRefs: readonly VerificationQuestionRef[],
  groups: readonly EquivalentGroupConfig[],
): EquivalentSnapshotParts {
  // Mappa entryId → order (posizione nell'array congelato). Un entryId
  // duplicato tra i questionRefs è già impossibile a monte, ma lo verifichiamo.
  const orderByEntryId = new Map<string, number>();
  questionRefs.forEach((ref, order) => {
    if (orderByEntryId.has(ref.questionIndexEntryId)) {
      throw new VexSnapshotError(
        `questionRefs contiene un duplicato: ${ref.questionIndexEntryId}.`,
      );
    }
    orderByEntryId.set(ref.questionIndexEntryId, order);
  });
  const byEntryId = new Map(questionRefs.map((r) => [r.questionIndexEntryId, r]));

  const groupedOrders = new Set<number>();
  const equivalentGroups: EquivalentGroupSnapshot[] = [];
  const seenGroupIds = new Set<string>();

  for (const group of groups) {
    // Id gruppo univoci (fail-closed): id duplicati renderebbero ambigua
    // l'identità dello snapshot.
    if (seenGroupIds.has(group.id)) {
      throw new VexSnapshotError(`Due gruppi hanno lo stesso identificativo: ${group.id}.`);
    }
    seenGroupIds.add(group.id);
    if (group.questionIndexEntryIds.length === 0) {
      // I gruppi vuoti sono eliminati a monte (reconcile); qui è un errore.
      throw new VexSnapshotError(`Gruppo ${group.id} vuoto: non convertibile.`);
    }
    const first = byEntryId.get(group.questionIndexEntryIds[0]!);
    const alternativeOrders: number[] = [];
    for (const entryId of group.questionIndexEntryIds) {
      const order = orderByEntryId.get(entryId);
      const ref = byEntryId.get(entryId);
      if (order === undefined || ref === undefined) {
        throw new VexSnapshotError(`Riferimento mancante nei questionRefs congelati: ${entryId}.`);
      }
      if (groupedOrders.has(order)) {
        throw new VexSnapshotError(
          `La domanda ${ref.questionLocalId ?? entryId} è in più di un gruppo.`,
        );
      }
      if (
        first &&
        (ref.udaDir !== first.udaDir ||
          ref.tipo !== first.tipo ||
          ref.difficolta !== first.difficolta)
      ) {
        throw new VexSnapshotError(
          'Le alternative di un gruppo devono avere stessa UDA, stesso tipo e stessa difficoltà.',
        );
      }
      groupedOrders.add(order);
      alternativeOrders.push(order);
    }
    alternativeOrders.sort((a, b) => a - b);
    equivalentGroups.push({ id: group.id, alternativeOrders });
  }

  // Comuni = order non raggruppati; copertura completa e disgiunta garantita.
  const commonQuestionOrders: number[] = [];
  for (let order = 0; order < questionRefs.length; order++) {
    if (!groupedOrders.has(order)) commonQuestionOrders.push(order);
  }

  const covered = commonQuestionOrders.length + groupedOrders.size;
  if (covered !== questionRefs.length) {
    throw new VexSnapshotError('Copertura degli order incompleta: snapshot non costruibile.');
  }

  return { commonQuestionOrders, equivalentGroups };
}
