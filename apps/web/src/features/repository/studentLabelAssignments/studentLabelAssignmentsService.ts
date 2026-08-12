import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import type { DocumentData, Firestore, Transaction } from 'firebase/firestore';
import { hasExactKeys, isFirestoreTimestamp, isValidDocumentId } from '../documentShape.js';
import {
  LABELS_COLLECTION,
  parseDifferentiationLabel,
  type DifferentiationLabelItem,
} from '../differentiation/differentiationLabelsService.js';

/**
 * VDIF-02 — **unico** service owner-only dell'assegnazione studente → etichetta.
 *
 * ## Che cosa garantisce
 *
 * - **una sola etichetta per studente**, garantita dall'id deterministico del
 *   documento (`= studentUid`), non da una query di unicità;
 * - **contatori atomici**: `assignedCount` delle etichette coinvolte si muove
 *   nella **stessa transazione** dell'assegnazione. Non esiste un istante in cui
 *   l'assegnazione esiste e il contatore non la conosce;
 * - **valori espliciti, mai `increment` alla cieca**: il nuovo contatore è
 *   calcolato dopo aver **validato** quello letto. Un `increment(-1)` su un
 *   contatore corrotto lo renderebbe negativo senza che nessuno se ne accorga;
 * - **fail-closed**: studente inesistente o di altro owner, etichetta
 *   inesistente o malformata, assegnazione malformata, contatore a zero da
 *   decrementare ⇒ errore leggibile e **zero scritture**;
 * - **audit atomico** nello stesso commit della mutazione.
 *
 * ## Che cosa NON fa
 *
 * Non conosce il **nome** dell'etichetta e non lo duplica: l'assegnazione porta
 * solo il `labelId`, e il nome si unisce in memoria. Una rinomina si riflette
 * ovunque senza toccare una sola assegnazione.
 */

export const ASSIGNMENTS_COLLECTION = 'studentLabelAssignments';
export const STUDENTS_COLLECTION = 'students';

/** Forma chiusa: cinque chiavi, ordinate per il confronto. */
const ASSIGNMENT_KEYS = ['createdAt', 'labelId', 'ownerUid', 'studentUid', 'updatedAt'];

export type StudentLabelAssignmentItem = {
  studentUid: string;
  ownerUid: string;
  labelId: string;
};

export type StudentLabelAssignmentErrorCode =
  /** Lo studente non esiste più, o non appartiene a questo docente. */
  | 'student_not_found'
  /** L'etichetta scelta non esiste più (eliminata da un'altra scheda). */
  | 'label_not_found'
  /** Documento assegnazione, studente o etichetta incoerente: mai riparato. */
  | 'corrupted_state';

export class StudentLabelAssignmentError extends Error {
  readonly code: StudentLabelAssignmentErrorCode;

  constructor(code: StudentLabelAssignmentErrorCode, message: string) {
    super(message);
    this.name = 'StudentLabelAssignmentError';
    this.code = code;
  }
}

function corrupted(message: string): never {
  throw new StudentLabelAssignmentError('corrupted_state', message);
}

/**
 * Parser **fail-closed** dell'assegnazione.
 *
 * Verifica forma chiusa a cinque chiavi, identità (`studentUid` == path),
 * ownership, `labelId` usabile come id di documento e timestamp Firestore
 * risolti e coerenti. Un documento che non passa non viene scartato né corretto
 * in lettura: lancia, e il chiamante lo tratta come stato incoerente.
 */
