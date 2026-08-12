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
import {
  hasExactKeys,
  isFiniteNonNegativeInteger,
  isFirestoreTimestamp,
} from '../documentShape.js';
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

function corrupted(message: string): never {
  throw new DifferentiationLabelError('corrupted_state', message);
}

const LABEL_KEYS = [
  'assignedCount',
  'createdAt',
  'draftUsageCount',
  'labelId',
  'name',
  'nameKey',
  'ownerUid',
  'updatedAt',
];

const RESERVATION_KEYS = ['createdAt', 'labelId', 'nameKey', 'ownerUid'];

/**
 * Parser **fail-closed** del documento etichetta.
 *
 * Verifica forma chiusa, identità, ownership, **canonicità del nome**,
 * **derivazione di `nameKey` dal nome**, contatori e timestamp. Il punto che
 * conta: `name` non è solo «una stringa non vuota», è *esattamente* ciò che
 * `normalizeLabelName` produrrebbe, e `nameKey` è *esattamente*
 * `computeNameKey(name)`. Senza questi due confronti un documento con spazi
 * doppi, caratteri di controllo o una chiave estranea entrerebbe in lista come
 * se fosse valido, e la sua prenotazione — derivata da un `nameKey` diverso —
 * punterebbe altrove.
 *
 * Un documento che non passa non viene scartato né corretto in silenzio:
 * lancia, e chi legge la lista mostra un errore sull'**intera** lista. Una
 * lista parziale presentata come completa è peggio di un errore, perché il
 * docente non ha modo di accorgersene.
 */
