import type { RawFile } from '../validation/types.js';
import { validateUdaArchive } from './validateUdaArchive.js';
import { buildUdaImportPayload, estimateUdaImportCost } from './buildUdaImportPayload.js';
import type {
  UdaArchiveError,
  UdaImportCostModel,
  UdaImportManifest,
  UdaImportPayload,
} from './types.js';

/** Active import context, read once at the start of an attempt. */
export interface UdaImportContext {
  ownerUid: string;
  activeImportId: string;
  existingUdaOrders: number[];
}

export interface UdaImportCollision {
  kind: 'uda' | 'lesson' | 'questionIndex' | 'publicLesson' | 'storage';
  id: string;
}

/**
 * Side-effecting ports for the "Importa UDA" protocol. The orchestrator owns
 * the ordering, idempotency and cleanup decisions; each port is a single,
 * mockable Firestore/Storage operation. A concrete Firestore+SGW implementation
 * is provided by `createFirestoreUdaImportDeps`.
 */
export interface UdaImportDeps {
  /** Reads program + active import; null when the program has no active import. */
  loadContext(programId: string): Promise<UdaImportContext | null>;
  /**
   * Idempotency probe: has THIS request/hash already committed its UDA?
   * `'committed'` → return success without redoing work; `'conflict'` → same
   * request id with a different hash (or a different attempt on the same UDA);
   * `'none'` → proceed.
   */
  findCommittedAttempt(params: {
    programId: string;
    activeImportId: string;
    manifest: UdaImportManifest;
    requestId: string;
  }): Promise<'committed' | 'conflict' | 'none'>;
  /** Authoritative collision preflight over Firestore ids AND Storage paths. Zero writes. */
  preflight(params: {
    programId: string;
    context: UdaImportContext;
    manifest: UdaImportManifest;
  }): Promise<{ collision: UdaImportCollision | null }>;
  /** Reserve the append: create attempt + single import lease. `'busy'` when a lease is held. */
  acquireLease(params: {
    programId: string;
    activeImportId: string;
    manifest: UdaImportManifest;
    requestId: string;
  }): Promise<'acquired' | 'busy'>;
  /** Upload the exact manifest files through SGW, bounded concurrency (≤3). */
  uploadStorage(files: Array<{ path: string; content: string }>): Promise<void>;
  /** Chunked (≤400) staging of lessons + questionIndex. No UdaDoc, no publicLessons. */
  stageDocs(params: { programId: string; payload: UdaImportPayload }): Promise<void>;
  /**
   * Final commit transaction: verifies lease/request/hash + activeImportId
   * unchanged + no collision, then creates UdaDoc + all publicLessons, updates
   * import/program metadata, writes audit and removes lease/attempt.
   */
  commit(params: {
    programId: string;
    payload: UdaImportPayload;
    requestId: string;
  }): Promise<void>;
  /** Idempotent pre-commit cleanup of ONLY this attempt's staged docs + files + lease. */
  cleanup(params: {
    programId: string;
    activeImportId: string;
    manifest: UdaImportManifest;
    requestId: string;
  }): Promise<'done' | 'pending'>;
}

export interface UdaImportInput {
  programId: string;
  ownerUid: string;
  /** Stable per operation, preserved across retries (idempotency). */
  requestId: string;
  files: RawFile[];
}

export type UdaImportResult =
  | {
      status: 'committed';
      udaId: string;
      udaTitle: string | null;
      lessonCount: number;
      poolCount: number;
      questionCount: number;
      cost: UdaImportCostModel;
      /** True when the commit landed but a best-effort post-commit refresh/cleanup did not. */
      cleanupPending: boolean;
    }
  | { status: 'validation_failed'; error: UdaArchiveError }
  | { status: 'not_applied'; message: string; reason: NotAppliedReason }
  | { status: 'cleanup_pending'; message: string };

export type NotAppliedReason =
  | 'no_active_import'
  | 'collision'
  | 'busy'
  | 'conflict'
  | 'upload_failed'
  | 'stage_failed'
  | 'commit_failed';

