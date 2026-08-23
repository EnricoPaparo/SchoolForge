import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { AI_CONTENT_RUN_TTL_MS } from './aiContentCore.js';
import {
  AI_VISUAL_CONTRACT_VERSION,
  AI_VISUAL_SERVER_CONFIG,
  computeVisualBudgetReservationKey,
  computeVisualInputHash,
  computeVisualRunId,
  estimateVisualCost,
  toVisualDataUri,
  visualStagingRef,
  type AiVisualRequest,
} from './aiVisualCore.js';
import { generateVisual } from './aiVisualEngine.js';
import { createVisualPorts, cleanupDeletedVisualRun } from './aiVisualGateway.js';
import { normalizeVisualWebp } from './aiVisualNormalizer.js';
import {
  parseVisualRunDocument,
  serializeVisualRun,
  type StoredAiVisualRun,
} from './aiVisualRunDoc.js';

const OWNER = 'emulator-owner';
const NOW = Date.UTC(2026, 7, 23, 10);
const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

function requestFor(requestId: string): AiVisualRequest {
  return {
    requestId,
    subject: 'Schema essenziale del ciclo dell’acqua con evaporazione e condensazione.',
  };
}

function reservedRun(request: AiVisualRequest, executionId: string): StoredAiVisualRun {
  const runId = computeVisualRunId(OWNER, request.requestId);
  const cost = estimateVisualCost(request.subject, 'mock');
  return {
    contractVersion: AI_VISUAL_CONTRACT_VERSION,
    status: 'reserved',
    inputHash: computeVisualInputHash(request),
    config: AI_VISUAL_SERVER_CONFIG,
    leaseExecutionId: executionId,
    leaseExpiresAtMs: NOW + 300_000,
    budget: {
      monthKey: '2026-08',
      reservationKey: computeVisualBudgetReservationKey(OWNER, request.requestId),
      estimatedInputTokens: cost.estimatedInputTokens,
      reservedInputTokens: cost.reservedInputTokens,
      expectedOutputTokens: cost.expectedOutputTokens,
      estimatedCostMicroUsd: cost.estimatedCostMicroUsd,
      reservedCostMicroUsd: cost.reservationCostMicroUsd,
      actualInputTokens: null,
      actualOutputTokens: null,
      actualCostMicroUsd: null,
      settledCostMicroUsd: null,
    },
    image: null,
    stagingRef: visualStagingRef(OWNER, runId),
    createdAtMs: NOW,
    updatedAtMs: NOW,
    expireAtMs: NOW + AI_CONTENT_RUN_TTL_MS,
  };
}

async function completedRun(request: AiVisualRequest): Promise<StoredAiVisualRun> {
  const source = await sharp({
    create: {
      width: 96,
      height: 64,
      channels: 3,
      background: { r: 238, g: 248, b: 249 },
    },
  })
    .webp({ quality: 88 })
    .toBuffer();
  const normalized = await normalizeVisualWebp(source);
  const run = reservedRun(request, 'completed-execution');
  return {
    ...run,
    status: 'completed',
    budget: {
      ...run.budget,
      actualInputTokens: 0,
      actualOutputTokens: 0,
      actualCostMicroUsd: 0,
      settledCostMicroUsd: 0,
    },
    image: {
      dataUri: toVisualDataUri(normalized.bytes),
      width: normalized.width,
      height: normalized.height,
      byteLength: normalized.byteLength,
      sha256: normalized.sha256,
      mimeType: 'image/webp',
      styleVersion: AI_VISUAL_SERVER_CONFIG.styleVersion,
      webpQuality: normalized.webpQuality,
      normalizationAttempts: normalized.normalizationAttempts,
    },
  };
}

emulatorDescribe('visualRuns — round-trip Firestore Emulator reale', () => {
  let app: App;
  let db: Firestore;
  const touchedRefs: FirebaseFirestore.DocumentReference[] = [];

  beforeAll(() => {
    app = initializeApp(
      { projectId: process.env.GCLOUD_PROJECT ?? 'demo-schoolforge' },
      `ai-visual-roundtrip-${randomUUID()}`,
    );
    db = getFirestore(app);
  });

  afterEach(async () => {
    await Promise.all(touchedRefs.splice(0).map((ref) => ref.delete()));
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  function runRef(request: AiVisualRequest): FirebaseFirestore.DocumentReference {
    const ref = db.doc(`visualRuns/${computeVisualRunId(OWNER, request.requestId)}`);
    touchedRefs.push(ref);
    return ref;
  }

  it('serializes, writes, reads, parses and advances reserved to pending', async () => {
    const request = requestFor('11111111-2222-4333-8444-555555555551');
    const run = reservedRun(request, 'pending-execution');
    const ref = runRef(request);
    await ref.set(serializeVisualRun(run));

    const persisted = await ref.get();
    expect(parseVisualRunDocument(persisted.data(), ref.id)).toEqual(run);

    const ports = createVisualPorts(db, 'mock', null);
    await expect(
      ports.markProviderPending({
        opaqueRunId: ref.id,
        executionId: run.leaseExecutionId,
        nowMs: NOW,
      }),
    ).resolves.toBe(true);
    expect(parseVisualRunDocument((await ref.get()).data(), ref.id)).toMatchObject({
      status: 'pending',
    });
  });

  it('replays completed inline bytes after the database round-trip without side effects', async () => {
    const request = requestFor('11111111-2222-4333-8444-555555555552');
    const run = await completedRun(request);
    const ref = runRef(request);
    await ref.set(serializeVisualRun(run));
    const persisted = parseVisualRunDocument((await ref.get()).data(), ref.id);
    expect(persisted?.status).toBe('completed');

    const runtimePorts = createVisualPorts(db, 'mock', null);
    const ports = {
      ...runtimePorts,
      callProvider: vi.fn(runtimePorts.callProvider),
      normalize: vi.fn(runtimePorts.normalize),
      uploadStaging: vi.fn(runtimePorts.uploadStaging),
      finalizeRun: vi.fn(runtimePorts.finalizeRun),
    };
    const result = await generateVisual(
      request,
      {
        authenticatedOwnerUid: OWNER,
        mode: 'mock',
        executionId: 'replay-execution',
        nowMs: NOW,
      },
      ports,
    );
    expect(result).toMatchObject({ replayed: true, dataUri: run.image?.dataUri });
    expect(ports.callProvider).not.toHaveBeenCalled();
    expect(ports.normalize).not.toHaveBeenCalled();
    expect(ports.uploadStaging).not.toHaveBeenCalled();
    expect(ports.finalizeRun).not.toHaveBeenCalled();
  });

  it('cleans the exact validated staging object after the completed run round-trip', async () => {
    const request = requestFor('11111111-2222-4333-8444-555555555553');
    const run = await completedRun(request);
    const ref = runRef(request);
    await ref.set(serializeVisualRun(run));
    const persisted = await ref.get();
    const deleteObject = vi.fn(async () => undefined);

    await expect(
      cleanupDeletedVisualRun({
        opaqueRunId: ref.id,
        data: persisted.data(),
        deleteObject,
      }),
    ).resolves.toBe('deleted');
    expect(deleteObject).toHaveBeenCalledOnce();
    expect(deleteObject).toHaveBeenCalledWith(run.stagingRef);
  });
});
