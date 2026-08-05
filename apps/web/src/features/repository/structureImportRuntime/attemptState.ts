/**
 * STRUCTURE-IMPORT-02A — la macchina degli stati di un tentativo di import.
 *
 * Tutte le decisioni delicate del protocollo — *questo record è un replay o un
 * conflitto?*, *questo commit può procedere?*, *questo cleanup può cancellare
 * qualcosa?* — vivono qui, pure e con un clock iniettabile, invece che dentro
 * le transazioni Firestore. Sono esattamente i punti in cui un errore non si
 * manifesta come un crash ma come un dato sbagliato, quindi devono essere
 * verificabili senza emulatore.
 *
 * Principio unico: **fail-closed su tutto ciò che non è dimostrato**. Un record
 * assente, parziale, malformato o divergente non viene mai «riparato», né
 * sovrascritto, né interpretato con benevolenza: blocca.
 *
 * Modulo puro: nessun Firebase, nessun DOM, nessun timer.
 */

/** Stati ammessi per il record di un tentativo. */
export type AttemptStatus = 'reserved' | 'committed';

/** Ciò che il record del tentativo contiene, come arriva da Firestore. */
export interface AttemptRecord {
  requestId?: unknown;
  /** Identità della sorgente, calcolabile prima del planner. */
  sourceHash?: unknown;
  /** Destinazione: corso e import su cui il tentativo è stato costruito. */
  programId?: unknown;
  importId?: unknown;
  manifestHash?: unknown;
  kind?: unknown;
  status?: unknown;
  /** Destination UDA — only meaningful for a lesson append. */
  udaId?: unknown;
  /** Document ids the attempt creates: `udaIds` for UDAs, `lessonIds` for lessons. */
  documentIds?: unknown;
  /** Projection ids, only for a lesson append. */
  publicLessonIds?: unknown;
  storagePaths?: unknown;
  expiresAt?: unknown;
}

/** Ciò che il lease contiene, come arriva da Firestore. */
export interface LeaseRecord {
  requestId?: unknown;
  manifestHash?: unknown;
  expiresAt?: unknown;
}

/** L'identità e la forma attesa del tentativo corrente. */
/**
 * Ciò che identifica un tentativo **prima** che il piano esista: richiesta,
 * sorgente e destinazione. È quanto basta a riconoscere un replay senza dover
 * rileggere la destinazione già modificata dal commit precedente.
 */
export interface SourceExpectation {
  requestId: string;
  sourceHash: string;
  kind: 'uda' | 'lesson';
  programId: string;
  importId: string;
  /** UDA di destinazione per le lezioni; `null` per le UDA. */
  udaId: string | null;
}

export interface AttemptExpectation extends SourceExpectation {
  manifestHash: string;
  /** Document ids the plan creates, in order. */
  documentIds: readonly string[];
  /** Projection ids the plan creates, in order (empty for a UDA append). */
  publicLessonIds: readonly string[];
  storagePaths: readonly string[];
}

/**
 * Esito della sonda **di sorgente**, eseguita prima del planner.
 *
 * `committed` porta con sé il risultato minimo persistito nel record: è ciò che
 * permette di rispondere a un replay senza ricostruire un manifest sulla
 * destinazione ormai modificata — cosa che produrrebbe id e numerazioni
 * diverse da quelle realmente scritte.
 */
export type SourceProbe =
  | { state: 'none' }
  | { state: 'reserved' }
  | { state: 'conflict' }
  | { state: 'incoherent' }
  | { state: 'committed'; documentIds: string[]; publicLessonIds: string[] };

/**
 * Classifica un record rispetto a richiesta, sorgente e destinazione, senza
 * conoscere il piano.
 *
 * Un record privo di `sourceHash` — legacy o parziale — è `incoherent`: non
 * viene mai «riparato» né riscritto, perché non è dimostrabile che descriva
 * questo tentativo.
 */
