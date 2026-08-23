import { randomUUID } from 'node:crypto';
import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AI_VISUAL_SERVER_CONFIG,
  computeVisualRunId,
  resolveAiVisualMode,
  visualStagingRef,
} from './aiVisualCore.js';
import { generateVisual } from './aiVisualEngine.js';
import {
  abandonVisualForOwner,
  bindVisualCandidateForOwner,
  cleanupVisualArtifactsForDelete,
  createVisualPorts,
  exportLessonVisualsForOwner,
  promoteVisualForOwner,
  removeLessonVisualForOwner,
  setLessonCompletedForOwner,
} from './aiVisualGateway.js';
import { canonicalVisualStorageRef } from './aiVisualManifest.js';
import type { BucketLike } from './repositoryGatewayCore.js';

/**
 * VISUAL-ENRICHMENT-03C — il ciclo di vita completo, in un solo racconto.
 *
 * Le suite di VE-03A e VE-03B provano ciascuna il proprio pezzo. Questa prova
 * che i pezzi stiano insieme: la stessa lezione attraversa bind, generazione
 * mock, promozione, pubblicazione, export, spubblicazione, ripubblicazione,
 * sostituzione, rimozione e cancellazione — e dopo **ogni** passaggio si
 * verifica non solo che ci sia ciò che deve esserci, ma che non sia rimasto
 * ciò che non deve: nessun documento pubblico orfano, nessun blob orfano,
 * nessun dato privato nella proiezione.
 *
 * La generazione è **esclusivamente mock**: `AI_VISUAL_MODE=mock` è
 * deterministico e a costo zero, e un contatore verifica che il provider reale
 * non venga mai sfiorato.
 */

const OWNER = 've03c-e2e-owner';
const PROGRAM = 've03c-e2e-prog';
const IMPORT = 've03c-e2e-imp';
const LESSON = 've03c-e2e-lesson';
const PUBLIC_LESSON = `${IMPORT}_${LESSON}`;
const UDA = 'uda-01-reti';
const BODY = '# Lezione\n\n## Reti\n\nTesto della lezione.\n';

const emulatorDescribe =
  process.env.FIRESTORE_EMULATOR_HOST && process.env.STORAGE_EMULATOR_HOST
    ? describe
    : describe.skip;

