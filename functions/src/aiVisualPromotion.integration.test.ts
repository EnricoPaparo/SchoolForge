import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
} from './aiVisualCore.js';
import {
  VISUAL_CANDIDATE_TTL_MS,
  computeSourceBodyHash,
  serializeVisualCandidate,
} from './aiVisualCandidate.js';
import { promoteVisualForOwner } from './aiVisualGateway.js';
import { canonicalVisualStorageRef } from './aiVisualManifest.js';
import { parseStoredVisualPromotion } from './aiVisualPromotion.js';
import { normalizeVisualWebp } from './aiVisualNormalizer.js';
import { serializeVisualRun, type StoredAiVisualRun } from './aiVisualRunDoc.js';
import type { BucketLike } from './repositoryGatewayCore.js';

/**
 * VE-03A-REVIEW-FIX — le corse, provate sull'Emulator vero.
 *
 * Una corsa non si dimostra sperando che due scritture si incrocino: si
 * provoca. `promoteVisualForOwner` espone per questo un punto di iniezione fra
 * il preflight e la transazione — è l'istante esatto in cui, in produzione, una
 * scrittura concorrente si infilerebbe.
 *
 * Ciò che questi test verificano non è solo che l'operazione fallisca, ma che
 * fallisca **senza lasciare tracce**: nessun manifest privato, nessuna
 * proiezione, nessun documento di byte, nessun registro di approvazione,
 * nessun audit. Un fallimento che scrive metà delle cose sarebbe peggio di
 * nessun controllo, perché sembrerebbe riuscito.
 */

const OWNER = 'promotion-owner';
const PROGRAM = 'prog-1';
const IMPORT = 'imp-1';
const LESSON = 'lesson-1';
const PUBLIC_LESSON = `${IMPORT}_${LESSON}`;
const UDA = 'uda-01-reti';
const NOW = Date.UTC(2026, 7, 23, 10);

const BODY = ['# Lezione', '', 'testo', '', '## La fotosintesi', '', 'altro'].join('\n');

const emulatorDescribe =
  process.env.FIRESTORE_EMULATOR_HOST && process.env.STORAGE_EMULATOR_HOST
    ? describe
    : describe.skip;

function promotionInput(requestId: string) {
  return {
    requestId,
    programId: PROGRAM,
    importId: IMPORT,
    lessonId: LESSON,
    anchorHeadingText: 'La fotosintesi',
    caption: 'Schema della fotosintesi',
    altText: 'Diagramma con foglia, luce e anidride carbonica',
  };
}

async function completedRun(requestId: string): Promise<StoredAiVisualRun> {
  const source = await sharp({
    create: { width: 96, height: 64, channels: 3, background: { r: 238, g: 248, b: 249 } },
  })
    .webp({ quality: 88 })
    .toBuffer();
  const normalized = await normalizeVisualWebp(source);
  const runId = computeVisualRunId(OWNER, requestId);
  const subject = 'Schema essenziale del ciclo dell’acqua con evaporazione e condensazione.';
  const cost = estimateVisualCost(subject, 'mock');
  return {
    contractVersion: AI_VISUAL_CONTRACT_VERSION,
    status: 'completed',
    inputHash: computeVisualInputHash({ requestId, subject }),
    config: AI_VISUAL_SERVER_CONFIG,
    leaseExecutionId: 'completed-execution',
    leaseExpiresAtMs: NOW + 300_000,
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
    stagingRef: visualStagingRef(OWNER, runId),
    createdAtMs: NOW,
    updatedAtMs: NOW,
    expireAtMs: NOW + AI_CONTENT_RUN_TTL_MS,
  };
}

/**
 * **Limite dichiarato dell'Emulator, e come è aggirato senza barare.**
 *
 * L'Emulator Storage **ignora** `ifGenerationMatch: 0`: verificato con una
 * sonda diretta, un secondo `save()` con quella precondizione sovrascrive
 * invece di fallire con 412. GCS vero la applica. Se il test si limitasse a
 * girare sull'Emulator dimostrerebbe il contrario di ciò che serve.
 *
 * Questo wrapper avvolge il bucket **reale** e applica la sola precondizione
 * che manca, con una verifica di esistenza vera. Tutto il resto — scrittura,
 * lettura, cancellazione — resta l'Emulator. Ciò che il test dimostra è quindi
 * il comportamento del **nostro codice** di fronte a un 412: che la
 * precondizione venga richiesta è invece congelato dal test sul call site.
 */