export function classifySourceAttempt(
  record: AttemptRecord | null,
  expected: SourceExpectation,
): SourceProbe {
  if (record === null) return { state: 'none' };

  if (typeof record.requestId !== 'string' || record.requestId !== expected.requestId) {
    return { state: 'incoherent' };
  }
  // Nessun `sourceHash`: record scritto da una versione precedente del
  // protocollo, o troncato. Non è riparabile e non è questo tentativo.
  if (typeof record.sourceHash !== 'string') return { state: 'incoherent' };
  // Stessa richiesta, sorgente diversa: il docente ha cambiato il file.
  if (record.sourceHash !== expected.sourceHash) return { state: 'conflict' };

  // Stessa sorgente ma altro bersaglio: non è questo tentativo.
  if (record.kind !== expected.kind) return { state: 'conflict' };
  if (record.programId !== undefined && record.programId !== expected.programId) {
    return { state: 'conflict' };
  }
  if (record.importId !== undefined && record.importId !== expected.importId) {
    return { state: 'conflict' };
  }
  const recordUdaId = record.udaId === undefined ? null : record.udaId;
  if (recordUdaId !== expected.udaId) return { state: 'conflict' };

  if (record.status === 'committed') {
    // Il risultato deve essere leggibile e ben formato, altrimenti il replay
    // non ha nulla di autorevole da restituire.
    if (!isStringArray(record.documentIds)) return { state: 'incoherent' };
    const publicLessonIds = isStringArray(record.publicLessonIds) ? record.publicLessonIds : [];
    if (expected.kind === 'lesson' && !isStringArray(record.publicLessonIds)) {
      return { state: 'incoherent' };
    }
    return { state: 'committed', documentIds: record.documentIds, publicLessonIds };
  }
  if (record.status === 'reserved') return { state: 'reserved' };
  return { state: 'incoherent' };
}

export type AttemptClassification =
  /** Nessun record: tentativo nuovo. */
  | 'none'
  /** Stesso tentativo, già committato: replay, restituire successo. */
  | 'committed'
  /** Stesso `requestId` ma piano diverso: fail-closed, mai un secondo import. */
  | 'conflict'
  /** Stesso tentativo, non completato e coerente: riprendibile. */
  | 'resumable'
  /** Record parziale, malformato o divergente: fail-closed, non si tocca. */
  | 'incoherent';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * Classifica il record di un tentativo rispetto al piano corrente.
 *
 * L'ordine dei controlli è deliberato: prima l'identità (`requestId`), poi
 * l'hash — così un `requestId` riusato con un contenuto diverso è sempre un
 * `conflict`, mai un `incoherent` — e solo dopo la forma. Un record che dice di
 * appartenere a questo tentativo ma elenca id o path diversi **non** è
 * riprendibile: sarebbe l'unico modo per far cancellare o riscrivere a un
 * retry i file di un tentativo sostituito.
 */
export function classifyAttempt(
  record: AttemptRecord | null,
  expected: AttemptExpectation,
): AttemptClassification {
  if (record === null) return 'none';

  if (typeof record.requestId !== 'string' || record.requestId !== expected.requestId) {
    // Il record vive su un documento indirizzato dal requestId: un mismatch qui
    // significa un documento corrotto o riusato, mai il nostro tentativo.
    return 'incoherent';
  }
  if (typeof record.sourceHash !== 'string') return 'incoherent';
  if (record.sourceHash !== expected.sourceHash) return 'conflict';
  if (typeof record.manifestHash !== 'string') return 'incoherent';
  // Stessa sorgente ma piano diverso: la destinazione è cambiata sotto il
  // tentativo (una mutazione concorrente ha spostato numerazione o `order`).
  // Fail-closed: il record non descrive ciò che stiamo per scrivere.
  if (record.manifestHash !== expected.manifestHash) return 'incoherent';

  // The kind is part of the identity: an attempt that created UDAs can never
  // stand in for one that must create lessons.
  if (record.kind !== expected.kind) return 'incoherent';
  // And so is the destination UDA: a lesson attempt on another UDA is not this
  // attempt, even with the same requestId and the same hash.
  const recordUdaId = record.udaId === undefined ? null : record.udaId;
  if (recordUdaId !== expected.udaId) return 'incoherent';

  if (!isStringArray(record.documentIds) || !isStringArray(record.storagePaths)) {
    return 'incoherent';
  }
  if (!sameSequence(record.documentIds, expected.documentIds)) return 'incoherent';
  if (!sameSequence(record.storagePaths, expected.storagePaths)) return 'incoherent';
  // Projections exist only for lessons; when expected, they must match exactly.
  if (expected.publicLessonIds.length > 0 || record.publicLessonIds !== undefined) {
    if (!isStringArray(record.publicLessonIds)) return 'incoherent';
    if (!sameSequence(record.publicLessonIds, expected.publicLessonIds)) return 'incoherent';
  }

  if (record.status === 'committed') return 'committed';
  if (record.status === 'reserved') return 'resumable';
  return 'incoherent';
}

