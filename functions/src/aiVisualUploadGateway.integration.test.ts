import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { AiVisualMultiError } from './aiVisualMultiCore.js';
import {
  computeOpaqueVisualUploadRunId,
  validateVisualUploadAcceptInput,
  visualUploadStagingRef,
} from './aiVisualUploadCore.js';
import { parseStoredVisualUploadRun } from './aiVisualUploadRunDoc.js';
import { normalizeVisualUploadBytes } from './aiVisualUploadNormalizer.js';
import { validateVisualUploadPromoteInput } from './aiVisualUploadPromotion.js';
import { promoteVisualUploadForOwner } from './aiVisualUploadPromotionGateway.js';
import type { BucketLike, FileLike } from './repositoryGatewayCore.js';

const { acceptVisualUploadForOwner, abandonVisualUploadForOwner, cleanupExpiredVisualUploadRun } =
  await import('./aiVisualUploadGateway.js');

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

const OWNER_UID = 'emulator-upload-owner';
const PROGRAM_ID = 'program-1';
const IMPORT_ID = 'import-1';
const LESSON_ID = 'lesson-1';
const PUBLIC_LESSON_ID = 'public-lesson-1';
const UDA_DIR = 'uda-1';
const LESSON_PATH_FIELD = 'uda-1/lezione-1.md';
const LESSON_FILENAME = 'lezione-1.md';
const LESSON_BODY = '## Introduzione\n\nTesto introduttivo.\n\n## Reti\n\nContenuto sulle reti.';

function createFakeBucket(): {
  bucket: BucketLike;
  files: Map<string, Buffer>;
  saveCalls: string[];
  deleteCalls: string[];
  downloadCalls: string[];
} {
  const files = new Map<string, Buffer>();
  const metadataByPath = new Map<
    string,
    { generation: string; metadata: Record<string, unknown> }
  >();
  let nextGeneration = 1;
  const saveCalls: string[] = [];
  const deleteCalls: string[] = [];
  const downloadCalls: string[] = [];
  const bucket: BucketLike = {
    file(path: string): FileLike {
      return {
        async save(data: Uint8Array, options?: unknown) {
          saveCalls.push(path);
          const precondition = options as
            | { preconditionOpts?: { ifGenerationMatch?: number } }
            | undefined;
          if (precondition?.preconditionOpts?.ifGenerationMatch === 0 && files.has(path)) {
            throw Object.assign(new Error('precondition failed'), { code: 412 });
          }
          files.set(path, Buffer.from(data));
          const saveMetadata = options as
            | { metadata?: { metadata?: Record<string, unknown> } }
            | undefined;
          metadataByPath.set(path, {
            generation: String(nextGeneration++),
            metadata: { ...(saveMetadata?.metadata?.metadata ?? {}) },
          });
        },
        async delete(options?: unknown) {
          deleteCalls.push(path);
          if (!files.has(path)) {
            const err = new Error('not found') as Error & { code: number };
            err.code = 404;
            throw err;
          }
          const generationMatch = (
            options as { preconditionOpts?: { ifGenerationMatch?: string | number } } | undefined
          )?.preconditionOpts?.ifGenerationMatch;
          const metadata = metadataByPath.get(path);
          if (generationMatch !== undefined && String(generationMatch) !== metadata?.generation) {
            throw Object.assign(new Error('precondition failed'), { code: 412 });
          }
          files.delete(path);
          metadataByPath.delete(path);
        },
        async getMetadata(): Promise<[Record<string, unknown>]> {
          const metadata = metadataByPath.get(path);
          if (!files.has(path) || !metadata) {
            const err = new Error('not found') as Error & { code: number };
            err.code = 404;
            throw err;
          }
          return [{ generation: metadata.generation, metadata: metadata.metadata }];
        },
        async download(): Promise<[Uint8Array]> {
          downloadCalls.push(path);
          const data = files.get(path);
          if (!data) {
            const err = new Error('not found') as Error & { code: number };
            err.code = 404;
            throw err;
          }
          return [data];
        },
      };
    },
    async deleteFiles() {
      /* non usato in questo scope */
    },
  };
  return { bucket, files, saveCalls, deleteCalls, downloadCalls };
}

async function pngUploadBase64(width = 40, height = 30, alpha = 255): Promise<string> {
  const bytes = await sharp({
    create: { width, height, channels: 4, background: { r: 1, g: 2, b: 3, alpha } },
  })
    .png()
    .toBuffer();
  return bytes.toString('base64');
}

