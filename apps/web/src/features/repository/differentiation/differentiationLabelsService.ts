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
import { computeNameKey, normalizeLabelName } from './labelName.js';
import { computeLabelReservationId } from './labelReservationId.js';

/**
 * VDIF-01 — **unico** service owner-only del registro etichette.
 *
 * Nessun componente duplica questa logica: la UI chiama queste quattro funzioni
 * e non costruisce mai da sé un path, un `nameKey` o una transazione.
 *
 * ## Invarianti che questo modulo garantisce
 *
 * - **unicità autorevole**: ogni mutazione del nome passa da
 *   `differentiationLabelNames/{reservationId}` dentro la stessa transazione
 *   che scrive l'etichetta, quindi due tentativi concorrenti sullo stesso nome
 *   non possono riuscire entrambi;
 * - **fail-closed**: un documento malformato — etichetta o prenotazione — ferma
 *   l'operazione **prima di ogni scrittura**. Non viene mai riparato in
 *   silenzio, perché una riparazione invisibile nasconde lo stato che l'ha
 *   causata;
 * - **atomicità dell'audit**: l'evento viaggia nella stessa transazione della
 *   mutazione. Un audit scritto fuori transazione racconterebbe operazioni che
 *   potrebbero non essere avvenute;
 * - **contatori rispettati**: `assignedCount` e `draftUsageCount` sono l'unica
 *   fonte che autorizza l'eliminazione. VDIF-01 non li muove ancora (lo fanno
 *   VDIF-02 e VDIF-03/04), ma li legge **dentro** la transazione e li difende.
 */

export const LABELS_COLLECTION = 'differentiationLabels';
export const LABEL_NAMES_COLLECTION = 'differentiationLabelNames';

export type DifferentiationLabelItem = {
  labelId: string;
  ownerUid: string;
  name: string;
  nameKey: string;
  assignedCount: number;
  draftUsageCount: number;
};

export type DifferentiationLabelErrorCode =
  /** Il nome è già usato da un'altra etichetta dello stesso docente. */
  | 'duplicate_name'
  /** L'etichetta non esiste più (eliminata da un'altra scheda). */
  | 'label_not_found'
  /** Documento etichetta o prenotazione incoerente: mai riparato in automatico. */
  | 'corrupted_state'
  /** Almeno un contatore è positivo: l'etichetta è ancora in uso. */
  | 'label_in_use';

export class DifferentiationLabelError extends Error {
  readonly code: DifferentiationLabelErrorCode;