emulatorDescribe('VE-03 end-to-end — dal candidato alla cancellazione', () => {
  let app: App;
  let db: Firestore;
  let bucket: BucketLike;

  const lessonRef = () => db.doc(`programs/${PROGRAM}/imports/${IMPORT}/lessons/${LESSON}`);
  const publicRef = () => db.doc(`publicLessons/${PUBLIC_LESSON}`);
  const publicBytesRef = () => db.doc(`publicLessonVisuals/${PUBLIC_LESSON}`);
  const identity = { programId: PROGRAM, importId: IMPORT, lessonId: LESSON };

  beforeAll(async () => {
    const projectId = process.env.GCLOUD_PROJECT ?? 'demo-schoolforge';
    // App **di default**, non nominata: `createVisualPorts` costruisce i propri
    // handle Storage dall'app di default, e una suite che ne usasse una
    // nominata proverebbe un percorso diverso da quello di produzione — con lo
    // staging che fallisce per un bucket non configurato invece che per un
    // difetto vero.
    app =
      getApps().find((existing) => existing.name === '[DEFAULT]') ??
      initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
    db = getFirestore(app);
    bucket = getStorage(app).bucket() as unknown as BucketLike;

    await lessonRef().set({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: UDA,
      path: `${UDA}/lezione-001.md`,
      filename: 'lezione-001.md',
      publicLessonId: PUBLIC_LESSON,
      completed: false,
      poolStatus: 'absent',
      questionCount: 0,
      storageRef: `repository/${OWNER}/${IMPORT}/${UDA}/lezione-001.md`,
      poolStorageRef: null,
    });
    await publicRef().set({
      ownerUid: OWNER,
      programId: PROGRAM,
      importId: IMPORT,
      udaId: UDA,
      udaDir: UDA,
      path: `${UDA}/lezione-001.md`,
      filename: 'lezione-001.md',
      contentPath: `repository/${OWNER}/${IMPORT}/${UDA}/lezione-001.md`,
      content: BODY,
      completed: false,
      createdAt: Timestamp.fromMillis(1_700_000_000_000),
    });
  });

  afterAll(async () => {
    for (const name of [
      'aiVisualCandidates',
      'aiVisualPromotions',
      'aiVisualRemovals',
      'aiVisualAbandonments',
      'visualRuns',
      'auditEvents',
    ]) {
      const snap = await db.collection(name).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
    await Promise.all([lessonRef().delete(), publicRef().delete(), publicBytesRef().delete()]);
  });

  /** Conta le invocazioni del provider: deve restare a zero oltre il mock. */
  let providerCalls = 0;

  async function generateMock(requestId: string): Promise<void> {
    const mode = resolveAiVisualMode({ AI_VISUAL_MODE: 'mock' });
    expect(mode).toBe('mock');
    const ports = createVisualPorts(db, mode, null);
    const spied = {
      ...ports,
      callProvider: async (args: Parameters<typeof ports.callProvider>[0]) => {
        providerCalls += 1;
        expect(args.mode).toBe('mock');
        return ports.callProvider(args);
      },
    };
    await generateVisual(
      { requestId, subject: 'Schema essenziale di una rete a tre nodi collegati.' },
      { authenticatedOwnerUid: OWNER, mode, executionId: randomUUID(), nowMs: Date.now() },
      spied,
    );
  }

  async function auditActions(): Promise<string[]> {
    const snap = await db.collection('auditEvents').get();
    return snap.docs.map((d) => d.get('action') as string).sort();
  }

  async function objectExists(path: string): Promise<boolean> {
    try {
      await bucket.file(path).download();
      return true;
    } catch {
      return false;
    }
  }

  const promotionInput = (requestId: string) => ({
    requestId,
    ...identity,
    anchorHeadingText: 'Reti',
    caption: 'Schema dei nodi della rete',
    altText: 'Tre nodi collegati da frecce',
  });

  let firstAssetId = '';
  let firstStorageRef = '';
  let secondStorageRef = '';

  it('1-6. bind, generazione mock, staging, promozione e manifest privato', async () => {
    const requestId = randomUUID();

    // 2. bind del candidato: nessuna immagine esiste ancora.
    const bind = await bindVisualCandidateForOwner({
      db,
      ownerUid: OWNER,
      input: { requestId, ...identity },
      nowMs: Date.now(),
    });
    expect(bind.status).toBe('created');

    // 3-4. generazione mock e staging del WebP.
    await generateMock(requestId);
    const opaqueRunId = computeVisualRunId(OWNER, requestId);
    expect(await objectExists(visualStagingRef(OWNER, opaqueRunId))).toBe(true);

    // 5. promozione.
    const promoted = await promoteVisualForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: promotionInput(requestId),
      nowMs: Date.now(),
    });
    expect(promoted.replayed).toBe(false);
    firstAssetId = promoted.assetId;
    firstStorageRef = canonicalVisualStorageRef({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: UDA,
      assetId: firstAssetId,
    });

    // 6. il manifest privato è sul LessonDoc, i byte al percorso canonico.
    const visual = (await lessonRef().get()).get('visual') as Record<string, unknown>;
    expect(visual.assetId).toBe(firstAssetId);
    expect(visual.storageRef).toBe(firstStorageRef);
    expect(visual.styleVersion).toBe(AI_VISUAL_SERVER_CONFIG.styleVersion);
    expect(await objectExists(firstStorageRef)).toBe(true);

    // Lo staging è sparito: nessun blob orfano dopo il commit.
    expect(await objectExists(visualStagingRef(OWNER, opaqueRunId))).toBe(false);
    expect(await auditActions()).toEqual(['lesson.visualApproved']);
  });

  it('7. lezione non svolta: nessuna proiezione, nessun documento di byte', async () => {
    expect((await publicRef().get()).get('visual')).toBeUndefined();
    expect((await publicBytesRef().get()).exists).toBe(false);
  });

  it('8-9. false → true pubblica manifest e byte, senza nulla di privato', async () => {
    await setLessonCompletedForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: { ...identity, completed: true },
    });

    const projected = (await publicRef().get()).get('visual') as Record<string, unknown>;
    expect(projected.assetId).toBe(firstAssetId);
    // La garanzia negativa: nulla di privato attraversa la proiezione.
    for (const forbidden of [
      'storageRef',
      'sha256',
      'byteLength',
      'sourceBodyHash',
      'approvedAt',
      'mimeType',
      'styleVersion',
      'ownerUid',
    ]) {
      expect(projected[forbidden]).toBeUndefined();
    }

    const bytesDoc = (await publicBytesRef().get()).data() as Record<string, unknown>;
    expect(bytesDoc.assetId).toBe(firstAssetId);
    expect(String(bytesDoc.dataUri).startsWith('data:image/webp;base64,')).toBe(true);
    expect(bytesDoc.storageRef).toBeUndefined();
    expect(bytesDoc.sourceBodyHash).toBeUndefined();
  });

  it('10. export ZIP: manifest deterministico e byte identici al canonico', async () => {
    const auditBefore = await auditActions();
    const { items } = await exportLessonVisualsForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: { programId: PROGRAM, importId: IMPORT, lessonIds: [LESSON] },
    });
    const item = items[0];
    if (item?.status !== 'present') throw new Error('atteso present');

    const [canonical] = await bucket.file(firstStorageRef).download();
    expect(Buffer.from(item.base64, 'base64').equals(Buffer.from(canonical))).toBe(true);

    const manifest = JSON.parse(item.manifestJson) as Record<string, unknown>;
    expect(manifest.assetId).toBe(firstAssetId);
    expect(typeof manifest.approvedAt).toBe('string');
    // L'export non scrive: l'audit è esattamente quello di prima, non uno in
    // più. Non introduciamo un'azione «esportato» per simmetria — l'export
    // testuale che affianca non ne emette, e una traccia solo qui
    // racconterebbe metà della stessa azione.
    expect(await auditActions()).toEqual(auditBefore);
  });

  it('11-12. true → false rimuove il pubblico e conserva il privato', async () => {
    await setLessonCompletedForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: { ...identity, completed: false },
    });

    expect((await publicRef().get()).get('visual')).toBeUndefined();
    expect((await publicBytesRef().get()).exists).toBe(false);
    // Il privato resta: spubblicare non è rimuovere.
    expect((await lessonRef().get()).get('visual')).toBeDefined();
    expect(await objectExists(firstStorageRef)).toBe(true);
  });

  it('13. nuovo false → true ripubblica senza toccare il provider', async () => {
    const before = providerCalls;
    await setLessonCompletedForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: { ...identity, completed: true },
    });

    expect((await publicRef().get()).get('visual')).toBeDefined();
    expect((await publicBytesRef().get()).exists).toBe(true);
    expect(providerCalls).toBe(before);
  });

  it('14. sostituzione: nuovo asset, vecchio blob eliminato, proiezione allineata', async () => {
    const requestId = randomUUID();
    await bindVisualCandidateForOwner({
      db,
      ownerUid: OWNER,
      input: { requestId, ...identity },
      nowMs: Date.now(),
    });
    await generateMock(requestId);

    const promoted = await promoteVisualForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: { ...promotionInput(requestId), caption: 'Schema aggiornato della rete' },
      nowMs: Date.now(),
    });
    expect(promoted.assetId).not.toBe(firstAssetId);
    secondStorageRef = canonicalVisualStorageRef({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: UDA,
      assetId: promoted.assetId,
    });

    expect((await lessonRef().get()).get('visual').assetId).toBe(promoted.assetId);
    expect((await publicRef().get()).get('visual').assetId).toBe(promoted.assetId);
    expect((await publicBytesRef().get()).get('assetId')).toBe(promoted.assetId);

    // Il blob superato è stato eliminato: nessun orfano dopo una sostituzione.
    expect(await objectExists(secondStorageRef)).toBe(true);
    expect(await objectExists(firstStorageRef)).toBe(false);
  });

  it('15-16. rimozione esplicita: tutto sparisce, privato e pubblico', async () => {
    await removeLessonVisualForOwner({ db, bucket, ownerUid: OWNER, input: identity });

    expect((await lessonRef().get()).get('visual')).toBeUndefined();
    expect((await publicRef().get()).get('visual')).toBeUndefined();
    expect((await publicBytesRef().get()).exists).toBe(false);
    expect(await objectExists(secondStorageRef)).toBe(false);
    expect(await auditActions()).toContain('lesson.visualRemoved');
  });

  it('l’export di una lezione ripulita è un absent regolare, non un errore', async () => {
    const { items } = await exportLessonVisualsForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: { programId: PROGRAM, importId: IMPORT, lessonIds: [LESSON] },
    });
    expect(items).toEqual([{ lessonId: LESSON, status: 'absent' }]);
  });

  it('l’abbandono di un candidato non promosso non lascia tracce', async () => {
    const requestId = randomUUID();
    await bindVisualCandidateForOwner({
      db,
      ownerUid: OWNER,
      input: { requestId, ...identity },
      nowMs: Date.now(),
    });
    await generateMock(requestId);
    const opaqueRunId = computeVisualRunId(OWNER, requestId);
    expect(await objectExists(visualStagingRef(OWNER, opaqueRunId))).toBe(true);

    await abandonVisualForOwner({ db, bucket, ownerUid: OWNER, requestId });

    expect(await objectExists(visualStagingRef(OWNER, opaqueRunId))).toBe(false);
    expect((await lessonRef().get()).get('visual')).toBeUndefined();
    expect((await publicBytesRef().get()).exists).toBe(false);
  });

  it('17. cancellazione della lezione ripulisce documenti e blob', async () => {
    // Nuova immagine, così la cancellazione ha davvero qualcosa da ripulire.
    const requestId = randomUUID();
    await bindVisualCandidateForOwner({
      db,
      ownerUid: OWNER,
      input: { requestId, ...identity },
      nowMs: Date.now(),
    });
    await generateMock(requestId);
    const promoted = await promoteVisualForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: promotionInput(requestId),
      nowMs: Date.now(),
    });
    const finalRef = canonicalVisualStorageRef({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: UDA,
      assetId: promoted.assetId,
    });
    expect(await objectExists(finalRef)).toBe(true);

    const result = await cleanupVisualArtifactsForDelete({
      db,
      bucket,
      ownerUid: OWNER,
      input: { programId: PROGRAM, importId: IMPORT, lessonIds: [LESSON] },
    });
    expect(result.status).toBe('completed');

    expect((await lessonRef().get()).get('visual')).toBeUndefined();
    expect((await publicBytesRef().get()).exists).toBe(false);
    expect(await objectExists(finalRef)).toBe(false);
  });

  it('nessuna chiamata a un provider reale in tutto il ciclo', () => {
    // Ogni generazione è passata dal mock deterministico, e il conteggio lo
    // dimostra: il provider OpenAI non è stato sfiorato nemmeno una volta.
    expect(providerCalls).toBeGreaterThan(0);
    expect(process.env.AI_VISUAL_MODE ?? 'mock').not.toBe('openai');
  });
});
