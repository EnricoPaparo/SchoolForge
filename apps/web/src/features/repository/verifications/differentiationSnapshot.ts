import type {
  DifferentiatedChoiceSnapshot,
  DifferentiatedQuestionSnapshot,
  EquivalentGroupConfig,
  VerificationDifferentiationConfig,
  VerificationDifferentiationSnapshot,
  VerificationLabelAssignmentSnapshot,
  VerificationQuestionRef,
} from '../../../types/firestore.js';
import {
  classifyQuestionParticipation,
  QuestionParticipationError,
} from './questionParticipation.js';
import { resolveDifferentiatedCommonOrders } from './differentiationResolution.js';

/**
 * VDIF-04 — costruzione **pura** dello snapshot differenziato e delle guardie
 * G03→G16, eseguite sul preflight prima di aprire qualunque transazione.
 *
 * Nessuna IO: il chiamante fornisce già la configurazione di bozza, i
 * `questionRefs` congelati, l'indice delle domande corrente, le etichette
 * dell'owner e le assegnazioni correnti. Così ogni guardia è verificabile con un
 * test puro, e l'attivazione fallisce **prima** di leggere lo Storage o di
 * scrivere un solo documento.
 *
 * ## L'ordine degli `order`
 *
 * Le domande selezionate occupano gli `order` `0..n-1`, esattamente come oggi
 * (l'`order` è l'indice in `questionRefs`). Le alternative differenziate sono
 * **appese in coda**, `n..n+m-1`, in ordine deterministico. Due conseguenze
 * volute: gli `order` delle domande comuni non cambiano rispetto a una verifica
 * senza differenziazione, e `commonQuestionOrders` resta esattamente
 * `0..n-1` meno i membri dei gruppi VEX.
 */

export class DifferentiationSnapshotError extends Error {
  /** Guardia che ha bloccato: serve ai test, non all'utente. */
  readonly guard: string;

  constructor(guard: string, message: string) {
    super(message);
    this.name = 'DifferentiationSnapshotError';
    this.guard = guard;
  }
}

/** Voce dell'indice domande necessaria per risolvere un'alternativa. */
export type DifferentiationIndexEntry = {
  id: string;
  udaDir: string;
  lessonFilename: string;
  poolStorageRef: string;
  questionLocalId: string;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  difficolta: VerificationQuestionRef['difficolta'];
  maxPoints: number;
};

/** Etichetta dell'owner, ridotta a ciò che il congelamento richiede. */
export type DifferentiationLabelInput = { labelId: string; name: string };

/** Assegnazione corrente, già filtrata sull'owner. */
export type DifferentiationAssignmentInput = { studentUid: string; labelId: string };

/** Studente dell'owner: serve a distinguere G06 (ignora) da G07 (blocca). */
export type DifferentiationStudentInput = { uid: string; ownerUid: string };

export type DifferentiationPlanLabel = {
  labelId: string;
  labelName: string;
  /** `order` comuni risolti per questa etichetta, dopo sostituzioni e omissioni. */
  commonOrders: number[];
  /** Numero finale di domande: comuni risolte **più** un membro per gruppo VEX. */
  questionCount: number;
  /** Somma dei `maxPoints` delle domande realmente risolte. */
  maxPoints: number;
  substitutions: number;
  omissions: number;
  /** Motivo leggibile che impedisce l'attivazione, o `null`. */
  blocker: string | null;
};

export type DifferentiationSnapshotParts = {
  /** Refs delle alternative, nell'ordine in cui vanno appese a `questionRefs`. */
  alternativeRefs: VerificationQuestionRef[];
  /** Snapshot congelato, `order`-based. */
  snapshot: VerificationDifferentiationSnapshot;
  /** Assegnazioni congelate, già ripulite dagli studenti inesistenti (G06). */
  labelAssignments: VerificationLabelAssignmentSnapshot;
  /** Esito risolto per ciascuna etichetta coinvolta, più il percorso base. */
  perLabel: DifferentiationPlanLabel[];
  /** Percorso di chi non ha etichetta: sempre la base (principio 7). */
  base: {
    commonOrders: number[];
    questionCount: number;
    maxPoints: number;
    blocker: string | null;
  };
  /** Assegnazioni scartate perché lo studente non esiste più (G06, non bloccante). */
  ignoredAssignments: string[];
};

export type BuildDifferentiationSnapshotInput = {
  config: VerificationDifferentiationConfig;
  questionRefs: readonly VerificationQuestionRef[];
  equivalentGroups: readonly EquivalentGroupConfig[];
  questionIndex: readonly DifferentiationIndexEntry[];
  labels: readonly DifferentiationLabelInput[];
  assignments: readonly DifferentiationAssignmentInput[];
  students: readonly DifferentiationStudentInput[];
  ownerUid: string;
};