function preconditionEnforcingBucket(real: BucketLike): BucketLike {
  return {
    file(path: string) {
      const file = real.file(path);
      return {
        download: () => file.download(),
        delete: () => file.delete(),
        save: async (data: Uint8Array, options?: unknown) => {
          const opts = options as { preconditionOpts?: { ifGenerationMatch?: number } } | undefined;
          if (opts?.preconditionOpts?.ifGenerationMatch === 0) {
            let exists = true;
            try {
              await file.download();
            } catch {
              exists = false;
            }
            if (exists) {
              throw Object.assign(new Error('precondition failed'), { code: 412 });
            }
          }
          return file.save(data, options);
        },
      };
    },
    deleteFiles: (options: { prefix: string }) => real.deleteFiles(options),
  };
}

emulatorDescribe('promozione — corse reali su Firestore e Storage Emulator', () => {
  let app: App;
  let db: Firestore;
  let bucket: BucketLike;
  const writtenObjects: string[] = [];

  const lessonRef = () => db.doc(`programs/${PROGRAM}/imports/${IMPORT}/lessons/${LESSON}`);
  const publicRef = () => db.doc(`publicLessons/${PUBLIC_LESSON}`);
  const publicVisualRef = () => db.doc(`publicLessonVisuals/${PUBLIC_LESSON}`);

  beforeAll(() => {
    const projectId = process.env.GCLOUD_PROJECT ?? 'demo-schoolforge';
    app = initializeApp(
      { projectId, storageBucket: `${projectId}.appspot.com` },
      `ai-visual-promotion-${randomUUID()}`,
    );
    db = getFirestore(app);
    bucket = getStorage(app).bucket() as unknown as BucketLike;
  });

  afterEach(async () => {
    const collections = ['aiVisualCandidates', 'aiVisualPromotions', 'visualRuns', 'auditEvents'];
    for (const name of collections) {
      const snap = await db.collection(name).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
    await Promise.all([lessonRef(), publicRef(), publicVisualRef()].map((ref) => ref.delete()));
    await Promise.all(
      writtenObjects.splice(0).map(async (path) => {
        try {
          await bucket.file(path).delete();
        } catch {
          // già assente: la pulizia è idempotente per costruzione.
        }
      }),
    );
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  async function seedPromotable(params: {
    requestId: string;
    completed?: boolean;
    body?: string;
    lessonVisual?: Record<string, unknown>;
  }) {
    const { requestId, completed = true, body = BODY, lessonVisual } = params;
    const opaqueRunId = computeVisualRunId(OWNER, requestId);
    const run = await completedRun(requestId);

    await lessonRef().set({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: UDA,
      path: `${UDA}/lezione-001.md`,
      filename: 'lezione-001.md',
      publicLessonId: PUBLIC_LESSON,
      completed,
      poolStatus: 'absent',
      questionCount: 0,
      storageRef: `repository/${OWNER}/${IMPORT}/${UDA}/lezione-001.md`,
      poolStorageRef: null,
      ...(lessonVisual ? { visual: lessonVisual } : {}),
    });
    await publicRef().set({
      ownerUid: OWNER,
      programId: PROGRAM,
      importId: IMPORT,
      udaId: 'uda-1',
      udaDir: UDA,
      path: `${UDA}/lezione-001.md`,
      filename: 'lezione-001.md',
      contentPath: `repository/${OWNER}/${IMPORT}/${UDA}/lezione-001.md`,
      createdAt: Timestamp.fromMillis(NOW),
      completed,
      content: body,
    });
    await db.doc(`aiVisualCandidates/${opaqueRunId}`).set(
      serializeVisualCandidate({
        contractVersion: 1,
        ownerUid: OWNER,
        programId: PROGRAM,
        importId: IMPORT,
        lessonId: LESSON,
        publicLessonId: PUBLIC_LESSON,
        udaDir: UDA,
        sourceBodyHash: computeSourceBodyHash(body),
        createdAtMs: NOW,
        expireAtMs: NOW + VISUAL_CANDIDATE_TTL_MS,
      }),
    );
    await db.doc(`visualRuns/${opaqueRunId}`).set(serializeVisualRun(run));

    const stagingRef = visualStagingRef(OWNER, opaqueRunId);
    const [staged] = [Buffer.from(run.image!.dataUri.split(',')[1] ?? '', 'base64')];
    await bucket.file(stagingRef).save(staged, { resumable: false });
    writtenObjects.push(stagingRef);
    return { opaqueRunId, run, stagingRef, staged };
  }

  async function assertNoPersistentTrace() {
    expect((await lessonRef().get()).data()?.visual).toBeUndefined();
    expect((await publicRef().get()).data()?.visual).toBeUndefined();
    expect((await publicVisualRef().get()).exists).toBe(false);
    expect((await db.collection('aiVisualPromotions').get()).empty).toBe(true);
    expect((await db.collection('auditEvents').get()).empty).toBe(true);
  }

  it('promuove, proietta e registra quando nulla cambia sotto i piedi', async () => {
    const requestId = '11111111-2222-4333-8444-000000000001';
    const assetId = '22222222-3333-4444-8555-000000000001';
    const { staged } = await seedPromotable({ requestId });
    writtenObjects.push(
      canonicalVisualStorageRef({ ownerUid: OWNER, importId: IMPORT, udaDir: UDA, assetId }),
    );

    const result = await promoteVisualForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: promotionInput(requestId),
      nowMs: NOW,
      generateAssetId: () => assetId,
    });
    expect(result).toEqual({ requestId, replayed: false, assetId });

    const lesson = (await lessonRef().get()).data();
    expect(lesson?.visual?.assetId).toBe(assetId);
    expect(lesson?.visual?.anchor?.headingSlug).toBe('la-fotosintesi');

    const projected = (await publicRef().get()).data();
    expect(projected?.visual?.assetId).toBe(assetId);
    expect(projected?.visual?.storageRef).toBeUndefined();

    const bytesDoc = (await publicVisualRef().get()).data();
    expect(bytesDoc?.assetId).toBe(assetId);
    expect(bytesDoc?.dataUri?.startsWith('data:image/webp;base64,')).toBe(true);

    // Il registro deve superare il proprio parser chiuso, non solo esistere.
    const promotionDoc = await db
      .doc(`aiVisualPromotions/${computeVisualRunId(OWNER, requestId)}`)
      .get();
    expect(parseStoredVisualPromotion(promotionDoc.data())?.assetId).toBe(assetId);

    // I byte canonici sono esattamente quelli staged, e lo staging è sparito.
    const [canonical] = await bucket
      .file(canonicalVisualStorageRef({ ownerUid: OWNER, importId: IMPORT, udaDir: UDA, assetId }))
      .download();
    expect(Buffer.from(canonical).equals(staged)).toBe(true);
  });

  /**
   * BLOCCANTE 1 — corsa sul corpo.
   *
   * Il preflight vede il corpo su cui la proposta è nata; fra quel momento e il
   * commit qualcuno riscrive `PublicLessonDoc.content`. Senza la rilettura
   * transazionale l'immagine verrebbe legata a un testo che il docente non ha
   * mai visto, con un manifest che giura il contrario.
   */
  it('rifiuta se il corpo pubblico cambia fra preflight e transazione', async () => {
    const requestId = '11111111-2222-4333-8444-000000000002';
    const assetId = '22222222-3333-4444-8555-000000000002';
    await seedPromotable({ requestId });
    writtenObjects.push(
      canonicalVisualStorageRef({ ownerUid: OWNER, importId: IMPORT, udaDir: UDA, assetId }),
    );

    await expect(
      promoteVisualForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: promotionInput(requestId),
        nowMs: NOW,
        generateAssetId: () => assetId,
        beforeTransaction: async () => {
          await publicRef().update({ content: `${BODY}\n\n## Sezione aggiunta dopo\n` });
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });

    await assertNoPersistentTrace();
  });

  /** Stessa corsa, ma sull'identità: la proiezione smette di combaciare. */
  it('rifiuta se la proiezione smette di corrispondere alla lezione', async () => {
    const requestId = '11111111-2222-4333-8444-000000000003';
    const assetId = '22222222-3333-4444-8555-000000000003';
    await seedPromotable({ requestId });
    writtenObjects.push(
      canonicalVisualStorageRef({ ownerUid: OWNER, importId: IMPORT, udaDir: UDA, assetId }),
    );

    await expect(
      promoteVisualForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: promotionInput(requestId),
        nowMs: NOW,
        generateAssetId: () => assetId,
        beforeTransaction: async () => {
          await publicRef().update({ filename: 'lezione-002.md' });
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });

    await assertNoPersistentTrace();
  });

  /** E sullo stato di svolgimento, che decide la visibilità allo studente. */
  it('rifiuta se la lezione viene smarcata fra preflight e transazione', async () => {
    const requestId = '11111111-2222-4333-8444-000000000004';
    const assetId = '22222222-3333-4444-8555-000000000004';
    await seedPromotable({ requestId });
    writtenObjects.push(
      canonicalVisualStorageRef({ ownerUid: OWNER, importId: IMPORT, udaDir: UDA, assetId }),
    );

    await expect(
      promoteVisualForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: promotionInput(requestId),
        nowMs: NOW,
        generateAssetId: () => assetId,
        beforeTransaction: async () => {
          await publicRef().update({ completed: false });
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });

    await assertNoPersistentTrace();
  });

  /**
   * BLOCCANTE 2 — corsa fra due sostituzioni.
   *
   * A e B approvano insieme sulla stessa lezione. B parte, A commit-a per prima.
   * Senza il confronto sull'impronta del visual precedente, B sovrascriverebbe
   * il manifest di A **e** cancellerebbe il blob che credeva di sostituire —
   * che nel frattempo non è più quello vero, ma quello appena approvato da A.
   */
  it('rifiuta la seconda sostituzione concorrente senza toccare la prima', async () => {
    const requestId = '11111111-2222-4333-8444-000000000005';
    const assetIdB = '22222222-3333-4444-8555-000000000005';
    const assetIdA = '33333333-4444-4555-8666-000000000005';
    const refA = canonicalVisualStorageRef({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: UDA,
      assetId: assetIdA,
    });

    // Stato iniziale: la lezione ha già un visual V0, quello che B crede di
    // sostituire.
    const visualV0 = {
      assetId: '44444444-5555-4666-8777-000000000005',
      storageRef: canonicalVisualStorageRef({
        ownerUid: OWNER,
        importId: IMPORT,
        udaDir: UDA,
        assetId: '44444444-5555-4666-8777-000000000005',
      }),
      anchor: {
        headingSlug: 'la-fotosintesi',
        headingText: 'La fotosintesi',
        placement: 'after-heading',
      },
      caption: 'Vecchia didascalia',
      altText: 'Vecchio testo alternativo',
      width: 96,
      height: 64,
      byteLength: 10,
      sha256: 'a'.repeat(64),
      mimeType: 'image/webp',
      styleVersion: AI_VISUAL_SERVER_CONFIG.styleVersion,
      sourceBodyHash: computeSourceBodyHash(BODY),
      approvedAt: Timestamp.fromMillis(NOW - 1000),
    };
    await seedPromotable({ requestId, lessonVisual: visualV0 });
    writtenObjects.push(
      refA,
      canonicalVisualStorageRef({
        ownerUid: OWNER,
        importId: IMPORT,
        udaDir: UDA,
        assetId: assetIdB,
      }),
      visualV0.storageRef,
    );

    // A ha già commit-ato: manifest e byte canonici esistono.
    await bucket.file(refA).save(Buffer.from('byte-di-A'), { resumable: false });
    const visualA = {
      ...visualV0,
      assetId: assetIdA,
      storageRef: refA,
      caption: 'Didascalia di A',
    };

    await expect(
      promoteVisualForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: promotionInput(requestId),
        nowMs: NOW,
        generateAssetId: () => assetIdB,
        beforeTransaction: async () => {
          await lessonRef().update({ visual: visualA });
        },
      }),
    ).rejects.toMatchObject({ code: 'uncertain_state' });

    // Il manifest di A sopravvive intatto: B non l'ha sovrascritto.
    expect((await lessonRef().get()).data()?.visual?.assetId).toBe(assetIdA);
    // E i byte di A non sono stati cancellati dal cleanup sbagliato di B.
    const [bytesA] = await bucket.file(refA).download();
    expect(Buffer.from(bytesA).toString()).toBe('byte-di-A');
    // Nessuna proiezione, nessun registro, nessun audit da parte di B.
    expect((await publicVisualRef().get()).exists).toBe(false);
    expect((await db.collection('aiVisualPromotions').get()).empty).toBe(true);
    expect((await db.collection('auditEvents').get()).empty).toBe(true);
  });

  /**
   * BLOCCANTE 3 — collisione sul percorso canonico.
   *
   * `ifGenerationMatch: 0` significa «solo se non esiste». Una collisione non
   * deve poter cancellare byte già presenti, e poiché la copia precede la
   * transazione il fallimento lascia Firestore intatto per costruzione.
   */
  it('non sovrascrive un oggetto canonico già esistente e non scrive nulla', async () => {
    const requestId = '11111111-2222-4333-8444-000000000006';
    const assetId = '22222222-3333-4444-8555-000000000006';
    const canonical = canonicalVisualStorageRef({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: UDA,
      assetId,
    });
    await seedPromotable({ requestId });

    const preesistenti = Buffer.from('byte-preesistenti-da-non-toccare');
    await bucket.file(canonical).save(preesistenti, { resumable: false });
    writtenObjects.push(canonical);

    await expect(
      promoteVisualForOwner({
        db,
        bucket: preconditionEnforcingBucket(bucket),
        ownerUid: OWNER,
        input: promotionInput(requestId),
        nowMs: NOW,
        generateAssetId: () => assetId,
      }),
    ).rejects.toMatchObject({ code: 'corrupted_state' });

    const [after] = await bucket.file(canonical).download();
    expect(Buffer.from(after).equals(preesistenti)).toBe(true);
    await assertNoPersistentTrace();
  });

  /**
   * BLOCCANTE 4 — un registro illeggibile non è né fresh né replay.
   *
   * Letto come assente produrrebbe un secondo asset e un secondo audit per un
   * `requestId` già promosso; letto come valido restituirebbe un `assetId` che
   * non corrisponde a nulla.
   */
  it('rifiuta un registro di approvazione malformato invece di rigenerare', async () => {
    const requestId = '11111111-2222-4333-8444-000000000007';
    await seedPromotable({ requestId });
    await db
      .doc(`aiVisualPromotions/${computeVisualRunId(OWNER, requestId)}`)
      .set({ contractVersion: 1, ownerUid: OWNER, assetId: 'non-un-uuid' });

    await expect(
      promoteVisualForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: promotionInput(requestId),
        nowMs: NOW,
      }),
    ).rejects.toMatchObject({ code: 'corrupted_state' });

    expect((await lessonRef().get()).data()?.visual).toBeUndefined();
    expect((await publicVisualRef().get()).exists).toBe(false);
  });

  it('replica lo stesso risultato su richiesta ripetuta, senza un secondo asset', async () => {
    const requestId = '11111111-2222-4333-8444-000000000008';
    const assetId = '22222222-3333-4444-8555-000000000008';
    await seedPromotable({ requestId });
    writtenObjects.push(
      canonicalVisualStorageRef({ ownerUid: OWNER, importId: IMPORT, udaDir: UDA, assetId }),
    );

    const first = await promoteVisualForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: promotionInput(requestId),
      nowMs: NOW,
      generateAssetId: () => assetId,
    });
    const second = await promoteVisualForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: promotionInput(requestId),
      nowMs: NOW + 1000,
      generateAssetId: () => '99999999-8888-4777-8666-000000000008',
    });

    expect(first).toEqual({ requestId, replayed: false, assetId });
    expect(second).toEqual({ requestId, replayed: true, assetId });
    expect((await db.collection('auditEvents').get()).size).toBe(1);
  });
});
