import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
  where,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import type { ClassItem } from '../classes/classesService.js';
import { listLessons, listUdas } from '../programs/programsService.js';
import type {
  EquivalentGroupSnapshot,
  ImportDoc,
  ProgramDoc,
  PublicVerificationQuestion,
  VerificationAssignmentMode,
  VerificationConfig,
  VerificationDistributionMode,
  VerificationDoc,
  VerificationQuestionRef,
  VerificationTeacherQuestionSnapshot,
  VerificationTeacherSnapshot,
  VerificationTopicUda,
  VerificationVisibility,
} from '../../../types/firestore.js';
import { assertValidVerificationDate, isValidVerificationDate } from './verificationDate.js';
import { buildTopicOutline, TopicOutlineError } from './topicOutline.js';
import { loadSelectedQuestionsWithSolutions } from './loadSelectedQuestionsWithSolutions.js';
import { poolQuestionInvariantError } from './poolQuestionInvariant.js';
import { normalizeOnlineEnabled } from './onlineEnabled.js';
import { normalizeStudentPdfEnabled } from './studentPdfEnabled.js';
import {
  assertActivationPayloadWithinLimit,
  assertTeacherSnapshotQuestionsWithinLimit,
} from './verificationSnapshotLimits.js';
import {
  toPublicVerificationQuestion,
  toTeacherQuestionSnapshot,
} from './verificationSnapshotMappers.js';
import { normalizeVisibility } from './visibility.js';
import { normalizeDistributionMode } from './vexDistribution.js';
import { buildEquivalentSnapshotParts, VexSnapshotError } from './vexSnapshot.js';
import {
  parseDifferentiationConfig,
  referencedDifferentiationLabelIds,
} from './differentiationConfig.js';
import {
  LABELS_COLLECTION,
  parseDifferentiationLabel,
} from '../differentiation/differentiationLabelsService.js';
import { classifyQuestionParticipation } from './questionParticipation.js';
import {
  activationBlockers,
  assertNoBlockers,
  buildDifferentiationSnapshotParts,
  type DifferentiationSnapshotParts,
} from './differentiationSnapshot.js';
import { buildActivationSummary, type ActivationSummary } from './activationSummary.js';
import { computeAssignmentsFingerprint } from './assignmentsFingerprint.js';
import { deriveAssignmentMode } from './assignmentMode.js';
import { listDifferentiationLabels } from '../differentiation/differentiationLabelsService.js';
import { listStudentLabelAssignments } from '../studentLabelAssignments/studentLabelAssignmentsService.js';
import { listStudents } from '../students/studentsService.js';
import { listQuestionIndex } from './questionIndexService.js';

export type VerificationItem = { id: string } & Omit<
  VerificationDoc,
  'visibility' | 'onlineEnabled' | 'studentPdfEnabled'
> & {
    visibility: VerificationVisibility;
    onlineEnabled: boolean;
    studentPdfEnabled: boolean;
  };

export const VERIFICATION_TITLE_MAX_LENGTH = 100;

export function normalizeVerificationTitle(title: string): string {
  const normalized = title.trim();
  if (normalized.length === 0) {
    throw new Error('Il titolo della verifica è obbligatorio.');
  }
  if (normalized.length > VERIFICATION_TITLE_MAX_LENGTH) {
    throw new Error(
      `Il titolo della verifica non può superare ${VERIFICATION_TITLE_MAX_LENGTH} caratteri.`,
    );
  }
  return normalized;
}

export async function listVerifications(
  ownerUid: string,
  db: Firestore,
): Promise<VerificationItem[]> {
  const snap = await getDocs(collection(db, 'verifications'));
  return snap.docs
    .map((d) => {
      const data = d.data() as VerificationDoc;
      return {
        id: d.id,
        ...data,
        visibility: normalizeVisibility(data.visibility),
        onlineEnabled: normalizeOnlineEnabled(data.onlineEnabled),
        studentPdfEnabled: normalizeStudentPdfEnabled(data.studentPdfEnabled),
      };
    })
    .filter((item) => item.ownerUid === ownerUid);
}

/**
 * Returns only the distinct classes that currently have an active online
 * verification. Used by the teacher's manual Modalità verifica switch: the
 * switch derives its scope without a class-picker dialog, while paper-only
 * or merely active verifications never block lessons. The Firestore query is
 * bounded to matching documents; it does not scan the verification archive.
 */
export async function listActiveOnlineVerificationClassIds(
  ownerUid: string,
  db: Firestore,
): Promise<string[]> {
  const snap = await getDocs(
    query(
      collection(db, 'verifications'),
      where('ownerUid', '==', ownerUid),
      where('status', '==', 'active'),
      where('onlineEnabled', '==', true),
    ),
  );
  return [
    ...new Set(
      snap.docs
        .map((item) => (item.data() as VerificationDoc).config?.classId)
        .filter((classId): classId is string => typeof classId === 'string' && classId.length > 0),
    ),
  ];
}

