import type { AttemptClassification } from './attemptState.js';

/**
 * STRUCTURE-IMPORT — il protocollo di append, unico per UDA e lezioni.
 *
 * Estratto da STRUCTURE-IMPORT-02A quando 02B ha avuto bisogno dello stesso
 * comportamento: identità del tentativo, sonda di replay, preflight, lease,
 * upload, rinnovo condizionato, commit e cleanup non sono due macchine simili
 * ma **la stessa macchina** su manifest diversi. Duplicarla avrebbe significato
 * due protocolli che divergono alla prima correzione.
 *
 * Ciò che resta specifico del tipo di import vive fuori di qui: la validazione
 * del file, la lettura della destinazione e la costruzione del manifest puro.
 * Quando arriva qui, il piano esiste già e non cambia più.
 *
 * L'identità è a **due livelli** e il primo vive fuori di qui:
 *
 * - `sourceHash` — richiesta, owner autorevole, destinazione e metadati del
 *   file — è calcolabile *prima* del planner, e serve a riconoscere un replay
 *   anche quando il commit precedente ha già modificato la destinazione;
 * - `manifestHash` — il piano completo, con id, `order` e path — governa
 *   lease, resume e commit, ed è ciò di cui si occupa questa funzione.
 *
 * Ordine fisso, fail-closed a ogni passo:
 *
 *   SHA-256 del manifest → verifica del tentativo → preflight → lease →
 *   upload → rinnovo → commit
 *
 * Nessuna scrittura prima che il preflight sia verde. Ogni fallimento dopo il
 * lease esegue un cleanup limitato al manifest del tentativo.
 *
 * Modulo puro rispetto all'infrastruttura: nessun Firebase, nessun DOM.
 */

/** Il minimo che il protocollo deve conoscere di un manifest. */
export interface AppendManifestLike {
  kind: 'uda' | 'lesson';
  ownerUid: string;
  programId: string;
  importId: string;
  storagePaths: string[];
  manifestCanonical: string;
}

/** Collisione tecnica rilevata dal preflight. Mai mostrata verbatim in UI. */
export interface AppendCollision {
  kind: string;
  id: string;
}

export interface StructureAppendPorts<M extends AppendManifestLike> {
  /** `hex(SHA-256(UTF8(canonical)))`. Deve sollevare se non calcolabile. */
  hashCanonical(canonical: string): Promise<string>;
  /**
   * Verifica il record del tentativo **contro il piano**: un `resumable` deve
   * descrivere esattamente questo manifest, altrimenti fallisce chiuso.
   */
  probeAttempt(params: {
    manifest: M;
    requestId: string;
    manifestHash: string;
  }): Promise<AttemptClassification>;
  preflight(params: {
    manifest: M;
    /** Path che un tentativo `resumable` ha già dimostrato propri. */
    ownedStoragePaths: readonly string[];
  }): Promise<{ collision: AppendCollision | null }>;
  acquireLease(params: {
    manifest: M;
    requestId: string;
    manifestHash: string;
    /** Persistito nel record: è la chiave del riconoscimento di un replay. */
    sourceHash: string;
  }): Promise<'acquired' | 'busy'>;
  uploadStorage(files: Array<{ path: string; content: string }>): Promise<void>;
  renewLease(params: {
    manifest: M;
    requestId: string;
    manifestHash: string;
  }): Promise<'renewed' | 'lost'>;
  commit(params: { manifest: M; requestId: string; manifestHash: string }): Promise<void>;
  cleanup(params: {
    manifest: M;
    requestId: string;
    manifestHash: string;
  }): Promise<'done' | 'pending'>;
  /** I file che l'attempt carica: path canonico e contenuto esatto. */
  filesOf(manifest: M): Array<{ path: string; content: string }>;
}

export type AppendNotAppliedReason =
  | 'hash_unavailable'
  | 'incoherent_attempt'
  | 'collision'
  | 'busy'
  | 'conflict'
  | 'upload_failed'
  | 'lease_lost'
  | 'commit_failed';

