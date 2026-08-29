/**
 * MULTI-VISUAL-02 — callable owner-only della catena binaria dell'upload
 * (roadmap §9, §9.6–§9.9): accettazione/normalizzazione/staging e
 * abbandono/cleanup del proprio run. **Nessuna promozione**: un
 * `VisualUploadRun` in stato `ready` resta staged finché MULTI-VISUAL-03 non
 * implementa la promozione condivisa (§8.6/§9.8), fuori da questo scope.
 *
 * Zero provider, zero budget IA, zero secret: l'upload non chiama mai
 * OpenAI (roadmap §9.5). Riusa `requireOwner`/`readAuthoritativeLesson` di
 * VE (`aiVisualIdentity.ts`) — nessuna seconda implementazione
 * dell'autenticazione o della rilettura autorevole di identità.
 */

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { CallableRequest, FunctionsErrorCode } from 'firebase-functions/v2/https';
import { timestampToMillis } from './aiContentCore.js';
import { AiVisualError, sha256Hex } from './aiVisualCore.js';
import { computeSourceBodyHash } from './aiVisualCandidate.js';
import { readAuthoritativeLesson, requireOwner } from './aiVisualIdentity.js';
import { resolveVisualAnchorForWrite } from './aiVisualMultiAnchor.js';
import { normalizeVisualUploadBytes } from './aiVisualUploadNormalizer.js';
import type { NormalizedVisual } from './aiVisualNormalizer.js';
import { AiVisualMultiError } from './aiVisualMultiCore.js';
import type { VisualAnchorSelector } from './aiVisualMultiAnchor.js';
import {
  VISUAL_UPLOAD_CONTRACT_VERSION,
  computeOpaqueVisualUploadRunId,
  validateVisualUploadAbandonInput,
  validateVisualUploadAcceptInput,
  visualUploadStagingRef,
  type VisualUploadAcceptInput,
  type VisualUploadRun,
} from './aiVisualUploadCore.js';
import { parseStoredVisualUploadRun, serializeVisualUploadRun } from './aiVisualUploadRunDoc.js';
import { VISUAL_STAGING_TTL_MS } from './aiContentVisualProposal.js';
import { SCHOOLFORGE_FUNCTION_REGION } from './deploymentRegion.js';
import { isStorageNotFound, type BucketLike, type FileLike } from './repositoryGatewayCore.js';
import { cleanupPreparedVisualUploadPromotion } from './aiVisualUploadPromotionGateway.js';

const VISUAL_UPLOAD_CALLABLE_OPTIONS = {
  region: SCHOOLFORGE_FUNCTION_REGION,
  invoker: 'public' as const,
};

const VISUAL_UPLOAD_RUNS = 'visualUploadRuns';

function database(): Firestore {
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}

// ─── Autenticazione ─────────────────────────────────────────────────────────

const OWNER_ERROR_MAP: Partial<Record<AiVisualError['code'], FunctionsErrorCode>> = {
  unauthenticated: 'unauthenticated',
  not_owner: 'permission-denied',
};

const MULTI_ERROR_MAP: Partial<Record<AiVisualMultiError['code'], FunctionsErrorCode>> = {
  invalid_input: 'invalid-argument',
  corrupted_state: 'data-loss',
  visuals_malformed: 'data-loss',
  visual_legacy_malformed: 'data-loss',
  visual_legacy_conflict: 'data-loss',
  provider_invalid_output: 'data-loss',
  visual_promotion_anchor_stale: 'failed-precondition',
  visual_upload_too_large: 'resource-exhausted',
  visual_upload_unsupported_format: 'invalid-argument',
  visual_upload_conflict: 'invalid-argument',
};

function toHttpsError(error: AiVisualError | AiVisualMultiError): HttpsError {
  if (error instanceof AiVisualMultiError) {
    return new HttpsError(MULTI_ERROR_MAP[error.code] ?? 'internal', error.message, {
      code: error.code,
    });
  }
  return new HttpsError(OWNER_ERROR_MAP[error.code] ?? 'internal', error.message, {
    code: error.code,
  });
}