emulatorDescribe('VisualUploadRun — Firestore Emulator reale', () => {
  let app: App;
  let db: Firestore;
  const touchedRefs: FirebaseFirestore.DocumentReference[] = [];

  beforeAll(async () => {
    app = initializeApp(
      { projectId: process.env.GCLOUD_PROJECT ?? 'demo-schoolforge' },
      `ai-visual-upload-${randomUUID()}`,
    );
    db = getFirestore(app);
  });

  afterEach(async () => {
    await Promise.all(touchedRefs.splice(0).map((ref) => ref.delete().catch(() => undefined)));
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  async function seedLesson(): Promise<void> {
    const lessonRef = db.doc(`programs/${PROGRAM_ID}/imports/${IMPORT_ID}/lessons/${LESSON_ID}`);
    const publicRef = db.doc(`publicLessons/${PUBLIC_LESSON_ID}`);
    await lessonRef.set({
      ownerUid: OWNER_UID,
      importId: IMPORT_ID,
      udaDir: UDA_DIR,
      path: LESSON_PATH_FIELD,
      filename: LESSON_FILENAME,
      publicLessonId: PUBLIC_LESSON_ID,
      completed: false,
    });
    await publicRef.set({
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      udaDir: UDA_DIR,
      path: LESSON_PATH_FIELD,
      filename: LESSON_FILENAME,
      content: LESSON_BODY,
      completed: false,
    });
    touchedRefs.push(lessonRef, publicRef);
  }

  function acceptInputPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      requestId: randomUUID(),
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      lessonId: LESSON_ID,
      base64: '',
      anchor: { anchorHeadingIndex: 0, anchorHeadingText: 'Introduzione' },
      caption: 'Didascalia di prova.',
      altText: 'Testo alternativo di prova.',
      ...over,
    };
  }

  function runRef(requestId: string): FirebaseFirestore.DocumentReference {
    const id = computeOpaqueVisualUploadRunId(OWNER_UID, requestId);
    return db.doc(`visualUploadRuns/${id}`);
  }

  function uploadRefs(requestId: string): {
    run: FirebaseFirestore.DocumentReference;
    promotion: FirebaseFirestore.DocumentReference;
    recovery: FirebaseFirestore.DocumentReference;
  } {
    const opaque = computeOpaqueVisualUploadRunId(OWNER_UID, requestId);
    return {
      run: db.doc(`visualUploadRuns/${opaque}`),
      promotion: db.doc(`visualUploadPromotions/${opaque}`),
      recovery: db.doc(`visualUploadPromotionRecoveries/${opaque}`),
    };
  }

  async function acceptAndPromote(params: {
    bucket: BucketLike;
    nowMs: number;
    mode?: { mode: 'add' } | { mode: 'replace'; replaceAssetId: string };
    afterPromotionReads?: () => Promise<void>;
  }): Promise<{ requestId: string; assetId: string }> {
    const requestId = randomUUID();
    const refs = uploadRefs(requestId);
    touchedRefs.push(refs.run, refs.promotion, refs.recovery);
    await acceptVisualUploadForOwner({
      db,
      bucket: params.bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadAcceptInput(
        acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
      ),
      nowMs: params.nowMs,
    });
    const result = await promoteVisualUploadForOwner({
      db,
      bucket: params.bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadPromoteInput({
        requestId,
        promotionRequestId: randomUUID(),
        mode: params.mode ?? { mode: 'add' },
      }),
      nowMs: params.nowMs + 1,
      afterPromotionReads: params.afterPromotionReads,
    });
    return { requestId, assetId: result.assetId };
  }

  it('crea un run al primo accept: normalizza una sola volta, scrive lo staging atteso', async () => {
    await seedLesson();
    const base64 = await pngUploadBase64();
    const requestId = randomUUID();
    const input = validateVisualUploadAcceptInput(acceptInputPayload({ requestId, base64 }));
    const { bucket, saveCalls } = createFakeBucket();
    touchedRefs.push(runRef(requestId));

    const result = await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input,
      nowMs: Date.UTC(2026, 7, 25),
    });

    expect(result).toMatchObject({ status: 'ready', replayed: false, lastError: null });
    expect(saveCalls).toHaveLength(1);
    const opaqueUploadRunId = computeOpaqueVisualUploadRunId(OWNER_UID, requestId);
    expect(saveCalls[0]).toBe(visualUploadStagingRef(OWNER_UID, opaqueUploadRunId));

    const snap = await runRef(requestId).get();
    expect(snap.exists).toBe(true);
    const data = snap.data()!;
    expect(data.status).toBe('ready');
    expect(data.publicLessonId).toBe(PUBLIC_LESSON_ID);
    expect(data.udaDir).toBe(UDA_DIR);
    expect(data.normalized).toBeTruthy();
  });

  it('promuove atomicamente add e il replay non ricopia i byte', async () => {
    await seedLesson();
    const requestId = randomUUID();
    const promotionRequestId = randomUUID();
    const accepted = validateVisualUploadAcceptInput(
      acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
    );
    const { bucket, files, saveCalls } = createFakeBucket();
    const opaque = computeOpaqueVisualUploadRunId(OWNER_UID, requestId);
    const promotionRef = db.doc(`visualUploadPromotions/${opaque}`);
    const recoveryRef = db.doc(`visualUploadPromotionRecoveries/${opaque}`);
    const publicBytesRef = db.doc(`publicLessonVisuals/${PUBLIC_LESSON_ID}`);
    touchedRefs.push(runRef(requestId), promotionRef, recoveryRef, publicBytesRef);
    await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: accepted,
      nowMs: Date.UTC(2026, 7, 25),
    });
    const input = validateVisualUploadPromoteInput({
      requestId,
      promotionRequestId,
      mode: { mode: 'add' },
    });
    const first = await promoteVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input,
      nowMs: Date.UTC(2026, 7, 25, 0, 1),
    });
    expect(first.replayed).toBe(false);
    expect((await runRef(requestId).get()).data()?.status).toBe('promoted');
    const lesson = (
      await db.doc(`programs/${PROGRAM_ID}/imports/${IMPORT_ID}/lessons/${LESSON_ID}`).get()
    ).data()!;
    expect(lesson.visuals.items[0]).toMatchObject({
      assetId: first.assetId,
      source: 'uploaded',
      styleVersion: 'uploaded/v1',
    });
    expect(lesson).not.toHaveProperty('visual');
    expect((await db.doc(`publicLessons/${PUBLIC_LESSON_ID}`).get()).data()).not.toHaveProperty(
      'visuals',
    );
    expect((await publicBytesRef.get()).exists).toBe(false);
    expect(files.has(visualUploadStagingRef(OWNER_UID, opaque))).toBe(false);
    const writesAfterFirst = saveCalls.length;
    await expect(
      promoteVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input,
        nowMs: Date.UTC(2026, 7, 25, 0, 2),
      }),
    ).resolves.toEqual({ replayed: true, assetId: first.assetId });
    expect(saveCalls).toHaveLength(writesAfterFirst);
  });

  it('risposta persa: stesso requestId, stessi byte, stessa ancora/editoriale ⇒ replay senza seconda normalizzazione', async () => {
    await seedLesson();
    const base64 = await pngUploadBase64();
    const requestId = randomUUID();
    const payload = acceptInputPayload({ requestId, base64 });
    touchedRefs.push(runRef(requestId));

    const { bucket, saveCalls } = createFakeBucket();
    const first = await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadAcceptInput(payload),
      nowMs: Date.UTC(2026, 7, 25),
    });
    expect(first).toMatchObject({ status: 'ready', replayed: false });
    expect(saveCalls).toHaveLength(1);

    const second = await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadAcceptInput(payload),
      nowMs: Date.UTC(2026, 7, 25, 1),
    });
    expect(second).toMatchObject({ status: 'ready', replayed: true, lastError: null });
    // Nessuna seconda normalizzazione: il bucket non ha ricevuto una seconda
    // `.save()` (la pre-lettura ha riconosciuto il replay prima di Sharp).
    expect(saveCalls).toHaveLength(1);
  });

  it('crash dopo reservation: il retry riprende accepted e completa senza riusare il requestId', async () => {
    await seedLesson();
    const requestId = randomUUID();
    touchedRefs.push(runRef(requestId));
    const input = validateVisualUploadAcceptInput(
      acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
    );
    const { bucket, saveCalls } = createFakeBucket();

    await expect(
      acceptVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input,
        nowMs: Date.UTC(2026, 7, 25),
        normalizeBytes: async () => {
          throw new Error('crash simulato dopo la reservation');
        },
      }),
    ).rejects.toThrow('crash simulato');
    expect(parseStoredVisualUploadRun((await runRef(requestId).get()).data())?.status).toBe(
      'accepted',
    );
    expect(saveCalls).toHaveLength(0);

    const resumed = await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input,
      nowMs: Date.UTC(2026, 7, 25, 1),
    });
    expect(resumed).toMatchObject({ status: 'ready', replayed: true, lastError: null });
    expect(saveCalls).toHaveLength(1);
    expect(parseStoredVisualUploadRun((await runRef(requestId).get()).data())?.status).toBe(
      'ready',
    );
  });

  it('crash dopo save e prima di ready: il cleanup TTL prova ownership e rimuove lo staging senza retry', async () => {
    await seedLesson();
    const requestId = randomUUID();
    touchedRefs.push(runRef(requestId));
    const input = validateVisualUploadAcceptInput(
      acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
    );
    const { bucket, files, deleteCalls } = createFakeBucket();
    const createdAtMs = Date.UTC(2026, 7, 20);
    const stagingRef = visualUploadStagingRef(
      OWNER_UID,
      computeOpaqueVisualUploadRunId(OWNER_UID, requestId),
    );

    await expect(
      acceptVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input,
        nowMs: createdAtMs,
        afterStagingWrite: async () => {
          throw new Error('crash simulato dopo save');
        },
      }),
    ).rejects.toThrow('crash simulato dopo save');
    expect(files.has(stagingRef)).toBe(true);
    expect(parseStoredVisualUploadRun((await runRef(requestId).get()).data())?.status).toBe(
      'accepted',
    );

    const result = await cleanupExpiredVisualUploadRun({
      db,
      bucket,
      ownerUid: OWNER_UID,
      requestId,
      nowMs: createdAtMs + 24 * 60 * 60 * 1000 + 1,
    });
    expect(result.status).toBe('expired');
    expect(files.has(stagingRef)).toBe(false);
    expect(deleteCalls).toEqual([stagingRef]);
  });

  it('race identica: due resume accepted convergono via 412 sugli stessi byte senza delete del winner', async () => {
    await seedLesson();
    const requestId = randomUUID();
    touchedRefs.push(runRef(requestId));
    const input = validateVisualUploadAcceptInput(
      acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
    );
    const { bucket, saveCalls, deleteCalls, downloadCalls } = createFakeBucket();
    let release!: () => void;
    let firstEntered!: () => void;
    let bothEntered!: () => void;
    const firstEnteredPromise = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });
    const bothEnteredPromise = new Promise<void>((resolve) => {
      bothEntered = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    let normalizeCalls = 0;
    const normalizeAtBarrier = async (bytes: Buffer) => {
      normalizeCalls += 1;
      if (normalizeCalls === 1) firstEntered();
      if (normalizeCalls === 2) bothEntered();
      await releasePromise;
      return normalizeVisualUploadBytes(bytes);
    };
    const firstPromise = acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input,
      nowMs: Date.UTC(2026, 7, 25),
      normalizeBytes: normalizeAtBarrier,
    });
    await firstEnteredPromise;

    const secondPromise = acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input,
      nowMs: Date.UTC(2026, 7, 25),
      normalizeBytes: normalizeAtBarrier,
    });
    await bothEnteredPromise;
    release();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first.status).toBe('ready');
    expect(second).toMatchObject({ status: 'ready', replayed: true });
    expect(normalizeCalls).toBe(2);
    expect(saveCalls).toHaveLength(2);
    expect(downloadCalls).toHaveLength(1);
    expect(deleteCalls).toHaveLength(0);
    expect(new Set(saveCalls).size).toBe(1);
  });

  it('race divergente: il perdente fallisce prima di Sharp/Storage e non sovrascrive il winner', async () => {
    await seedLesson();
    const requestId = randomUUID();
    touchedRefs.push(runRef(requestId));
    const firstInput = validateVisualUploadAcceptInput(
      acceptInputPayload({ requestId, base64: await pngUploadBase64(40, 30) }),
    );
    const secondInput = validateVisualUploadAcceptInput(
      acceptInputPayload({ requestId, base64: await pngUploadBase64(50, 50) }),
    );
    const { bucket, saveCalls, files } = createFakeBucket();
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstPromise = acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: firstInput,
      nowMs: Date.UTC(2026, 7, 25),
      normalizeBytes: async (bytes) => {
        entered();
        await releasePromise;
        return normalizeVisualUploadBytes(bytes);
      },
    });
    await enteredPromise;
    await expect(
      acceptVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input: secondInput,
        nowMs: Date.UTC(2026, 7, 25),
        normalizeBytes: async () => {
          throw new Error('il concorrente divergente non deve normalizzare');
        },
      }),
    ).rejects.toMatchObject({ code: 'visual_upload_conflict' });
    expect(saveCalls).toHaveLength(0);

    release();
    await firstPromise;
    expect(saveCalls).toHaveLength(1);
    const run = parseStoredVisualUploadRun((await runRef(requestId).get()).data());
    expect(run?.status).toBe('ready');
    expect(files.get(run!.normalized!.storageRef)?.length).toBe(run!.normalized!.byteLength);
  });

  it('abandon durante accepted non cancella un oggetto di cui il run non ha ancora provato ownership', async () => {
    await seedLesson();
    const requestId = randomUUID();
    touchedRefs.push(runRef(requestId));
    const opaqueUploadRunId = computeOpaqueVisualUploadRunId(OWNER_UID, requestId);
    const stagingRef = visualUploadStagingRef(OWNER_UID, opaqueUploadRunId);
    const input = validateVisualUploadAcceptInput(
      acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
    );
    const { bucket, files, deleteCalls } = createFakeBucket();
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const producer = acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input,
      nowMs: Date.UTC(2026, 7, 25),
      normalizeBytes: async (bytes) => {
        entered();
        await releasePromise;
        return normalizeVisualUploadBytes(bytes);
      },
    });
    await enteredPromise;
    const foreignBytes = Buffer.from('byte-estranei-iniettati-dopo-la-reservation');
    files.set(stagingRef, foreignBytes);

    await expect(
      abandonVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        requestId,
        nowMs: Date.UTC(2026, 7, 25, 1),
      }),
    ).resolves.toEqual({ status: 'abandoned' });
    expect(deleteCalls).toHaveLength(0);
    expect(files.get(stagingRef)).toEqual(foreignBytes);

    release();
    await expect(producer).rejects.toMatchObject({ code: 'visual_upload_conflict' });
    expect(deleteCalls).toHaveLength(0);
    expect(files.get(stagingRef)).toEqual(foreignBytes);
    expect(parseStoredVisualUploadRun((await runRef(requestId).get()).data())?.status).toBe(
      'abandoned',
    );
  });

  it('ancora stale: fallisce sul body autorevole prima di reservation, Sharp e Storage', async () => {
    await seedLesson();
    const requestId = randomUUID();
    touchedRefs.push(runRef(requestId));
    const { bucket, saveCalls } = createFakeBucket();
    let normalizeCalls = 0;
    await expect(
      acceptVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input: validateVisualUploadAcceptInput(
          acceptInputPayload({
            requestId,
            base64: await pngUploadBase64(),
            anchor: { anchorHeadingIndex: 0, anchorHeadingText: 'Heading diverso' },
          }),
        ),
        nowMs: Date.UTC(2026, 7, 25),
        normalizeBytes: async (bytes) => {
          normalizeCalls += 1;
          return normalizeVisualUploadBytes(bytes);
        },
      }),
    ).rejects.toMatchObject({ code: 'visual_promotion_anchor_stale' });
    expect(normalizeCalls).toBe(0);
    expect(saveCalls).toHaveLength(0);
    expect((await runRef(requestId).get()).exists).toBe(false);
  });

  it('conflitto: stesso requestId, byte grezzi diversi ⇒ visual_upload_conflict, zero scritture sopra il run esistente', async () => {
    await seedLesson();
    const requestId = randomUUID();
    touchedRefs.push(runRef(requestId));
    const { bucket } = createFakeBucket();

    await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadAcceptInput(
        acceptInputPayload({ requestId, base64: await pngUploadBase64(40, 30) }),
      ),
      nowMs: Date.UTC(2026, 7, 25),
    });
    const before = (await runRef(requestId).get()).data();

    let thrown: unknown;
    try {
      await acceptVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input: validateVisualUploadAcceptInput(
          acceptInputPayload({ requestId, base64: await pngUploadBase64(50, 50) }),
        ),
        nowMs: Date.UTC(2026, 7, 25, 1),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AiVisualMultiError);
    expect((thrown as AiVisualMultiError).code).toBe('visual_upload_conflict');

    const after = (await runRef(requestId).get()).data();
    expect(after).toEqual(before);
  });

  it('conflitto: stesso requestId, ancora diversa ⇒ visual_upload_conflict', async () => {
    await seedLesson();
    const requestId = randomUUID();
    touchedRefs.push(runRef(requestId));
    const { bucket } = createFakeBucket();
    const base64 = await pngUploadBase64();

    await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadAcceptInput(acceptInputPayload({ requestId, base64 })),
      nowMs: Date.UTC(2026, 7, 25),
    });

    await expect(
      acceptVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input: validateVisualUploadAcceptInput(
          acceptInputPayload({
            requestId,
            base64,
            anchor: { anchorHeadingIndex: 1, anchorHeadingText: 'Reti' },
          }),
        ),
        nowMs: Date.UTC(2026, 7, 25, 1),
      }),
    ).rejects.toMatchObject({ code: 'visual_upload_conflict' });
  });

  it('conflitto: stesso requestId, editoriale diverso (caption) ⇒ visual_upload_conflict', async () => {
    await seedLesson();
    const requestId = randomUUID();
    touchedRefs.push(runRef(requestId));
    const { bucket } = createFakeBucket();
    const base64 = await pngUploadBase64();

    await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadAcceptInput(acceptInputPayload({ requestId, base64 })),
      nowMs: Date.UTC(2026, 7, 25),
    });

    await expect(
      acceptVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input: validateVisualUploadAcceptInput(
          acceptInputPayload({ requestId, base64, caption: 'Didascalia completamente diversa.' }),
        ),
        nowMs: Date.UTC(2026, 7, 25, 1),
      }),
    ).rejects.toMatchObject({ code: 'visual_upload_conflict' });
  });

  it('conflitto: stesso requestId, destinazione diversa (altra lezione) ⇒ visual_upload_conflict', async () => {
    await seedLesson();
    const otherLessonId = 'lesson-2';
    const otherPublicLessonId = 'public-lesson-2';
    const otherLessonRef = db.doc(
      `programs/${PROGRAM_ID}/imports/${IMPORT_ID}/lessons/${otherLessonId}`,
    );
    const otherPublicRef = db.doc(`publicLessons/${otherPublicLessonId}`);
    await otherLessonRef.set({
      ownerUid: OWNER_UID,
      importId: IMPORT_ID,
      udaDir: UDA_DIR,
      path: 'uda-1/lezione-2.md',
      filename: 'lezione-2.md',
      publicLessonId: otherPublicLessonId,
      completed: false,
    });
    await otherPublicRef.set({
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      udaDir: UDA_DIR,
      path: 'uda-1/lezione-2.md',
      filename: 'lezione-2.md',
      content: LESSON_BODY,
      completed: false,
    });
    touchedRefs.push(otherLessonRef, otherPublicRef);

    const requestId = randomUUID();
    touchedRefs.push(runRef(requestId));
    const { bucket } = createFakeBucket();
    const base64 = await pngUploadBase64();

    await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadAcceptInput(
        acceptInputPayload({ requestId, base64, lessonId: LESSON_ID }),
      ),
      nowMs: Date.UTC(2026, 7, 25),
    });

    await expect(
      acceptVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input: validateVisualUploadAcceptInput(
          acceptInputPayload({ requestId, base64, lessonId: otherLessonId }),
        ),
        nowMs: Date.UTC(2026, 7, 25, 1),
      }),
    ).rejects.toMatchObject({ code: 'visual_upload_conflict' });
  });

  it('record presente ma malformato ⇒ corrupted_state, mai trattato come assenza', async () => {
    await seedLesson();
    const requestId = randomUUID();
    const ref = runRef(requestId);
    touchedRefs.push(ref);
    // Scrittura diretta di un record fuori contratto (chiave mancante).
    await ref.set({ contractVersion: 'visual-upload/v1', ownerUid: OWNER_UID });

    const { bucket } = createFakeBucket();
    await expect(
      acceptVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input: validateVisualUploadAcceptInput(
          acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
        ),
        nowMs: Date.UTC(2026, 7, 25),
      }),
    ).rejects.toMatchObject({ code: 'corrupted_state' });
  });

  it('fallimento deterministico: persiste failed e il retry espone lo stato senza rinormalizzare', async () => {
    await seedLesson();
    const requestId = randomUUID();
    touchedRefs.push(runRef(requestId));
    const input = validateVisualUploadAcceptInput(
      acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
    );
    const { bucket, saveCalls } = createFakeBucket();
    let normalizeCalls = 0;

    await expect(
      acceptVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input,
        nowMs: Date.UTC(2026, 7, 25),
        normalizeBytes: async () => {
          normalizeCalls += 1;
          throw new AiVisualMultiError(
            'visual_upload_unsupported_format',
            'Formato deterministically non supportato.',
          );
        },
      }),
    ).rejects.toMatchObject({ code: 'visual_upload_unsupported_format' });

    const failed = parseStoredVisualUploadRun((await runRef(requestId).get()).data());
    expect(failed).toMatchObject({
      status: 'failed',
      lastError: 'visual_upload_unsupported_format',
      normalized: null,
    });
    const replay = await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input,
      nowMs: Date.UTC(2026, 7, 25, 1),
      normalizeBytes: async () => {
        throw new Error('un failed terminale non deve essere rinormalizzato');
      },
    });
    expect(replay).toEqual({
      requestId,
      status: 'failed',
      replayed: true,
      lastError: 'visual_upload_unsupported_format',
    });
    expect(normalizeCalls).toBe(1);
    expect(saveCalls).toHaveLength(0);

    await expect(
      abandonVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        requestId,
        nowMs: Date.UTC(2026, 7, 25, 2),
      }),
    ).resolves.toEqual({ status: 'abandoned' });
    expect(parseStoredVisualUploadRun((await runRef(requestId).get()).data())).toMatchObject({
      status: 'abandoned',
      lastError: null,
      normalized: null,
    });
  });

  it('staging preesistente: ifGenerationMatch=0 conserva i byte estranei e rende il run failed', async () => {
    await seedLesson();
    const requestId = randomUUID();
    touchedRefs.push(runRef(requestId));
    const opaqueUploadRunId = computeOpaqueVisualUploadRunId(OWNER_UID, requestId);
    const stagingRef = visualUploadStagingRef(OWNER_UID, opaqueUploadRunId);
    const { bucket, files, saveCalls, deleteCalls } = createFakeBucket();
    const foreignBytes = Buffer.from('byte-preesistenti-da-non-sovrascrivere');
    files.set(stagingRef, foreignBytes);

    await expect(
      acceptVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input: validateVisualUploadAcceptInput(
          acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
        ),
        nowMs: Date.UTC(2026, 7, 25),
      }),
    ).rejects.toMatchObject({ code: 'visual_upload_conflict' });

    expect(saveCalls).toEqual([stagingRef]);
    expect(deleteCalls).toHaveLength(0);
    expect(files.get(stagingRef)).toEqual(foreignBytes);
    expect(parseStoredVisualUploadRun((await runRef(requestId).get()).data())).toMatchObject({
      status: 'failed',
      lastError: 'visual_upload_conflict',
      normalized: null,
    });

    const cleanup = await cleanupExpiredVisualUploadRun({
      db,
      bucket,
      ownerUid: OWNER_UID,
      requestId,
      nowMs: Date.UTC(2026, 7, 27),
    });
    expect(cleanup.status).toBe('expired');
    expect(deleteCalls).toHaveLength(0);
    expect(files.get(stagingRef)).toEqual(foreignBytes);
    expect(parseStoredVisualUploadRun((await runRef(requestId).get()).data())?.status).toBe(
      'expired',
    );
  });

  it('abbandono: elimina lo staging, marca abandoned; un secondo abbandono è già_abandoned senza errore', async () => {
    await seedLesson();
    const requestId = randomUUID();
    touchedRefs.push(runRef(requestId));
    const { bucket, deleteCalls, saveCalls } = createFakeBucket();
    const input = validateVisualUploadAcceptInput(
      acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
    );

    await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input,
      nowMs: Date.UTC(2026, 7, 25),
    });

    const first = await abandonVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      requestId,
      nowMs: Date.UTC(2026, 7, 25, 2),
    });
    expect(first.status).toBe('abandoned');
    expect(deleteCalls).toHaveLength(1);

    const snap = await runRef(requestId).get();
    expect(snap.data()!.status).toBe('abandoned');
    expect(parseStoredVisualUploadRun(snap.data())).not.toBeNull();

    const second = await abandonVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      requestId,
      nowMs: Date.UTC(2026, 7, 25, 3),
    });
    expect(second.status).toBe('already_abandoned');
    expect(parseStoredVisualUploadRun((await runRef(requestId).get()).data())).not.toBeNull();

    const replay = await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input,
      nowMs: Date.UTC(2026, 7, 25, 4),
      normalizeBytes: async () => {
        throw new Error('un abandoned terminale non deve essere rinormalizzato');
      },
    });
    expect(replay).toMatchObject({ status: 'abandoned', replayed: true, lastError: null });
    expect(saveCalls).toHaveLength(1);
  });

  it('abbandono di un run inesistente ⇒ invalid_input', async () => {
    const { bucket } = createFakeBucket();
    await expect(
      abandonVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        requestId: randomUUID(),
        nowMs: Date.UTC(2026, 7, 25),
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('abbandono oltre TTL non scrive uno stato fuori contratto; il cleanup lo porta a expired', async () => {
    await seedLesson();
    const requestId = randomUUID();
    touchedRefs.push(runRef(requestId));
    const { bucket } = createFakeBucket();
    const createdAtMs = Date.UTC(2026, 7, 20);
    await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadAcceptInput(
        acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
      ),
      nowMs: createdAtMs,
    });
    const afterTtlMs = createdAtMs + 24 * 60 * 60 * 1000 + 1;

    await expect(
      abandonVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        requestId,
        nowMs: afterTtlMs,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(parseStoredVisualUploadRun((await runRef(requestId).get()).data())?.status).toBe(
      'ready',
    );

    await cleanupExpiredVisualUploadRun({
      db,
      bucket,
      ownerUid: OWNER_UID,
      requestId,
      nowMs: afterTtlMs,
    });
    expect(parseStoredVisualUploadRun((await runRef(requestId).get()).data())?.status).toBe(
      'expired',
    );
  });

  it('cleanup TTL: un run scaduto e mai promosso diventa expired, staging eliminato', async () => {
    await seedLesson();
    const requestId = randomUUID();
    touchedRefs.push(runRef(requestId));
    const { bucket, deleteCalls } = createFakeBucket();
    const createdAtMs = Date.UTC(2026, 7, 20);

    await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadAcceptInput(
        acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
      ),
      nowMs: createdAtMs,
    });

    const afterTtlMs = createdAtMs + 24 * 60 * 60 * 1000 + 1;
    const swept = await cleanupExpiredVisualUploadRun({
      db,
      bucket,
      ownerUid: OWNER_UID,
      requestId,
      nowMs: afterTtlMs,
    });
    expect(swept.status).toBe('expired');
    expect(deleteCalls).toHaveLength(1);

    const snap = await runRef(requestId).get();
    expect(snap.data()!.status).toBe('expired');
    expect(parseStoredVisualUploadRun(snap.data())).not.toBeNull();
  });

  it('retry di accepted oltre TTL lo rende terminale senza rinormalizzare o cancellare byte non provati', async () => {
    await seedLesson();
    const requestId = randomUUID();
    touchedRefs.push(runRef(requestId));
    const input = validateVisualUploadAcceptInput(
      acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
    );
    const { bucket, saveCalls, deleteCalls } = createFakeBucket();
    const createdAtMs = Date.UTC(2026, 7, 20);
    await expect(
      acceptVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input,
        nowMs: createdAtMs,
        normalizeBytes: async () => {
          throw new Error('crash dopo reservation');
        },
      }),
    ).rejects.toThrow('crash dopo reservation');

    const result = await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input,
      nowMs: createdAtMs + 24 * 60 * 60 * 1000 + 1,
      normalizeBytes: async () => {
        throw new Error('un accepted scaduto non deve essere rinormalizzato');
      },
    });
    expect(result).toMatchObject({ status: 'expired', replayed: true, lastError: null });
    expect(saveCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
    expect(parseStoredVisualUploadRun((await runRef(requestId).get()).data())?.status).toBe(
      'expired',
    );
  });

  it('cleanup TTL è ripetibile: un expired con normalized ritenta il solo path esatto', async () => {
    await seedLesson();
    const requestId = randomUUID();
    touchedRefs.push(runRef(requestId));
    const { bucket, deleteCalls } = createFakeBucket();
    const createdAtMs = Date.UTC(2026, 7, 20);

    await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadAcceptInput(
        acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
      ),
      nowMs: createdAtMs,
    });
    const afterTtlMs = createdAtMs + 24 * 60 * 60 * 1000 + 1;
    await cleanupExpiredVisualUploadRun({
      db,
      bucket,
      ownerUid: OWNER_UID,
      requestId,
      nowMs: afterTtlMs,
    });
    const replay = await cleanupExpiredVisualUploadRun({
      db,
      bucket,
      ownerUid: OWNER_UID,
      requestId,
      nowMs: afterTtlMs + 1,
    });

    expect(replay.status).toBe('terminal');
    expect(deleteCalls).toHaveLength(1);
    expect(new Set(deleteCalls).size).toBe(1);
    expect(parseStoredVisualUploadRun((await runRef(requestId).get()).data())?.status).toBe(
      'expired',
    );
  });

  it('body/ancora stale dopo lo staging: abandon elimina canonico preparato e consuma il recovery', async () => {
    await seedLesson();
    const requestId = randomUUID();
    const refs = uploadRefs(requestId);
    touchedRefs.push(refs.run, refs.promotion, refs.recovery);
    const { bucket, files } = createFakeBucket();
    const nowMs = Date.UTC(2026, 7, 25, 3);
    await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadAcceptInput(
        acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
      ),
      nowMs,
    });
    await db.doc(`publicLessons/${PUBLIC_LESSON_ID}`).update({
      content: `${LESSON_BODY}\n\nTesto cambiato dopo l'accept.`,
    });
    await expect(
      promoteVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input: validateVisualUploadPromoteInput({
          requestId,
          promotionRequestId: randomUUID(),
          mode: { mode: 'add' },
        }),
        nowMs: nowMs + 1,
      }),
    ).rejects.toMatchObject({ code: 'visual_promotion_anchor_stale' });
    const prepared = (await refs.recovery.get()).data()!;
    expect(prepared.status).toBe('prepared');
    expect(files.has(prepared.storageRef as string)).toBe(true);

    await expect(
      abandonVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        requestId,
        nowMs: nowMs + 2,
      }),
    ).resolves.toEqual({ status: 'abandoned' });
    expect(files.has(prepared.storageRef as string)).toBe(false);
    expect(files.has(prepared.stagingRef as string)).toBe(false);
    expect((await refs.recovery.get()).exists).toBe(false);
    expect((await refs.promotion.get()).exists).toBe(false);
  });

  it('cleanup fail-closed: byte canonici sostituiti non vengono eliminati né consumano il recovery', async () => {
    await seedLesson();
    const requestId = randomUUID();
    const refs = uploadRefs(requestId);
    touchedRefs.push(refs.run, refs.promotion, refs.recovery);
    const { bucket, files, deleteCalls } = createFakeBucket();
    const nowMs = Date.UTC(2026, 7, 25, 3, 30);
    await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadAcceptInput(
        acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
      ),
      nowMs,
    });
    await db.doc(`publicLessons/${PUBLIC_LESSON_ID}`).update({ content: `${LESSON_BODY}\nmutato` });
    await expect(
      promoteVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input: validateVisualUploadPromoteInput({
          requestId,
          promotionRequestId: randomUUID(),
          mode: { mode: 'add' },
        }),
        nowMs: nowMs + 1,
      }),
    ).rejects.toMatchObject({ code: 'visual_promotion_anchor_stale' });
    const prepared = (await refs.recovery.get()).data()!;
    const replacement = Buffer.from('blob-canonico-sostitutivo');
    files.set(prepared.storageRef as string, replacement);

    await expect(
      abandonVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        requestId,
        nowMs: nowMs + 2,
      }),
    ).rejects.toMatchObject({ code: 'corrupted_state' });
    expect(files.get(prepared.storageRef as string)).toEqual(replacement);
    expect(deleteCalls).not.toContain(prepared.storageRef as string);
    expect((await refs.recovery.get()).exists).toBe(true);
  });

  it('TTL ritenta e consuma un recovery prepared lasciato da una promozione stale', async () => {
    await seedLesson();
    const requestId = randomUUID();
    const refs = uploadRefs(requestId);
    touchedRefs.push(refs.run, refs.promotion, refs.recovery);
    const { bucket, files } = createFakeBucket();
    const nowMs = Date.UTC(2026, 7, 25, 3, 45);
    await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadAcceptInput(
        acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
      ),
      nowMs,
    });
    await db.doc(`publicLessons/${PUBLIC_LESSON_ID}`).update({ content: `${LESSON_BODY}\nmutato` });
    await expect(
      promoteVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input: validateVisualUploadPromoteInput({
          requestId,
          promotionRequestId: randomUUID(),
          mode: { mode: 'add' },
        }),
        nowMs: nowMs + 1,
      }),
    ).rejects.toMatchObject({ code: 'visual_promotion_anchor_stale' });
    const prepared = (await refs.recovery.get()).data()!;

    await expect(
      cleanupExpiredVisualUploadRun({
        db,
        bucket,
        ownerUid: OWNER_UID,
        requestId,
        nowMs: nowMs + 24 * 60 * 60 * 1000 + 1,
      }),
    ).resolves.toEqual({ status: 'expired' });
    expect(files.has(prepared.storageRef as string)).toBe(false);
    expect(files.has(prepared.stagingRef as string)).toBe(false);
    expect((await refs.recovery.get()).exists).toBe(false);
    expect(parseStoredVisualUploadRun((await refs.run.get()).data())?.status).toBe('expired');
  });

  it('crash dopo commit abandoned: il replay cleanup elimina staging e canonico prepared', async () => {
    await seedLesson();
    const requestId = randomUUID();
    const refs = uploadRefs(requestId);
    touchedRefs.push(refs.run, refs.promotion, refs.recovery);
    const { bucket, files } = createFakeBucket();
    const nowMs = Date.UTC(2026, 7, 25, 3, 50);
    await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadAcceptInput(
        acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
      ),
      nowMs,
    });
    await db.doc(`publicLessons/${PUBLIC_LESSON_ID}`).update({ content: `${LESSON_BODY}\nmutato` });
    await expect(
      promoteVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input: validateVisualUploadPromoteInput({
          requestId,
          promotionRequestId: randomUUID(),
          mode: { mode: 'add' },
        }),
        nowMs: nowMs + 1,
      }),
    ).rejects.toMatchObject({ code: 'visual_promotion_anchor_stale' });
    const prepared = (await refs.recovery.get()).data()!;

    await expect(
      abandonVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        requestId,
        nowMs: nowMs + 2,
        afterAbandonCommit: async () => {
          throw new Error('crash dopo commit abandoned');
        },
      }),
    ).rejects.toThrow('crash dopo commit abandoned');
    expect(parseStoredVisualUploadRun((await refs.run.get()).data())?.status).toBe('abandoned');
    expect(files.has(prepared.storageRef as string)).toBe(true);
    expect(files.has(prepared.stagingRef as string)).toBe(true);
    expect((await refs.recovery.get()).exists).toBe(true);

    await expect(
      cleanupExpiredVisualUploadRun({
        db,
        bucket,
        ownerUid: OWNER_UID,
        requestId,
        nowMs: nowMs + 3,
      }),
    ).resolves.toEqual({ status: 'terminal' });
    expect(files.has(prepared.storageRef as string)).toBe(false);
    expect(files.has(prepared.stagingRef as string)).toBe(false);
    expect((await refs.recovery.get()).exists).toBe(false);
  });

  it('slot pieno dopo la copia canonica: abandon recupera il quarto asset senza toccare i tre live', async () => {
    await seedLesson();
    const { bucket, files } = createFakeBucket();
    const nowMs = Date.UTC(2026, 7, 25, 4);
    const live = [] as string[];
    for (let index = 0; index < 3; index += 1) {
      live.push((await acceptAndPromote({ bucket, nowMs: nowMs + index * 10 })).assetId);
    }
    const livePaths = (
      await db.doc(`programs/${PROGRAM_ID}/imports/${IMPORT_ID}/lessons/${LESSON_ID}`).get()
    )
      .data()!
      .visuals.items.map((item: { storageRef: string }) => item.storageRef as string);
    expect(live).toHaveLength(3);
    expect(livePaths.every((path: string) => files.has(path))).toBe(true);

    const requestId = randomUUID();
    const refs = uploadRefs(requestId);
    touchedRefs.push(refs.run, refs.promotion, refs.recovery);
    await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadAcceptInput(
        acceptInputPayload({ requestId, base64: await pngUploadBase64() }),
      ),
      nowMs: nowMs + 40,
    });
    await expect(
      promoteVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input: validateVisualUploadPromoteInput({
          requestId,
          promotionRequestId: randomUUID(),
          mode: { mode: 'add' },
        }),
        nowMs: nowMs + 41,
      }),
    ).rejects.toMatchObject({ code: 'visual_slot_full' });
    const prepared = (await refs.recovery.get()).data()!;
    expect(files.has(prepared.storageRef as string)).toBe(true);

    await abandonVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      requestId,
      nowMs: nowMs + 42,
    });
    expect(files.has(prepared.storageRef as string)).toBe(false);
    expect(livePaths.every((path: string) => files.has(path))).toBe(true);
    expect((await refs.recovery.get()).exists).toBe(false);
  });

  it('race replace: il target sparisce fra lettura e commit, poi abandon recupera solo il candidato', async () => {
    await seedLesson();
    const { bucket, files } = createFakeBucket();
    const nowMs = Date.UTC(2026, 7, 25, 5);
    const live = await acceptAndPromote({ bucket, nowMs });
    const lessonRef = db.doc(`programs/${PROGRAM_ID}/imports/${IMPORT_ID}/lessons/${LESSON_ID}`);
    const livePath = (await lessonRef.get()).data()!.visuals.items[0].storageRef as string;

    const requestId = randomUUID();
    const refs = uploadRefs(requestId);
    touchedRefs.push(refs.run, refs.promotion, refs.recovery);
    await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadAcceptInput(
        acceptInputPayload({ requestId, base64: await pngUploadBase64(48, 36) }),
      ),
      nowMs: nowMs + 10,
    });
    // La modifica concorrente avviene dopo accept (che congela ancora e
    // sourceBodyHash) ma prima della transazione di promozione: il target
    // autorizzato non è più live quando il server rilegge il LessonDoc.
    await lessonRef.update({ visuals: FieldValue.delete() });
    await expect(
      promoteVisualUploadForOwner({
        db,
        bucket,
        ownerUid: OWNER_UID,
        input: validateVisualUploadPromoteInput({
          requestId,
          promotionRequestId: randomUUID(),
          mode: { mode: 'replace', replaceAssetId: live.assetId },
        }),
        nowMs: nowMs + 11,
      }),
    ).rejects.toMatchObject({ code: 'visual_replace_target_missing' });
    const prepared = (await refs.recovery.get()).data()!;
    expect(files.has(prepared.storageRef as string)).toBe(true);

    await abandonVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      requestId,
      nowMs: nowMs + 12,
    });
    expect(files.has(prepared.storageRef as string)).toBe(false);
    expect(files.has(livePath)).toBe(true);
    expect((await refs.recovery.get()).exists).toBe(false);
  });

  it('un requestId scaduto è terminale: replay dello stato, nessun nuovo upload', async () => {
    await seedLesson();
    const requestId = randomUUID();
    touchedRefs.push(runRef(requestId));
    const { bucket, saveCalls } = createFakeBucket();
    const base64 = await pngUploadBase64();
    const createdAtMs = Date.UTC(2026, 7, 20);

    await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadAcceptInput(acceptInputPayload({ requestId, base64 })),
      nowMs: createdAtMs,
    });
    expect(saveCalls).toHaveLength(1);

    const afterTtlMs = createdAtMs + 24 * 60 * 60 * 1000 + 1;
    await cleanupExpiredVisualUploadRun({
      db,
      bucket,
      ownerUid: OWNER_UID,
      requestId,
      nowMs: afterTtlMs,
    });
    const retried = await acceptVisualUploadForOwner({
      db,
      bucket,
      ownerUid: OWNER_UID,
      input: validateVisualUploadAcceptInput(acceptInputPayload({ requestId, base64 })),
      nowMs: afterTtlMs,
    });
    expect(retried).toMatchObject({ status: 'expired', replayed: true });
    expect(saveCalls).toHaveLength(1);

    const snap = await runRef(requestId).get();
    expect(snap.data()!.status).toBe('expired');
  });
});