export type StructureAppendOutcome =
  | { status: 'committed' }
  | { status: 'not_applied'; message: string; reason: AppendNotAppliedReason }
  | { status: 'cleanup_pending'; message: string };

/** I messaggi variano col tipo di import: il protocollo no. */
export interface AppendCopy {
  busy: string;
  conflict: string;
  incoherentAttempt: string;
  leaseLost: string;
  collision: string;
  preCommit: string;
  cleanupPending: string;
  hashUnavailable: string;
}

export async function runStructureAppend<M extends AppendManifestLike>(
  params: { manifest: M; requestId: string; sourceHash: string; copy: AppendCopy },
  ports: StructureAppendPorts<M>,
): Promise<StructureAppendOutcome> {
  const { manifest, requestId, sourceHash, copy } = params;

  // 1. Identità del piano. Calcolata PRIMA del lease, dell'upload e di
  // qualunque scrittura: se non è calcolabile, non accade nulla.
  let manifestHash: string;
  try {
    manifestHash = await ports.hashCanonical(manifest.manifestCanonical);
  } catch (error) {
    return {
      status: 'not_applied',
      message: error instanceof Error ? error.message : copy.hashUnavailable,
      reason: 'hash_unavailable',
    };
  }

  // 2. Il record del tentativo deve descrivere **questo** piano. La sonda di
  // sorgente ha già escluso il replay e il cambio di file; qui si intercetta il
  // caso in cui una mutazione concorrente ha spostato numerazione o `order` fra
  // la prenotazione e il retry: il piano non è più quello prenotato.
  const attempt = await ports.probeAttempt({ manifest, requestId, manifestHash });
  if (attempt === 'committed') return { status: 'committed' };
  if (attempt === 'conflict') {
    return { status: 'not_applied', message: copy.conflict, reason: 'conflict' };
  }
  if (attempt === 'incoherent') {
    // Mai riparato e mai sovrascritto automaticamente: decide una persona.
    return {
      status: 'not_applied',
      message: copy.incoherentAttempt,
      reason: 'incoherent_attempt',
    };
  }

  // 3. Preflight — ancora zero scritture e zero upload. In un resume i file già
  // caricati da questo stesso tentativo non sono collisioni estranee: il record
  // ha dimostrato che portano questo `requestId`, questo `manifestHash` e
  // questa esatta lista di path. Qualunque altro path esistente blocca.
  const { collision } = await ports.preflight({
    manifest,
    ownedStoragePaths: attempt === 'resumable' ? manifest.storagePaths : [],
  });
  if (collision) {
    return { status: 'not_applied', message: copy.collision, reason: 'collision' };
  }

  // 4. Prime scritture: record del tentativo + lease.
  const lease = await ports.acquireLease({ manifest, requestId, manifestHash, sourceHash });
  if (lease === 'busy') {
    return { status: 'not_applied', message: copy.busy, reason: 'busy' };
  }

  const cleanupAndReturn = async (
    reason: AppendNotAppliedReason,
  ): Promise<StructureAppendOutcome> => {
    const outcome = await ports.cleanup({ manifest, requestId, manifestHash });
    if (outcome === 'pending') return { status: 'cleanup_pending', message: copy.cleanupPending };
    return { status: 'not_applied', message: copy.preCommit, reason };
  };

  try {
    // Ricaricare gli stessi path in un resume è deliberato e sicuro: il
    // contenuto è fissato dal manifest di cui il record porta l'hash, quindi la
    // scrittura è byte-identica a ciò che è già lì.
    await ports.uploadStorage(ports.filesOf(manifest));
  } catch {
    return cleanupAndReturn('upload_failed');
  }

  // 5. Un upload lento non deve poter essere seguito da un commit su un lease
  // scaduto.
  const renewal = await ports.renewLease({ manifest, requestId, manifestHash });
  if (renewal === 'lost') return cleanupAndReturn('lease_lost');

  try {
    await ports.commit({ manifest, requestId, manifestHash });
  } catch {
    return cleanupAndReturn('commit_failed');
  }

  // Committato: tutto è visibile insieme. Da qui nulla può più declassare
  // l'esito a errore.
  return { status: 'committed' };
}
