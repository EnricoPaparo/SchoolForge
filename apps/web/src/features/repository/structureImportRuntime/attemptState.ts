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
  manifestHash?: unknown;
  kind?: unknown;
  status?: unknown;
  udaIds?: unknown;
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
export interface AttemptExpectation {
  requestId: string;
  manifestHash: string;
  udaIds: readonly string[];
  storagePaths: readonly string[];
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
  if (typeof record.manifestHash !== 'string') return 'incoherent';
  if (record.manifestHash !== expected.manifestHash) return 'conflict';

  if (record.kind !== 'uda') return 'incoherent';
  if (!isStringArray(record.udaIds) || !isStringArray(record.storagePaths)) return 'incoherent';
  if (!sameSequence(record.udaIds, expected.udaIds)) return 'incoherent';
  if (!sameSequence(record.storagePaths, expected.storagePaths)) return 'incoherent';

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
 * l'ha sostituita.
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