  constructor(code: DifferentiationLabelErrorCode, message: string) {
    super(message);
    this.name = 'DifferentiationLabelError';
    this.code = code;
  }
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Parser **fail-closed** del documento etichetta.
 *
 * Verifica la forma chiusa a otto chiavi, l'identità (`labelId` == path),
 * l'ownership e i due contatori. Un documento che non passa non viene scartato
 * in silenzio: lancia, e chi legge la lista mostra un errore sull'**intera**
 * lista — una lista parziale presentata come completa è peggio di un errore,
 * perché il docente non ha modo di accorgersene.
 */
export function parseDifferentiationLabel(
  labelId: string,
  data: DocumentData | undefined,
  ownerUid: string,
): DifferentiationLabelItem {
  if (!data) {
    throw new DifferentiationLabelError(
      'corrupted_state',
      `Etichetta ${labelId} non leggibile: documento assente.`,
    );
  }
  const keys = Object.keys(data).sort();
  const expected = [
    'assignedCount',
    'createdAt',
    'draftUsageCount',
    'labelId',
    'name',
    'nameKey',
    'ownerUid',
    'updatedAt',
  ];
  const shapeOk =
    keys.length === expected.length && keys.every((key, index) => key === expected[index]);
  if (!shapeOk) {
    throw new DifferentiationLabelError(
      'corrupted_state',
      `Etichetta ${labelId} non leggibile: struttura del documento non riconosciuta.`,
    );
  }
  if (data.labelId !== labelId) {
    throw new DifferentiationLabelError(
      'corrupted_state',
      `Etichetta ${labelId} non leggibile: identità incoerente.`,
    );
  }
  if (data.ownerUid !== ownerUid) {
    throw new DifferentiationLabelError(
      'corrupted_state',
      `Etichetta ${labelId} non leggibile: proprietario incoerente.`,
    );
  }
  if (typeof data.name !== 'string' || data.name.length === 0) {
    throw new DifferentiationLabelError(
      'corrupted_state',
      `Etichetta ${labelId} non leggibile: nome mancante.`,
    );
  }
  if (typeof data.nameKey !== 'string' || data.nameKey.length === 0) {
    throw new DifferentiationLabelError(
      'corrupted_state',
      `Etichetta ${labelId} non leggibile: chiave di confronto mancante.`,
    );
  }
  if (!isFiniteNonNegativeInteger(data.assignedCount)) {
    throw new DifferentiationLabelError(
      'corrupted_state',
      `Etichetta «${data.name}» non leggibile: contatore delle assegnazioni non valido.`,
    );
  }
  if (!isFiniteNonNegativeInteger(data.draftUsageCount)) {
    throw new DifferentiationLabelError(
      'corrupted_state',
      `Etichetta «${data.name}» non leggibile: contatore delle bozze non valido.`,
    );
  }
  return {
    labelId,
    ownerUid: data.ownerUid,
    name: data.name,
    nameKey: data.nameKey,
    assignedCount: data.assignedCount,
    draftUsageCount: data.draftUsageCount,
  };
}

/**
 * Verifica che una prenotazione sia coerente con l'etichetta che dovrebbe
 * detenerla. Non ricalcola l'hash del path — quello lo fa il chiamante, che
 * conosce `ownerUid` e `nameKey` e costruisce il path da lì.
 */
function assertReservationMatches(
  data: DocumentData | undefined,
  expected: { ownerUid: string; labelId: string; nameKey: string },
): void {
  if (
    !data ||
    data.ownerUid !== expected.ownerUid ||
    data.labelId !== expected.labelId ||
    data.nameKey !== expected.nameKey
  ) {
    throw new DifferentiationLabelError(
      'corrupted_state',
      `La prenotazione del nome «${expected.nameKey}» non è coerente con l’etichetta. Ricarica la pagina e riprova.`,
    );
  }
}

function writeAudit(
  transaction: Transaction,
  db: Firestore,
  ownerUid: string,
  action: 'label.created' | 'label.updated' | 'label.deleted',
  labelId: string,
): void {
  // `reason` resta null per contratto: il nome dell'etichetta è testo libero e
  // non ha motivo di transitare nei log, nemmeno owner-only.
  transaction.set(doc(collection(db, 'auditEvents')), {
    actorUid: ownerUid,
    action,
    targetId: labelId,
    outcome: 'success',
    reason: null,
    timestamp: serverTimestamp(),
  });
}

/**
 * **Una sola query**, filtrata per `ownerUid` — la stessa condizione su cui le
 * Rules autorizzano il `list`, altrimenti Firestore non può dimostrarla e nega
 * l'intera richiesta.
 *
 * L'ordinamento è fatto **in memoria** su `nameKey`: un `orderBy` su Firestore
 * richiederebbe un indice composito `(ownerUid, nameKey)` per un elenco di
 * poche decine di documenti già interamente caricati. Nessuna lettura per card,
 * nessun listener, nessun polling.
 */
export async function listDifferentiationLabels(
  ownerUid: string,
  db: Firestore,
): Promise<DifferentiationLabelItem[]> {
  const snap = await getDocs(
    query(collection(db, LABELS_COLLECTION), where('ownerUid', '==', ownerUid)),
  );
  const items = snap.docs.map((d) => parseDifferentiationLabel(d.id, d.data(), ownerUid));
  return items.sort((a, b) => a.nameKey.localeCompare(b.nameKey, 'it'));
}

/**
 * Crea un'etichetta e la sua prenotazione **nello stesso commit**.
 *
 * `labelId` è generato una sola volta, prima della transazione: i retry interni
 * dell'SDK riusano lo stesso id, quindi una prenotazione già esistente **con
 * quel labelId** è riconoscibile come il nostro stesso commit andato a buon
 * fine, non come un conflitto.
 *
 * **Limite dichiarato dell'idempotenza.** Il contratto VDIF-00 non prevede un
 * `requestId` persistito, e questo service non ne inventa uno. Ne consegue che
 * l'idempotenza copre i retry *interni a questa chiamata*: se la risposta si
 * perde e il docente ripete l'azione dalla UI, la seconda chiamata genera un
 * `labelId` nuovo e riceve `duplicate_name`. È l'esito corretto e sicuro — non
 * viene creata una seconda etichetta omonima — ma non è un replay silenzioso, e
 * la UI lo mostra come conflitto di nome.
 */
export async function createDifferentiationLabel(
  rawName: string,
  ownerUid: string,
  db: Firestore,
): Promise<DifferentiationLabelItem> {
  const name = normalizeLabelName(rawName);
  const nameKey = computeNameKey(name);
  const reservationId = await computeLabelReservationId(ownerUid, nameKey);
  const labelId = crypto.randomUUID();

  await runTransaction(db, async (transaction) => {
    const reservationRef = doc(db, LABEL_NAMES_COLLECTION, reservationId);
    const labelRef = doc(db, LABELS_COLLECTION, labelId);
    const reservationSnap = await transaction.get(reservationRef);

    if (reservationSnap.exists()) {
      const data = reservationSnap.data();
      if (data.labelId === labelId) {
        // Replay del nostro stesso tentativo: nulla da scrivere.
        assertReservationMatches(data, { ownerUid, labelId, nameKey });
        return;
      }
      // Prenotazione di un'altra etichetta (o orfana): mai riusata, mai
      // sovrascritta. Per il docente è, in entrambi i casi, «nome occupato».
      throw new DifferentiationLabelError(
        'duplicate_name',
        `Esiste già un’etichetta con questo nome: «${name}».`,
      );
    }

    transaction.set(labelRef, {
      labelId,
      ownerUid,
      name,
      nameKey,
      assignedCount: 0,
      draftUsageCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    transaction.set(reservationRef, {
      ownerUid,
      labelId,
      nameKey,
      createdAt: serverTimestamp(),
    });
    writeAudit(transaction, db, ownerUid, 'label.created', labelId);
  });

  return { labelId, ownerUid, name, nameKey, assignedCount: 0, draftUsageCount: 0 };
}

/**
 * Rinomina conservando `labelId`, `ownerUid`, i contatori e `createdAt`.
 *
 * Prenotazione nuova, aggiornamento dell'etichetta e rilascio della vecchia
 * viaggiano **in un solo commit**: non esiste un istante in cui il vecchio nome
 * è già libero ma il nuovo non è ancora occupato.
 *
 * Un nome semanticamente invariato (stesso `nameKey`) è un **no-op**: zero
 * scritture, nemmeno l'audit. Cambiare solo maiuscole o spazi interni cambia
 * però la forma canonica mostrata, quindi in quel caso l'etichetta viene
 * comunque aggiornata pur mantenendo la stessa prenotazione.
 */
export async function renameDifferentiationLabel(
  labelId: string,
  rawName: string,
  ownerUid: string,
  db: Firestore,
): Promise<DifferentiationLabelItem> {
  const name = normalizeLabelName(rawName);
  const nameKey = computeNameKey(name);
  const nextReservationId = await computeLabelReservationId(ownerUid, nameKey);

  // Il valore torna dal callback della transazione, non da una variabile
  // catturata: su un retry la closure verrebbe rieseguita e un'assegnazione
  // esterna potrebbe conservare il risultato del tentativo fallito.
  return runTransaction<DifferentiationLabelItem>(db, async (transaction) => {
    const labelRef = doc(db, LABELS_COLLECTION, labelId);
    const labelSnap = await transaction.get(labelRef);
    if (!labelSnap.exists()) {
      throw new DifferentiationLabelError(
        'label_not_found',
        'Questa etichetta non esiste più. Ricarica la pagina.',
      );
    }
    const current = parseDifferentiationLabel(labelId, labelSnap.data(), ownerUid);
    const previousReservationId = await computeLabelReservationId(ownerUid, current.nameKey);

    // La prenotazione corrente deve esistere ed essere coerente: senza, il nome
    // dell'etichetta non è realmente protetto e non si procede.
    const previousReservationSnap = await transaction.get(
      doc(db, LABEL_NAMES_COLLECTION, previousReservationId),
    );
    if (!previousReservationSnap.exists()) {
      throw new DifferentiationLabelError(
        'corrupted_state',
        `L’etichetta «${current.name}» non ha una prenotazione del nome valida. Ricarica la pagina e riprova.`,
      );
    }
    assertReservationMatches(previousReservationSnap.data(), {
      ownerUid,
      labelId,
      nameKey: current.nameKey,
    });

    if (nextReservationId === previousReservationId) {
      // Stesso `nameKey`. Se anche la forma canonica coincide non c'è nulla da
      // fare; se cambia solo la grafia si aggiorna il documento senza toccare
      // la prenotazione, che è già quella giusta.
      if (current.name === name) return current;
      transaction.update(labelRef, { name, updatedAt: serverTimestamp() });
      writeAudit(transaction, db, ownerUid, 'label.updated', labelId);
      return { ...current, name };
    }

    const nextReservationRef = doc(db, LABEL_NAMES_COLLECTION, nextReservationId);
    const nextReservationSnap = await transaction.get(nextReservationRef);
    if (nextReservationSnap.exists()) {
      const data = nextReservationSnap.data();
      if (data.labelId !== labelId) {
        throw new DifferentiationLabelError(
          'duplicate_name',
          `Esiste già un’etichetta con questo nome: «${name}».`,
        );
      }
      // Prenotazione già nostra: replay di questa stessa rinomina.
      assertReservationMatches(data, { ownerUid, labelId, nameKey });
    } else {
      transaction.set(nextReservationRef, {
        ownerUid,
        labelId,
        nameKey,
        createdAt: serverTimestamp(),
      });
    }

    transaction.update(labelRef, { name, nameKey, updatedAt: serverTimestamp() });
    transaction.delete(doc(db, LABEL_NAMES_COLLECTION, previousReservationId));
    writeAudit(transaction, db, ownerUid, 'label.updated', labelId);
    return { ...current, name, nameKey };
  });
}

/**
 * Elimina etichetta e prenotazione **nello stesso commit**, e solo se entrambi
 * i contatori — riletti **dentro** la transazione — valgono zero.
 *
 * È qui che il contratto diventa vero: i contatori non sono un suggerimento
 * dell'interfaccia, sono la condizione riletta nella transazione che scrive.
 * Se nel frattempo qualcosa è cambiato, Firestore fa ritentare e il secondo
 * tentativo rifiuta.
 */
export async function deleteDifferentiationLabel(
  labelId: string,
  ownerUid: string,
  db: Firestore,
): Promise<void> {
  await runTransaction(db, async (transaction) => {
    const labelRef = doc(db, LABELS_COLLECTION, labelId);
    const labelSnap = await transaction.get(labelRef);
    if (!labelSnap.exists()) {
      throw new DifferentiationLabelError(
        'label_not_found',
        'Questa etichetta non esiste più. Ricarica la pagina.',
      );
    }
    const current = parseDifferentiationLabel(labelId, labelSnap.data(), ownerUid);

    if (current.assignedCount > 0 || current.draftUsageCount > 0) {
      throw new DifferentiationLabelError('label_in_use', describeUsage(current));
    }

    const reservationId = await computeLabelReservationId(ownerUid, current.nameKey);
    const reservationRef = doc(db, LABEL_NAMES_COLLECTION, reservationId);
    const reservationSnap = await transaction.get(reservationRef);
    if (!reservationSnap.exists()) {
      throw new DifferentiationLabelError(
        'corrupted_state',
        `L’etichetta «${current.name}» non ha una prenotazione del nome valida. Ricarica la pagina e riprova.`,
      );
    }
    assertReservationMatches(reservationSnap.data(), {
      ownerUid,
      labelId,
      nameKey: current.nameKey,
    });

    transaction.delete(labelRef);
    transaction.delete(reservationRef);
    writeAudit(transaction, db, ownerUid, 'label.deleted', labelId);
  });
}

/** Messaggio leggibile del perché un'etichetta non è eliminabile. */
export function describeUsage(label: {
  name: string;
  assignedCount: number;
  draftUsageCount: number;
}): string {
  const parts: string[] = [];
  if (label.assignedCount > 0) {
    parts.push(
      `assegnata a ${label.assignedCount} ${label.assignedCount === 1 ? 'studente' : 'studenti'}`,
    );
  }
  if (label.draftUsageCount > 0) {
    parts.push(
      `usata in ${label.draftUsageCount} ${label.draftUsageCount === 1 ? 'bozza' : 'bozze'} di verifica`,
    );
  }
  if (parts.length === 0) return '';
  return `L’etichetta «${label.name}» è ${parts.join(' e ')}: rimuovi prima questi utilizzi.`;
}