export function parseDifferentiationLabel(
  labelId: string,
  data: DocumentData | undefined,
  ownerUid: string,
): DifferentiationLabelItem {
  if (!data) corrupted(`Etichetta ${labelId} non leggibile: documento assente.`);
  if (!hasExactKeys(data, LABEL_KEYS)) {
    corrupted(`Etichetta ${labelId} non leggibile: struttura del documento non riconosciuta.`);
  }
  if (data.labelId !== labelId) {
    corrupted(`Etichetta ${labelId} non leggibile: identità incoerente.`);
  }
  if (data.ownerUid !== ownerUid) {
    corrupted(`Etichetta ${labelId} non leggibile: proprietario incoerente.`);
  }

  // Canonicità: il nome persistito deve essere già la forma canonica. Se
  // `normalizeLabelName` lo rifiuta (controlli, limiti) o lo cambierebbe
  // (spazi), il documento non è valido — e non lo si aggiusta leggendolo.
  let canonicalName: string;
  try {
    canonicalName = normalizeLabelName(data.name);
  } catch {
    corrupted(`Etichetta ${labelId} non leggibile: nome non valido.`);
  }
  if (canonicalName !== data.name) {
    corrupted(`Etichetta ${labelId} non leggibile: nome non in forma canonica.`);
  }
  if (data.nameKey !== computeNameKey(canonicalName)) {
    corrupted(`Etichetta ${labelId} non leggibile: chiave di confronto non derivata dal nome.`);
  }

  if (!isFiniteNonNegativeInteger(data.assignedCount)) {
    corrupted(`Etichetta «${data.name}» non leggibile: contatore delle assegnazioni non valido.`);
  }
  if (!isFiniteNonNegativeInteger(data.draftUsageCount)) {
    corrupted(`Etichetta «${data.name}» non leggibile: contatore delle bozze non valido.`);
  }
  if (!isFirestoreTimestamp(data.createdAt) || !isFirestoreTimestamp(data.updatedAt)) {
    corrupted(`Etichetta «${data.name}» non leggibile: date mancanti o non valide.`);
  }
  // Alla creazione i due timestamp coincidono (stesso commit), poi `updatedAt`
  // può solo avanzare: un `updatedAt` anteriore descrive una storia impossibile.
  if (data.updatedAt.toMillis() < data.createdAt.toMillis()) {
    corrupted(`Etichetta «${data.name}» non leggibile: date incoerenti.`);
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
 * Parser **chiuso** della prenotazione: quattro chiavi esatte, ownership,
 * identità dell'etichetta che la detiene, `nameKey` atteso e `createdAt`
 * valido.
 *
 * Il `nameKey` atteso non viene *ricavato* da qui: è il chiamante che possiede
 * `ownerUid` e `nameKey` e da quelli deriva il path. Questa funzione verifica
 * che il **contenuto** concordi con quel path — è il solo modo di accorgersi di
 * una prenotazione spostata a mano, dato che né qui né nelle Rules si può
 * ricalcolare SHA-256.
 */
function assertValidReservation(
  data: DocumentData | undefined,
  expected: { ownerUid: string; labelId: string; nameKey: string },
): void {
  const incoherent = () =>
    corrupted(
      `La prenotazione del nome «${expected.nameKey}» non è coerente con l’etichetta. Ricarica la pagina e riprova.`,
    );
  if (!data || !hasExactKeys(data, RESERVATION_KEYS)) incoherent();
  if (
    data!.ownerUid !== expected.ownerUid ||
    data!.labelId !== expected.labelId ||
    data!.nameKey !== expected.nameKey ||
    !isFirestoreTimestamp(data!.createdAt)
  ) {
    incoherent();
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
 * **Che cosa conta come replay.** Una prenotazione con il *nostro* `labelId`
 * **non basta** a dichiarare riuscito il tentativo precedente: dimostra solo
 * che qualcuno ha scritto quella prenotazione. Il replay è riconosciuto solo se
 * esiste anche l'etichetta, è integra, appartiene a noi, ha esattamente il nome
 * e la chiave richiesti e ha entrambi i contatori a zero — cioè se lo stato è
 * *identico* a quello che questa chiamata produrrebbe. Qualunque divergenza è
 * `corrupted_state`, non un successo silenzioso.
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

  return runTransaction<DifferentiationLabelItem>(db, async (transaction) => {
    const reservationRef = doc(db, LABEL_NAMES_COLLECTION, reservationId);
    const labelRef = doc(db, LABELS_COLLECTION, labelId);
    const reservationSnap = await transaction.get(reservationRef);

    if (reservationSnap.exists()) {
      const data = reservationSnap.data();
      if (data.labelId !== labelId) {
        // Prenotazione di un'altra etichetta (o orfana): mai riusata, mai
        // sovrascritta. Per il docente è, in entrambi i casi, «nome occupato».
        throw new DifferentiationLabelError(
          'duplicate_name',
          `Esiste già un’etichetta con questo nome: «${name}».`,
        );
      }
      // Possibile replay del nostro stesso tentativo: va **dimostrato**.
      assertValidReservation(data, { ownerUid, labelId, nameKey });
      const existingSnap = await transaction.get(labelRef);
      if (!existingSnap.exists()) {
        // Prenotazione senza etichetta: il commit precedente non è mai avvenuto
        // per intero. Non è un replay riuscito e non si ripara da soli.
        corrupted(
          `Il nome «${name}» risulta prenotato ma l’etichetta non esiste. Ricarica la pagina e riprova.`,
        );
      }
      const existing = parseDifferentiationLabel(labelId, existingSnap.data(), ownerUid);
      if (
        existing.name !== name ||
        existing.nameKey !== nameKey ||
        existing.assignedCount !== 0 ||
        existing.draftUsageCount !== 0
      ) {
        corrupted(
          `Lo stato dell’etichetta «${name}» non corrisponde alla creazione richiesta. Ricarica la pagina e riprova.`,
        );
      }
      // Stato identico a quello che avremmo prodotto: nessuna scrittura,
      // nessun secondo evento di audit.
      return existing;
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
    return { labelId, ownerUid, name, nameKey, assignedCount: 0, draftUsageCount: 0 };
  });
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
    assertValidReservation(previousReservationSnap.data(), {
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
      if (nextReservationSnap.data().labelId !== labelId) {
        throw new DifferentiationLabelError(
          'duplicate_name',
          `Esiste già un’etichetta con questo nome: «${name}».`,
        );
      }
      /*
       * Prenotazione nuova già nostra **mentre l'etichetta porta ancora il
       * vecchio `nameKey`**: non è il replay di una rinomina riuscita. Una
       * rinomina valida è atomica — avrebbe aggiornato l'etichetta e rilasciato
       * la vecchia prenotazione nello stesso commit — quindi questo stato è
       * parziale e non va completato a posteriori.
       *
       * Il replay vero non arriva mai qui: se la rinomina è già stata
       * committata, l'etichetta ha già il nuovo `nameKey`, quindi
       * `previousReservationId === nextReservationId` e il ramo precedente la
       * riconosce come no-op.
       */
      corrupted(
        `Il nome «${name}» risulta già prenotato da questa etichetta, ma l’etichetta non è stata rinominata. Ricarica la pagina e riprova.`,
      );
    }
    transaction.set(nextReservationRef, {
      ownerUid,
      labelId,
      nameKey,
      createdAt: serverTimestamp(),
    });

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
    assertValidReservation(reservationSnap.data(), {
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
