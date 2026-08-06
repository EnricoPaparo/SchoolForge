import { planUdaMetadataAppend, parseUdaStructureInput } from '../structureImport/index.js';
import { runStructureAppend } from './structureAppendProtocol.js';
import { canonicalizeSource } from './structureSourceCanonical.js';
import type { AttemptClassification, SourceProbe } from './attemptState.js';
import type {
  ExistingUdaForPlan,
  NormalizedUdaMetadata,
  StructureImportBytes,
  StructureImportError,
  UdaStructureImportManifest,
} from '../structureImport/index.js';

/**
 * STRUCTURE-IMPORT-02A — orchestrator of the metadata-only UDA append
 * (structure-metadata-import-roadmap.md §6, §7.1, §8).
 *
 * It owns the ordering, the idempotency decisions and the cleanup decisions;
 * every side effect is a single injected port, so the whole protocol is
 * testable without Firestore, Storage or a browser. It contains no Firebase
 * import of its own.
 *
 * Fixed order, fail-closed at every step:
 *
 *   validate (byte-first) → load destination → plan → SHA-256 → replay probe
 *   → collision preflight → lease → upload → commit
 *
 * Nothing is written until the whole preflight is green. Any failure before the
 * commit runs a cleanup limited to this attempt's own manifest, and the
 * existing course is left exactly as it was.
 *
 * **No staging phase, by construction.** A UDA document *is* its own visibility
 * marker: there is no invisible document to write ahead of time, so the only
 * pre-commit Firestore writes are the lease and the attempt record, and every
 * `UdaDoc` is created inside the single commit transaction. That is what makes
 * all the new UDAs appear together or not at all.
 *
 * Firestore and Storage do not share a transaction. This is mitigated — not
 * solved — by uploading only manifest files and cleaning up exactly those on
 * failure: an uploaded file whose commit never happened is an orphan inside the
 * attempt's own paths, never a modification of existing content. No distributed
 * rollback is claimed.
 */

/** Destination state, read once at the start of an attempt. */
export interface UdaStructureImportContext {
  ownerUid: string;
  activeImportId: string;
  /** Every UDA already in the active import — for numbering, order and collisions. */
  existingUdas: ExistingUdaForPlan[];
}

export interface UdaStructureImportCollision {
  kind: 'uda' | 'storage';
  /** Technical id or path — for logs and tests, never rendered verbatim in the UI. */
  id: string;
}

export interface UdaStructureImportDeps {
  /** Reads program + active import + existing UDAs. `null` when there is no active import. */
  loadContext(programId: string): Promise<UdaStructureImportContext | null>;
  /** `hex(SHA-256(UTF8(manifestCanonical)))`. Throws — fail-closed — when unavailable. */
  /** `hex(SHA-256(UTF8(canonical)))` — usato sia per la sorgente sia per il piano. */
  hashCanonical(canonical: string): Promise<string>;
  /**
   * Sonda **di sorgente**, prima del planner: riconosce un replay anche quando
   * il commit precedente ha già modificato la destinazione.
   */
  probeSourceAttempt(params: {
    programId: string;
    activeImportId: string;
    requestId: string;
    sourceHash: string;
  }): Promise<SourceProbe>;
  /**
   * Classifies the attempt record for `requestId` against the current plan
   * (see `classifyAttempt`): `'none'`, `'committed'`, `'conflict'`,
   * `'resumable'` or `'incoherent'`. Zero writes.
   */
  probeAttempt(params: {
    programId: string;
    activeImportId: string;
    requestId: string;
    manifestHash: string;
    manifest: UdaStructureImportManifest;
  }): Promise<AttemptClassification>;
  /**
   * Authoritative collision preflight over UDA ids AND Storage paths. Zero
   * writes. `ownedStoragePaths` are the paths a **resumable** attempt already
   * proved to be its own: they are not foreign collisions. Any other existing
   * path still blocks, and a UDA document always blocks.
   */
  preflight(params: {
    programId: string;
    context: UdaStructureImportContext;
    manifest: UdaStructureImportManifest;
    ownedStoragePaths: readonly string[];
  }): Promise<{ collision: UdaStructureImportCollision | null }>;
  /** Reserve the append: attempt record + single per-import lease. */
  acquireLease(params: {
    programId: string;
    activeImportId: string;
    requestId: string;
    manifestHash: string;
    sourceHash: string;
    manifest: UdaStructureImportManifest;
  }): Promise<'acquired' | 'busy'>;
  /** Upload exactly the manifest files through the same-origin gateway, concurrency ≤ 3. */
  uploadStorage(files: Array<{ path: string; content: string }>): Promise<void>;
  /**
   * Conditionally extends this attempt's lease right before the commit, so a
   * slow upload cannot be followed by a commit on an expired lease. Returns
   * `'renewed'` only when the lease is still ours and still carries this
   * manifest hash; `'lost'` otherwise — and a lost lease aborts the attempt.
   */
  renewLease(params: {
    programId: string;
    activeImportId: string;
    requestId: string;
    manifestHash: string;
  }): Promise<'renewed' | 'lost'>;
  /**
   * Single commit transaction: re-verifies `activeImportId`, lease ownership and
   * the absence of every target id, then creates all `UdaDoc`s, updates the
   * import counters, writes the audit event and releases the lease.
   */
  commit(params: {
    programId: string;
    sourceHash: string;
    manifest: UdaStructureImportManifest;
    requestId: string;
    manifestHash: string;
  }): Promise<void>;
  /**
   * Pre-commit cleanup, allowed **only** when the persisted record proves the
   * target belongs to this exact attempt (see `mayCleanupAttempt`). A replaced
   * or committed attempt is left completely untouched.
   */
  cleanup(params: {
    programId: string;
    activeImportId: string;
    sourceHash: string;
    manifest: UdaStructureImportManifest;
    requestId: string;
    manifestHash: string;
  }): Promise<'done' | 'pending'>;
}

