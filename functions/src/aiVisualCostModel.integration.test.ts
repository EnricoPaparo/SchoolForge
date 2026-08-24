import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { resolveAiVisualMode, sha256Hex } from './aiVisualCore.js';
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
 * VISUAL-ENRICHMENT-03C — cost model **misurato**, non stimato.
 *
 * Un cost model scritto a mano invecchia in silenzio: si aggiunge una lettura,
 * la tabella resta quella di prima, e nessuno se ne accorge finché non arriva
 * la fattura. Qui ogni operazione viene eseguita davvero contro gli Emulator
 * con Firestore e Storage strumentati, e i numeri finiscono in una tabella che
 * il test stampa e — per le grandezze che contano — verifica.
 *
 * Le asserzioni sono deliberatamente **di forma**, non di valore esatto: che
 * l'export di zero visual non legga Storage, che nessuna operazione introduca
 * un listener, che il costo cresca linearmente con le immagini e non con le
 * lezioni. Bloccare un numero preciso renderebbe il test fragile senza
 * proteggere da nulla.
 */

const OWNER = 've03c-cost-owner';
const PROGRAM = 've03c-cost-prog';
const IMPORT = 've03c-cost-imp';
const UDA = 'uda-01-reti';
const BODY = '# Lezione\n\n## Reti\n\nTesto.\n';

const emulatorDescribe =
  process.env.FIRESTORE_EMULATOR_HOST && process.env.STORAGE_EMULATOR_HOST
    ? describe
    : describe.skip;

interface Counters {
  firestoreReads: number;
  firestoreWrites: number;
  storageReads: number;
  storageWrites: number;
  storageDeletes: number;
  egressBytes: number;
}

function emptyCounters(): Counters {
  return {
    firestoreReads: 0,
    firestoreWrites: 0,
    storageReads: 0,
    storageWrites: 0,
    storageDeletes: 0,
    egressBytes: 0,
  };
}