// ─── Identità di replay/conflitto (roadmap §9.7) ───────────────────────────

interface UploadIdentityCandidate {
  ownerUid: string;
  programId: string;
  importId: string;
  lessonId: string;
  requestId: string;
  rawBytesSha256: string;
  anchor: VisualAnchorSelector;
  caption: string;
  altText: string;
}

/**
 * Stesso `requestId`+stessi byte grezzi+stessa ancora/editoriale/destinazione
 * ⇒ replay. `sourceBodyHash` **non** partecipa: protegge l'integrità
 * dell'ancora alla promozione (fuori scope qui), non l'identità del
 * tentativo — un retry con lo stesso `requestId` resta lo stesso tentativo
 * anche se la lezione è cambiata nel frattempo (quella verifica avviene alla
 * promozione, §7.2.1, MULTI-VISUAL-03).
 */
function sameUploadIdentity(
  existing: VisualUploadRun,
  candidate: UploadIdentityCandidate,
): boolean {
  return (
    existing.ownerUid === candidate.ownerUid &&
    existing.programId === candidate.programId &&
    existing.importId === candidate.importId &&
    existing.lessonId === candidate.lessonId &&
    existing.requestId === candidate.requestId &&
    existing.rawBytesSha256 === candidate.rawBytesSha256 &&
    existing.anchor.anchorHeadingIndex === candidate.anchor.anchorHeadingIndex &&
    existing.anchor.anchorHeadingText === candidate.anchor.anchorHeadingText &&
    existing.caption === candidate.caption &&
    existing.altText === candidate.altText
  );
}

type UploadDecision =
  | { kind: 'replay' }
  | { kind: 'resume' }
  | { kind: 'create' }
  | { kind: 'conflict' };

/**
 * Un `requestId` non torna mai disponibile dopo uno stato terminale o il TTL:
 * riutilizzarlo significherebbe riusare anche lo stesso path di staging mentre
 * un cleanup precedente può essere ancora in volo. Stessa identità ⇒ replay
 * dello stato raggiunto; identità diversa ⇒ conflitto, per sempre.
 */
function decideUploadOutcome(
  existing: VisualUploadRun | null,
  candidate: UploadIdentityCandidate,
): UploadDecision {
  if (!existing) return { kind: 'create' };
  if (!sameUploadIdentity(existing, candidate)) return { kind: 'conflict' };
  if (existing.status === 'accepted') return { kind: 'resume' };
  return { kind: 'replay' };
}

function readExistingOrThrow(data: unknown): VisualUploadRun | null {
  const existing = parseStoredVisualUploadRun(data);
  if (data !== undefined && existing === null) {
    // La snapshot esisteva (altrimenti `data` sarebbe `undefined`) ma il
    // parser l'ha rifiutata: `corrupted_state`, mai trattato come assenza.
    throw new AiVisualMultiError('corrupted_state', 'Il run di upload non è leggibile.');
  }
  return existing;
}

// ─── Accettazione (roadmap §9.2, §9.6, §9.7) ───────────────────────────────

export interface VisualUploadAcceptResult {
  requestId: string;
  status: VisualUploadRun['status'];
  replayed: boolean;
  lastError: VisualUploadRun['lastError'];
}

function acceptResult(run: VisualUploadRun, replayed: boolean): VisualUploadAcceptResult {
  return { requestId: run.requestId, status: run.status, replayed, lastError: run.lastError };
}

function isStoragePreconditionFailed(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 412;
}

const STAGING_PROOF_RUN_KEY = 'schoolforgeUploadRunId';
const STAGING_PROOF_RAW_HASH_KEY = 'schoolforgeRawBytesSha256';

type MetadataFile = FileLike & {
  getMetadata(): Promise<unknown>;
};