export async function createVerification(
  config: Pick<
    VerificationConfig,
    'title' | 'classId' | 'programId' | 'importId' | 'verificationDate'
  >,
  ownerUid: string,
  db: Firestore,
): Promise<string> {
  const title = normalizeVerificationTitle(config.title);
  // UI-VERIFICHE-06B: la data è obbligatoria per ogni nuova verifica e validata
  // in modo rigoroso — nessuna normalizzazione, nessun "oggi" scelto in silenzio.
  const verificationDate = assertValidVerificationDate(config.verificationDate);
  if (!config.programId || !config.importId) {
    throw new Error('Seleziona un corso pronto con una importazione attiva.');
  }

  // The picker is only a convenience: verify the relationship again at write
  // time so stale tabs or legacy empty programs cannot create orphan drafts.
  const [programSnap, importSnap] = await Promise.all([
    getDoc(doc(db, 'programs', config.programId)),
    getDoc(doc(db, 'programs', config.programId, 'imports', config.importId)),
  ]);
  if (!programSnap.exists()) {
    throw new Error('Il corso selezionato non esiste più.');
  }
  const program = programSnap.data() as ProgramDoc;
  if (program.ownerUid !== ownerUid || program.activeImportId !== config.importId) {
    throw new Error('Il corso selezionato non ha più questa importazione attiva.');
  }
  if (!importSnap.exists()) {
    throw new Error("L'importazione attiva del corso non esiste più.");
  }
  const activeImport = importSnap.data() as ImportDoc;
  if (
    activeImport.ownerUid !== ownerUid ||
    activeImport.programId !== config.programId ||
    activeImport.importId !== config.importId ||
    // HARD-02B-2: new imports are promoted to 'active' by the atomic switch;
    // legacy imports carried 'committed'. Both denote a live active import
    // here (activeImportId match is already asserted above).
    (activeImport.status !== 'active' && activeImport.status !== 'committed')
  ) {
    throw new Error("L'importazione attiva del corso non è valida.");
  }

  const ref = doc(collection(db, 'verifications'));
  const auditRef = doc(collection(db, 'auditEvents'));
  const fullConfig: VerificationConfig = {
    ...config,
    title,
    verificationDate,
    questionRefs: [],
  };
  const batch = writeBatch(db);
  batch.set(ref, {
    ownerUid,
    status: 'draft',
    visibility: 'hidden',
    studentPdfEnabled: false,
    config: fullConfig,
    teacherSnapshot: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    activatedAt: null,
    closedAt: null,
  });
  batch.set(auditRef, {
    actorUid: ownerUid,
    action: 'verification.created',
    targetId: ref.id,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
  await batch.commit();
  return ref.id;
}

export async function updateVerificationConfig(
  verificationId: string,
  config: Partial<VerificationConfig>,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  const normalizedConfig: Partial<VerificationConfig> =
    config.title === undefined
      ? config
      : { ...config, title: normalizeVerificationTitle(config.title) };
  // UI-VERIFICHE-06B: una data presente nell'update deve essere valida. Nessuna
  // correzione silenziosa; l'assenza del campo lascia intatta quella salvata.
  if (normalizedConfig.verificationDate !== undefined) {
    assertValidVerificationDate(normalizedConfig.verificationDate);
  }
  if (Object.prototype.hasOwnProperty.call(normalizedConfig, 'differentiation')) {
    parseDifferentiationConfig(normalizedConfig.differentiation);
  }

  const verificationRef = doc(db, 'verifications', verificationId);
  const auditRef = doc(collection(db, 'auditEvents'));
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(verificationRef);
    if (!snap.exists()) throw new Error('Verifica non trovata.');
    const data = snap.data() as VerificationDoc;
    if (data.ownerUid !== ownerUid) throw new Error('Verifica non accessibile.');
    if (data.status !== 'draft') {
      throw new Error('Verifica non modificabile: non è in bozza');
    }

    const previousDifferentiation = parseDifferentiationConfig(data.config.differentiation);
    const nextConfig: VerificationConfig = { ...data.config, ...normalizedConfig };
    if (
      Object.prototype.hasOwnProperty.call(normalizedConfig, 'differentiation') &&
      normalizedConfig.differentiation === undefined
    ) {
      delete nextConfig.differentiation;
    }
    const nextDifferentiation = parseDifferentiationConfig(nextConfig.differentiation);
    classifyQuestionParticipation({
      selectedEntryIds: nextConfig.questionRefs.map((ref) => ref.questionIndexEntryId),
      equivalentGroups: nextConfig.equivalentGroups ?? [],
      differentiation: nextDifferentiation,
    });

    // Replay/no-op: nessun secondo audit e nessuna lettura etichetta.
    if (canonicalJson(data.config) === canonicalJson(nextConfig)) return;

    const previousLabels = referencedDifferentiationLabelIds(previousDifferentiation);
    const nextLabels = referencedDifferentiationLabelIds(nextDifferentiation);
    const added = [...nextLabels].filter((labelId) => !previousLabels.has(labelId));
    const removed = [...previousLabels].filter((labelId) => !nextLabels.has(labelId));
    const changed = [...added, ...removed];

    const labels = await Promise.all(
      changed.map(async (labelId) => {
        const ref = doc(db, LABELS_COLLECTION, labelId);
        const labelSnap = await transaction.get(ref);
        const item = parseDifferentiationLabel(labelId, labelSnap.data(), ownerUid);
        return { ref, item };
      }),
    );
    const addedSet = new Set(added);
    for (const { ref, item } of labels) {
      const delta = addedSet.has(item.labelId) ? 1 : -1;
      if (delta < 0 && item.draftUsageCount === 0) {
        throw new Error(`Etichetta «${item.name}»: contatore delle bozze incoerente.`);
      }
      transaction.update(ref, {
        draftUsageCount: item.draftUsageCount + delta,
        updatedAt: serverTimestamp(),
      });
    }

    transaction.update(verificationRef, { config: nextConfig, updatedAt: serverTimestamp() });
    transaction.set(auditRef, {
      actorUid: ownerUid,
      action: 'verification.updated',
      targetId: verificationId,
      outcome: 'success',
      reason: null,
      timestamp: serverTimestamp(),
    });
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function validateForActivation(config: VerificationConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!config.title || config.title.trim() === '') {
    errors.push('Il titolo è obbligatorio');
  } else if (config.title.trim().length > VERIFICATION_TITLE_MAX_LENGTH) {
    errors.push(`Il titolo non può superare ${VERIFICATION_TITLE_MAX_LENGTH} caratteri`);
  }
  if (!config.programId) {
    errors.push('Il programma è obbligatorio');
  }
  if (!config.importId) {
    errors.push("L'importazione è obbligatoria");
  }
  if (!config.questionRefs || config.questionRefs.length < 1) {
    errors.push('Selezionare almeno una domanda');
  } else {
    // POOL-SIMPLE v2 fail-closed: every selected ref must carry a valid integer
    // difficoltà 1–5 with maxPoints === difficolta, BEFORE any pool read,
    // snapshot build or write in activateVerification.
    for (const ref of config.questionRefs) {
      const invalid = poolQuestionInvariantError(ref);
      if (invalid) {
        errors.push(`Domanda ${ref.questionLocalId ?? ref.questionIndexEntryId}: ${invalid}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/** `soluzione` must be a non-empty string, or a non-empty array of non-empty strings. */
function isValidSoluzione(soluzione: string | string[]): boolean {
  if (Array.isArray(soluzione)) {
    return soluzione.length > 0 && soluzione.every((s) => s.trim().length > 0);
  }
  return soluzione.trim().length > 0;
}

/**
 * Storage is read before the Firestore transaction. If another tab changes
 * the draft selection in that gap, the already-loaded questions must never
 * be frozen alongside a different set of refs. Compare every persisted ref
 * field, including order, before committing the snapshot.
 */
function sameQuestionRefs(
  expected: VerificationQuestionRef[],
  current: VerificationQuestionRef[],
): boolean {
  return (
    expected.length === current.length &&
    expected.every((left, index) => {
      const right = current[index];
      return (
        right !== undefined &&
        left.questionIndexEntryId === right.questionIndexEntryId &&
        left.questionLocalId === right.questionLocalId &&
        left.udaDir === right.udaDir &&
        left.lessonFilename === right.lessonFilename &&
        left.poolStorageRef === right.poolStorageRef &&
        left.tipo === right.tipo &&
        left.difficolta === right.difficolta &&
        left.maxPoints === right.maxPoints
      );
    })
  );
}

/**
 * VDIF-04 — FASE 0 del contratto di attivazione (roadmap §7.1): tutte le
 * letture autorevoli e tutte le guardie **pure** G01→G16b, senza scrivere nulla
 * e senza aprire alcuna transazione.
 *
 * È separata dal commit per una ragione che non è estetica: il riepilogo di
 * conferma mostrato al docente deve essere **derivato dagli stessi dati** che
 * verranno congelati, senza una sola lettura in più. Preparare e poi confermare
 * è l'unico modo per garantirlo; ricalcolare al momento della conferma
 * significherebbe mostrare un riepilogo e attivarne un altro.
 */
export type ActivationPlan = {
  verificationId: string;
  ownerUid: string;
  className: string | null;
  /** Config letta nel preflight: base del confronto G18/G19 in transazione. */
  preConfig: VerificationConfig;
  teacherQuestions: VerificationTeacherQuestionSnapshot[];
  publicQuestions: PublicVerificationQuestion[];
  topicOutline: VerificationTopicUda[];
  verificationDate: string | null;
  distributionMode: VerificationDistributionMode;
  assignmentMode: VerificationAssignmentMode;
  commonQuestionOrders: number[];
  equivalentGroups: EquivalentGroupSnapshot[];
  /** `null` su una verifica senza varianti: il percorso resta quello di oggi. */
  differentiation: DifferentiationSnapshotParts | null;
  /** Impronta G20 calcolata sul preflight; `null` senza differenziazione. */
  assignmentsFingerprint: string | null;
  /** Blocker per percorso, già leggibili: vuoto ⇒ attivabile. */
  blockers: string[];
  /** Riepilogo owner-only, mai persistito. `null` senza differenziazione. */
  summary: ActivationSummary | null;
};

/**
 * Costruisce il piano di attivazione: legge autorevolmente, valida, e
 * restituisce snapshot e proiezione già pronti da committare.
 *
 * Ordine delle letture (roadmap §7.1 FASE 0):
 * `R1` verifica → `R2` etichette → `R3` assegnazioni → `R4` studenti →
 * `R4b` indice domande → `R5` Storage (domande selezionate **∪** alternative,
 * in una sola lettura aggregata) → `R6` udas + lessons.
 *
 * `R2`→`R4b` avvengono **solo** in presenza di `config.differentiation`: una
 * verifica senza varianti costa esattamente quanto costava prima di VDIF-04.
 */
export async function prepareVerificationActivation(
  verificationId: string,
  classItem: ClassItem | null,
  ownerUid: string,
  db: Firestore,
  storage?: FirebaseStorage,
): Promise<ActivationPlan> {
  const verRef = doc(db, 'verifications', verificationId);

  // R1 — G01/G02.
  const preSnap = await getDoc(verRef);
  if (!preSnap.exists()) {
    throw new Error('Verifica non trovata');
  }
  const preData = preSnap.data() as VerificationDoc;
  if (preData.status !== 'draft') {
    throw new Error('Verifica non attivabile: non è in bozza');
  }
  const preValidation = validateForActivation(preData.config);
  if (!preValidation.valid) {
    throw new Error(`Verifica non valida: ${preValidation.errors.join(', ')}`);
  }

  // VEX-01B — modalità di distribuzione, normalizzata fail-closed (valore
  // sconosciuto ⇒ errore leggibile, mai fallback silenzioso).
  const distributionMode = normalizeDistributionMode(preData.config.distributionMode);
  const isVex = distributionMode === 'equivalent_variants';
  // In `same_questions` i gruppi possono restare salvati nella bozza ma sono
  // inattivi: non entrano né nello snapshot né in alcuna guardia.
  const activeGroups = isVex ? (preData.config.equivalentGroups ?? []) : [];

  // G03 — il parser di bozza è fail-closed su versione, forma e chiavi extra.
  const differentiationConfig = parseDifferentiationConfig(preData.config.differentiation);

  // R2/R3/R4/R4b — solo con differenziazione presente.
  let differentiation: DifferentiationSnapshotParts | null = null;
  let assignmentsFingerprint: string | null = null;
  let students: { uid: string; ownerUid: string }[] = [];
  if (differentiationConfig) {
    const [labels, assignments, studentList, questionIndex] = await Promise.all([
      listDifferentiationLabels(ownerUid, db),
      listStudentLabelAssignments(ownerUid, db),
      listStudents(ownerUid, db),
      listQuestionIndex(preData.config.programId, preData.config.importId, db),
    ]);
    students = studentList.map((student) => ({ uid: student.id, ownerUid: student.ownerUid }));
    differentiation = buildDifferentiationSnapshotParts({
      config: differentiationConfig,
      questionRefs: preData.config.questionRefs,
      equivalentGroups: activeGroups,
      questionIndex,
      labels,
      assignments,
      students,
      ownerUid,
    });
    assignmentsFingerprint = await computeAssignmentsFingerprint(
      differentiation.labelAssignments.byStudentUid,
    );
  }

  const alternativeRefs = differentiation?.alternativeRefs ?? [];
  // R5 — UNA lettura aggregata: le alternative viaggiano nella stessa chiamata
  // delle domande selezionate. Nessuna lettura per alternativa, mai.
  const allRefs = [...preData.config.questionRefs, ...alternativeRefs];
  const questionsResult = await loadSelectedQuestionsWithSolutions(allRefs, storage);
  if (!questionsResult.ok) {
    throw new Error(`Impossibile attivare: ${questionsResult.error}`);
  }
  const invalidIndex = questionsResult.questions.findIndex((q) => !isValidSoluzione(q.soluzione));
  if (invalidIndex !== -1) {
    const badRef = questionsResult.questions[invalidIndex]!.ref;
    throw new Error(
      `Impossibile attivare: soluzione mancante o non valida per la domanda ${badRef.questionLocalId}.`,
    );
  }

  const teacherQuestions: VerificationTeacherQuestionSnapshot[] = questionsResult.questions.map(
    (q, index) => toTeacherQuestionSnapshot(q, index),
  );
  assertTeacherSnapshotQuestionsWithinLimit(teacherQuestions);

  // R6 — perimetro didattico ricostruito autorevolmente. Con la differenziazione
  // comprende **anche** le lezioni delle alternative: è l'unione didattica
  // complessiva, identica per tutta la classe, e proprio per questo muta
  // sull'etichetta di chiunque (roadmap §4).
  const [udas, lessons] = await Promise.all([
    listUdas(preData.config.programId, preData.config.importId, db),
    listLessons(preData.config.programId, preData.config.importId, db),
  ]);
  let topicOutline: VerificationTopicUda[];
  try {
    topicOutline = buildTopicOutline({ questionRefs: allRefs, udas, lessons });
  } catch (error) {
    if (error instanceof TopicOutlineError) {
      throw new Error(`Impossibile attivare: ${error.message}`);
    }
    throw error;
  }
  const verificationDate = isValidVerificationDate(preData.config.verificationDate)
    ? preData.config.verificationDate
    : null;

  // ── Snapshot VEX ────────────────────────────────────────────────────────────
  let commonQuestionOrders: number[];
  let equivalentGroups: EquivalentGroupSnapshot[] = [];
  if (isVex) {
    let parts;
    try {
      parts = buildEquivalentSnapshotParts(preData.config.questionRefs, activeGroups);
    } catch (error) {
      if (error instanceof VexSnapshotError) {
        throw new Error(`Impossibile attivare le varianti equivalenti: ${error.message}`);
      }
      throw error;
    }
    commonQuestionOrders = parts.commonQuestionOrders;
    equivalentGroups = parts.equivalentGroups;
  } else {
    // Senza VEX ogni domanda selezionata è comune. Le alternative differenziate
    // restano fuori: sono in `questions[]`, mai fra le comuni.
    commonQuestionOrders = preData.config.questionRefs.map((_, order) => order);
  }

  // ── Proiezione pubblica ────────────────────────────────────────────────────
  // Una domanda base con almeno una scelta non-base **non** vi compare: uno
  // studente potrebbe altrimenti leggerla anche quando gli è stata omessa o
  // sostituita. Le alternative non vi compaiono mai (non sono comuni).
  const differentiatedBaseOrders = new Set(
    differentiation?.snapshot.questions.map((question) => question.baseOrder) ?? [],
  );
  const publishedOrders = new Set(
    isVex || differentiation
      ? commonQuestionOrders.filter((order) => !differentiatedBaseOrders.has(order))
      : teacherQuestions.map((question) => question.order),
  );
  const publicQuestions = teacherQuestions
    .filter((question) => publishedOrders.has(question.order))
    .map(toPublicVerificationQuestion);

  const assignmentMode = deriveAssignmentMode({
    distributionMode,
    hasDifferentiation: differentiation !== null,
  });

  return {
    verificationId,
    ownerUid,
    className: classItem?.name ?? null,
    preConfig: preData.config,
    teacherQuestions,
    publicQuestions,
    topicOutline,
    verificationDate,
    distributionMode,
    assignmentMode,
    commonQuestionOrders,
    equivalentGroups,
    differentiation,
    assignmentsFingerprint,
    blockers: differentiation ? activationBlockers(differentiation) : [],
    summary: differentiation ? buildActivationSummary(differentiation, students) : null,
  };
}

/**
 * VDIF-04 — FASE 1 e FASE 2 del contratto di attivazione.
 *
 * Dentro **una sola** transazione client Firestore, nell'ordine congelato:
 * rilettura verifica → G17 stato ancora `draft` → G18 `questionRefs` invariati →
 * G19 `config.differentiation` strutturalmente invariata → rilettura di **ogni**
 * etichetta congelata (esistenza, owner, `draftUsageCount` intero ≥ 1) → update
 * verifica → set proiezione → decremento di ogni `draftUsageCount`.
 *
 * G20 sta **immediatamente prima** della transazione e non dentro: una `getDocs`
 * non è ammessa dentro una transazione Firestore client, quindi le assegnazioni
 * si confrontano per impronta (limite dichiarato in `assignmentsFingerprint.ts`).
 *
 * **Perché il decremento sta nello stesso commit.** Se l'attivazione committasse
 * e il decremento fallisse subito dopo, l'etichetta resterebbe bloccata per
 * sempre da una bozza che non esiste più: un contatore che non torna mai a zero
 * e nessuno che sappia spiegare perché. Insieme, o nessuno dei due.
 *
 * G21 (retry dopo risposta persa) non è un ramo a sé: la transazione rilegge lo
 * stato e, se la verifica è già `active`, G17 blocca **senza scrivere nulla**.
 */
export async function commitVerificationActivation(
  plan: ActivationPlan,
  db: Firestore,
): Promise<void> {
  // Fail-closed prima di ogni scrittura: un blocker rimasto ferma l'attivazione
  // anche se la UI avesse lasciato premere il pulsante.
  if (plan.differentiation) assertNoBlockers(plan.differentiation);

  const verRef = doc(db, 'verifications', plan.verificationId);
  const { verificationId, ownerUid, className } = plan;

  // G20 — secondo calcolo dell'impronta **immediatamente prima** della
  // transazione, sulle assegnazioni rilette e potate esattamente come nel
  // preflight (G06: uno studente inesistente non entra nella mappa congelata e
  // non deve far fallire il confronto).
  if (plan.differentiation) {
    const ignored = new Set(plan.differentiation.ignoredAssignments);
    const assignments = await listStudentLabelAssignments(ownerUid, db);
    const byStudentUid: Record<string, string> = {};
    for (const assignment of assignments) {
      if (ignored.has(assignment.studentUid)) continue;
      byStudentUid[assignment.studentUid] = assignment.labelId;
    }
    const freshFingerprint = await computeAssignmentsFingerprint(byStudentUid);
    if (freshFingerprint !== plan.assignmentsFingerprint) {
      throw new Error(
        'Le etichette degli studenti sono cambiate durante l’attivazione. Riprova per congelare la versione aggiornata.',
      );
    }
  }

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(verRef);
    if (!snap.exists()) {
      throw new Error('Verifica non trovata');
    }
    const data = snap.data() as VerificationDoc;
    // G17 / G21.
    if (data.status !== 'draft') {
      throw new Error('Verifica non attivabile: non è in bozza');
    }
    const validation = validateForActivation(data.config);
    if (!validation.valid) {
      throw new Error(`Verifica non valida: ${validation.errors.join(', ')}`);
    }
    // G18.
    if (!sameQuestionRefs(plan.preConfig.questionRefs, data.config.questionRefs)) {
      throw new Error(
        'La selezione delle domande è cambiata durante l’attivazione. Riprova per congelare la versione aggiornata.',
      );
    }
    // G19 — confronto **strutturale profondo** della configurazione varianti.
    if (
      canonicalJson(data.config.differentiation) !== canonicalJson(plan.preConfig.differentiation)
    ) {
      throw new Error(
        'La configurazione delle varianti è cambiata durante l’attivazione. Riprova per congelare la versione aggiornata.',
      );
    }

    // T1b — ogni etichetta congelata, riletta **dentro** la transazione che
    // scrive: esistenza, owner e contatore. Un'etichetta eliminata nel
    // frattempo fa fallire qui, senza congelare nulla.
    const frozenLabels = plan.differentiation?.snapshot.labels ?? [];
    const labelUpdates = await Promise.all(
      frozenLabels.map(async ({ labelId, labelName }) => {
        const ref = doc(db, LABELS_COLLECTION, labelId);
        const labelSnap = await transaction.get(ref);
        if (!labelSnap.exists()) {
          throw new Error(
            `Impossibile attivare: l’etichetta «${labelName}» non esiste più. Ricarica la pagina.`,
          );
        }
        const item = parseDifferentiationLabel(labelId, labelSnap.data(), ownerUid);
        if (!Number.isInteger(item.draftUsageCount) || item.draftUsageCount < 1) {
          throw new Error(`Etichetta «${item.name}»: contatore delle bozze incoerente.`);
        }
        return { ref, next: item.draftUsageCount - 1 };
      }),
    );

    const teacherSnapshot: Omit<VerificationTeacherSnapshot, 'activatedAt'> & {
      activatedAt: ReturnType<typeof serverTimestamp>;
    } = {
      title: data.config.title,
      classId: data.config.classId,
      className,
      programId: data.config.programId,
      importId: data.config.importId,
      ...(plan.verificationDate === null ? {} : { verificationDate: plan.verificationDate }),
      topicOutline: plan.topicOutline,
      questionRefs: data.config.questionRefs,
      questions: plan.teacherQuestions,
      distributionMode: plan.distributionMode,
      // `commonQuestionOrders` è congelato anche in `same_questions` quando c'è
      // differenziazione: è l'insieme da cui il risolutore parte.
      ...(plan.distributionMode === 'equivalent_variants' || plan.differentiation
        ? {
            commonQuestionOrders: plan.commonQuestionOrders,
            equivalentGroups: plan.equivalentGroups,
          }
        : {}),
      ...(plan.differentiation
        ? {
            differentiation: plan.differentiation.snapshot,
            labelAssignments: plan.differentiation.labelAssignments,
          }
        : {}),
      activatedAt: serverTimestamp(),
    };

    const projection = {
      ownerUid,
      title: data.config.title,
      className,
      classId: data.config.classId,
      visibility: 'hidden' as const,
      status: 'active' as const,
      onlineEnabled: normalizeOnlineEnabled(data.onlineEnabled),
      studentPdfEnabled: normalizeStudentPdfEnabled(data.studentPdfEnabled),
      distributionMode: plan.distributionMode,
      // VDIF-04 — unico campo nuovo leggibile dallo studente. Dice COME arrivano
      // le domande, mai PERCHÉ, ed è identico per tutta la classe.
      assignmentMode: plan.assignmentMode,
      ...(plan.verificationDate === null ? {} : { verificationDate: plan.verificationDate }),
      topicOutline: plan.topicOutline,
      questions: plan.publicQuestions,
      activatedAt: serverTimestamp(),
    };

    // G16b — snapshot e proiezione **interi** entro il limite conservativo.
    assertActivationPayloadWithinLimit({ teacherSnapshot, publishedProjection: projection });

    // T2 / T3 / T4 — stesso commit.
    transaction.update(verRef, {
      status: 'active',
      visibility: 'hidden',
      teacherSnapshot,
      activatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    transaction.set(
      doc(db, 'verifications', verificationId, 'publishedProjection', 'data'),
      projection,
    );
    for (const { ref, next } of labelUpdates) {
      // Valore esplicito, mai `increment` alla cieca e mai `max(0, n - 1)`: il
      // contatore è stato validato sopra, e ripararlo in silenzio renderebbe
      // definitivamente invisibile uno stato che nessuno ha spiegato.
      transaction.update(ref, { draftUsageCount: next, updatedAt: serverTimestamp() });
    }
  });

  // FASE 2 — audit invariato: un solo evento, fuori dalla transazione, come per
  // ogni altra attivazione. VDIF-04 non introduce un secondo audit.
  await setDoc(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'verification.activated',
    targetId: verificationId,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
}

/**
 * Activates a draft verification. Alongside the existing owner-only
 * `teacherSnapshot`, this also builds and writes `publishedProjection/data`
 * — the safe, solution-free projection a student (M3-lite) reads to list the
 * verification and render the student PDF (M3L-D). It never includes
 * poolStorageRef, questionLocalId, questionIndexEntryId or soluzione.
 *
 * `teacherSnapshot.questions` embeds each question's full text, options AND
 * solution at activation time, so an `active`/`closed` verification's own PDF
 * downloads never re-read the current pool file from Storage (ADR-07). All
 * questions — selected **and** differentiated alternatives — are read from
 * Storage exactly ONCE, before the transaction opens.
 *
 * `visibility` is always reset to `hidden` on activation: publishing is a
 * separate, explicit teacher action (see `setVerificationVisibility`).
 *
 * VDIF-04: preparazione e commit sono due funzioni separate
 * (`prepareVerificationActivation` / `commitVerificationActivation`) perché il
 * riepilogo di conferma deve essere derivato dagli stessi dati che verranno
 * congelati. Questa resta la porta unica per chi non ha bisogno del riepilogo.
 */
export async function activateVerification(
  verificationId: string,
  classItem: ClassItem | null,
  ownerUid: string,
  db: Firestore,
  storage?: FirebaseStorage,
): Promise<void> {
  const plan = await prepareVerificationActivation(
    verificationId,
    classItem,
    ownerUid,
    db,
    storage,
  );
  await commitVerificationActivation(plan, db);
}

/**
 * Toggles `visibility` on an `active` or `closed` verification — publishing or hiding
 * it from the student portal (M3-lite). Touches only `visibility` and
 * `updatedAt` on the parent document; never config, teacherSnapshot, status
 * or any other field. The Security Rules enforce the same restriction
 * server-side.
 *
 * Also mirrors the new value onto `publishedProjection/data.visibility`
 * (M3L-D) — required so the student's `collectionGroup` discovery query has
 * a query-filterable field to authorize on; see `PublishedProjectionDoc`.
 *
 * Written atomically in a single `writeBatch` together with the audit
 * event (PERF-SEC-01B-1 / PERF-05) — a partial failure can no longer leave
 * the parent document and the projection mirror out of sync, matching the
 * pattern already used by `setVerificationOnlineEnabled`/
 * `setVerificationStudentPdfEnabled`.
 */
export async function setVerificationVisibility(
  verificationId: string,
  visibility: VerificationVisibility,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  const snap = await getDoc(doc(db, 'verifications', verificationId));
  const data = snap.data() as VerificationDoc | undefined;
  if (!data || (data.status !== 'active' && data.status !== 'closed')) {
    throw new Error('Visibilità modificabile solo su una verifica attiva o chiusa');
  }
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'verifications', verificationId),
    { visibility, updatedAt: serverTimestamp() },
    { merge: true },
  );
  batch.set(
    doc(db, 'verifications', verificationId, 'publishedProjection', 'data'),
    { visibility },
    { merge: true },
  );
  batch.set(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'verification.visibilityChanged',
    targetId: verificationId,
    outcome: 'success',
    reason: `visibility -> ${visibility}`,
    timestamp: serverTimestamp(),
  });
  await batch.commit();
}

/**
 * Toggles `onlineEnabled` on an `active` verification — the master switch
 * that lets students actually start/save/submit the online exam (Security
 * Rules gate every submission write on `verificationOnlineAndActive()`,
 * which reads this exact field). Touches only `onlineEnabled` and
 * `updatedAt` on the parent document; never config, teacherSnapshot, status,
 * or `visibility` — the two toggles are independent, mirroring
 * `setVerificationVisibility`.
 *
 * Like `setVerificationVisibility`, this uses a single `writeBatch` so the
 * parent update and the `publishedProjection/data.onlineEnabled` mirror
 * commit atomically — a partial failure can never leave the two out of
 * sync.
 *
 * A verification with no class assigned (`config.classId == null`) can
 * never have online enabled: `verificationClassMatches()` in Security Rules
 * would deny every submission anyway, so enabling here would be a dead,
 * confusing toggle.
 */
export async function setVerificationOnlineEnabled(
  verificationId: string,
  onlineEnabled: boolean,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  const snap = await getDoc(doc(db, 'verifications', verificationId));
  const data = snap.data() as VerificationDoc | undefined;
  if (!data || data.status !== 'active') {
    throw new Error('Online modificabile solo su una verifica attiva');
  }
  if (onlineEnabled && data.config.classId == null) {
    throw new Error("Assegnare una classe prima di attivare l'online");
  }
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'verifications', verificationId),
    { onlineEnabled, updatedAt: serverTimestamp() },
    { merge: true },
  );
  batch.set(
    doc(db, 'verifications', verificationId, 'publishedProjection', 'data'),
    { onlineEnabled },
    { merge: true },
  );
  batch.set(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'verification.onlineEnabledChanged',
    targetId: verificationId,
    outcome: 'success',
    reason: `onlineEnabled -> ${onlineEnabled}`,
    timestamp: serverTimestamp(),
  });
  await batch.commit();
}

/**
 * Toggles `studentPdfEnabled` — the sole gate on whether a student may
 * download the verification PDF (M3F-09). Unlike `visibility`/
 * `onlineEnabled`, this is allowed on `draft`, `active`, AND `closed`: a
 * teacher may want to prepare the flag before activation, or open/close
 * paper access on an already-closed exam without reopening anything else.
 * Toggling it never changes `status`, `visibility`, or `onlineEnabled` — a
 * `draft`/`closed`/hidden verification never becomes visible to a student
 * just because this flag is `true` (see `PublishedProjectionDoc` and
 * `loadStudentVerifications`, which still gate on `visibility == 'public'`
 * and class match first).
 *
 * Touches only `studentPdfEnabled`/`updatedAt` on the parent document —
 * the Security Rules enforce the same restriction for `active`/`closed`
 * server-side (a `draft` verification allows any owner update already).
 * Written atomically in a single `writeBatch` together with the
 * `publishedProjection/data` mirror (when one exists — a `draft`
 * verification has none yet, see `activateVerification`) and the audit
 * event, so a partial failure can never leave the parent document and the
 * projection out of sync.
 */
export async function setVerificationStudentPdfEnabled(
  verificationId: string,
  studentPdfEnabled: boolean,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  const verRef = doc(db, 'verifications', verificationId);
  const snap = await getDoc(verRef);
  const data = snap.data() as VerificationDoc | undefined;
  if (!data) {
    throw new Error('Verifica non trovata');
  }

  const projectionRef = doc(db, 'verifications', verificationId, 'publishedProjection', 'data');
  const projectionSnap = await getDoc(projectionRef);

  const batch = writeBatch(db);
  batch.set(verRef, { studentPdfEnabled, updatedAt: serverTimestamp() }, { merge: true });
  if (projectionSnap.exists()) {
    batch.set(projectionRef, { studentPdfEnabled }, { merge: true });
  }
  batch.set(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'verification.studentPdfEnabledChanged',
    targetId: verificationId,
    outcome: 'success',
    reason: `studentPdfEnabled -> ${studentPdfEnabled}`,
    timestamp: serverTimestamp(),
  });
  await batch.commit();
}

/**
 * Closes an active verification while preserving its independent visibility.
 * The projection receives `status: 'closed'`; a public closed verification
 * remains discoverable for history/PDF, but submission writes stay denied by
 * the parent-status checks in Security Rules.
 *
 * Written atomically in a single `writeBatch` together with the audit
 * event (PERF-SEC-01B-1 / PERF-05) — a partial failure can no longer leave
 * the parent document and the projection mirror out of sync, matching the
 * pattern already used by `setVerificationOnlineEnabled`/
 * `setVerificationStudentPdfEnabled`.
 */
export async function closeVerification(
  verificationId: string,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  const snap = await getDoc(doc(db, 'verifications', verificationId));
  const data = snap.data() as VerificationDoc | undefined;
  if (!data) {
    throw new Error('Verifica non trovata');
  }
  if (data.status !== 'active') {
    throw new Error('Verifica non chiudibile: non è attiva');
  }
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'verifications', verificationId),
    { status: 'closed', closedAt: serverTimestamp(), updatedAt: serverTimestamp() },
    { merge: true },
  );
  batch.set(
    doc(db, 'verifications', verificationId, 'publishedProjection', 'data'),
    { status: 'closed' },
    { merge: true },
  );
  batch.set(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'verification.closed',
    targetId: verificationId,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
  await batch.commit();
}

/**
 * Reopens a closed verification without changing its immutable snapshot,
 * visibility, online flag or PDF setting. Parent, student projection and audit
 * are updated atomically so the student-facing status cannot drift.
 */
export async function reopenVerification(
  verificationId: string,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  const snap = await getDoc(doc(db, 'verifications', verificationId));
  const data = snap.data() as VerificationDoc | undefined;
  if (!data) {
    throw new Error('Verifica non trovata');
  }
  if (data.status !== 'closed') {
    throw new Error('Verifica non riapribile: non è chiusa');
  }
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'verifications', verificationId),
    { status: 'active', closedAt: null, updatedAt: serverTimestamp() },
    { merge: true },
  );
  batch.set(
    doc(db, 'verifications', verificationId, 'publishedProjection', 'data'),
    { status: 'active' },
    { merge: true },
  );
  batch.set(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action: 'verification.reopened',
    targetId: verificationId,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
  await batch.commit();
}

/**
 * Deletes a verification. Allowed for `draft` (discard an unfinished
 * configuration) and `closed` (tidy up an old exam) — never for `active`,
 * which is an immutable snapshot that can only be closed. The security
 * rules enforce the same constraint server-side as defense in depth.
 */
export async function deleteVerification(
  verificationId: string,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  // Preflight leggibile e a costo invariato rispetto al flusso storico. La
  // transazione ripete comunque tutte le precondizioni prima delle scritture,
  // quindi una modifica concorrente non può aggirarle.
  const preSnap = await getDoc(doc(db, 'verifications', verificationId));
  const preData = preSnap.data() as VerificationDoc | undefined;
  if (!preData || preData.ownerUid !== ownerUid) throw new Error('Verifica non trovata.');
  if (preData.status !== 'draft' && preData.status !== 'closed') {
    throw new Error('Verifica non eliminabile: deve essere in bozza o chiusa');
  }
  // M4-LIFE-02 — application-level guard (single-owner model): a verification
  // that still owns at least one submission cannot be deleted; the docente must
  // delete its submissions first (deleteSubmissionData). One targeted, indexed
  // read (limit 1) — never a full-collection scan. This is deliberately an
  // application guard, not a Firestore rule: Rules cannot verify the ABSENCE of
  // documents in another collection via an inverse query, so a `verifications`
  // delete rule can't gate on "no submissions reference me". Aborts before any
  // write when a submission exists.
  const linkedSubmissions = await getDocs(
    query(
      collection(db, 'submissions'),
      where('ownerUid', '==', ownerUid),
      where('verificationId', '==', verificationId),
      limit(1),
    ),
  );
  if (!linkedSubmissions.empty) {
    throw new Error('Elimina prima tutte le consegne associate a questa verifica.');
  }

  const verificationRef = doc(db, 'verifications', verificationId);
  const projectionRef = doc(db, 'verifications', verificationId, 'publishedProjection', 'data');
  const auditRef = doc(collection(db, 'auditEvents'));
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(verificationRef);
    if (!snap.exists()) throw new Error('Verifica non trovata.');
    const data = snap.data() as VerificationDoc;
    if (data.ownerUid !== ownerUid) throw new Error('Verifica non accessibile.');
    if (data.status !== 'draft' && data.status !== 'closed') {
      throw new Error('Verifica non eliminabile: deve essere in bozza o chiusa');
    }

    // VDIF-03 — una bozza trattiene ogni etichetta riferita una sola volta.
    // L'eliminazione rilascia gli stessi contatori nel medesimo commit; una
    // verifica active/closed li ha già rilasciati all'attivazione (VDIF-04).
    const labels =
      data.status === 'draft'
        ? await Promise.all(
            [
              ...referencedDifferentiationLabelIds(
                parseDifferentiationConfig(data.config.differentiation),
              ),
            ].map(async (labelId) => {
              const ref = doc(db, LABELS_COLLECTION, labelId);
              const labelSnap = await transaction.get(ref);
              return { ref, item: parseDifferentiationLabel(labelId, labelSnap.data(), ownerUid) };
            }),
          )
        : [];
    for (const { ref, item } of labels) {
      if (item.draftUsageCount === 0) {
        throw new Error(`Etichetta «${item.name}»: contatore delle bozze incoerente.`);
      }
      transaction.update(ref, {
        draftUsageCount: item.draftUsageCount - 1,
        updatedAt: serverTimestamp(),
      });
    }

    // Firestore does not cascade-delete subcollections. Remove the student
    // projection in the same transaction as the parent and the audit.
    transaction.delete(projectionRef);
    transaction.delete(verificationRef);
    transaction.set(auditRef, {
      actorUid: ownerUid,
      action: 'verification.deleted',
      targetId: verificationId,
      outcome: 'success',
      reason: null,
      timestamp: serverTimestamp(),
    });
  });
}