function describeQuestion(ref: VerificationQuestionRef | DifferentiationIndexEntry): string {
  return ref.questionLocalId;
}

/**
 * G03→G16 e costruzione dello snapshot, in un solo passaggio. L'ordine delle
 * verifiche è quello congelato in roadmap §7.2: ogni guardia lancia con un
 * messaggio che nomina il dato reale, mai un id nudo.
 */
export function buildDifferentiationSnapshotParts(
  input: BuildDifferentiationSnapshotInput,
): DifferentiationSnapshotParts {
  const { config, questionRefs, equivalentGroups, questionIndex, labels, ownerUid } = input;

  // G03 — versione e forma. Il parser di bozza ha già rifiutato le chiavi extra;
  // qui si ricontrolla la versione perché lo snapshot è un contratto diverso e
  // non deve fidarsi di ciò che un'altra scheda potrebbe aver scritto.
  if (config.version !== 1) {
    throw new DifferentiationSnapshotError(
      'G03',
      'Configurazione delle varianti non riconosciuta.',
    );
  }

  const labelById = new Map(labels.map((label) => [label.labelId, label]));
  const orderByEntryId = new Map<string, number>();
  questionRefs.forEach((ref, order) => orderByEntryId.set(ref.questionIndexEntryId, order));
  const refByEntryId = new Map(questionRefs.map((ref) => [ref.questionIndexEntryId, ref]));
  const indexById = new Map(questionIndex.map((entry) => [entry.id, entry]));
  const groupedEntryIds = new Set(equivalentGroups.flatMap((group) => group.questionIndexEntryIds));

  // ── Etichette referenziate: esistenza e ownership (G04 / G05) ───────────────
  // G05 usa lo **stesso** messaggio di G04: confermare che un'etichetta esiste
  // ma appartiene a un altro docente sarebbe già un'informazione di troppo.
  const referenced = new Set(config.questions.flatMap((q) => Object.keys(q.choices)));
  for (const labelId of referenced) {
    if (!labelById.has(labelId)) {
      throw new DifferentiationSnapshotError(
        'G04',
        `Impossibile attivare: un'etichetta usata dalle varianti non esiste più (${labelId}). Ricarica la pagina e rivedi le varianti.`,
      );
    }
  }

  // ── Alternative: order deterministici appesi in coda ────────────────────────
  const alternativeRefs: VerificationQuestionRef[] = [];
  const alternativeOrderByEntryId = new Map<string, number>();
  const nextOrder = () => questionRefs.length + alternativeRefs.length;

  const snapshotQuestions: DifferentiatedQuestionSnapshot[] = config.questions.map((question) => {
    const baseOrder = orderByEntryId.get(question.baseQuestionIndexEntryId);
    const baseRef = refByEntryId.get(question.baseQuestionIndexEntryId);
    // G08 — la base deve essere fra le domande selezionate.
    if (baseOrder === undefined || baseRef === undefined) {
      throw new DifferentiationSnapshotError(
        'G08',
        `Impossibile attivare: la domanda con varianti ${question.baseQuestionIndexEntryId} non è più fra quelle selezionate.`,
      );
    }
    const choices: Record<string, DifferentiatedChoiceSnapshot> = {};
    for (const [labelId, choice] of Object.entries(question.choices)) {
      if (choice.kind === 'base' || choice.kind === 'none') {
        choices[labelId] = { kind: choice.kind };
        continue;
      }
      const entryId = choice.questionIndexEntryId;
      const label = labelById.get(labelId)!;
      // G09 — l'alternativa deve esistere nell'indice corrente.
      // G10 — un'alternativa rimossa dal pool sparisce dall'indice: è lo stesso
      // sintomo, e il messaggio nomina base e alternativa, mai un id nudo.
      const entry = indexById.get(entryId);
      if (entry === undefined) {
        throw new DifferentiationSnapshotError(
          'G09',
          `Impossibile attivare: l'alternativa dell'etichetta «${label.name}» per la domanda ${describeQuestion(baseRef)} non esiste più nel corso.`,
        );
      }
      // G11 — stessa lezione della base.
      if (entry.lessonFilename !== baseRef.lessonFilename) {
        throw new DifferentiationSnapshotError(
          'G11',
          `Impossibile attivare: l'alternativa ${describeQuestion(entry)} è della lezione ${entry.lessonFilename}, mentre la domanda base ${describeQuestion(baseRef)} è della lezione ${baseRef.lessonFilename}.`,
        );
      }
      // G12 — un'alternativa già selezionata come domanda della verifica
      // servirebbe due volte la stessa domanda.
      if (orderByEntryId.has(entryId)) {
        throw new DifferentiationSnapshotError(
          'G12',
          `Impossibile attivare: la domanda ${describeQuestion(entry)} è già selezionata nella verifica e non può essere anche un'alternativa.`,
        );
      }
      // G14 — un'alternativa dentro un gruppo VEX mescolerebbe i due meccanismi.
      if (groupedEntryIds.has(entryId)) {
        throw new DifferentiationSnapshotError(
          'G14',
          `Impossibile attivare: la domanda ${describeQuestion(entry)} è alternativa differenziata e membro di un gruppo equivalente.`,
        );
      }
      let order = alternativeOrderByEntryId.get(entryId);
      if (order === undefined) {
        order = nextOrder();
        alternativeOrderByEntryId.set(entryId, order);
        alternativeRefs.push({
          questionIndexEntryId: entry.id,
          questionLocalId: entry.questionLocalId,
          udaDir: entry.udaDir,
          lessonFilename: entry.lessonFilename,
          poolStorageRef: entry.poolStorageRef,
          tipo: entry.tipo,
          difficolta: entry.difficolta,
          maxPoints: entry.maxPoints,
        });
      }
      choices[labelId] = { kind: 'alternative', order };
    }
    return { baseOrder, choices };
  });

  /*
   * G14 — mutua esclusione VEX ↔ differenziazione, ri-verificata autorevolmente
   * sulla configurazione persistita e non sullo stato della UI.
   *
   * Sta **dopo** le guardie per domanda e non prima: `classifyQuestionParticipation`
   * intercetta anche una base non selezionata o un'alternativa già comune, ma con
   * un messaggio che parla di conflitto VEX. Un docente a cui è stata rimossa una
   * domanda leggerebbe che ha un problema di gruppi equivalenti che non ha. Qui
   * resta a coprire ciò che solo lei vede: le sovrapposizioni con i gruppi.
   */
  try {
    classifyQuestionParticipation({
      selectedEntryIds: questionRefs.map((ref) => ref.questionIndexEntryId),
      equivalentGroups,
      differentiation: config,
    });
  } catch (error) {
    if (error instanceof QuestionParticipationError) {
      throw new DifferentiationSnapshotError('G14', `Impossibile attivare: ${error.message}`);
    }
    throw error;
  }

  // ── Assegnazioni congelate: G06 ignora, G07 blocca ──────────────────────────
  const studentById = new Map(input.students.map((student) => [student.uid, student]));
  const byStudentUid: Record<string, string> = {};
  const ignoredAssignments: string[] = [];
  for (const assignment of input.assignments) {
    const student = studentById.get(assignment.studentUid);
    if (student === undefined) {
      // G06 — un'assegnazione che punta a uno studente inesistente è ignorata:
      // è residuo, non manomissione, e non deve impedire un'attivazione.
      ignoredAssignments.push(assignment.studentUid);
      continue;
    }
    if (student.ownerUid !== ownerUid) {
      // G07 — uno studente di un altro docente in questa mappa indica invece
      // manomissione: blocca.
      throw new DifferentiationSnapshotError(
        'G07',
        "Impossibile attivare: un'assegnazione di etichetta punta a uno studente di un altro docente. Ricarica la pagina.",
      );
    }
    byStudentUid[assignment.studentUid] = assignment.labelId;
  }

  const snapshot: VerificationDifferentiationSnapshot = {
    version: 1,
    questions: snapshotQuestions,
    // Congelate con il nome **al momento dell'attivazione**: è il nome con cui
    // questa configurazione è stata decisa, e resta leggibile anche dopo una
    // rinomina o l'eliminazione dell'etichetta.
    labels: [...referenced]
      .sort()
      .map((labelId) => ({ labelId, labelName: labelById.get(labelId)!.name })),
    differentiatedAlternativeOrders: alternativeRefs.map((_, index) => questionRefs.length + index),
  };

  // ── Percorsi risolti: G13, G15, G16 ────────────────────────────────────────
  const commonQuestionOrders = questionRefs
    .map((ref, order) => ({ ref, order }))
    .filter(({ ref }) => !groupedEntryIds.has(ref.questionIndexEntryId))
    .map(({ order }) => order);
  const groupCount = equivalentGroups.length;
  const maxPointsByOrder = new Map<number, number>();
  questionRefs.forEach((ref, order) => maxPointsByOrder.set(order, ref.maxPoints));
  alternativeRefs.forEach((ref, index) =>
    maxPointsByOrder.set(questionRefs.length + index, ref.maxPoints),
  );
  // Un gruppo VEX contribuisce con esattamente **una** domanda, e le sue
  // alternative hanno per contratto lo stesso `maxPoints` (validato da
  // `buildEquivalentSnapshotParts` su UDA/tipo/difficoltà, e `maxPoints ===
  // difficolta` per POOL-SIMPLE v2). Il punteggio del gruppo è quindi
  // determinato, qualunque alternativa esca.
  const groupPoints = equivalentGroups.reduce((total, group) => {
    const first = group.questionIndexEntryIds[0];
    const order = first === undefined ? undefined : orderByEntryId.get(first);
    return total + (order === undefined ? 0 : (maxPointsByOrder.get(order) ?? 0));
  }, 0);

  function resolveFor(labelId: string | null): { commonOrders: number[]; maxPoints: number } {
    const commonOrders = resolveDifferentiatedCommonOrders(
      { commonQuestionOrders, differentiation: snapshot },
      labelId,
    );
    const maxPoints =
      commonOrders.reduce((total, order) => total + (maxPointsByOrder.get(order) ?? 0), 0) +
      groupPoints;
    return { commonOrders, maxPoints };
  }

  /**
   * G13/G15/G16 sono guardie **per percorso**: raccolte invece che lanciate al
   * primo errore, perché il riepilogo di conferma deve poterle mostrare tutte
   * in rosso, con il motivo, accanto al percorso che blocca. L'attivazione non
   * diventa per questo più permissiva: `assertNoBlockers` la ferma comunque, e
   * il pulsante di conferma resta disabilitato finché ne resta anche una sola.
   */
  function resolveRow(
    labelId: string | null,
    labelName: string,
  ): { commonOrders: number[]; questionCount: number; maxPoints: number; blocker: string | null } {
    let resolved: { commonOrders: number[]; maxPoints: number };
    try {
      resolved = resolveFor(labelId);
    } catch {
      // G13 — duplicazione nella verifica risolta.
      return {
        commonOrders: [],
        questionCount: 0,
        maxPoints: 0,
        blocker: `${labelName}: riceverebbe due volte la stessa domanda.`,
      };
    }
    const questionCount = resolved.commonOrders.length + groupCount;
    // G15 — percorso con zero domande.
    if (questionCount === 0) {
      return {
        commonOrders: resolved.commonOrders,
        questionCount,
        maxPoints: resolved.maxPoints,
        blocker: `${labelName}: non riceverebbe alcuna domanda.`,
      };
    }
    // G16 — punteggio massimo intero e positivo. È legittimamente **diverso**
    // fra etichette (D6): la guardia verifica che sia valido, non che sia
    // uguale a quello base.
    if (!Number.isInteger(resolved.maxPoints) || resolved.maxPoints <= 0) {
      return {
        commonOrders: resolved.commonOrders,
        questionCount,
        maxPoints: resolved.maxPoints,
        blocker: `${labelName}: il punteggio massimo risultante non è valido (${resolved.maxPoints}).`,
      };
    }
    return { ...resolved, questionCount, blocker: null };
  }

  const base = resolveRow(null, 'Nessuna etichetta');

  const perLabel: DifferentiationPlanLabel[] = snapshot.labels.map(({ labelId, labelName }) => {
    const row = resolveRow(labelId, labelName);
    let substitutions = 0;
    let omissions = 0;
    for (const question of snapshot.questions) {
      const choice = question.choices[labelId];
      if (choice?.kind === 'alternative') substitutions += 1;
      if (choice?.kind === 'none') omissions += 1;
    }
    return { labelId, labelName, ...row, substitutions, omissions };
  });

  return {
    alternativeRefs,
    snapshot,
    labelAssignments: { version: 1, byStudentUid },
    perLabel,
    base,
    ignoredAssignments,
  };
}

/** Ogni blocker raccolto, percorso base incluso, nell'ordine di presentazione. */
export function activationBlockers(parts: DifferentiationSnapshotParts): string[] {
  return [parts.base, ...parts.perLabel]
    .map((row) => row.blocker)
    .filter((blocker): blocker is string => blocker !== null);
}

/**
 * Fail-closed sul percorso di scrittura: un solo blocker rimasto ferma
 * l'attivazione, anche se la UI avesse per qualunque motivo lasciato premere il
 * pulsante. Il riepilogo informa; questa funzione decide.
 */
export function assertNoBlockers(parts: DifferentiationSnapshotParts): void {
  const blockers = activationBlockers(parts);
  if (blockers.length > 0) {
    throw new DifferentiationSnapshotError('G15', `Impossibile attivare: ${blockers.join(' ')}`);
  }
}