export function parseStudentLabelAssignment(
  studentUid: string,
  data: DocumentData | undefined,
  ownerUid: string,
): StudentLabelAssignmentItem {
  if (!data) corrupted(`Assegnazione di ${studentUid} non leggibile: documento assente.`);
  if (!hasExactKeys(data, ASSIGNMENT_KEYS)) {
    corrupted(
      `Assegnazione di ${studentUid} non leggibile: struttura del documento non riconosciuta.`,
    );
  }
  if (data.studentUid !== studentUid) {
    corrupted(`Assegnazione di ${studentUid} non leggibile: identità incoerente.`);
  }
  if (data.ownerUid !== ownerUid) {
    corrupted(`Assegnazione di ${studentUid} non leggibile: proprietario incoerente.`);
  }
  if (!isValidDocumentId(data.labelId)) {
    corrupted(`Assegnazione di ${studentUid} non leggibile: etichetta non valida.`);
  }
  if (!isFirestoreTimestamp(data.createdAt) || !isFirestoreTimestamp(data.updatedAt)) {
    corrupted(`Assegnazione di ${studentUid} non leggibile: date mancanti o non valide.`);
  }
  if (data.updatedAt.toMillis() < data.createdAt.toMillis()) {
    corrupted(`Assegnazione di ${studentUid} non leggibile: date incoerenti.`);
  }
  return { studentUid, ownerUid: data.ownerUid, labelId: data.labelId };
}

/**
 * Esito **autorevole** di una mutazione: contiene tutto ciò che serve alla UI
 * per aggiornarsi localmente, senza inventare contatori e senza rifare query.
 *
 * `labelCounts` riporta il valore **scritto** nella transazione, non una stima:
 * è calcolato dai documenti validati e committato insieme all'assegnazione.
 */
export type SetStudentLabelResult = {
  studentUid: string;
  /** Stato finale: `null` = nessuna etichetta. */
  labelId: string | null;
  /** Nuovo `assignedCount` di ogni etichetta toccata. Vuoto su no-op. */
  labelCounts: { labelId: string; assignedCount: number }[];
  /** `false` quando la selezione coincideva già con lo stato persistito. */
  changed: boolean;
};

/**
 * **Una sola query**, filtrata su `ownerUid` — la stessa condizione su cui le
 * Rules autorizzano il `list`, altrimenti Firestore non può dimostrarla.
 *
 * Nessuna lettura per card, nessun listener, nessun polling. Un documento
 * malformato fa fallire l'**intera** lista: una lista parziale presentata come
 * completa mostrerebbe «Nessuna etichetta» su uno studente che invece ne ha una.
 */
export async function listStudentLabelAssignments(
  ownerUid: string,
  db: Firestore,
): Promise<StudentLabelAssignmentItem[]> {
  const snap = await getDocs(
    query(collection(db, ASSIGNMENTS_COLLECTION), where('ownerUid', '==', ownerUid)),
  );
  return snap.docs.map((d) => parseStudentLabelAssignment(d.id, d.data(), ownerUid));
}

/**
 * Verifica che lo studente esista **davvero** e appartenga a questo docente.
 *
 * Non ci si fida dello studente già presente nella UI: quella lista può essere
 * vecchia di minuti, e assegnare un'etichetta a uno studente rimosso creerebbe
 * un'assegnazione orfana che nessuno vedrebbe più.
 */
async function readOwnedStudent(
  transaction: Transaction,
  db: Firestore,
  studentUid: string,
  ownerUid: string,
): Promise<void> {
  const snap = await transaction.get(doc(db, STUDENTS_COLLECTION, studentUid));
  if (!snap.exists()) {
    throw new StudentLabelAssignmentError(
      'student_not_found',
      'Questo studente non esiste più. Ricarica la pagina.',
    );
  }
  if (snap.data().ownerUid !== ownerUid) {
    throw new StudentLabelAssignmentError(
      'student_not_found',
      'Questo studente non appartiene a questo docente.',
    );
  }
}

async function readOwnedLabel(
  transaction: Transaction,
  db: Firestore,
  labelId: string,
  ownerUid: string,
): Promise<DifferentiationLabelItem> {
  const snap = await transaction.get(doc(db, LABELS_COLLECTION, labelId));
  if (!snap.exists()) {
    throw new StudentLabelAssignmentError(
      'label_not_found',
      'Questa etichetta non esiste più. Ricarica la pagina e riprova.',
    );
  }
  try {
    return parseDifferentiationLabel(labelId, snap.data(), ownerUid);
  } catch (error) {
    // Il parser delle etichette ha il proprio tipo d'errore: qui interessa che
    // l'operazione si fermi fail-closed, con un messaggio del dominio giusto.
    corrupted(
      error instanceof Error
        ? error.message
        : `Etichetta ${labelId} non leggibile. Ricarica la pagina e riprova.`,
    );
  }
}

