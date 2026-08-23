import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  AI_VISUAL_CONTRACT_VERSION,
  AI_VISUAL_SERVER_CONFIG,
  computeVisualBudgetReservationKey,
  computeVisualInputHash,
  computeVisualRunId,
  estimateVisualCost,
  sha256Hex,
  toVisualDataUri,
  visualStagingRef,
} from './aiVisualCore.js';
import {
  abandonVisualForOwner,
  cleanupVisualArtifactsForDelete,
  removeLessonVisualForOwner,
  setLessonCompletedForOwner,
} from './aiVisualGateway.js';
import { serializeVisualCandidate } from './aiVisualCandidate.js';
import { canonicalVisualStorageRef } from './aiVisualManifest.js';
import { serializeVisualRun, type StoredAiVisualRun } from './aiVisualRunDoc.js';
import { visualRemovalId } from './aiVisualLifecycle.js';
import type { BucketLike } from './repositoryGatewayCore.js';

const OWNER = 'lifecycle-owner';
const PROGRAM = 've03b-prog-1';
const IMPORT = 've03b-imp-1';
const LESSON = 've03b-lesson-1';
const PUBLIC = `${IMPORT}_${LESSON}`;
const UDA = 'uda-01-reti';
const ASSET = '123e4567-e89b-42d3-a456-426614174000';
const PATH = canonicalVisualStorageRef({
  ownerUid: OWNER,
  importId: IMPORT,
  udaDir: UDA,
  assetId: ASSET,
});
const PROTECTED_PATH = 'protected/foreign-object.bin';

const emulatorDescribe =
  process.env.FIRESTORE_EMULATOR_HOST && process.env.STORAGE_EMULATOR_HOST
    ? describe
    : describe.skip;