export interface UdaStructureImportInput {
  programId: string;
  /**
   * The uid the client believes it is acting as. **Not authoritative**: it is
   * only compared, fail-closed, with the owner read from the program document.
   * Storage paths, the audit actor and the whole manifest are always built from
   * the authoritative value.
   */
  ownerUid: string;
  /** Stable per operation and preserved across retries — half of the attempt identity. */
  requestId: string;
  /** Original file bytes. Never text: encoding is validated, not assumed. */
  bytes: StructureImportBytes;
  filename?: string;
}

export type UdaStructureImportNotAppliedReason =
  | 'no_active_import'
  | 'owner_mismatch'
  | 'incoherent_attempt'
  | 'lease_lost'
  | 'hash_unavailable'
  | 'collision'
  | 'busy'
  | 'conflict'
  | 'upload_failed'
  | 'commit_failed';

export type UdaStructureImportResult =
  | {
      /**
       * Replay riconosciuto dopo un commit la cui risposta si era persa. Gli id
       * e il conteggio vengono dal record persistito, non da un piano
       * ricostruito sulla destinazione ormai modificata: per questo la vista
       * locale va ricaricata invece di essere aggiornata a mano.
       */
      status: 'committed_replay';
      udaIds: string[];
      udaCount: number;
      requiresReload: true;
    }
  | {
      status: 'committed';
      udaIds: string[];
      udaCount: number;
      titles: string[];
      /**
       * The manifest that landed. The UI appends these documents to the local
       * tree instead of refetching the whole course — they are exactly what the
       * commit wrote.
       */
      manifest: UdaStructureImportManifest;
    }
  | { status: 'validation_failed'; error: StructureImportError }
  | { status: 'not_applied'; message: string; reason: UdaStructureImportNotAppliedReason }
  | { status: 'cleanup_pending'; message: string };

const COPY = {
  noActiveImport: 'Il corso non ha un import attivo. Apri o inizializza il corso e riprova.',
  busy: "Un'altra importazione è in corso su questo corso. Attendi il completamento e riprova.",
  conflict:
    'Esiste già un tentativo di importazione con contenuti diversi. Ricarica la pagina e riprova.',
  ownerMismatch:
    'Questo corso non risulta più tuo in questa sessione. Ricarica la pagina e riprova.',
  incoherentAttempt:
    'Un tentativo precedente su questo corso è rimasto in uno stato incoerente. Ricarica la pagina e riprova con una nuova importazione.',
  leaseLost:
    "L'importazione ha impiegato troppo tempo e la prenotazione è scaduta: nulla è stato applicato. Riprova.",
  collision:
    'Una delle UDA del file coincide con contenuti già presenti nel corso. Nessuna modifica è stata applicata: cambia i titoli nel file e riprova.',
  preCommit: 'Importazione non applicata: il corso è rimasto invariato. Puoi riprovare.',
  cleanupPending:
    'Importazione non applicata. Alcuni dati tecnici del tentativo devono ancora essere rimossi: riprova fra poco.',
  hashUnavailable: "Impossibile calcolare l'impronta dell'importazione.",
} as const;

/**
 * Validates a UDA metadata file and appends its entries to the course's active
 * import. Append-only: it never creates a course, never modifies, renames,
 * merges or overwrites an existing UDA, never creates lessons, content or
 * pools. One error voids the whole import.
 */
