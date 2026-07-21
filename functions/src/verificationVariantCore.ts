/**
 * VEX-01B — logica **pura** dell'assegnazione delle varianti equivalenti,
 * lato server. Nessun accesso a Firestore/rete/Admin SDK: opera su strutture in
 * memoria e su un RNG **iniettabile** (in produzione crittograficamente sicuro,
 * nei test deterministico). Riusata dalla callable `assignVerificationVariant`.
 *
 * Contratto (documentazione/vex-contract.md §4.1–4.2b):
 * - una alternativa per gruppo, scelta **uniforme** server-side;
 * - le domande comuni sono sempre tutte assegnate;
 * - `assignedQuestionOrders` è l'unione ordinata (ascendente) di comuni + una
 *   alternativa per gruppo, espressa in `order` canonici (0-based);
 * - la risposta allo studente non contiene **mai** soluzioni né alternative non
 *   assegnate: il tipo interno delle domande **esclude** `soluzione`.
 */

import { randomInt } from 'node:crypto';

/** Codici di errore fail-closed della callable/assegnazione. */
export type VexAssignmentErrorCode = 'invalid_snapshot' | 'wrong_mode' | 'invalid_assignment';

export class VexAssignmentError extends Error {
  readonly code: VexAssignmentErrorCode;
  constructor(code: VexAssignmentErrorCode, message: string) {
    super(message);
    this.name = 'VexAssignmentError';
    this.code = code;
  }
}

export type VexTipo = 'aperta' | 'chiusa_singola' | 'chiusa_multipla';

/**
 * Domanda dello snapshot **senza soluzione**: è la vista sicura su cui operano
 * assegnazione e sanitizzazione. La porta di caricamento (gateway) è l'unico
 * punto che legge `teacherSnapshot.questions` e **scarta** `soluzione` prima di
 * costruire questo tipo, così la soluzione non entra mai nel core né nella
 * risposta.
 */
export interface VexSnapshotQuestion {
  order: number;
  tipo: VexTipo;
  maxPoints: number;
  difficolta: number;
  testo: string;
  opzioni?: { id: string; testo: string }[];
  maxCharacters?: number;
}

export interface VexEquivalentGroup {
  id: string;
  alternativeOrders: number[];
}

export interface VexSnapshot {
  distributionMode: 'equivalent_variants';
  questions: VexSnapshotQuestion[];
  commonQuestionOrders: number[];
  equivalentGroups: VexEquivalentGroup[];
}

/** Domanda restituita allo studente: sanitizzata, senza soluzione. */
export interface VexAssignedQuestion {
  order: number;
  tipo: VexTipo;
  maxPoints: number;
  testo: string;
  opzioni?: { id: string; testo: string }[];
  maxCharacters?: number;
}

/** RNG iniettabile: `randomIntBelow(n)` ⇒ intero uniforme in `[0, n)`. */
export type RandomIntBelow = (n: number) => number;

/**
 * RNG crittograficamente sicuro di **produzione** (Node `crypto.randomInt`).
 * Uniforme e non prevedibile; **nessun** `Math.random`. Iniettabile nei test.
 */
export const secureRandomIntBelow: RandomIntBelow = (n: number): number => {
  if (!Number.isInteger(n) || n <= 0) {
    throw new VexAssignmentError('invalid_assignment', `Intervallo RNG non valido: ${n}.`);
  }
  return randomInt(n);
};

function isPlainOptions(value: unknown): value is { id: string; testo: string }[] {
  return (
    Array.isArray(value) &&
    value.every(
      (o) =>
        typeof o === 'object' &&
        o !== null &&
        typeof (o as Record<string, unknown>).id === 'string' &&
        typeof (o as Record<string, unknown>).testo === 'string',
    )
  );
}

const TIPI: ReadonlySet<string> = new Set<VexTipo>(['aperta', 'chiusa_singola', 'chiusa_multipla']);

function toIntArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const out: number[] = [];
  for (const v of value) {
    if (!Number.isInteger(v) || (v as number) < 0) return null;
    out.push(v as number);
  }
  return out;
}

/**
 * Parsing **difensivo** dello snapshot VEX dal documento Firestore (Admin SDK).
 * Fail-closed: qualunque forma inattesa ⇒ `VexAssignmentError('invalid_snapshot')`.
 * Non tocca `soluzione`: la porta chiamante deve già averla esclusa.
 */