/**
 * Elimina uno staging soltanto quando i metadati server-only dimostrano che
 * l'oggetto e' stato creato da questo preciso run. La delete e' inoltre
 * vincolata alla generation letta: un oggetto sostituito fra lettura e delete
 * non viene mai toccato. Serve anche per il crash `save -> finalizzazione`,
 * quando il run e' ancora `accepted` e `normalized` non e' stato persistito.
 */
async function deleteProvenUploadStaging(params: {
  bucket: BucketLike;
  storageRef: string;
  opaqueUploadRunId: string;
  rawBytesSha256: string;
}): Promise<boolean> {
  const file = params.bucket.file(params.storageRef) as MetadataFile;
  if (typeof file.getMetadata !== 'function') return false;
  let metadata: Record<string, unknown>;
  try {
    const response = await file.getMetadata();
    const candidate = Array.isArray(response) ? response[0] : null;
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      return false;
    }
    metadata = candidate as Record<string, unknown>;
  } catch (error) {
    if (isStorageNotFound(error)) return false;
    throw error;
  }
  const custom = metadata.metadata;
  if (
    typeof custom !== 'object' ||
    custom === null ||
    Array.isArray(custom) ||
    (custom as Record<string, unknown>)[STAGING_PROOF_RUN_KEY] !== params.opaqueUploadRunId ||
    (custom as Record<string, unknown>)[STAGING_PROOF_RAW_HASH_KEY] !== params.rawBytesSha256
  ) {
    return false;
  }
  const generation = metadata.generation;
  if (
    (typeof generation !== 'string' && typeof generation !== 'number') ||
    String(generation).length === 0
  ) {
    return false;
  }
  try {
    await file.delete({ preconditionOpts: { ifGenerationMatch: generation } });
    return true;
  } catch (error) {
    if (isStorageNotFound(error) || isStoragePreconditionFailed(error)) return false;
    throw error;
  }
}

async function markUploadFailed(params: {
  db: Firestore;
  runRef: DocumentReference;
  candidate: UploadIdentityCandidate;
  code: NonNullable<VisualUploadRun['lastError']>;
  nowMs: number;
}): Promise<void> {
  await params.db.runTransaction(async (tx) => {
    const snap = await tx.get(params.runRef);
    const existing = readExistingOrThrow(snap.exists ? snap.data() : undefined);
    if (!existing || !sameUploadIdentity(existing, params.candidate)) return;
    if (existing.status !== 'accepted') return;
    tx.update(params.runRef, {
      status: 'failed',
      lastError: params.code,
      updatedAt: Timestamp.fromMillis(params.nowMs),
    });
  });
}