export async function importUdaStructure(
  input: UdaStructureImportInput,
  deps: UdaStructureImportDeps,
): Promise<UdaStructureImportResult> {
  // 1. Local, byte-first validation. Zero Firebase operations so far.
  const validation = parseUdaStructureInput(input.bytes, {
    ...(input.filename === undefined ? {} : { filename: input.filename }),
  });
  if (!validation.ok) return { status: 'validation_failed', error: validation.error };

  // 2. Authoritative read of the destination — this course's UDAs only.
  const context = await deps.loadContext(input.programId);
  if (!context) {
    return { status: 'not_applied', message: COPY.noActiveImport, reason: 'no_active_import' };
  }

  // The owner comes from the program document, never from the client. A
  // mismatch stops the attempt here: before the hash, the preflight, the lease,
  // any upload and any write.
  if (input.ownerUid !== context.ownerUid) {
    return { status: 'not_applied', message: COPY.ownerMismatch, reason: 'owner_mismatch' };
  }

  // 3. Identità della **sorgente**, calcolabile prima del planner: è ciò che
  // permette di riconoscere un replay quando il commit precedente ha già
  // scritto le UDA e il planner le vedrebbe come duplicati.
  let sourceHash: string;
  try {
    sourceHash = await deps.hashCanonical(
      canonicalizeSource({
        kind: 'uda',
        ownerUid: context.ownerUid,
        programId: input.programId,
        importId: context.activeImportId,
        udas: validation.value,
      }),
    );
  } catch (error) {
    return {
      status: 'not_applied',
      message: error instanceof Error ? error.message : COPY.hashUnavailable,
      reason: 'hash_unavailable',
    };
  }

  // 4. Sonda di sorgente: prima del planner, del preflight, del lease e di
  // qualunque scrittura.
  const source = await deps.probeSourceAttempt({
    programId: input.programId,
    activeImportId: context.activeImportId,
    requestId: input.requestId,
    sourceHash,
  });
  if (source.state === 'committed') {
    return {
      status: 'committed_replay',
      udaIds: source.documentIds,
      udaCount: source.documentIds.length,
      requiresReload: true,
    };
  }
  if (source.state === 'conflict') {
    return { status: 'not_applied', message: COPY.conflict, reason: 'conflict' };
  }
  if (source.state === 'incoherent') {
    return { status: 'not_applied', message: COPY.incoherentAttempt, reason: 'incoherent_attempt' };
  }

  // 5. Piano. I titoli già presenti nella destinazione sono ricontrollati
  // contro lo stato appena letto, non contro quello che il dialog mostrava.
  const plan = planUdaMetadataAppend({
    ownerUid: context.ownerUid,
    programId: input.programId,
    importId: context.activeImportId,
    udas: validation.value,
    existingUdas: context.existingUdas,
  });
  if (!plan.ok) return { status: 'validation_failed', error: plan.error };
  const manifest = plan.value;

  // 6–11. Identità del piano, verifica del tentativo, preflight, lease, upload,
  // rinnovo e commit: protocollo condiviso con l'import delle lezioni.
  const outcome = await runStructureAppend(
    { manifest, requestId: input.requestId, sourceHash, copy: COPY },
    {
      hashCanonical: (canonical) => deps.hashCanonical(canonical),
      probeAttempt: ({ requestId, manifestHash }) =>
        deps.probeAttempt({
          programId: input.programId,
          activeImportId: context.activeImportId,
          requestId,
          manifestHash,
          manifest,
        }),
      preflight: ({ ownedStoragePaths }) =>
        deps.preflight({ programId: input.programId, context, manifest, ownedStoragePaths }),
      acquireLease: ({ requestId, manifestHash, sourceHash: source }) =>
        deps.acquireLease({
          programId: input.programId,
          activeImportId: context.activeImportId,
          requestId,
          manifestHash,
          sourceHash: source,
          manifest,
        }),
      uploadStorage: (files) => deps.uploadStorage(files),
      renewLease: ({ requestId, manifestHash }) =>
        deps.renewLease({
          programId: input.programId,
          activeImportId: context.activeImportId,
          requestId,
          manifestHash,
        }),
      commit: ({ requestId, manifestHash }) =>
        deps.commit({ programId: input.programId, manifest, requestId, manifestHash, sourceHash }),
      cleanup: ({ requestId, manifestHash }) =>
        deps.cleanup({
          programId: input.programId,
          activeImportId: context.activeImportId,
          manifest,
          requestId,
          manifestHash,
          sourceHash,
        }),
      filesOf: (m) => m.udas.map((uda) => ({ path: uda.storagePath, content: uda.content })),
    },
  );

  if (outcome.status === 'committed') {
    return {
      status: 'committed',
      udaIds: manifest.udaIds,
      udaCount: manifest.udas.length,
      titles: manifest.udas.map((uda) => uda.metadata.titolo),
      manifest,
    };
  }
  return outcome;
}

/** Re-exported for the UI's summary rendering — no second parsing pass. */
export type { NormalizedUdaMetadata, UdaStructureImportManifest };