emulatorDescribe('VE-03B lifecycle — Firestore + Storage Emulator', () => {
  let app: App;
  let db: Firestore;
  let bucket: BucketLike;
  let bytes: Buffer;

  const lessonRef = () => db.doc(`programs/${PROGRAM}/imports/${IMPORT}/lessons/${LESSON}`);
  const publicRef = () => db.doc(`publicLessons/${PUBLIC}`);
  const publicBytesRef = () => db.doc(`publicLessonVisuals/${PUBLIC}`);
  const removalRef = () => db.doc(`aiVisualRemovals/${visualRemovalId(OWNER, input)}`);
  const input = { programId: PROGRAM, importId: IMPORT, lessonId: LESSON };

  beforeAll(async () => {
    const projectId = process.env.GCLOUD_PROJECT ?? 'demo-schoolforge';
    app = initializeApp(
      { projectId, storageBucket: `${projectId}.appspot.com` },
      `ai-visual-lifecycle-${randomUUID()}`,
    );
    db = getFirestore(app);
    bucket = getStorage(app).bucket() as unknown as BucketLike;
    bytes = await sharp({
      create: { width: 96, height: 64, channels: 3, background: '#eef8f9' },
    })
      .webp({ quality: 82 })
      .toBuffer();
  });

  async function seed(withVisual = true): Promise<Record<string, unknown> | undefined> {
    const visual = withVisual
      ? {
          assetId: ASSET,
          storageRef: PATH,
          anchor: { headingSlug: 'reti', headingText: 'Reti', placement: 'after-heading' },
          caption: 'Schema dei nodi della rete',
          altText: 'Tre nodi collegati da frecce',
          width: 96,
          height: 64,
          byteLength: bytes.byteLength,
          sha256: sha256Hex(bytes),
          mimeType: 'image/webp',
          styleVersion: 'schoolforge-sketch/v1',
          sourceBodyHash: 'b'.repeat(64),
          approvedAt: Timestamp.fromMillis(1_700_000_000_000),
        }
      : undefined;
    await lessonRef().set({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: UDA,
      path: `${UDA}/lezione.md`,
      filename: 'lezione.md',
      publicLessonId: PUBLIC,
      completed: false,
      completedAt: null,
      conceptMapMarkdown: '## Sintesi\n\n- rete',
      ...(visual ? { visual } : {}),
    });
    await publicRef().set({
      ownerUid: OWNER,
      programId: PROGRAM,
      importId: IMPORT,
      udaId: UDA,
      udaDir: UDA,
      path: `${UDA}/lezione.md`,
      filename: 'lezione.md',
      contentPath: `${UDA}/lezione.md`,
      content: '# Lezione\n\n## Reti\n\nTesto.',
      completed: false,
      createdAt: Timestamp.fromMillis(1_700_000_000_000),
    });
    if (visual) await bucket.file(PATH).save(bytes, { metadata: { contentType: 'image/webp' } });
    return visual;
  }

  function validRecovery(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ownerUid: OWNER,
      programId: PROGRAM,
      importId: IMPORT,
      lessonId: LESSON,
      publicLessonId: PUBLIC,
      udaDir: UDA,
      assetId: ASSET,
      storageRef: PATH,
      createdAt: Timestamp.fromMillis(1_700_000_000_000),
      ...over,
    };
  }

  afterEach(async () => {
    for (const name of [
      'auditEvents',
      'aiVisualRemovals',
      'aiVisualCandidates',
      'aiVisualAbandonments',
      'visualRuns',
    ]) {
      const snap = await db.collection(name).get();
      await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
    }
    await Promise.all([lessonRef().delete(), publicRef().delete(), publicBytesRef().delete()]);
    try {
      await bucket.file(PATH).delete();
    } catch {
      // idempotente
    }
    try {
      await bucket.file(PROTECTED_PATH).delete();
    } catch {
      // idempotente
    }
  });

  afterAll(async () => deleteApp(app));

  it.each([
    ['né mappa né visual', false, false],
    ['sola mappa', true, false],
    ['solo visual', false, true],
    ['mappa e visual', true, true],
  ])('false → true con %s', async (_label, withMap, withVisual) => {
    await seed(withVisual);
    if (!withMap) await lessonRef().update({ conceptMapMarkdown: FieldValue.delete() });
    let storageReads = 0;
    const countedBucket: BucketLike = {
      ...bucket,
      file(path) {
        storageReads += 1;
        return bucket.file(path);
      },
    };
    await setLessonCompletedForOwner({
      db,
      bucket: countedBucket,
      ownerUid: OWNER,
      input: { ...input, completed: true },
    });
    const lesson = (await lessonRef().get()).data();
    const projection = (await publicRef().get()).data();
    expect(lesson?.completed).toBe(true);
    expect(projection?.completed).toBe(true);
    expect(projection?.conceptMapMarkdown).toBe(withMap ? '## Sintesi\n\n- rete' : undefined);
    expect(projection?.visual?.assetId).toBe(withVisual ? ASSET : undefined);
    expect((await publicBytesRef().get()).exists).toBe(withVisual);
    expect(storageReads).toBe(withVisual ? 1 : 0);
  });

  it('blob canonico mancante fallisce senza proiezioni o audit', async () => {
    await seed();
    await bucket.file(PATH).delete();
    await expect(
      setLessonCompletedForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: { ...input, completed: true },
      }),
    ).rejects.toThrow(/non sono disponibili/);
    expect((await publicRef().get()).data()?.completed).toBe(false);
    expect((await publicBytesRef().get()).exists).toBe(false);
    expect((await db.collection('auditEvents').get()).empty).toBe(true);
  });

  it.each([
    ['hash', { sha256: 'c'.repeat(64) }],
    ['byteLength', { byteLength: 1 }],
    ['MIME', { mimeType: 'image/png' }],
    ['dimensioni', { width: 95 }],
  ])('rifiuta divergenza %s fra manifest e byte', async (_label, mutation) => {
    await seed();
    await lessonRef().update(
      Object.fromEntries(Object.entries(mutation).map(([key, value]) => [`visual.${key}`, value])),
    );
    await expect(
      setLessonCompletedForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: { ...input, completed: true },
      }),
    ).rejects.toThrow();
    expect((await publicRef().get()).data()?.completed).toBe(false);
    expect((await publicBytesRef().get()).exists).toBe(false);
    expect((await db.collection('auditEvents').get()).empty).toBe(true);
  });

  it('pubblica gli stessi byte, smarca senza Storage e ripubblica senza provider', async () => {
    await seed();
    const downloads: string[] = [];
    const countedBucket: BucketLike = {
      ...bucket,
      file(path) {
        const file = bucket.file(path);
        return {
          ...file,
          download: async () => {
            downloads.push(path);
            return file.download();
          },
        };
      },
    };
    await setLessonCompletedForOwner({
      db,
      bucket: countedBucket,
      ownerUid: OWNER,
      input: { ...input, completed: true },
    });
    expect((await publicRef().get()).data()).toMatchObject({
      completed: true,
      conceptMapMarkdown: '## Sintesi\n\n- rete',
      visual: { assetId: ASSET },
    });
    expect((await publicBytesRef().get()).data()?.dataUri).toBe(
      `data:image/webp;base64,${bytes.toString('base64')}`,
    );

    downloads.length = 0;
    await setLessonCompletedForOwner({
      db,
      bucket: countedBucket,
      ownerUid: OWNER,
      input: { ...input, completed: false },
    });
    expect(downloads).toEqual([]);
    expect((await lessonRef().get()).data()?.visual.assetId).toBe(ASSET);
    expect((await publicRef().get()).data()).not.toHaveProperty('visual');
    expect((await publicBytesRef().get()).exists).toBe(false);

    await setLessonCompletedForOwner({
      db,
      bucket: countedBucket,
      ownerUid: OWNER,
      input: { ...input, completed: true },
    });
    expect(downloads).toEqual([PATH]);
    expect((await publicBytesRef().get()).exists).toBe(true);
  });

  it('true → false conserva una mappa privata malformata e mette in sicurezza il pubblico', async () => {
    await seed();
    await setLessonCompletedForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: { ...input, completed: true },
    });
    const malformedMap = '   \n\t';
    await lessonRef().update({ conceptMapMarkdown: malformedMap });
    let storageReads = 0;
    const guarded: BucketLike = {
      ...bucket,
      file() {
        storageReads += 1;
        throw new Error('Storage non deve essere raggiunto');
      },
    };

    await expect(
      setLessonCompletedForOwner({
        db,
        bucket: guarded,
        ownerUid: OWNER,
        input: { ...input, completed: false },
      }),
    ).resolves.toEqual({ status: 'completed' });

    const privateLesson = (await lessonRef().get()).data();
    const projection = (await publicRef().get()).data();
    expect(privateLesson?.conceptMapMarkdown).toBe(malformedMap);
    expect(privateLesson?.visual.assetId).toBe(ASSET);
    expect(privateLesson?.completed).toBe(false);
    expect(projection?.completed).toBe(false);
    expect(projection).not.toHaveProperty('conceptMapMarkdown');
    expect(projection).not.toHaveProperty('visual');
    expect((await publicBytesRef().get()).exists).toBe(false);
    expect(storageReads).toBe(0);
  });

  it('true → false ignora mappa e visual privati entrambi malformati senza usare path', async () => {
    await seed();
    await setLessonCompletedForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: { ...input, completed: true },
    });
    const malformedMap = { unexpected: 'map' };
    const malformedVisual = { storageRef: '../arbitrary/foreign.webp', nested: { value: 1 } };
    await lessonRef().update({
      conceptMapMarkdown: malformedMap,
      visual: malformedVisual,
    });
    let storageReads = 0;
    const guarded: BucketLike = {
      ...bucket,
      file() {
        storageReads += 1;
        throw new Error('Storage non deve essere raggiunto');
      },
    };

    await expect(
      setLessonCompletedForOwner({
        db,
        bucket: guarded,
        ownerUid: OWNER,
        input: { ...input, completed: false },
      }),
    ).resolves.toEqual({ status: 'completed' });

    const privateLesson = (await lessonRef().get()).data();
    const projection = (await publicRef().get()).data();
    expect(privateLesson?.conceptMapMarkdown).toEqual(malformedMap);
    expect(privateLesson?.visual).toEqual(malformedVisual);
    expect(projection?.completed).toBe(false);
    expect(projection).not.toHaveProperty('conceptMapMarkdown');
    expect(projection).not.toHaveProperty('visual');
    expect((await publicBytesRef().get()).exists).toBe(false);
    expect(storageReads).toBe(0);
  });

  it('true → false confronta il fingerprint grezzo anche se la mappa è malformata', async () => {
    await seed();
    await setLessonCompletedForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: { ...input, completed: true },
    });
    await lessonRef().update({ conceptMapMarkdown: { malformed: 1 } });
    let storageReads = 0;
    const guarded: BucketLike = {
      ...bucket,
      file() {
        storageReads += 1;
        throw new Error('Storage non deve essere raggiunto');
      },
    };

    await expect(
      setLessonCompletedForOwner({
        db,
        bucket: guarded,
        ownerUid: OWNER,
        input: { ...input, completed: false },
        beforeTransaction: async () => {
          await lessonRef().update({ conceptMapMarkdown: { malformed: 2 } });
        },
      }),
    ).rejects.toThrow(/cambiata/);

    expect(storageReads).toBe(0);
    expect((await lessonRef().get()).data()?.conceptMapMarkdown).toEqual({ malformed: 2 });
    expect((await publicRef().get()).data()).toMatchObject({
      completed: true,
      conceptMapMarkdown: '## Sintesi\n\n- rete',
      visual: { assetId: ASSET },
    });
    expect((await publicBytesRef().get()).exists).toBe(true);
    expect((await db.collection('auditEvents').get()).size).toBe(1);
  });

  it('manifest malformato fallisce prima di leggere un path o scrivere', async () => {
    await seed(false);
    await lessonRef().update({ visual: { storageRef: 'arbitrary/path.webp' } });
    let downloads = 0;
    const guardedBucket: BucketLike = {
      ...bucket,
      file() {
        downloads += 1;
        throw new Error('non deve essere raggiunto');
      },
    };
    await expect(
      setLessonCompletedForOwner({
        db,
        bucket: guardedBucket,
        ownerUid: OWNER,
        input: { ...input, completed: true },
      }),
    ).rejects.toThrow();
    expect(downloads).toBe(0);
    expect((await publicRef().get()).data()?.completed).toBe(false);
    expect((await db.collection('auditEvents').get()).empty).toBe(true);
  });

  it('rifiuta una race fra preflight e transazione con zero proiezioni', async () => {
    await seed();
    await expect(
      setLessonCompletedForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: { ...input, completed: true },
        beforeTransaction: async () => {
          await lessonRef().update({ conceptMapMarkdown: '## Sintesi\n\n- cambiata' });
        },
      }),
    ).rejects.toThrow(/cambiata/);
    expect((await publicBytesRef().get()).exists).toBe(false);
    expect((await publicRef().get()).data()).not.toHaveProperty('visual');
  });

  it.each([
    [
      'manifest',
      async () => lessonRef().update({ 'visual.caption': 'Caption cambiata durante la race' }),
    ],
    ['concept map', async () => lessonRef().update({ conceptMapMarkdown: '## Mappa cambiata' })],
    [
      'completed',
      async () => {
        await Promise.all([
          lessonRef().update({ completed: true }),
          publicRef().update({ completed: true }),
        ]);
      },
    ],
  ])('rifiuta la race su %s fra preflight e transazione', async (_label, mutate) => {
    await seed();
    await expect(
      setLessonCompletedForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: { ...input, completed: true },
        beforeTransaction: mutate,
      }),
    ).rejects.toThrow(/cambiata/);
    expect((await publicBytesRef().get()).exists).toBe(false);
    expect((await db.collection('auditEvents').get()).empty).toBe(true);
  });

  it('rimuove atomicamente le proiezioni, poi il blob; il replay non duplica audit', async () => {
    await seed();
    await setLessonCompletedForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: { ...input, completed: true },
    });
    await removeLessonVisualForOwner({ db, bucket, ownerUid: OWNER, input });
    expect((await lessonRef().get()).data()).not.toHaveProperty('visual');
    expect((await publicRef().get()).data()).not.toHaveProperty('visual');
    expect((await publicBytesRef().get()).exists).toBe(false);
    await expect(bucket.file(PATH).download()).rejects.toBeTruthy();
    await removeLessonVisualForOwner({ db, bucket, ownerUid: OWNER, input });
    const audits = await db
      .collection('auditEvents')
      .where('action', '==', 'lesson.visualRemoved')
      .get();
    expect(audits.size).toBe(1);
  });

  it('rimozione di visual assente è replay senza audit né Storage', async () => {
    await seed(false);
    let storageCalls = 0;
    const guarded: BucketLike = {
      ...bucket,
      file() {
        storageCalls += 1;
        throw new Error('Storage non deve essere raggiunto');
      },
    };
    await expect(
      removeLessonVisualForOwner({ db, bucket: guarded, ownerUid: OWNER, input }),
    ).resolves.toEqual({ status: 'replayed' });
    expect(storageCalls).toBe(0);
    expect((await db.collection('auditEvents').get()).empty).toBe(true);
  });

  it('rimozione con blob già assente completa e resta idempotente', async () => {
    await seed();
    await bucket.file(PATH).delete();
    await expect(
      removeLessonVisualForOwner({ db, bucket, ownerUid: OWNER, input }),
    ).resolves.toEqual({ status: 'removed' });
    await expect(
      removeLessonVisualForOwner({ db, bucket, ownerUid: OWNER, input }),
    ).resolves.toEqual({ status: 'replayed' });
    const audits = await db
      .collection('auditEvents')
      .where('action', '==', 'lesson.visualRemoved')
      .get();
    expect(audits.size).toBe(1);
  });

  it('rimozione con manifest malformato non costruisce alcun path Storage', async () => {
    await seed(false);
    await lessonRef().update({ visual: { storageRef: 'path/non/autorevole.webp' } });
    let storageCalls = 0;
    const guarded: BucketLike = {
      ...bucket,
      file() {
        storageCalls += 1;
        throw new Error('Storage non deve essere raggiunto');
      },
    };
    await expect(
      removeLessonVisualForOwner({ db, bucket: guarded, ownerUid: OWNER, input }),
    ).rejects.toThrow();
    expect(storageCalls).toBe(0);
    expect((await lessonRef().get()).data()).toHaveProperty('visual');
  });

  it('errore Storage dopo la rimozione lascia recovery e il retry lo consuma', async () => {
    await seed();
    const failing: BucketLike = {
      ...bucket,
      file(path) {
        const file = bucket.file(path);
        return { ...file, delete: async () => Promise.reject(new Error('storage unavailable')) };
      },
    };
    await expect(
      removeLessonVisualForOwner({ db, bucket: failing, ownerUid: OWNER, input }),
    ).rejects.toThrow('storage unavailable');
    expect((await lessonRef().get()).data()).not.toHaveProperty('visual');
    expect((await db.collection('aiVisualRemovals').get()).size).toBe(1);
    await expect(
      removeLessonVisualForOwner({ db, bucket, ownerUid: OWNER, input }),
    ).resolves.toEqual({ status: 'replayed' });
    expect((await db.collection('aiVisualRemovals').get()).empty).toBe(true);
    const audits = await db
      .collection('auditEvents')
      .where('action', '==', 'lesson.visualRemoved')
      .get();
    expect(audits.size).toBe(1);
  });

  it('un visual sostituito durante la rimozione blocca commit e delete vecchia', async () => {
    const original = await seed();
    const nextAsset = '99999999-8888-4777-8666-555555555555';
    const nextPath = canonicalVisualStorageRef({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: UDA,
      assetId: nextAsset,
    });
    await expect(
      removeLessonVisualForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input,
        beforeTransaction: async () => {
          await lessonRef().update({
            visual: { ...original, assetId: nextAsset, storageRef: nextPath },
          });
        },
      }),
    ).rejects.toThrow(/cambiato/);
    expect((await bucket.file(PATH).download())[0]).toEqual(bytes);
    expect((await lessonRef().get()).data()?.visual.assetId).toBe(nextAsset);
    expect((await db.collection('auditEvents').get()).empty).toBe(true);
  });

  const malformedRecoveryCases: Array<
    [string, (recovery: Record<string, unknown>) => Record<string, unknown>]
  > = [
    [
      'path di un altro owner',
      (recovery) => ({
        ...recovery,
        storageRef: canonicalVisualStorageRef({
          ownerUid: 'other-owner',
          importId: IMPORT,
          udaDir: UDA,
          assetId: ASSET,
        }),
      }),
    ],
    [
      'path di un altro import',
      (recovery) => ({
        ...recovery,
        storageRef: canonicalVisualStorageRef({
          ownerUid: OWNER,
          importId: 'other-import',
          udaDir: UDA,
          assetId: ASSET,
        }),
      }),
    ],
    [
      'path di un altro udaDir',
      (recovery) => ({
        ...recovery,
        storageRef: canonicalVisualStorageRef({
          ownerUid: OWNER,
          importId: IMPORT,
          udaDir: 'uda-99-other',
          assetId: ASSET,
        }),
      }),
    ],
    [
      'assetId divergente dal path',
      (recovery) => ({ ...recovery, assetId: '99999999-8888-4777-8666-555555555555' }),
    ],
    ['segmento traversal', (recovery) => ({ ...recovery, udaDir: '..' })],
    [
      'doppio slash',
      (recovery) => ({ ...recovery, storageRef: PATH.replace(`/${IMPORT}/`, `//${IMPORT}/`) }),
    ],
    [
      'estensione diversa',
      (recovery) => ({ ...recovery, storageRef: PATH.replace('.webp', '.png') }),
    ],
    [
      'createdAt assente',
      (recovery) => {
        const rest = { ...recovery };
        delete rest.createdAt;
        return rest;
      },
    ],
    ['createdAt stringa', (recovery) => ({ ...recovery, createdAt: '2026-08-23' })],
    ['chiave extra', (recovery) => ({ ...recovery, extra: true })],
    [
      'chiave mancante',
      (recovery) => {
        const rest = { ...recovery };
        delete rest.publicLessonId;
        return rest;
      },
    ],
    ['owner divergente', (recovery) => ({ ...recovery, ownerUid: 'other-owner' })],
    ['controllo nel segmento', (recovery) => ({ ...recovery, publicLessonId: `${PUBLIC}\n` })],
  ];

  for (const mode of ['rimozione esplicita', 'bulk cleanup'] as const) {
    it.each(malformedRecoveryCases)(
      `${mode}: recovery malformato (%s) non legge Storage e non modifica nulla`,
      async (_label, mutate) => {
        await seed();
        const protectedBytes = Buffer.from('oggetto estraneo da non cancellare');
        await bucket.file(PROTECTED_PATH).save(protectedBytes);
        await removalRef().set(mutate(validRecovery()));
        const beforeRecovery = (await removalRef().get()).data();
        const beforeLesson = (await lessonRef().get()).data();
        const beforePublic = (await publicRef().get()).data();
        let storageCalls = 0;
        const guarded: BucketLike = {
          ...bucket,
          file() {
            storageCalls += 1;
            throw new Error('Storage non deve essere raggiunto');
          },
        };
        const operation =
          mode === 'rimozione esplicita'
            ? removeLessonVisualForOwner({ db, bucket: guarded, ownerUid: OWNER, input })
            : cleanupVisualArtifactsForDelete({
                db,
                bucket: guarded,
                ownerUid: OWNER,
                input: { programId: PROGRAM, importId: IMPORT, lessonIds: [LESSON] },
              });

        await expect(operation).rejects.toThrow(/recovery.*non è valido/);
        expect(storageCalls).toBe(0);
        expect((await removalRef().get()).data()).toEqual(beforeRecovery);
        expect((await lessonRef().get()).data()).toEqual(beforeLesson);
        expect((await publicRef().get()).data()).toEqual(beforePublic);
        expect((await db.collection('auditEvents').get()).empty).toBe(true);
        expect((await bucket.file(PROTECTED_PATH).download())[0]).toEqual(protectedBytes);
      },
    );
  }

  it('abbandona il solo staging, impedisce la promozione e gestisce la risposta persa', async () => {
    const requestId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const opaqueRunId = computeVisualRunId(OWNER, requestId);
    const stagingRef = visualStagingRef(OWNER, opaqueRunId);
    const subject = 'Schema didattico di una rete di nodi.';
    const cost = estimateVisualCost(subject, 'mock');
    const now = Date.UTC(2026, 7, 23, 10);
    const run: StoredAiVisualRun = {
      contractVersion: AI_VISUAL_CONTRACT_VERSION,
      status: 'completed',
      inputHash: computeVisualInputHash({ requestId, subject }),
      config: AI_VISUAL_SERVER_CONFIG,
      leaseExecutionId: 'execution-1',
      leaseExpiresAtMs: now + 60_000,
      budget: {
        monthKey: '2026-08',
        reservationKey: computeVisualBudgetReservationKey(OWNER, requestId),
        estimatedInputTokens: cost.estimatedInputTokens,
        reservedInputTokens: cost.reservedInputTokens,
        expectedOutputTokens: cost.expectedOutputTokens,
        estimatedCostMicroUsd: cost.estimatedCostMicroUsd,
        reservedCostMicroUsd: cost.reservationCostMicroUsd,
        actualInputTokens: 0,
        actualOutputTokens: 0,
        actualCostMicroUsd: 0,
        settledCostMicroUsd: 0,
      },
      image: {
        dataUri: toVisualDataUri(bytes),
        width: 96,
        height: 64,
        byteLength: bytes.byteLength,
        sha256: sha256Hex(bytes),
        mimeType: 'image/webp',
        styleVersion: AI_VISUAL_SERVER_CONFIG.styleVersion,
        webpQuality: 82,
        normalizationAttempts: 1,
      },
      stagingRef,
      createdAtMs: now,
      updatedAtMs: now,
      expireAtMs: now + 86_400_000,
    };
    await db.doc(`visualRuns/${opaqueRunId}`).set(serializeVisualRun(run));
    await db.doc(`aiVisualCandidates/${opaqueRunId}`).set(
      serializeVisualCandidate({
        contractVersion: 1,
        ownerUid: OWNER,
        programId: PROGRAM,
        importId: IMPORT,
        lessonId: LESSON,
        publicLessonId: PUBLIC,
        udaDir: UDA,
        sourceBodyHash: 'c'.repeat(64),
        createdAtMs: now,
        expireAtMs: now + 86_400_000,
      }),
    );
    await bucket.file(stagingRef).save(bytes);
    await bucket.file(PATH).save(bytes);

    await abandonVisualForOwner({ db, bucket, ownerUid: OWNER, requestId });
    expect((await db.doc(`aiVisualCandidates/${opaqueRunId}`).get()).exists).toBe(false);
    await expect(bucket.file(stagingRef).download()).rejects.toBeTruthy();
    expect((await lessonRef().get()).exists).toBe(false);
    expect((await publicRef().get()).exists).toBe(false);
    expect((await bucket.file(PATH).download())[0]).toEqual(bytes);

    await expect(
      abandonVisualForOwner({ db, bucket, ownerUid: OWNER, requestId }),
    ).resolves.toEqual({ status: 'replayed' });
  });

  it('abbandono rifiuta ticket assente, malformato o appartenente ad altro owner', async () => {
    const requestId = 'aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff';
    const opaqueRunId = computeVisualRunId(OWNER, requestId);
    await expect(abandonVisualForOwner({ db, bucket, ownerUid: OWNER, requestId })).rejects.toThrow(
      /non esiste o non è valido/,
    );

    await db.doc(`aiVisualCandidates/${opaqueRunId}`).set({ malformed: true });
    await expect(abandonVisualForOwner({ db, bucket, ownerUid: OWNER, requestId })).rejects.toThrow(
      /non esiste o non è valido/,
    );

    await db.doc(`aiVisualCandidates/${opaqueRunId}`).set(
      serializeVisualCandidate({
        contractVersion: 1,
        ownerUid: 'other-owner',
        programId: PROGRAM,
        importId: IMPORT,
        lessonId: LESSON,
        publicLessonId: PUBLIC,
        udaDir: UDA,
        sourceBodyHash: 'c'.repeat(64),
        createdAtMs: Date.UTC(2026, 7, 23, 10),
        expireAtMs: Date.UTC(2026, 7, 24, 10),
      }),
    );
    await expect(abandonVisualForOwner({ db, bucket, ownerUid: OWNER, requestId })).rejects.toThrow(
      /non esiste o non è valido/,
    );
    expect((await bucket.file(PATH).exists())[0]).toBe(false);
  });

  it('cleanup di cancellazione elimina visual valido e non inventa path da manifest malformato', async () => {
    await seed();
    await setLessonCompletedForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: { ...input, completed: true },
    });
    await cleanupVisualArtifactsForDelete({
      db,
      bucket,
      ownerUid: OWNER,
      input: { programId: PROGRAM, importId: IMPORT, lessonIds: [LESSON] },
    });
    expect((await publicBytesRef().get()).exists).toBe(false);
    expect((await lessonRef().get()).data()).not.toHaveProperty('visual');
    await expect(bucket.file(PATH).download()).rejects.toBeTruthy();

    await lessonRef().update({ visual: { storageRef: 'non-canonico' } });
    let storagePaths = 0;
    const guarded: BucketLike = {
      ...bucket,
      file() {
        storagePaths += 1;
        throw new Error('nessun path deve essere usato');
      },
    };
    await expect(
      cleanupVisualArtifactsForDelete({
        db,
        bucket: guarded,
        ownerUid: OWNER,
        input: { programId: PROGRAM, importId: IMPORT, lessonIds: [LESSON] },
      }),
    ).resolves.toMatchObject({ blobs: 0 });
    expect(storagePaths).toBe(0);
    expect((await lessonRef().get()).data()).not.toHaveProperty('visual');
  });

  it('un errore Storage lascia un record di recovery e il retry completa senza manifest', async () => {
    await seed();
    const failingBucket: BucketLike = {
      ...bucket,
      file(path) {
        const file = bucket.file(path);
        return {
          ...file,
          delete: async () => {
            throw new Error('storage unavailable');
          },
        };
      },
    };
    await expect(
      cleanupVisualArtifactsForDelete({
        db,
        bucket: failingBucket,
        ownerUid: OWNER,
        input: { programId: PROGRAM, importId: IMPORT, lessonIds: [LESSON] },
      }),
    ).rejects.toThrow('storage unavailable');
    expect((await lessonRef().get()).data()).not.toHaveProperty('visual');
    expect((await db.collection('aiVisualRemovals').get()).size).toBe(1);

    await cleanupVisualArtifactsForDelete({
      db,
      bucket,
      ownerUid: OWNER,
      input: { programId: PROGRAM, importId: IMPORT, lessonIds: [LESSON] },
    });
    expect((await db.collection('aiVisualRemovals').get()).empty).toBe(true);
    await expect(bucket.file(PATH).download()).rejects.toBeTruthy();
  });
});