export function parseVexSnapshot(raw: unknown): VexSnapshot {
  if (typeof raw !== 'object' || raw === null) {
    throw new VexAssignmentError('invalid_snapshot', 'teacherSnapshot assente o non valido.');
  }
  const data = raw as Record<string, unknown>;
  if (data.distributionMode !== 'equivalent_variants') {
    throw new VexAssignmentError(
      'wrong_mode',
      'La verifica non è in modalità varianti equivalenti.',
    );
  }
  const rawQuestions = data.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    throw new VexAssignmentError('invalid_snapshot', 'Snapshot senza domande.');
  }
  const questions: VexSnapshotQuestion[] = rawQuestions.map((q, index) => {
    if (typeof q !== 'object' || q === null) {
      throw new VexAssignmentError('invalid_snapshot', `Domanda ${index} non valida.`);
    }
    const r = q as Record<string, unknown>;
    if (!Number.isInteger(r.order) || (r.order as number) < 0) {
      throw new VexAssignmentError('invalid_snapshot', `Domanda ${index}: order non valido.`);
    }
    if (typeof r.tipo !== 'string' || !TIPI.has(r.tipo)) {
      throw new VexAssignmentError('invalid_snapshot', `Domanda ${index}: tipo non valido.`);
    }
    if (!Number.isInteger(r.maxPoints) || (r.maxPoints as number) < 0) {
      throw new VexAssignmentError('invalid_snapshot', `Domanda ${index}: maxPoints non valido.`);
    }
    if (!Number.isInteger(r.difficolta)) {
      throw new VexAssignmentError('invalid_snapshot', `Domanda ${index}: difficoltà non valida.`);
    }
    if (typeof r.testo !== 'string') {
      throw new VexAssignmentError('invalid_snapshot', `Domanda ${index}: testo non valido.`);
    }
    const question: VexSnapshotQuestion = {
      order: r.order as number,
      tipo: r.tipo as VexTipo,
      maxPoints: r.maxPoints as number,
      difficolta: r.difficolta as number,
      testo: r.testo as string,
    };
    if (r.opzioni !== undefined) {
      if (!isPlainOptions(r.opzioni)) {
        throw new VexAssignmentError('invalid_snapshot', `Domanda ${index}: opzioni non valide.`);
      }
      question.opzioni = r.opzioni.map((o) => ({ id: o.id, testo: o.testo }));
    }
    if (r.maxCharacters !== undefined) {
      if (!Number.isInteger(r.maxCharacters) || (r.maxCharacters as number) < 0) {
        throw new VexAssignmentError(
          'invalid_snapshot',
          `Domanda ${index}: maxCharacters non valido.`,
        );
      }
      question.maxCharacters = r.maxCharacters as number;
    }
    return question;
  });

  const commonQuestionOrders = toIntArray(data.commonQuestionOrders);
  if (commonQuestionOrders === null) {
    throw new VexAssignmentError('invalid_snapshot', 'commonQuestionOrders non valido.');
  }
  if (!Array.isArray(data.equivalentGroups)) {
    throw new VexAssignmentError('invalid_snapshot', 'equivalentGroups non valido.');
  }
  const equivalentGroups: VexEquivalentGroup[] = data.equivalentGroups.map((g, index) => {
    if (typeof g !== 'object' || g === null) {
      throw new VexAssignmentError('invalid_snapshot', `Gruppo ${index} non valido.`);
    }
    const gr = g as Record<string, unknown>;
    if (typeof gr.id !== 'string' || gr.id.length === 0) {
      throw new VexAssignmentError('invalid_snapshot', `Gruppo ${index}: id non valido.`);
    }
    const alternativeOrders = toIntArray(gr.alternativeOrders);
    if (alternativeOrders === null) {
      throw new VexAssignmentError(
        'invalid_snapshot',
        `Gruppo ${index}: alternativeOrders non valido.`,
      );
    }
    return { id: gr.id, alternativeOrders };
  });

  const snapshot: VexSnapshot = {
    distributionMode: 'equivalent_variants',
    questions,
    commonQuestionOrders,
    equivalentGroups,
  };
  validateVexSnapshot(snapshot);
  return snapshot;
}

/**
 * Validazione **strutturale** fail-closed dello snapshot: order validi e unici,
 * gruppi con id unici e non vuoti, alternative compatibili (stesso tipo,
 * difficoltà e maxPoints — `maxCharacters` NON è un criterio, vedi §2.4),
 * nessun order duplicato tra gruppi, copertura completa e disgiunta di comuni +
 * alternative su tutte le domande. Lancia `VexAssignmentError('invalid_snapshot')`.
 */