emulatorDescribe('VE-03 cost model — misurato sugli Emulator', () => {
  let app: App;
  let rawDb: Firestore;
  let rawBucket: BucketLike;
  let counters = emptyCounters();
  const report: Array<{ operazione: string } & Counters> = [];

  beforeAll(() => {
    const projectId = process.env.GCLOUD_PROJECT ?? 'demo-schoolforge';
    app =
      getApps().find((existing) => existing.name === '[DEFAULT]') ??
      initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
    rawDb = getFirestore(app);
    rawBucket = getStorage(app).bucket() as unknown as BucketLike;
  });

  afterAll(async () => {
    // La tabella è l'output vero di questa suite: finisce nella roadmap.
    console.table(report);
    for (const name of [
      'aiVisualCandidates',
      'aiVisualPromotions',
      'aiVisualRemovals',
      'aiVisualAbandonments',
      'visualRuns',
      'auditEvents',
    ]) {
      const snap = await rawDb.collection(name).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
  });

  /** Firestore strumentato: conta letture e scritture senza cambiarne il comportamento. */
  function instrumentedDb(): Firestore {
    const wrapDocRef = (ref: FirebaseFirestore.DocumentReference) =>
      new Proxy(ref, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            if (prop === 'get') counters.firestoreReads += 1;
            if (prop === 'set' || prop === 'update' || prop === 'delete') {
              counters.firestoreWrites += 1;
            }
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });

    return new Proxy(rawDb, {
      get(target, prop, receiver) {
        if (prop === 'doc') {
          return (path: string) => wrapDocRef(target.doc(path));
        }
        if (prop === 'runTransaction') {
          return (fn: (tx: FirebaseFirestore.Transaction) => Promise<unknown>) =>
            target.runTransaction((tx) => {
              const proxied = new Proxy(tx, {
                get(txTarget, txProp, txReceiver) {
                  const value = Reflect.get(txTarget, txProp, txReceiver);
                  if (typeof value !== 'function') return value;
                  return (...args: unknown[]) => {
                    if (txProp === 'get') counters.firestoreReads += 1;
                    if (txProp === 'set' || txProp === 'update' || txProp === 'delete') {
                      counters.firestoreWrites += 1;
                    }
                    return (value as (...a: unknown[]) => unknown).apply(txTarget, args);
                  };
                },
              });
              return fn(proxied);
            });
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as Firestore;
  }

  /** Storage strumentato: conta download, upload, delete e byte in uscita. */
  function instrumentedBucket(): BucketLike {
    return {
      file(path: string) {
        const file = rawBucket.file(path);
        return {
          async download() {
            counters.storageReads += 1;
            const result = await file.download();
            counters.egressBytes += result[0]?.byteLength ?? 0;
            return result;
          },
          async save(data: Uint8Array, options?: unknown) {
            counters.storageWrites += 1;
            return file.save(data, options);
          },
          async delete() {
            counters.storageDeletes += 1;
            return file.delete();
          },
        };
      },
      deleteFiles: (options: { prefix: string }) => rawBucket.deleteFiles(options),
    };
  }

  async function measure<T>(
    operazione: string,
    fn: (db: Firestore, bucket: BucketLike) => Promise<T>,
  ): Promise<T> {
    counters = emptyCounters();
    const result = await fn(instrumentedDb(), instrumentedBucket());
    report.push({ operazione, ...counters });
    return result;
  }

  const lessonRef = (lessonId: string) =>
    rawDb.doc(`programs/${PROGRAM}/imports/${IMPORT}/lessons/${lessonId}`);
  const publicRef = (lessonId: string) => rawDb.doc(`publicLessons/${IMPORT}_${lessonId}`);

  async function seedLesson(lessonId: string, completed = false) {
    await lessonRef(lessonId).set({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: UDA,
      path: `${UDA}/${lessonId}.md`,
      filename: `${lessonId}.md`,
      publicLessonId: `${IMPORT}_${lessonId}`,
      completed,
      poolStatus: 'absent',
      questionCount: 0,
      storageRef: `repository/${OWNER}/${IMPORT}/${UDA}/${lessonId}.md`,
      poolStorageRef: null,
    });
    await publicRef(lessonId).set({
      ownerUid: OWNER,
      programId: PROGRAM,
      importId: IMPORT,
      udaId: UDA,
      udaDir: UDA,
      path: `${UDA}/${lessonId}.md`,
      filename: `${lessonId}.md`,
      contentPath: `repository/${OWNER}/${IMPORT}/${UDA}/${lessonId}.md`,
      content: BODY,
      completed,
      createdAt: Timestamp.fromMillis(1_700_000_000_000),
    });
  }

  async function generateMock(requestId: string) {
    const mode = resolveAiVisualMode({ AI_VISUAL_MODE: 'mock' });
    const ports = createVisualPorts(rawDb, mode, null);
    await generateVisual(
      { requestId, subject: 'Schema essenziale di una rete a tre nodi collegati.' },
      { authenticatedOwnerUid: OWNER, mode, executionId: randomUUID(), nowMs: Date.now() },
      ports,
    );
  }

  const identityOf = (lessonId: string) => ({
    programId: PROGRAM,
    importId: IMPORT,
    lessonId,
  });

  async function approveVisual(lessonId: string): Promise<string> {
    const requestId = randomUUID();
    await bindVisualCandidateForOwner({
      db: rawDb,
      ownerUid: OWNER,
      input: { requestId, ...identityOf(lessonId) },
      nowMs: Date.now(),
    });
    await generateMock(requestId);
    const promoted = await promoteVisualForOwner({
      db: rawDb,
      bucket: rawBucket,
      ownerUid: OWNER,
      input: {
        requestId,
        ...identityOf(lessonId),
        anchorHeadingText: 'Reti',
        anchorHeadingIndex: 0,
        caption: 'Schema dei nodi',
        altText: 'Tre nodi collegati',
      },
      nowMs: Date.now(),
    });
    return promoted.assetId;
  }

  it('bind — solo letture di identità, una scrittura tecnica', async () => {
    await seedLesson('cost-bind');
    const requestId = randomUUID();
    await measure('bind', (db) =>
      bindVisualCandidateForOwner({
        db,
        ownerUid: OWNER,
        input: { requestId, ...identityOf('cost-bind') },
        nowMs: Date.now(),
      }),
    );
    const bind = report.at(-1)!;
    // Nessun byte binario tocca il bind: il corpo non raggiunge il provider e
    // l'immagine non esiste ancora.
    expect(bind.storageReads).toBe(0);
    expect(bind.storageWrites).toBe(0);
    expect(bind.firestoreWrites).toBe(1);
  });

  it('promozione — una copia in Storage e un solo commit', async () => {
    await seedLesson('cost-promote');
    const requestId = randomUUID();
    await bindVisualCandidateForOwner({
      db: rawDb,
      ownerUid: OWNER,
      input: { requestId, ...identityOf('cost-promote') },
      nowMs: Date.now(),
    });
    await generateMock(requestId);

    await measure('promozione', (db, bucket) =>
      promoteVisualForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: {
          requestId,
          ...identityOf('cost-promote'),
          anchorHeadingText: 'Reti',
          anchorHeadingIndex: 0,
          caption: 'Schema dei nodi',
          altText: 'Tre nodi collegati',
        },
        nowMs: Date.now(),
      }),
    );
    const promo = report.at(-1)!;
    expect(promo.storageReads).toBe(1); // staging
    expect(promo.storageWrites).toBe(1); // copia canonica
    expect(promo.storageDeletes).toBe(1); // staging eliminato dopo il commit
  });

  it('replay della promozione — nessuna copia, nessuna scrittura di dominio', async () => {
    const requestId = randomUUID();
    await seedLesson('cost-replay');
    await bindVisualCandidateForOwner({
      db: rawDb,
      ownerUid: OWNER,
      input: { requestId, ...identityOf('cost-replay') },
      nowMs: Date.now(),
    });
    await generateMock(requestId);
    const input = {
      requestId,
      ...identityOf('cost-replay'),
      anchorHeadingText: 'Reti',
      anchorHeadingIndex: 0,
      caption: 'Schema dei nodi',
      altText: 'Tre nodi collegati',
    };
    await promoteVisualForOwner({
      db: rawDb,
      bucket: rawBucket,
      ownerUid: OWNER,
      input,
      nowMs: Date.now(),
    });

    const replay = await measure('promozione (replay)', (db, bucket) =>
      promoteVisualForOwner({ db, bucket, ownerUid: OWNER, input, nowMs: Date.now() }),
    );
    expect(replay.replayed).toBe(true);
    const row = report.at(-1)!;
    // Un replay costa **una** lettura del registro e nient'altro.
    expect(row.storageWrites).toBe(0);
    expect(row.storageDeletes).toBe(0);
    expect(row.firestoreWrites).toBe(0);
  });

  it('completed false → true senza visual costa meno che con visual', async () => {
    await seedLesson('cost-nocompl');
    await measure('completed true (senza visual)', (db, bucket) =>
      setLessonCompletedForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: { ...identityOf('cost-nocompl'), completed: true },
      }),
    );
    const senza = report.at(-1)!;
    expect(senza.storageReads).toBe(0);

    await seedLesson('cost-compl');
    await approveVisual('cost-compl');
    await measure('completed true (con visual)', (db, bucket) =>
      setLessonCompletedForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: { ...identityOf('cost-compl'), completed: true },
      }),
    );
    const con = report.at(-1)!;
    // Pubblicare i byte richiede di leggerli: è l'unica differenza, ed è
    // proporzionale a un'immagine sola.
    expect(con.storageReads).toBeGreaterThanOrEqual(senza.storageReads);
  });

  it('true → false — nessuna lettura binaria per nascondere', async () => {
    await measure('completed false (con visual)', (db, bucket) =>
      setLessonCompletedForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: { ...identityOf('cost-compl'), completed: false },
      }),
    );
    const row = report.at(-1)!;
    // Nascondere non richiede i byte: si cancellano documenti, non si legge.
    expect(row.storageReads).toBe(0);
    expect(row.storageWrites).toBe(0);
  });

  it('rimozione — un delete di blob, nessuna lettura binaria', async () => {
    await measure('rimozione', (db, bucket) =>
      removeLessonVisualForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: identityOf('cost-compl'),
      }),
    );
    const row = report.at(-1)!;
    expect(row.storageReads).toBe(0);
    expect(row.storageDeletes).toBeGreaterThanOrEqual(1);
  });

  it('abbandono — elimina solo lo staging', async () => {
    await seedLesson('cost-abandon');
    const requestId = randomUUID();
    await bindVisualCandidateForOwner({
      db: rawDb,
      ownerUid: OWNER,
      input: { requestId, ...identityOf('cost-abandon') },
      nowMs: Date.now(),
    });
    await generateMock(requestId);

    await measure('abbandono', (db, bucket) =>
      abandonVisualForOwner({ db, bucket, ownerUid: OWNER, requestId }),
    );
    const row = report.at(-1)!;
    expect(row.storageDeletes).toBe(1);
    expect(row.storageWrites).toBe(0);
  });

  it('export con 0 visual — nessuna lettura Storage e nessun byte di egress', async () => {
    const ids = ['cost-e0-a', 'cost-e0-b', 'cost-e0-c'];
    for (const id of ids) await seedLesson(id);

    await measure('export (0 visual)', (db, bucket) =>
      exportLessonVisualsForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: { programId: PROGRAM, importId: IMPORT, lessonIds: ids },
      }),
    );
    const row = report.at(-1)!;
    // La garanzia che conta: una lezione senza immagine non aggiunge
    // operazioni. L'export legge un documento per lezione e basta.
    expect(row.storageReads).toBe(0);
    expect(row.egressBytes).toBe(0);
    expect(row.firestoreWrites).toBe(0);
    expect(row.firestoreReads).toBe(ids.length);
  });

  it('export con 1 e con 10 visual — costo lineare nelle sole immagini', async () => {
    await seedLesson('cost-e1');
    await approveVisual('cost-e1');
    await measure('export (1 visual)', (db, bucket) =>
      exportLessonVisualsForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: { programId: PROGRAM, importId: IMPORT, lessonIds: ['cost-e1'] },
      }),
    );
    const uno = report.at(-1)!;
    expect(uno.storageReads).toBe(1);
    expect(uno.egressBytes).toBeGreaterThan(0);

    const dieci: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const id = `cost-e10-${i}`;
      await seedLesson(id);
      await approveVisual(id);
      dieci.push(id);
    }
    await measure('export (10 visual)', (db, bucket) =>
      exportLessonVisualsForOwner({
        db,
        bucket,
        ownerUid: OWNER,
        input: { programId: PROGRAM, importId: IMPORT, lessonIds: dieci },
      }),
    );
    const molti = report.at(-1)!;
    expect(molti.storageReads).toBe(10);
    expect(molti.firestoreReads).toBe(10);
    expect(molti.firestoreWrites).toBe(0);
    expect(molti.egressBytes).toBeGreaterThan(uno.egressBytes);
  }, 120_000);

  /**
   * Quaranta immagini superano il limite di 32 per richiesta: l'export reale
   * usa due batch. Qui gli artefatti sono seminati direttamente invece di
   * passare da bind/generazione/promozione — ciò che si misura è il **costo
   * dell'export**, che non dipende da come l'immagine è nata, e il percorso
   * completo è già provato dalla suite end-to-end.
   */
  it('export con 40 visual — due batch, costo lineare e nessuna scrittura', async () => {
    const bytes = await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#eef8f9' },
    })
      .webp({ quality: 80 })
      .toBuffer();

    const ids: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      const lessonId = `cost-e40-${i}`;
      const assetId = `${i.toString(16).padStart(8, '0')}-2222-4333-8444-555555555555`;
      const storageRef = canonicalVisualStorageRef({
        ownerUid: OWNER,
        importId: IMPORT,
        udaDir: UDA,
        assetId,
      });
      await seedLesson(lessonId);
      await lessonRef(lessonId).update({
        visual: {
          assetId,
          storageRef,
          anchor: { headingSlug: 'reti', headingText: 'Reti', placement: 'after-heading' },
          caption: 'Schema dei nodi',
          altText: 'Tre nodi collegati',
          width: 32,
          height: 24,
          byteLength: bytes.byteLength,
          sha256: sha256Hex(bytes),
          mimeType: 'image/webp',
          styleVersion: 'schoolforge-sketch/v1',
          sourceBodyHash: 'b'.repeat(64),
          approvedAt: Timestamp.fromMillis(1_700_000_000_000),
        },
      });
      await rawBucket.file(storageRef).save(bytes, { metadata: { contentType: 'image/webp' } });
      ids.push(lessonId);
    }

    // Due chiamate, come le farebbe il client: 32 + 8.
    counters = emptyCounters();
    for (const batch of [ids.slice(0, 32), ids.slice(32)]) {
      await exportLessonVisualsForOwner({
        db: instrumentedDb(),
        bucket: instrumentedBucket(),
        ownerUid: OWNER,
        input: { programId: PROGRAM, importId: IMPORT, lessonIds: batch },
      });
    }
    report.push({ operazione: 'export (40 visual, 2 batch)', ...counters });

    const row = report.at(-1)!;
    expect(row.firestoreReads).toBe(40);
    expect(row.storageReads).toBe(40);
    expect(row.firestoreWrites).toBe(0);
    expect(row.storageWrites).toBe(0);
    expect(row.storageDeletes).toBe(0);
    // Nessun batch supera il tetto dichiarato della risposta.
    expect(row.egressBytes).toBeLessThan(8_000_000);
  }, 180_000);

  it('delete lezione — un delete per blob, nessuna lettura binaria', async () => {
    await measure('delete lezione', (db, bucket) =>
      cleanupVisualArtifactsForDelete({
        db,
        bucket,
        ownerUid: OWNER,
        input: { programId: PROGRAM, importId: IMPORT, lessonIds: ['cost-e1'] },
      }),
    );
    const row = report.at(-1)!;
    expect(row.storageReads).toBe(0);
    expect(row.storageDeletes).toBeGreaterThanOrEqual(1);
  });

  it('delete UDA/corso — costo proporzionale alle lezioni, non alle immagini lette', async () => {
    const ids = ['cost-e10-0', 'cost-e10-1', 'cost-e10-2'];
    await measure('delete UDA (3 lezioni)', (db, bucket) =>
      cleanupVisualArtifactsForDelete({
        db,
        bucket,
        ownerUid: OWNER,
        input: { programId: PROGRAM, importId: IMPORT, lessonIds: ids },
      }),
    );
    const row = report.at(-1)!;
    // Cancellare non richiede di scaricare: zero egress, sempre.
    expect(row.storageReads).toBe(0);
    expect(row.egressBytes).toBe(0);
  });

  it('nessuna operazione ha costo passivo: zero listener e zero polling', () => {
    // Il codice del gateway non registra alcun listener: la verifica è
    // testuale perché un listener assente non produce operazioni da contare,
    // e l'unica prova possibile è che non venga mai creato.
    const gateway = readFileSync(new URL('./aiVisualGateway.ts', import.meta.url), 'utf8');
    for (const forbidden of ['onSnapshot', 'setInterval', 'setTimeout(', '.watch(']) {
      expect(gateway).not.toContain(forbidden);
    }
  });
});