export async function acceptVisualUploadForOwner(params: {
  db: Firestore;
  bucket: BucketLike;
  ownerUid: string;
  input: VisualUploadAcceptInput;
  nowMs: number;
  normalizeBytes?: (bytes: Buffer) => Promise<NormalizedVisual>;
  /** Punto di iniezione riservato ai test di crash dopo lo staging. */
  afterStagingWrite?: () => Promise<void>;
}): Promise<VisualUploadAcceptResult> {
  const { db, bucket, ownerUid, input, nowMs } = params;

  // Identità della lezione riletta server-side (mai dal client, §9.6).
  const lesson = await readAuthoritativeLesson(db, {
    ownerUid,
    programId: input.programId,
    importId: input.importId,
    lessonId: input.lessonId,
  });
  // L'ancora deve esistere sul corpo autorevole prima che nasca la reservation:
  // un selettore stale non crea run, non invoca Sharp e non tocca Storage.
  resolveVisualAnchorForWrite(input.anchor, lesson.body);

  const rawBytesSha256 = sha256Hex(input.rawBytes);
  const sourceBodyHash = computeSourceBodyHash(lesson.body);
  const opaqueUploadRunId = computeOpaqueVisualUploadRunId(ownerUid, input.requestId);
  const runRef = db.doc(`${VISUAL_UPLOAD_RUNS}/${opaqueUploadRunId}`);
  const candidate: UploadIdentityCandidate = {
    ownerUid,
    programId: input.programId,
    importId: input.importId,
    lessonId: input.lessonId,
    requestId: input.requestId,
    rawBytesSha256,
    anchor: input.anchor,
    caption: input.caption,
    altText: input.altText,
  };

  // Reservation transazionale PRIMA di Sharp/Storage. Concorrenti divergenti
  // falliscono senza CPU né I/O Storage. Un retry identico su `accepted` può
  // riprendere dopo un crash: più resume possono normalizzare, ma il save
  // create-only e la verifica byte-per-byte su 412 fanno convergere tutti su
  // un solo staging, senza mai riscriverlo o cancellare il winner.
  const reservation = await db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    const existing = readExistingOrThrow(snap.exists ? snap.data() : undefined);
    const decision = decideUploadOutcome(existing, candidate);
    if (decision.kind === 'conflict') {
      throw new AiVisualMultiError(
        'visual_upload_conflict',
        'La richiesta è già stata usata con un file, un’ancora o dati editoriali diversi.',
      );
    }
    if (
      existing &&
      existing.status !== 'promoted' &&
      existing.status !== 'abandoned' &&
      existing.status !== 'expired' &&
      timestampToMillis(existing.expireAt)! <= nowMs
    ) {
      const expired: VisualUploadRun = {
        ...existing,
        status: 'expired',
        lastError: null,
        updatedAt: Timestamp.fromMillis(nowMs),
      };
      tx.set(runRef, serializeVisualUploadRun(expired));
      return {
        kind: 'expired' as const,
        run: expired,
        shouldDelete: existing.status === 'ready',
      };
    }
    if (decision.kind === 'replay') return { kind: 'replay' as const, run: existing! };
    if (decision.kind === 'resume') return { kind: 'resume' as const, run: existing! };
    const run: VisualUploadRun = {
      contractVersion: VISUAL_UPLOAD_CONTRACT_VERSION,
      ownerUid,
      programId: input.programId,
      importId: input.importId,
      lessonId: input.lessonId,
      publicLessonId: lesson.publicLessonId,
      udaDir: lesson.udaDir,
      requestId: input.requestId,
      status: 'accepted',
      sourceBodyHash,
      anchor: input.anchor,
      rawBytesSha256,
      rawByteLength: input.rawBytes.length,
      normalized: null,
      caption: input.caption,
      altText: input.altText,
      lastError: null,
      createdAt: Timestamp.fromMillis(nowMs),
      updatedAt: Timestamp.fromMillis(nowMs),
      expireAt: Timestamp.fromMillis(nowMs + VISUAL_STAGING_TTL_MS),
    };
    tx.set(runRef, serializeVisualUploadRun(run));
    return { kind: 'created' as const, run };
  });
  if (reservation.kind === 'expired') {
    if (reservation.shouldDelete) {
      try {
        await bucket.file(visualUploadStagingRef(ownerUid, opaqueUploadRunId)).delete();
      } catch (error) {
        if (!isStorageNotFound(error)) throw error;
      }
    }
    return acceptResult(reservation.run, true);
  }
  if (reservation.kind === 'replay') return acceptResult(reservation.run, true);
  const resumedReservation = reservation.kind === 'resume';

  let normalized: NormalizedVisual;
  try {
    normalized = await (params.normalizeBytes ?? normalizeVisualUploadBytes)(input.rawBytes);
  } catch (error) {
    if (error instanceof AiVisualMultiError) {
      const code =
        error.code === 'visual_upload_too_large'
          ? 'visual_upload_too_large'
          : 'visual_upload_unsupported_format';
      await markUploadFailed({ db, runRef, candidate, code, nowMs });
    }
    throw error;
  }
  const stagingRef = visualUploadStagingRef(ownerUid, opaqueUploadRunId);
  let createdStaging = false;
  try {
    await bucket.file(stagingRef).save(normalized.bytes, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: 'image/webp',
        cacheControl: 'private,no-store',
        metadata: {
          sha256: normalized.sha256,
          [STAGING_PROOF_RUN_KEY]: opaqueUploadRunId,
          [STAGING_PROOF_RAW_HASH_KEY]: rawBytesSha256,
        },
      },
    });
    createdStaging = true;
  } catch (error) {
    if (isStoragePreconditionFailed(error)) {
      let stagedBytes: Uint8Array;
      try {
        [stagedBytes] = await bucket.file(stagingRef).download();
      } catch {
        await markUploadFailed({ db, runRef, candidate, code: 'visual_upload_conflict', nowMs });
        throw new AiVisualMultiError(
          'visual_upload_conflict',
          'Lo staging di questo tentativo è occupato ma non verificabile.',
        );
      }
      if (!Buffer.from(stagedBytes).equals(normalized.bytes)) {
        await markUploadFailed({ db, runRef, candidate, code: 'visual_upload_conflict', nowMs });
        throw new AiVisualMultiError(
          'visual_upload_conflict',
          'Lo staging di questo tentativo contiene byte diversi.',
        );
      }
      // Un concorrente identico ha già creato esattamente gli stessi byte:
      // nessuna riscrittura e, soprattutto, nessuna delete del winner.
      createdStaging = false;
    } else {
      throw error;
    }
  }

  await params.afterStagingWrite?.();

  const finalization = await db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    const existing = readExistingOrThrow(snap.exists ? snap.data() : undefined);
    if (!existing || !sameUploadIdentity(existing, candidate)) {
      throw new AiVisualMultiError(
        'visual_upload_conflict',
        'Il run di upload è cambiato durante la normalizzazione.',
      );
    }
    if (existing.status === 'ready') {
      const persisted = existing.normalized;
      if (
        persisted?.storageRef !== stagingRef ||
        persisted.width !== normalized.width ||
        persisted.height !== normalized.height ||
        persisted.byteLength !== normalized.byteLength ||
        persisted.sha256 !== normalized.sha256
      ) {
        throw new AiVisualMultiError(
          'visual_upload_conflict',
          'Il run pronto non coincide con i byte normalizzati del tentativo.',
        );
      }
      return { kind: 'replay' as const, run: existing };
    }
    if (existing.status !== 'accepted') {
      return { kind: 'terminal_conflict' as const, run: existing };
    }
    const run: VisualUploadRun = {
      ...existing,
      status: 'ready',
      normalized: {
        storageRef: stagingRef,
        width: normalized.width,
        height: normalized.height,
        byteLength: normalized.byteLength,
        sha256: normalized.sha256,
      },
      updatedAt: Timestamp.fromMillis(nowMs),
    };
    tx.set(runRef, serializeVisualUploadRun(run));
    return { kind: 'ready' as const, run };
  });
  if (finalization.kind === 'terminal_conflict') {
    if (createdStaging) {
      await deleteProvenUploadStaging({
        bucket,
        storageRef: stagingRef,
        opaqueUploadRunId,
        rawBytesSha256,
      });
    }
    throw new AiVisualMultiError(
      'visual_upload_conflict',
      `Il run di upload è già nello stato terminale ${finalization.run.status}.`,
    );
  }
  // Nessuna delete generica: su 412 i byte appartengono a un altro
  // concorrente identico, mentre su un errore ambiguo il commit potrebbe
  // essere riuscito. Solo il ramo terminale sopra dimostra che i byte
  // creati da questa invocazione non possono essere il winner.
  return acceptResult(finalization.run, resumedReservation || finalization.kind === 'replay');
}

