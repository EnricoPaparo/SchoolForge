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
 * Parsing difensivo delle sole `questions[]` dello snapshot, condiviso dal
 * percorso VEX e da quello differenziato: una copia sola, così le due porte non
 * possono divergere su che cosa considerano una domanda valida.
 */
export function parseSnapshotQuestions(rawQuestions: unknown): VexSnapshotQuestion[] {
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    throw new VexAssignmentError('invalid_snapshot', 'Snapshot senza domande.');
  }
  return rawQuestions.map((q, index) => {
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
  const questions = parseSnapshotQuestions(data.questions);

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

// ── VDIF-04 — risoluzione differenziata ────────────────────────────────────────

/**
 * Scelta congelata per una singola etichetta su una singola domanda comune.
 * L'alternativa è indicata dal suo `order` dentro `questions[]`: dopo
 * l'attivazione il pool non viene mai più letto, quindi un riferimento
 * all'indice corrente sarebbe un puntatore verso un mondo che può cambiare.
 */
export type VdifChoice =
  | { kind: 'base' }
  | { kind: 'alternative'; order: number }
  | { kind: 'none' };

export interface VdifQuestion {
  baseOrder: number;
  choices: Record<string, VdifChoice>;
}

export interface VdifSnapshot {
  version: 1;
  questions: VdifQuestion[];
  labels: { labelId: string; labelName: string }[];
  differentiatedAlternativeOrders: number[];
}

export interface VdifLabelAssignments {
  version: 1;
  byStudentUid: Record<string, string>;
}

/**
 * Snapshot **risolvibile dal server**: la forma unificata su cui opera la
 * callable. Copre i tre casi reali — solo VEX, solo differenziazione, entrambe —
 * senza che il chiamante debba distinguerli.
 *
 * `equivalentGroups` è `[]` quando non c'è VEX; `differentiation` è `null`
 * quando non c'è differenziazione. Almeno uno dei due è presente: altrimenti la
 * verifica non passa dalla callable e il client resta interamente client-side.
 */
export interface ResolvableSnapshot {
  questions: VexSnapshotQuestion[];
  commonQuestionOrders: number[];
  equivalentGroups: VexEquivalentGroup[];
  differentiation: VdifSnapshot | null;
  labelAssignments: VdifLabelAssignments | null;
}

function parseVdifChoice(raw: unknown, where: string): VdifChoice {
  if (typeof raw !== 'object' || raw === null) {
    throw new VexAssignmentError('invalid_snapshot', `${where}: scelta non valida.`);
  }
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r).sort();
  if (r.kind === 'base' || r.kind === 'none') {
    if (keys.length !== 1 || keys[0] !== 'kind') {
      throw new VexAssignmentError('invalid_snapshot', `${where}: scelta con proprietà inattese.`);
    }
    return { kind: r.kind };
  }
  if (r.kind === 'alternative') {
    if (keys.length !== 2 || keys[0] !== 'kind' || keys[1] !== 'order') {
      throw new VexAssignmentError('invalid_snapshot', `${where}: scelta con proprietà inattese.`);
    }
    if (!Number.isInteger(r.order) || (r.order as number) < 0) {
      throw new VexAssignmentError('invalid_snapshot', `${where}: order alternativa non valido.`);
    }
    return { kind: 'alternative', order: r.order as number };
  }
  throw new VexAssignmentError('invalid_snapshot', `${where}: tipo di scelta non riconosciuto.`);
}

/**
 * Parsing **difensivo** del blocco differenziato. Fail-closed su versione,
 * forma, chiavi extra e coerenza fra `labels[]` e le `choices` realmente usate:
 * uno snapshot che referenzia un'etichetta che non dichiara è incoerente, e
 * risolverlo comunque significherebbe servire domande decise da una
 * configurazione che nessuno può più leggere.
 */
export function parseVdifSnapshot(raw: unknown): VdifSnapshot {
  if (typeof raw !== 'object' || raw === null) {
    throw new VexAssignmentError('invalid_snapshot', 'Blocco differenziato non valido.');
  }
  const data = raw as Record<string, unknown>;
  if (data.version !== 1) {
    throw new VexAssignmentError('invalid_snapshot', 'Blocco differenziato: versione non attesa.');
  }
  const keys = Object.keys(data).sort();
  const expected = ['differentiatedAlternativeOrders', 'labels', 'questions', 'version'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new VexAssignmentError(
      'invalid_snapshot',
      'Blocco differenziato: struttura non riconosciuta.',
    );
  }
  if (!Array.isArray(data.questions) || data.questions.length === 0) {
    throw new VexAssignmentError('invalid_snapshot', 'Blocco differenziato senza domande.');
  }
  if (!Array.isArray(data.labels) || data.labels.length === 0) {
    throw new VexAssignmentError('invalid_snapshot', 'Blocco differenziato senza etichette.');
  }
  const labels = data.labels.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new VexAssignmentError('invalid_snapshot', `Etichetta ${index} non valida.`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.labelId !== 'string' || e.labelId.length === 0) {
      throw new VexAssignmentError('invalid_snapshot', `Etichetta ${index}: id non valido.`);
    }
    if (typeof e.labelName !== 'string') {
      throw new VexAssignmentError('invalid_snapshot', `Etichetta ${index}: nome non valido.`);
    }
    return { labelId: e.labelId, labelName: e.labelName };
  });
  const declared = new Set(labels.map((label) => label.labelId));
  if (declared.size !== labels.length) {
    throw new VexAssignmentError('invalid_snapshot', 'Blocco differenziato: etichetta duplicata.');
  }

  const seenBase = new Set<number>();
  const questions: VdifQuestion[] = data.questions.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new VexAssignmentError(
        'invalid_snapshot',
        `Domanda differenziata ${index} non valida.`,
      );
    }
    const q = entry as Record<string, unknown>;
    const qKeys = Object.keys(q).sort();
    if (qKeys.length !== 2 || qKeys[0] !== 'baseOrder' || qKeys[1] !== 'choices') {
      throw new VexAssignmentError(
        'invalid_snapshot',
        `Domanda differenziata ${index}: struttura non riconosciuta.`,
      );
    }
    if (!Number.isInteger(q.baseOrder) || (q.baseOrder as number) < 0) {
      throw new VexAssignmentError(
        'invalid_snapshot',
        `Domanda differenziata ${index}: baseOrder non valido.`,
      );
    }
    if (seenBase.has(q.baseOrder as number)) {
      throw new VexAssignmentError(
        'invalid_snapshot',
        `Domanda differenziata ${index}: baseOrder duplicato.`,
      );
    }
    seenBase.add(q.baseOrder as number);
    if (typeof q.choices !== 'object' || q.choices === null || Array.isArray(q.choices)) {
      throw new VexAssignmentError(
        'invalid_snapshot',
        `Domanda differenziata ${index}: scelte non valide.`,
      );
    }
    const choices: Record<string, VdifChoice> = {};
    for (const [labelId, choice] of Object.entries(q.choices as Record<string, unknown>)) {
      if (!declared.has(labelId)) {
        throw new VexAssignmentError(
          'invalid_snapshot',
          `Domanda differenziata ${index}: etichetta non dichiarata in labels[].`,
        );
      }
      choices[labelId] = parseVdifChoice(choice, `Domanda differenziata ${index}`);
    }
    return { baseOrder: q.baseOrder as number, choices };
  });

  const differentiatedAlternativeOrders = toIntArray(data.differentiatedAlternativeOrders);
  if (differentiatedAlternativeOrders === null) {
    throw new VexAssignmentError(
      'invalid_snapshot',
      'Blocco differenziato: differentiatedAlternativeOrders non valido.',
    );
  }
  return { version: 1, questions, labels, differentiatedAlternativeOrders };
}