export function validateVexSnapshot(snapshot: VexSnapshot): void {
  const orderToQuestion = new Map<number, VexSnapshotQuestion>();
  for (const q of snapshot.questions) {
    if (orderToQuestion.has(q.order)) {
      throw new VexAssignmentError('invalid_snapshot', `Order duplicato in questions: ${q.order}.`);
    }
    orderToQuestion.set(q.order, q);
  }

  const seen = new Set<number>();
  const requireKnownOrder = (order: number, where: string): void => {
    if (!orderToQuestion.has(order)) {
      throw new VexAssignmentError('invalid_snapshot', `${where}: order sconosciuto ${order}.`);
    }
    if (seen.has(order)) {
      throw new VexAssignmentError(
        'invalid_snapshot',
        `Order ${order} assegnato più di una volta.`,
      );
    }
    seen.add(order);
  };

  for (const order of snapshot.commonQuestionOrders)
    requireKnownOrder(order, 'commonQuestionOrders');

  const groupIds = new Set<string>();
  for (const group of snapshot.equivalentGroups) {
    if (groupIds.has(group.id)) {
      throw new VexAssignmentError('invalid_snapshot', `Gruppo con id duplicato: ${group.id}.`);
    }
    groupIds.add(group.id);
    if (group.alternativeOrders.length === 0) {
      throw new VexAssignmentError('invalid_snapshot', `Gruppo ${group.id} vuoto.`);
    }
    let first: VexSnapshotQuestion | undefined;
    for (const order of group.alternativeOrders) {
      requireKnownOrder(order, `Gruppo ${group.id}`);
      const q = orderToQuestion.get(order)!;
      if (first === undefined) {
        first = q;
      } else if (
        q.tipo !== first.tipo ||
        q.difficolta !== first.difficolta ||
        q.maxPoints !== first.maxPoints
      ) {
        throw new VexAssignmentError(
          'invalid_snapshot',
          `Gruppo ${group.id}: alternative incompatibili (tipo/difficoltà/maxPoints).`,
        );
      }
    }
  }

  // Copertura completa e disgiunta: ogni domanda è comune o in esattamente un gruppo.
  if (seen.size !== snapshot.questions.length) {
    throw new VexAssignmentError(
      'invalid_snapshot',
      'Copertura degli order incompleta o non disgiunta.',
    );
  }
}

/**
 * Estrae **una** alternativa per gruppo (scelta uniforme via RNG iniettato) e la
 * unisce a tutte le comuni. Ritorna gli `order` **ordinati ascendenti**, senza
 * duplicati. Non muta lo snapshot. La casualità è usata SOLO qui (primo avvio):
 * la persistenza/idempotenza è responsabilità del chiamante (transazione).
 */
export function assignVariant(snapshot: VexSnapshot, randomIntBelow: RandomIntBelow): number[] {
  const chosen: number[] = [...snapshot.commonQuestionOrders];
  for (const group of snapshot.equivalentGroups) {
    const n = group.alternativeOrders.length;
    const index = randomIntBelow(n);
    if (!Number.isInteger(index) || index < 0 || index >= n) {
      throw new VexAssignmentError(
        'invalid_assignment',
        `RNG ha restituito un indice fuori range per il gruppo ${group.id}.`,
      );
    }
    chosen.push(group.alternativeOrders[index]!);
  }
  return [...new Set(chosen)].sort((a, b) => a - b);
}

/**
 * Verifica fail-closed che un `assignedQuestionOrders` **già persistito** sia
 * coerente con lo snapshot: contiene tutte le comuni ed **esattamente una**
 * alternativa per ciascun gruppo, nessun order estraneo, nessuna omissione,
 * nessun duplicato. Ritorna `true`/`false`; il chiamante decide (nessuna
 * rigenerazione silenziosa: un valore invalido è un errore).
 */
export function isValidAssignment(snapshot: VexSnapshot, assigned: readonly number[]): boolean {
  const validOrders = new Set(snapshot.questions.map((q) => q.order));
  const set = new Set<number>();
  for (const order of assigned) {
    if (!Number.isInteger(order) || !validOrders.has(order)) return false;
    if (set.has(order)) return false; // duplicato
    set.add(order);
  }
  // Tutte le comuni presenti.
  for (const order of snapshot.commonQuestionOrders) {
    if (!set.has(order)) return false;
  }
  // Esattamente una alternativa per gruppo.
  for (const group of snapshot.equivalentGroups) {
    const picked = group.alternativeOrders.filter((o) => set.has(o));
    if (picked.length !== 1) return false;
  }
  // Nessun order estraneo: dimensione = comuni + gruppi.
  const expectedSize = snapshot.commonQuestionOrders.length + snapshot.equivalentGroups.length;
  return set.size === expectedSize;
}

/**
 * Sanitizza le domande assegnate per la risposta allo studente: solo gli order
 * in `assigned`, **ordinati ascendenti**, come `VexAssignedQuestion` (nessuna
 * soluzione, nessuna alternativa non assegnata). Ogni domanda conserva il
 * proprio `maxCharacters`.
 */
export function sanitizeAssignedQuestions(
  snapshot: VexSnapshot,
  assigned: readonly number[],
): VexAssignedQuestion[] {
  const byOrder = new Map(snapshot.questions.map((q) => [q.order, q]));
  return [...assigned]
    .sort((a, b) => a - b)
    .map((order) => {
      const q = byOrder.get(order);
      if (!q) {
        throw new VexAssignmentError(
          'invalid_assignment',
          `Order assegnato sconosciuto: ${order}.`,
        );
      }
      const out: VexAssignedQuestion = {
        order: q.order,
        tipo: q.tipo,
        maxPoints: q.maxPoints,
        testo: q.testo,
      };
      if (q.opzioni !== undefined)
        out.opzioni = q.opzioni.map((o) => ({ id: o.id, testo: o.testo }));
      if (q.maxCharacters !== undefined) out.maxCharacters = q.maxCharacters;
      return out;
    });
}