async function handleAcceptVisualUpload(request: CallableRequest<unknown>): Promise<unknown> {
  const db = database();
  try {
    const ownerUid = await requireOwner(request, db);
    const input = validateVisualUploadAcceptInput(request.data);
    return await acceptVisualUploadForOwner({
      db,
      bucket: getStorage().bucket() as unknown as BucketLike,
      ownerUid,
      input,
      nowMs: Date.now(),
    });
  } catch (error) {
    if (error instanceof AiVisualMultiError || error instanceof AiVisualError) {
      throw toHttpsError(error);
    }
    logger.error('aiVisualUploadAccept internal error', { name: (error as Error)?.name });
    throw new HttpsError('internal', "Errore interno dell'upload visuale.");
  }
}

/**
 * Owner-only, nessun secret binding, nessun provider: accetta byte base64,
 * normalizza (Sharp) e mette in staging. Vedi roadmap §9.2, §9.6.
 */
export const aiVisualUploadAccept = onCall(
  VISUAL_UPLOAD_CALLABLE_OPTIONS,
  handleAcceptVisualUpload,
);

// ─── Abbandono (roadmap §9.9) ──────────────────────────────────────────────

export interface VisualUploadAbandonResult {
  status: 'abandoned' | 'already_abandoned';
}

export async function abandonVisualUploadForOwner(params: {
  db: Firestore;
  bucket: BucketLike;
  ownerUid: string;
  requestId: string;
  nowMs: number;
  afterAbandonCommit?: () => Promise<void>;
}): Promise<VisualUploadAbandonResult> {
  const opaqueUploadRunId = computeOpaqueVisualUploadRunId(params.ownerUid, params.requestId);
  const runRef = params.db.doc(`${VISUAL_UPLOAD_RUNS}/${opaqueUploadRunId}`);

  const outcome = await params.db.runTransaction(
    async (
      tx,
    ): Promise<{
      status: 'abandoned' | 'already_abandoned';
      rawBytesSha256: string;
    }> => {
      const snap = await tx.get(runRef);
      if (!snap.exists) {
        throw new AiVisualMultiError('invalid_input', 'Il run di upload non esiste.');
      }
      const existing = parseStoredVisualUploadRun(snap.data());
      if (!existing || existing.ownerUid !== params.ownerUid) {
        throw new AiVisualMultiError('corrupted_state', 'Il run di upload non è leggibile.');
      }
      if (existing.status === 'promoted') {
        throw new AiVisualMultiError(
          'invalid_input',
          'Un upload già promosso non può essere abbandonato.',
        );
      }
      if (existing.status === 'expired') {
        throw new AiVisualMultiError(
          'invalid_input',
          'Un upload scaduto non può essere abbandonato.',
        );
      }
      if (existing.status === 'abandoned') {
        return { status: 'already_abandoned', rawBytesSha256: existing.rawBytesSha256 };
      }
      const expireMs = timestampToMillis(existing.expireAt);
      if (expireMs === null || expireMs <= params.nowMs) {
        // Non scrivere `abandoned` con updatedAt oltre expireAt: sarebbe un
        // documento fuori contratto. La porta TTL puntuale effettua la
        // transizione autorevole a `expired` e il relativo cleanup.
        throw new AiVisualMultiError(
          'invalid_input',
          'Il run di upload ha raggiunto la scadenza e deve essere ripulito.',
        );
      }
      tx.update(runRef, {
        status: 'abandoned',
        lastError: null,
        updatedAt: Timestamp.fromMillis(params.nowMs),
      });
      return { status: 'abandoned', rawBytesSha256: existing.rawBytesSha256 };
    },
  );

  // Punto di iniezione test-only: dimostra la finestra crash fra il commit
  // terminale e i delete Storage/recovery. Il replay TTL deve chiuderla.
  await params.afterAbandonCommit?.();

  // Elimina lo staging **dopo** il commit — stesso percorso indipendentemente
  // dallo stato osservato; tollerato assente (già ripulito da un tentativo
  // precedente, §9.9: «non richiede la stessa conferma esplicita bloccante»).
  await deleteProvenUploadStaging({
    bucket: params.bucket,
    storageRef: visualUploadStagingRef(params.ownerUid, opaqueUploadRunId),
    opaqueUploadRunId,
    rawBytesSha256: outcome.rawBytesSha256,
  });
  await cleanupPreparedVisualUploadPromotion({
    db: params.db,
    bucket: params.bucket,
    ownerUid: params.ownerUid,
    requestId: params.requestId,
  });

  return { status: outcome.status };
}

