import { planUdaMetadataAppend, validateUdaMetadataFile } from '../structureImport/index.js';
import type { AttemptClassification } from './attemptState.js';
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
  hashManifest(manifestCanonical: string): Promise<string>;
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
  const validation = validateUdaMetadataFile(input.bytes, {
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

  // Titles already in the destination are re-checked here against the freshly
  // read state, not against whatever the dialog showed a minute ago.
  const plan = planUdaMetadataAppend({
    ownerUid: context.ownerUid,
    programId: input.programId,
    importId: context.activeImportId,
    udas: validation.value,
    existingUdas: context.existingUdas,
  });
  if (!plan.ok) return { status: 'validation_failed', error: plan.error };
  const manifest = plan.value;

  // 3. Authoritative identity. Computed BEFORE the lease, the upload and any
  // write: if it cannot be computed, nothing happens at all.
  let manifestHash: string;
  try {
    manifestHash = await deps.hashManifest(manifest.manifestCanonical);
  } catch (error) {
    return {
      status: 'not_applied',
      message:
        error instanceof Error
          ? error.message
          : "Impossibile calcolare l'impronta dell'importazione.",
      reason: 'hash_unavailable',
    };
  }

  const success = (): UdaStructureImportResult => ({
    status: 'committed',
    udaIds: manifest.udaIds,
    udaCount: manifest.udas.length,
    titles: manifest.udas.map((uda) => uda.metadata.titolo),
    manifest,
  });

  // 4. Attempt state machine. A retry of the same request with the same plan is
  // a replay or a resume; anything else fails closed.
  const attempt = await deps.probeAttempt({
    programId: input.programId,
    activeImportId: context.activeImportId,
    requestId: input.requestId,
    manifestHash,
    manifest,
  });
  if (attempt === 'committed') return success();
  if (attempt === 'conflict') {
    return { status: 'not_applied', message: COPY.conflict, reason: 'conflict' };
  }
  if (attempt === 'incoherent') {
    // Never repaired and never overwritten automatically: a human decides.
    return {
      status: 'not_applied',
      message: COPY.incoherentAttempt,
      reason: 'incoherent_attempt',
    };
  }

  // 5. Collision preflight — still zero writes and zero uploads.
  //
  // On a resume, the files this same attempt already uploaded are not foreign
  // collisions: the attempt record proved they carry this exact `requestId`,
  // this exact `manifestHash` and this exact path list. Any other existing path
  // still blocks, and an existing UDA document always blocks.
  const { collision } = await deps.preflight({
    programId: input.programId,
    context,
    manifest,
    ownedStoragePaths: attempt === 'resumable' ? manifest.storagePaths : [],
  });
  if (collision) {
    return { status: 'not_applied', message: COPY.collision, reason: 'collision' };
  }

  // 6. First writes: attempt record + lease.
  const lease = await deps.acquireLease({
    programId: input.programId,
    activeImportId: context.activeImportId,
    requestId: input.requestId,
    manifestHash,
    manifest,
  });
  if (lease === 'busy') {
    return { status: 'not_applied', message: COPY.busy, reason: 'busy' };
  }

  const cleanupAndReturn = async (
    reason: UdaStructureImportNotAppliedReason,
  ): Promise<UdaStructureImportResult> => {
    const outcome = await deps.cleanup({
      programId: input.programId,
      activeImportId: context.activeImportId,
      manifest,
      requestId: input.requestId,
      manifestHash,
    });
    if (outcome === 'pending') return { status: 'cleanup_pending', message: COPY.cleanupPending };
    return { status: 'not_applied', message: COPY.preCommit, reason };
  };

  try {
    // Re-uploading the same paths on a resume is deliberate and safe: the
    // content is fixed by the manifest whose hash the attempt record carries,
    // so the write is byte-identical to what is already there. This is the
    // single recovery strategy — no conditional delete, no second preflight.
    await deps.uploadStorage(
      manifest.udas.map((uda) => ({ path: uda.storagePath, content: uda.content })),
    );
  } catch {
    return cleanupAndReturn('upload_failed');
  }

  // A slow upload must not be followed by a commit on an expired lease.
  const renewal = await deps.renewLease({
    programId: input.programId,
    activeImportId: context.activeImportId,
    requestId: input.requestId,
    manifestHash,
  });
  if (renewal === 'lost') {
    return cleanupAndReturn('lease_lost');
  }

  try {
    await deps.commit({
      programId: input.programId,
      manifest,
      requestId: input.requestId,
      manifestHash,
    });
  } catch {
    return cleanupAndReturn('commit_failed');
  }

  // Committed: every new UDA is visible together. Nothing after this point may
  // downgrade the result to a failure — a post-commit refresh problem is the
  // UI's business, not the import's.
  return success();
}

/** Re-exported for the UI's summary rendering — no second parsing pass. */
export type { NormalizedUdaMetadata, UdaStructureImportManifest };