/** Parsing difensivo della mappa `studentUid → labelId` congelata. */
export function parseVdifLabelAssignments(raw: unknown): VdifLabelAssignments {
  if (typeof raw !== 'object' || raw === null) {
    throw new VexAssignmentError('invalid_snapshot', 'Assegnazioni congelate non valide.');
  }
  const data = raw as Record<string, unknown>;
  if (data.version !== 1) {
    throw new VexAssignmentError(
      'invalid_snapshot',
      'Assegnazioni congelate: versione non attesa.',
    );
  }
  const keys = Object.keys(data).sort();
  if (keys.length !== 2 || keys[0] !== 'byStudentUid' || keys[1] !== 'version') {
    throw new VexAssignmentError(
      'invalid_snapshot',
      'Assegnazioni congelate: struttura non riconosciuta.',
    );
  }
  const raw2 = data.byStudentUid;
  if (typeof raw2 !== 'object' || raw2 === null || Array.isArray(raw2)) {
    throw new VexAssignmentError('invalid_snapshot', 'Assegnazioni congelate: mappa non valida.');
  }
  const byStudentUid: Record<string, string> = {};
  for (const [studentUid, labelId] of Object.entries(raw2 as Record<string, unknown>)) {
    if (typeof labelId !== 'string' || labelId.length === 0) {
      throw new VexAssignmentError(
        'invalid_snapshot',
        'Assegnazioni congelate: etichetta non valida.',
      );
    }
    byStudentUid[studentUid] = labelId;
  }
  return { version: 1, byStudentUid };
}