async function handleAbandonVisualUpload(request: CallableRequest<unknown>): Promise<unknown> {
  const db = database();
  try {
    const ownerUid = await requireOwner(request, db);
    const input = validateVisualUploadAbandonInput(request.data);
    return await abandonVisualUploadForOwner({
      db,
      bucket: getStorage().bucket() as unknown as BucketLike,
      ownerUid,
      requestId: input.requestId,
      nowMs: Date.now(),
    });
  } catch (error) {
    if (error instanceof AiVisualMultiError || error instanceof AiVisualError) {
      throw toHttpsError(error);
    }
    logger.error('aiVisualUploadAbandon internal error', { name: (error as Error)?.name });
    throw new HttpsError('internal', "Errore interno dell'abbandono upload.");
  }
}

export const aiVisualUploadAbandon = onCall(
  VISUAL_UPLOAD_CALLABLE_OPTIONS,
  handleAbandonVisualUpload,
);

// ─── Cleanup TTL puntuale (wiring differito a MULTI-VISUAL-03) ─────────────

/**
 * Porta puntuale e testabile: nessuna query periodica, nessun costo passivo e
 * nessun indice nuovo. MULTI-VISUAL-03 potrà collegarla alla policy TTL/trigger
 * prevista dal contratto quando `index_change` sarà nello scope. L'identità è
 * derivata da owner+requestId e il delete usa soltanto quel path esatto.
 */