function writeAudit(
  transaction: Transaction,
  db: Firestore,
  ownerUid: string,
  action: 'student.labelAssigned' | 'student.removed',
  studentUid: string,
): void {
  // `reason` resta null e non contiene mai `labelId` né il nome dell'etichetta:
  // l'audit registra che l'assegnazione è cambiata, non quale sia.
  transaction.set(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action,
    targetId: studentUid,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
}

/**
 * Assegna, cambia o rimuove l'etichetta di uno studente in **una transazione**.
 *
 * Ordine obbligato: **tutte le letture prima di ogni scrittura** (vincolo
 * Firestore), e ogni documento letto viene validato prima di decidere.
 *
 * 1. studente — deve esistere ed essere di questo owner;
 * 2. assegnazione corrente, se esiste;
 * 3. etichetta nuova, se richiesta;
 * 4. etichetta vecchia, se diversa dalla nuova.
 *
 * I quattro casi:
 *
 * | Da | A | Effetto |
 * |---|---|---|
 * | nessuna | `A` | crea l'assegnazione, `A.assignedCount + 1` |
 * | `A` | nessuna | elimina l'assegnazione, `A.assignedCount − 1` |
 * | `A` | `B` | conserva `createdAt`, aggiorna `labelId`/`updatedAt`, `A − 1` e `B + 1` nello stesso commit |
 * | `A` | `A` | **no-op**: zero scritture, zero audit — ma i documenti letti sono comunque validati |
 */
export async function setStudentLabelAssignment(
  studentUid: string,
  nextLabelId: string | null,
  ownerUid: string,
  db: Firestore,
): Promise<SetStudentLabelResult> {
  if (nextLabelId !== null && !isValidDocumentId(nextLabelId)) {
    throw new StudentLabelAssignmentError(
      'label_not_found',
      'Etichetta non valida. Ricarica la pagina e riprova.',
    );
  }

  return runTransaction<SetStudentLabelResult>(db, async (transaction) => {
    const assignmentRef = doc(db, ASSIGNMENTS_COLLECTION, studentUid);

    // ── FASE 1: letture ────────────────────────────────────────────────
    await readOwnedStudent(transaction, db, studentUid, ownerUid);

    const assignmentSnap = await transaction.get(assignmentRef);
    const current = assignmentSnap.exists()
      ? parseStudentLabelAssignment(studentUid, assignmentSnap.data(), ownerUid)
      : null;
    const currentLabelId = current?.labelId ?? null;

    const nextLabel =
      nextLabelId === null ? null : await readOwnedLabel(transaction, db, nextLabelId, ownerUid);
    const previousLabel =
      currentLabelId !== null && currentLabelId !== nextLabelId
        ? await readOwnedLabel(transaction, db, currentLabelId, ownerUid)
        : null;

    // ── No-op: la selezione coincide con lo stato persistito ───────────
    // I documenti sono stati comunque letti e validati: se qualcosa fosse
    // incoerente l'operazione sarebbe già fallita sopra.
    if (currentLabelId === nextLabelId) {
      return { studentUid, labelId: nextLabelId, labelCounts: [], changed: false };
    }

    // ── FASE 2: contatori espliciti, calcolati sui valori validati ─────
    const labelCounts: { labelId: string; assignedCount: number }[] = [];

    if (previousLabel) {
      if (previousLabel.assignedCount <= 0) {
        // Mai `max(0, n - 1)`: un contatore già a zero mentre esiste
        // un'assegnazione è uno stato che nessuno ha spiegato, e ripararlo in
        // silenzio lo renderebbe definitivamente invisibile.
        corrupted(
          `Il contatore dell’etichetta «${previousLabel.name}» è incoerente con le assegnazioni esistenti. Ricarica la pagina e riprova.`,
        );
      }
      const assignedCount = previousLabel.assignedCount - 1;
      transaction.update(doc(db, LABELS_COLLECTION, previousLabel.labelId), {
        assignedCount,
        updatedAt: serverTimestamp(),
      });
      labelCounts.push({ labelId: previousLabel.labelId, assignedCount });
    }

    if (nextLabel) {
      const assignedCount = nextLabel.assignedCount + 1;
      transaction.update(doc(db, LABELS_COLLECTION, nextLabel.labelId), {
        assignedCount,
        updatedAt: serverTimestamp(),
      });
      labelCounts.push({ labelId: nextLabel.labelId, assignedCount });
    }

    // ── FASE 3: assegnazione ───────────────────────────────────────────
    if (nextLabelId === null) {
      transaction.delete(assignmentRef);
    } else if (current === null) {
      transaction.set(assignmentRef, {
        studentUid,
        ownerUid,
        labelId: nextLabelId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      // Cambio A→B: `createdAt` è quando questo studente ha ricevuto la **prima**
      // etichetta e non va riscritto; l'update lo lascia intatto per costruzione.
      transaction.update(assignmentRef, {
        labelId: nextLabelId,
        updatedAt: serverTimestamp(),
      });
    }

    writeAudit(transaction, db, ownerUid, 'student.labelAssigned', studentUid);
    return { studentUid, labelId: nextLabelId, labelCounts, changed: true };
  });
}

/**
 * Esito della rimozione di uno studente: l'eventuale etichetta liberata con il
 * suo nuovo contatore, così la UI si aggiorna senza rileggere nulla.
 */
export type RemoveStudentResult = {
  studentUid: string;
  releasedLabel: { labelId: string; assignedCount: number } | null;
};

/**
 * Rimuove uno studente **e la sua eventuale assegnazione** in una singola
 * transazione.
 *
 * Perché una transazione e non un `writeBatch`: servono **letture** —
 * l'assegnazione e l'etichetta — per sapere quale contatore decrementare e per
 * validarlo prima di scriverlo. Un batch scrive alla cieca; qui un contatore
 * già a zero, un'assegnazione malformata o un'etichetta di un altro owner
 * devono **impedire** la rimozione, non accompagnarla.
 *
 * Ordine: studente → assegnazione → etichetta → (tutte le scritture).
 * Se qualcosa è incoerente lo studente **non** viene eliminato e non resta
 * alcuna scrittura parziale.
 */
export async function removeStudentWithAssignment(
  studentUid: string,
  ownerUid: string,
  db: Firestore,
): Promise<RemoveStudentResult> {
  return runTransaction<RemoveStudentResult>(db, async (transaction) => {
    const studentRef = doc(db, STUDENTS_COLLECTION, studentUid);
    const assignmentRef = doc(db, ASSIGNMENTS_COLLECTION, studentUid);

    // ── letture ────────────────────────────────────────────────────────
    await readOwnedStudent(transaction, db, studentUid, ownerUid);

    const assignmentSnap = await transaction.get(assignmentRef);
    const assignment = assignmentSnap.exists()
      ? parseStudentLabelAssignment(studentUid, assignmentSnap.data(), ownerUid)
      : null;
    const label = assignment
      ? await readOwnedLabel(transaction, db, assignment.labelId, ownerUid)
      : null;

    let releasedLabel: RemoveStudentResult['releasedLabel'] = null;
    if (label) {
      if (label.assignedCount <= 0) {
        corrupted(
          `Il contatore dell’etichetta «${label.name}» è incoerente con le assegnazioni esistenti. Ricarica la pagina e riprova.`,
        );
      }
      releasedLabel = { labelId: label.labelId, assignedCount: label.assignedCount - 1 };
    }

    // ── scritture, tutte nello stesso commit ───────────────────────────
    if (assignment) transaction.delete(assignmentRef);
    if (releasedLabel) {
      transaction.update(doc(db, LABELS_COLLECTION, releasedLabel.labelId), {
        assignedCount: releasedLabel.assignedCount,
        updatedAt: serverTimestamp(),
      });
    }
    transaction.delete(studentRef);
    writeAudit(transaction, db, ownerUid, 'student.removed', studentUid);

    return { studentUid, releasedLabel };
  });
}