/**
 * Parsing **unificato** dello snapshot risolvibile dal server. Copre i tre casi
 * reali senza duplicare la validazione delle domande, e rifiuta lo snapshot che
 * non è risolvibile affatto (né VEX né differenziazione): quel caso non deve
 * arrivare alla callable, e se ci arriva è uno stato che nessuno ha spiegato.
 */
export function parseResolvableSnapshot(raw: unknown): ResolvableSnapshot {
  if (typeof raw !== 'object' || raw === null) {
    throw new VexAssignmentError('invalid_snapshot', 'teacherSnapshot assente o non valido.');
  }
  const data = raw as Record<string, unknown>;
  const hasDifferentiation = data.differentiation != null;
  const isVex = data.distributionMode === 'equivalent_variants';
  if (!isVex && !hasDifferentiation) {
    throw new VexAssignmentError(
      'wrong_mode',
      'La verifica non richiede un’assegnazione dal server.',
    );
  }

  const questions = parseSnapshotQuestions(data.questions);
  const commonQuestionOrders = toIntArray(data.commonQuestionOrders);
  if (commonQuestionOrders === null) {
    throw new VexAssignmentError('invalid_snapshot', 'commonQuestionOrders non valido.');
  }
  const rawGroups = data.equivalentGroups ?? [];
  if (!Array.isArray(rawGroups)) {
    throw new VexAssignmentError('invalid_snapshot', 'equivalentGroups non valido.');
  }
  const equivalentGroups: VexEquivalentGroup[] = rawGroups.map((g, index) => {
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

  const differentiation = hasDifferentiation ? parseVdifSnapshot(data.differentiation) : null;
  const labelAssignments = hasDifferentiation
    ? parseVdifLabelAssignments(data.labelAssignments)
    : null;

  const snapshot: ResolvableSnapshot = {
    questions,
    commonQuestionOrders,
    equivalentGroups,
    differentiation,
    labelAssignments,
  };
  validateResolvableSnapshot(snapshot);
  return snapshot;
}

/**
 * Copertura **completa e disgiunta**: ogni domanda dello snapshot è comune,
 * oppure alternativa di esattamente un gruppo, oppure alternativa
 * differenziata. Le alternative dei gruppi restano compatibili fra loro
 * (tipo/difficoltà/maxPoints), come già in VEX.
 */
export function validateResolvableSnapshot(snapshot: ResolvableSnapshot): void {
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

  for (const order of snapshot.commonQuestionOrders) {
    requireKnownOrder(order, 'commonQuestionOrders');
  }

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

  const differentiation = snapshot.differentiation;
  if (differentiation) {
    for (const order of differentiation.differentiatedAlternativeOrders) {
      requireKnownOrder(order, 'Alternative differenziate');
    }
    const declaredAlternatives = new Set(differentiation.differentiatedAlternativeOrders);
    const commonSet = new Set(snapshot.commonQuestionOrders);
    for (const question of differentiation.questions) {
      if (!commonSet.has(question.baseOrder)) {
        throw new VexAssignmentError(
          'invalid_snapshot',
          `La domanda base ${question.baseOrder} non è fra le comuni.`,
        );
      }
      for (const choice of Object.values(question.choices)) {
        if (choice.kind !== 'alternative') continue;
        if (!declaredAlternatives.has(choice.order)) {
          throw new VexAssignmentError(
            'invalid_snapshot',
            `L'alternativa ${choice.order} non è dichiarata fra le alternative differenziate.`,
          );
        }
      }
    }
  }

  if (seen.size !== snapshot.questions.length) {
    throw new VexAssignmentError(
      'invalid_snapshot',
      'Copertura degli order incompleta o non disgiunta.',
    );
  }
}

/**
 * **Unica** implementazione autorevole dell'algoritmo di risoluzione congelato
 * (roadmap §5.D.4). Puro: non legge nulla, non muta gli input, e l'unica
 * casualità è quella di VEX, iniettata.
 *
 * ```
 * 1. labelId := labelAssignments.byStudentUid[studentUid]      // può mancare
 * 2. base    := commonQuestionOrders
 * 3. per ogni domanda differenziata: base / alternative / none
 * 4. per ogni gruppo VEX: estrai UNA alternativa con l'RNG sicuro
 * 5. insieme vuoto o con duplicati ⇒ ERRORE
 * 6. restituisci gli order ordinati
 * ```
 *
 * I passi 3 e 4 operano su insiemi **disgiunti** — invariante garantito dalle
 * guardie di mutua esclusione e ri-verificato all'attivazione — quindi il loro
 * ordine è irrilevante e non possono interferire. Uno studente senza etichetta
 * riceve sempre la base: è il default esplicito, non un ripiego.
 */
export function resolveDifferentiatedOrders(
  snapshot: ResolvableSnapshot,
  studentUid: string,
  randomIntBelow: RandomIntBelow,
): number[] {
  const labelId = snapshot.labelAssignments?.byStudentUid[studentUid] ?? null;
  const base = new Set<number>(snapshot.commonQuestionOrders);

  for (const question of snapshot.differentiation?.questions ?? []) {
    if (!base.has(question.baseOrder)) {
      throw new VexAssignmentError(
        'invalid_snapshot',
        `La domanda base ${question.baseOrder} non è fra le comuni.`,
      );
    }
    const choice = labelId === null ? undefined : question.choices[labelId];
    if (choice === undefined || choice.kind === 'base') continue;
    if (choice.kind === 'none') {
      base.delete(question.baseOrder);
      continue;
    }
    base.delete(question.baseOrder);
    if (base.has(choice.order)) {
      throw new VexAssignmentError(
        'invalid_assignment',
        `L'alternativa ${choice.order} duplicherebbe una domanda già assegnata.`,
      );
    }
    base.add(choice.order);
  }

  const chosen = [...base];
  for (const group of snapshot.equivalentGroups) {
    const n = group.alternativeOrders.length;
    const index = randomIntBelow(n);
    if (!Number.isInteger(index) || index < 0 || index >= n) {
      throw new VexAssignmentError(
        'invalid_assignment',
        `RNG ha restituito un indice fuori range per il gruppo ${group.id}.`,
      );
    }
    const picked = group.alternativeOrders[index]!;
    if (chosen.includes(picked)) {
      throw new VexAssignmentError(
        'invalid_assignment',
        `Il gruppo ${group.id} ha estratto una domanda già assegnata.`,
      );
    }
    chosen.push(picked);
  }

  if (chosen.length === 0) {
    throw new VexAssignmentError(
      'invalid_assignment',
      'La configurazione non assegna alcuna domanda a questo studente.',
    );
  }
  const unique = new Set(chosen);
  if (unique.size !== chosen.length) {
    throw new VexAssignmentError('invalid_assignment', 'Assegnazione con domande duplicate.');
  }
  return [...unique].sort((a, b) => a - b);
}

/**
 * Verifica fail-closed che un `assignedQuestionOrders` **già persistito** resti
 * coerente con lo snapshot e con l'etichetta congelata dello studente.
 *
 * Con la differenziazione l'insieme atteso è **deterministico** a meno dei
 * gruppi VEX: si ricalcolano i passi 1–3 e si confronta la parte comune, poi si
 * verifica che ogni gruppo abbia esattamente una alternativa. Nessuna
 * rigenerazione silenziosa: il chiamante decide, e il contratto è che un valore
 * incoerente sia un errore.
 */
export function isValidResolvedAssignment(
  snapshot: ResolvableSnapshot,
  studentUid: string,
  assigned: readonly number[],
): boolean {
  const validOrders = new Set(snapshot.questions.map((q) => q.order));
  const set = new Set<number>();
  for (const order of assigned) {
    if (!Number.isInteger(order) || !validOrders.has(order)) return false;
    if (set.has(order)) return false;
    set.add(order);
  }

  let expectedCommon: number[];
  try {
    expectedCommon = resolveDifferentiatedOrders(
      { ...snapshot, equivalentGroups: [] },
      studentUid,
      () => 0,
    );
  } catch {
    return false;
  }
  for (const order of expectedCommon) {
    if (!set.has(order)) return false;
  }
  for (const group of snapshot.equivalentGroups) {
    const picked = group.alternativeOrders.filter((o) => set.has(o));
    if (picked.length !== 1) return false;
  }
  return set.size === expectedCommon.length + snapshot.equivalentGroups.length;
}

/**
 * Sanitizza le domande assegnate per la risposta allo studente: solo gli order
 * in `assigned`, ordinati, senza soluzione e senza alcuna alternativa non
 * assegnata.
 */
export function sanitizeResolvedQuestions(
  snapshot: ResolvableSnapshot,
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