export async function cleanupExpiredVisualUploadRun(params: {
  db: Firestore;
  bucket: BucketLike;
  ownerUid: string;
  requestId: string;
  nowMs: number;
}): Promise<{ status: 'absent' | 'not_due' | 'terminal' | 'expired' }> {
  const opaqueUploadRunId = computeOpaqueVisualUploadRunId(params.ownerUid, params.requestId);
  const runRef = params.db.doc(`${VISUAL_UPLOAD_RUNS}/${opaqueUploadRunId}`);
  const decision = await params.db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    if (!snap.exists) return { status: 'absent' as const, rawBytesSha256: null };
    const existing = parseStoredVisualUploadRun(snap.data());
    if (
      !existing ||
      existing.ownerUid !== params.ownerUid ||
      existing.requestId !== params.requestId
    ) {
      throw new AiVisualMultiError('corrupted_state', 'Il run di upload non è leggibile.');
    }
    if (existing.status === 'expired') {
      // Il record terminale resta persistito proprio per rendere il requestId
      // non riusabile. Se il primo delete e' fallito, un replay del cleanup
      // deve poter ritentare il solo path dimostrato dal normalized del run.
      return { status: 'terminal' as const, rawBytesSha256: existing.rawBytesSha256 };
    }
    if (existing.status === 'promoted') {
      return { status: 'terminal' as const, rawBytesSha256: null };
    }
    if (existing.status === 'abandoned') {
      // Un crash può avvenire dopo il commit `abandoned` ma prima dei delete
      // Storage/recovery. Il replay deve quindi ritentare entrambi usando la
      // stessa prova raw del run; `promoted`, invece, non va mai ripulito qui.
      return { status: 'terminal' as const, rawBytesSha256: existing.rawBytesSha256 };
    }
    const expireMs = timestampToMillis(existing.expireAt);
    if (expireMs === null || expireMs > params.nowMs) {
      return { status: 'not_due' as const, rawBytesSha256: null };
    }
    tx.update(runRef, {
      status: 'expired',
      lastError: null,
      updatedAt: Timestamp.fromMillis(params.nowMs),
    });
    return { status: 'expired' as const, rawBytesSha256: existing.rawBytesSha256 };
  });
  if (decision.rawBytesSha256 !== null) {
    await deleteProvenUploadStaging({
      bucket: params.bucket,
      storageRef: visualUploadStagingRef(params.ownerUid, opaqueUploadRunId),
      opaqueUploadRunId,
      rawBytesSha256: decision.rawBytesSha256,
    });
    await cleanupPreparedVisualUploadPromotion({
      db: params.db,
      bucket: params.bucket,
      ownerUid: params.ownerUid,
      requestId: params.requestId,
    });
  }
  return { status: decision.status };
}