export type CommitPreconditionFailure =
  | 'lease_missing'
  | 'lease_malformed'
  | 'lease_expired'
  | 'lease_other_request'
  | 'lease_other_manifest'
  | 'attempt_missing'
  | 'attempt_incoherent'
  | 'attempt_committed';

/**
 * Precondizioni del commit finale.
 *
 * Un lease **assente o scaduto non è un permesso**: è la condizione in cui un
 * altro attore può aver già cambiato numerazione, `order` o destinazione, e un
 * tentativo lento che si svegliasse dopo la scadenza scriverebbe documenti
 * costruiti su uno stato ormai vecchio. Per questo il commit richiede un lease
 * presente, ben formato, non scaduto, di questo `requestId` e di questo
 * `manifestHash`, più un record del tentativo coerente e ancora `reserved`.
 *
 * Restituisce `null` quando il commit può procedere, altrimenti il motivo
 * esatto del rifiuto. Non ripara nulla: il chiamante deve abortire.
 */
export function checkCommitPreconditions(params: {
  lease: LeaseRecord | null | undefined;
  attempt: AttemptRecord | null;
  expected: AttemptExpectation;
  /** Millisecondi correnti — iniettabile, così la scadenza è verificabile. */
  now: number;
}): CommitPreconditionFailure | null {
  const { lease, attempt, expected, now } = params;

  if (lease === null || lease === undefined) return 'lease_missing';
  if (
    typeof lease.requestId !== 'string' ||
    typeof lease.manifestHash !== 'string' ||
    typeof lease.expiresAt !== 'number' ||
    !Number.isFinite(lease.expiresAt)
  ) {
    return 'lease_malformed';
  }
  if (lease.requestId !== expected.requestId) return 'lease_other_request';
  if (lease.manifestHash !== expected.manifestHash) return 'lease_other_manifest';
  if (lease.expiresAt <= now) return 'lease_expired';

  const classification = classifyAttempt(attempt, expected);
  if (classification === 'none') return 'attempt_missing';
  if (classification === 'committed') return 'attempt_committed';
  if (classification !== 'resumable') return 'attempt_incoherent';

  return null;
}

/**
 * Il cleanup può toccare qualcosa solo se il record dimostra che ciò che sta
 * per essere cancellato appartiene **a questo esatto tentativo**: stesso
 * `requestId`, stesso `manifestHash`, stesso `kind`, stessi `udaIds`, stessi
 * `storagePaths`, e tentativo non ancora committato.
 *
 * Il caso che questa guardia esiste per impedire: una vecchia esecuzione che si
 * risveglia e cancella lease, record e file di un tentativo che nel frattempo
 * l'ha sostituita — o, peggio, di un tentativo di un altro tipo o su un'altra
 * UDA.
 */
export function mayCleanupAttempt(
  record: AttemptRecord | null,
  expected: AttemptExpectation,
): boolean {
  return classifyAttempt(record, expected) === 'resumable';
}

/**
 * Un path caricato è «proprio» solo se compare nel record dello stesso
 * tentativo, già dimostrato coerente. Qualunque altro path esistente resta una
 * collisione bloccante, anche dentro le directory dell'import.
 */
export function ownedStoragePaths(
  classification: AttemptClassification,
  expected: AttemptExpectation,
): string[] {
  return classification === 'resumable' ? [...expected.storagePaths] : [];
}