const COPY = {
  noActiveImport: 'Il corso non ha un import attivo. Apri o inizializza il corso e riprova.',
  busy: 'Importazione UDA in corso… Non chiudere questa finestra.',
  conflict:
    'Esiste già un tentativo di import per questa UDA con contenuti diversi. Ricarica e riprova.',
  collision: (id: string) =>
    `Esiste già un contenuto con ID o percorso "${id}". L'import non ha modificato il corso.`,
  preCommit: 'Import non applicato: il corso esistente è rimasto invariato.',
  cleanupPending:
    'Import non applicato. Alcuni dati tecnici del tentativo devono ancora essere rimossi. Riprova la pulizia.',
} as const;

/**
 * Orchestrates the staged append of one UDA to the active import
 * (uda-import-contract §8). Deterministic ordering: validate → build → probe
 * idempotency → preflight → reserve → upload → stage → commit. Any failure
 * BEFORE commit triggers idempotent cleanup limited to the attempt manifest and
 * leaves the existing course untouched; a failure AFTER commit is never
 * reported as a failed import.
 */
export async function importUda(
  input: UdaImportInput,
  deps: UdaImportDeps,
): Promise<UdaImportResult> {
  // 1–3. Local validation + pure payload (no writes).
  const validation = validateUdaArchive(input.files);
  if (!validation.ok) return { status: 'validation_failed', error: validation.error };

  const context = await deps.loadContext(input.programId);
  if (!context) {
    return { status: 'not_applied', message: COPY.noActiveImport, reason: 'no_active_import' };
  }

  const payload = buildUdaImportPayload({
    archive: validation.archive,
    files: input.files,
    ownerUid: input.ownerUid,
    programId: input.programId,
    activeImportId: context.activeImportId,
    existingUdaOrders: context.existingUdaOrders,
  });
  const cost = estimateUdaImportCost(payload);
  const success = (cleanupPending: boolean): UdaImportResult => ({
    status: 'committed',
    udaId: payload.uda.id,
    udaTitle: validation.archive.udaTitle,
    lessonCount: validation.archive.lessonCount,
    poolCount: validation.archive.poolCount,
    questionCount: validation.archive.questionCount,
    cost,
    cleanupPending,
  });

  // Idempotent replay: this exact request/hash already committed.
  const committedProbe = await deps.findCommittedAttempt({
    programId: input.programId,
    activeImportId: context.activeImportId,
    manifest: payload.manifest,
    requestId: input.requestId,
  });
  if (committedProbe === 'committed') return success(false);
  if (committedProbe === 'conflict') {
    return { status: 'not_applied', message: COPY.conflict, reason: 'conflict' };
  }

  // 4. Authoritative collision preflight — zero writes, zero uploads.
  const { collision } = await deps.preflight({
    programId: input.programId,
    context,
    manifest: payload.manifest,
  });
  if (collision) {
    return { status: 'not_applied', message: COPY.collision(collision.id), reason: 'collision' };
  }

  // 5. Reserve (attempt + lease). First point of writes.
  const lease = await deps.acquireLease({
    programId: input.programId,
    activeImportId: context.activeImportId,
    manifest: payload.manifest,
    requestId: input.requestId,
  });
  if (lease === 'busy') {
    return { status: 'not_applied', message: COPY.busy, reason: 'busy' };
  }

  // 6–8. Upload → stage → commit; any pre-commit failure cleans up the attempt.
  const cleanupAndReturn = async (reason: NotAppliedReason): Promise<UdaImportResult> => {
    const outcome = await deps.cleanup({
      programId: input.programId,
      activeImportId: context.activeImportId,
      manifest: payload.manifest,
      requestId: input.requestId,
    });
    if (outcome === 'pending') {
      return { status: 'cleanup_pending', message: COPY.cleanupPending };
    }
    return { status: 'not_applied', message: COPY.preCommit, reason };
  };

  try {
    await deps.uploadStorage(payload.storagePaths);
  } catch {
    return cleanupAndReturn('upload_failed');
  }

  try {
    await deps.stageDocs({ programId: input.programId, payload });
  } catch {
    return cleanupAndReturn('stage_failed');
  }

  try {
    await deps.commit({ programId: input.programId, payload, requestId: input.requestId });
  } catch {
    return cleanupAndReturn('commit_failed');
  }

  // Committed: success. Post-commit refresh/cleanup warnings are handled by the UI.
  return success(false);
}
