import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { sha256Hex } from './aiVisualCore.js';
import { exportLessonVisualsForOwner } from './aiVisualGateway.js';
import { canonicalVisualStorageRef } from './aiVisualManifest.js';
import {
  MAX_VISUAL_EXPORT_LESSONS_PER_BATCH,
  serializeVisualManifestForExport,
} from './aiVisualExport.js';
import type { BucketLike } from './repositoryGatewayCore.js';

/**
 * VISUAL-ENRICHMENT-03C — l'operazione binaria, contro Emulator veri.
 *
 * Il criterio di questi test non è «l'export funziona», ma: **un visual
 * dichiarato o arriva verificato o l'export si ferma**. Ogni forma di
 * divergenza fra ciò che il `LessonDoc` promette e ciò che lo Storage contiene
 * deve produrre un errore, mai un archivio silenziosamente incompleto.
 */

const OWNER = 've03c-owner';
const OTHER_OWNER = 've03c-altro-docente';
const PROGRAM = 've03c-prog';
const IMPORT = 've03c-imp';
const UDA = 'uda-01-reti';

const emulatorDescribe =
  process.env.FIRESTORE_EMULATOR_HOST && process.env.STORAGE_EMULATOR_HOST
    ? describe
    : describe.skip;

emulatorDescribe('VE-03C export binario — Firestore + Storage Emulator', () => {
  let app: App;
  let db: Firestore;
  let bucket: BucketLike;
  let bytes: Buffer;
  const touchedBlobs: string[] = [];
  const touchedLessons: string[] = [];

  const lessonRef = (lessonId: string) =>
    db.doc(`programs/${PROGRAM}/imports/${IMPORT}/lessons/${lessonId}`);

  const pathFor = (assetId: string) =>
    canonicalVisualStorageRef({ ownerUid: OWNER, importId: IMPORT, udaDir: UDA, assetId });

  beforeAll(async () => {
    const projectId = process.env.GCLOUD_PROJECT ?? 'demo-schoolforge';
    app = initializeApp(
      { projectId, storageBucket: `${projectId}.appspot.com` },
      `ai-visual-export-${randomUUID()}`,
    );
    db = getFirestore(app);
    bucket = getStorage(app).bucket() as unknown as BucketLike;
    bytes = await sharp({
      create: { width: 96, height: 64, channels: 3, background: '#eef8f9' },
    })
      .webp({ quality: 82 })
      .toBuffer();
  });

  afterEach(async () => {
    await Promise.all(touchedLessons.splice(0).map((id) => lessonRef(id).delete()));
    await Promise.all(
      touchedBlobs.splice(0).map(async (path) => {
        try {
          await bucket.file(path).delete();
        } catch {
          // già assente: la pulizia è idempotente.
        }
      }),
    );
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  function manifestFor(assetId: string, over: Record<string, unknown> = {}) {
    return {
      assetId,
      storageRef: pathFor(assetId),
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
      ...over,
    };
  }

  async function seedLesson(params: {
    lessonId: string;
    visual?: Record<string, unknown> | null;
    writeBlob?: boolean;
    blobBytes?: Buffer;
    ownerUid?: string;
  }) {
    const { lessonId, visual, writeBlob = true, blobBytes, ownerUid = OWNER } = params;
    await lessonRef(lessonId).set({
      ownerUid,
      importId: IMPORT,
      udaDir: UDA,
      path: `${UDA}/${lessonId}.md`,
      filename: `${lessonId}.md`,
      publicLessonId: `${IMPORT}_${lessonId}`,
      completed: false,
      ...(visual ? { visual } : {}),
    });
    touchedLessons.push(lessonId);
    if (visual && writeBlob) {
      const ref = visual.storageRef as string;
      await bucket.file(ref).save(blobBytes ?? bytes, {
        metadata: { contentType: 'image/webp' },
      });
      touchedBlobs.push(ref);
    }
  }

  const exportFor = (lessonIds: string[], ownerUid = OWNER) =>
    exportLessonVisualsForOwner({
      db,
      bucket,
      ownerUid,
      input: { programId: PROGRAM, importId: IMPORT, lessonIds },
    });

  // ── Caso normale ────────────────────────────────────────────────────────────

  it('restituisce assent per una lezione senza visual, senza leggere Storage', async () => {
    await seedLesson({ lessonId: 'l-senza' });
    const { items } = await exportFor(['l-senza']);
    expect(items).toEqual([{ lessonId: 'l-senza', status: 'absent' }]);
  });

  it('restituisce manifest e byte per una lezione con visual', async () => {
    const assetId = '123e4567-e89b-42d3-a456-426614174000';
    await seedLesson({ lessonId: 'l-con', visual: manifestFor(assetId) });

    const { items } = await exportFor(['l-con']);
    const item = items[0];

    expect(item?.status).toBe('present');
    if (item?.status !== 'present') throw new Error('atteso present');
    expect(item.assetId).toBe(assetId);
    expect(item.byteLength).toBe(bytes.byteLength);
    // Prova byte-per-byte: ciò che esce è esattamente l'oggetto canonico.
    expect(Buffer.from(item.base64, 'base64').equals(bytes)).toBe(true);
  });

  it('il manifest esportato è quello serializzato in modo deterministico', async () => {
    const assetId = '223e4567-e89b-42d3-a456-426614174000';
    await seedLesson({ lessonId: 'l-det', visual: manifestFor(assetId) });

    const first = await exportFor(['l-det']);
    const second = await exportFor(['l-det']);
    const a = first.items[0];
    const b = second.items[0];
    if (a?.status !== 'present' || b?.status !== 'present') throw new Error('atteso present');

    expect(a.manifestJson).toBe(b.manifestJson);
    expect(JSON.parse(a.manifestJson)).toMatchObject({
      assetId,
      approvedAt: '2023-11-14T22:13:20.000Z',
    });
  });

  it('conserva l’ordine richiesto e mescola present e absent', async () => {
    const assetId = '323e4567-e89b-42d3-a456-426614174000';
    await seedLesson({ lessonId: 'l-a', visual: manifestFor(assetId) });
    await seedLesson({ lessonId: 'l-b' });

    const { items } = await exportFor(['l-b', 'l-a']);
    expect(items.map((i) => `${i.lessonId}:${i.status}`)).toEqual(['l-b:absent', 'l-a:present']);
  });

  // ── Fail-closed ─────────────────────────────────────────────────────────────

  /**
   * Il caso centrale: la lezione promette un'immagine e lo Storage non ce l'ha.
   * Ignorarlo produrrebbe un archivio che sembra completo.
   */
  it('fallisce se il blob dichiarato non esiste', async () => {
    const assetId = '423e4567-e89b-42d3-a456-426614174000';
    await seedLesson({ lessonId: 'l-noblob', visual: manifestFor(assetId), writeBlob: false });

    await expect(exportFor(['l-noblob'])).rejects.toMatchObject({ code: 'corrupted_state' });
  });

  it('fallisce se lo storageRef non è quello canonico', async () => {
    const assetId = '523e4567-e89b-42d3-a456-426614174000';
    const visual = manifestFor(assetId, { storageRef: `repository/${OWNER}/altrove/x.webp` });
    await seedLesson({ lessonId: 'l-noncanon', visual, writeBlob: false });
    await bucket.file(visual.storageRef as string).save(bytes);
    touchedBlobs.push(visual.storageRef as string);

    await expect(exportFor(['l-noncanon'])).rejects.toMatchObject({ code: 'corrupted_state' });
  });

  it('fallisce su un manifest malformato', async () => {
    await seedLesson({
      lessonId: 'l-malformato',
      visual: { assetId: 'non-un-uuid' },
      writeBlob: false,
    });
    await expect(exportFor(['l-malformato'])).rejects.toMatchObject({ code: 'corrupted_state' });
  });

  /**
   * Manifest valido ma byte sostituiti: le dimensioni possono coincidere, i
   * byte no. Il confronto è sul contenuto, non sui soli metadati.
   */
  it('fallisce se l’hash dei byte diverge dal manifest', async () => {
    const assetId = '623e4567-e89b-42d3-a456-426614174000';
    const altered = Buffer.from(bytes);
    altered[altered.length - 1] ^= 0xff;
    await seedLesson({
      lessonId: 'l-hash',
      visual: manifestFor(assetId),
      blobBytes: altered,
    });

    await expect(exportFor(['l-hash'])).rejects.toMatchObject({ code: 'corrupted_state' });
  });

  it('fallisce se byteLength o dimensioni divergono', async () => {
    const assetA = '723e4567-e89b-42d3-a456-426614174000';
    await seedLesson({
      lessonId: 'l-len',
      visual: manifestFor(assetA, { byteLength: bytes.byteLength + 1 }),
    });
    await expect(exportFor(['l-len'])).rejects.toMatchObject({ code: 'corrupted_state' });

    const assetB = '823e4567-e89b-42d3-a456-426614174000';
    await seedLesson({ lessonId: 'l-dim', visual: manifestFor(assetB, { width: 99 }) });
    await expect(exportFor(['l-dim'])).rejects.toMatchObject({ code: 'corrupted_state' });
  });

  it('fallisce se il blob non è un WebP valido', async () => {
    const assetId = '923e4567-e89b-42d3-a456-426614174000';
    const junk = Buffer.from('non sono un webp');
    await seedLesson({
      lessonId: 'l-nonwebp',
      visual: manifestFor(assetId, {
        byteLength: junk.byteLength,
        sha256: sha256Hex(junk),
      }),
      blobBytes: junk,
    });

    // Codice più preciso di `corrupted_state`: non è lo stato a essere
    // incoerente, sono i byte a non essere un WebP. Entrambi sono fail-closed.
    await expect(exportFor(['l-nonwebp'])).rejects.toMatchObject({
      code: 'visual_invalid_format',
    });
  });

  /** Nessun risultato parziale: un batch a metà è un archivio a metà. */
  it('non restituisce risultati parziali se una sola lezione del batch fallisce', async () => {
    const good = 'a23e4567-e89b-42d3-a456-426614174000';
    const bad = 'b23e4567-e89b-42d3-a456-426614174000';
    await seedLesson({ lessonId: 'l-ok', visual: manifestFor(good) });
    await seedLesson({ lessonId: 'l-ko', visual: manifestFor(bad), writeBlob: false });

    await expect(exportFor(['l-ok', 'l-ko'])).rejects.toMatchObject({ code: 'corrupted_state' });
  });

  // ── Identità e proprietà ────────────────────────────────────────────────────

  it('nega la lezione di un altro docente', async () => {
    await seedLesson({ lessonId: 'l-altrui', ownerUid: OTHER_OWNER });
    await expect(exportFor(['l-altrui'])).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('nega una lezione inesistente invece di ignorarla', async () => {
    await expect(exportFor(['l-fantasma'])).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('nega una lezione di un altro import', async () => {
    await lessonRef('l-altroimport').set({
      ownerUid: OWNER,
      importId: 'altro-import',
      udaDir: UDA,
      path: `${UDA}/x.md`,
      filename: 'x.md',
    });
    touchedLessons.push('l-altroimport');
    await expect(exportFor(['l-altroimport'])).rejects.toMatchObject({ code: 'invalid_input' });
  });

  // ── Corse ───────────────────────────────────────────────────────────────────

  /**
   * L'export legge il documento e poi il blob. Se fra i due il manifest cambia,
   * i byte non corrispondono più a ciò che è stato letto: meglio fermarsi che
   * archiviare una figura che non è quella descritta.
   */
  it('fallisce se il blob viene sostituito dopo l’approvazione', async () => {
    const assetId = 'c23e4567-e89b-42d3-a456-426614174000';
    await seedLesson({ lessonId: 'l-race-blob', visual: manifestFor(assetId) });

    const altro = await sharp({
      create: { width: 96, height: 64, channels: 3, background: '#ff0000' },
    })
      .webp({ quality: 82 })
      .toBuffer();
    await bucket.file(pathFor(assetId)).save(altro, { metadata: { contentType: 'image/webp' } });

    await expect(exportFor(['l-race-blob'])).rejects.toMatchObject({ code: 'corrupted_state' });
  });

  /** Dopo una rimozione la lezione non ha più `visual`: caso normale, non errore. */
  it('dopo la rimozione del visual la lezione torna a essere assente', async () => {
    const assetId = 'd23e4567-e89b-42d3-a456-426614174000';
    await seedLesson({ lessonId: 'l-rimosso', visual: manifestFor(assetId) });
    await lessonRef('l-rimosso').update({ visual: null });

    const { items } = await exportFor(['l-rimosso']);
    expect(items).toEqual([{ lessonId: 'l-rimosso', status: 'absent' }]);
  });

  /** Un documento legacy, senza il campo, non è un caso speciale. */
  it('un documento legacy senza campo visual è un absent regolare', async () => {
    await lessonRef('l-legacy').set({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: UDA,
      path: `${UDA}/legacy.md`,
      filename: 'legacy.md',
    });
    touchedLessons.push('l-legacy');

    const { items } = await exportFor(['l-legacy']);
    expect(items).toEqual([{ lessonId: 'l-legacy', status: 'absent' }]);
  });

  // ── Idempotenza e limiti ────────────────────────────────────────────────────

  /**
   * L'export è una lettura pura: ripeterlo — per esempio dopo una risposta
   * persa — deve dare byte identici e non lasciare tracce.
   */
  it('una richiesta ripetuta produce esattamente lo stesso risultato', async () => {
    const assetId = 'e23e4567-e89b-42d3-a456-426614174000';
    await seedLesson({ lessonId: 'l-replay', visual: manifestFor(assetId) });

    const first = await exportFor(['l-replay']);
    const second = await exportFor(['l-replay']);
    expect(second).toEqual(first);

    // Nessuna scrittura: nessun audit e nessun documento tecnico nuovo.
    expect((await db.collection('auditEvents').get()).empty).toBe(true);
    expect((await db.collection('aiVisualPromotions').get()).empty).toBe(true);
  });

  /**
   * **Perché con porte finte e non contro gli Emulator veri.**
   *
   * La versione precedente di questo test passava per il motivo sbagliato: gli
   * id erano validi ma le lezioni non esistevano, quindi l'errore
   * `invalid_input` arrivava da «lezione assente» e non dal limite. Un test
   * verde che non prova ciò che dice è peggio di un test mancante.
   *
   * Con `db` e `bucket` finti la prova diventa esatta: se una sola lettura
   * partisse, il contatore lo direbbe. Gli id sono 33, tutti validi e distinti,
   * così l'unico motivo possibile di rifiuto è il limite.
   */
  it('rifiuta oltre il massimo senza toccare Firestore né Storage', async () => {
    let firestoreCalls = 0;
    let storageCalls = 0;
    const spyDb = {
      doc() {
        firestoreCalls += 1;
        throw new Error('nessuna lettura Firestore deve partire');
      },
    } as unknown as Firestore;
    const spyBucket = {
      file() {
        storageCalls += 1;
        throw new Error('nessun accesso Storage deve partire');
      },
    } as unknown as BucketLike;

    const troppe = Array.from(
      { length: MAX_VISUAL_EXPORT_LESSONS_PER_BATCH + 1 },
      (_, i) => `l-troppe-${i}`,
    );
    expect(new Set(troppe).size).toBe(MAX_VISUAL_EXPORT_LESSONS_PER_BATCH + 1);

    await expect(
      exportLessonVisualsForOwner({
        db: spyDb,
        bucket: spyBucket,
        ownerUid: OWNER,
        input: { programId: PROGRAM, importId: IMPORT, lessonIds: troppe },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });

    expect(firestoreCalls).toBe(0);
    expect(storageCalls).toBe(0);
  });

  /**
   * Il limite esatto resta accettato: un test che prova solo il rifiuto
   * lascerebbe passare un off-by-one che rende inutilizzabile l'ultimo slot.
   */
  it('accetta esattamente il limite anche attraverso il validator d’ingresso', async () => {
    const ids = Array.from(
      { length: MAX_VISUAL_EXPORT_LESSONS_PER_BATCH },
      (_, i) => `l-limite-${i}`,
    );
    for (const id of ids) await seedLesson({ lessonId: id });

    const { items } = await exportLessonVisualsForOwner({
      db,
      bucket,
      ownerUid: OWNER,
      input: { programId: PROGRAM, importId: IMPORT, lessonIds: ids },
    });
    expect(items).toHaveLength(MAX_VISUAL_EXPORT_LESSONS_PER_BATCH);
  });

  /**
   * Ogni forma di payload invalido si ferma prima di qualunque I/O. Il
   * contratto è uno solo, quindi la prova è una sola tabella.
   */
  it('ogni payload invalido fallisce con zero I/O', async () => {
    const spyDb = {
      doc() {
        throw new Error('nessuna lettura Firestore deve partire');
      },
    } as unknown as Firestore;
    const spyBucket = {
      file() {
        throw new Error('nessun accesso Storage deve partire');
      },
    } as unknown as BucketLike;

    const invalidPayloads: unknown[] = [
      null,
      undefined,
      'stringa',
      42,
      [],
      {},
      { programId: PROGRAM, importId: IMPORT },
      { programId: PROGRAM, importId: IMPORT, lessonIds: [] },
      { programId: PROGRAM, importId: IMPORT, lessonIds: ['a', 'a'] },
      { programId: PROGRAM, importId: IMPORT, lessonIds: ['a'], ownerUid: OWNER },
      { programId: PROGRAM, importId: IMPORT, lessonIds: ['a'], storageRef: 'x' },
      { programId: PROGRAM, importId: IMPORT, lessonIds: ['a/b'] },
      { programId: PROGRAM, importId: IMPORT, lessonIds: ['..'] },
      { programId: PROGRAM, importId: IMPORT, lessonIds: ['__riservato__'] },
      { programId: PROGRAM, importId: IMPORT, lessonIds: [' spazio'] },
      { programId: PROGRAM, importId: IMPORT, lessonIds: [42] },
      { programId: '__riservato__', importId: IMPORT, lessonIds: ['a'] },
      { programId: PROGRAM, importId: 'x'.repeat(1501), lessonIds: ['a'] },
    ];

    for (const input of invalidPayloads) {
      await expect(
        exportLessonVisualsForOwner({ db: spyDb, bucket: spyBucket, ownerUid: OWNER, input }),
      ).rejects.toMatchObject({ code: 'invalid_input' });
    }
  });

  /** Il serializzatore usato dal server è lo stesso testato in isolamento. */
  it('il manifest esportato coincide con la serializzazione pura', async () => {
    const assetId = 'f23e4567-e89b-42d3-a456-426614174000';
    const visual = manifestFor(assetId);
    await seedLesson({ lessonId: 'l-serial', visual });

    const { items } = await exportFor(['l-serial']);
    const item = items[0];
    if (item?.status !== 'present') throw new Error('atteso present');
    expect(item.manifestJson).toBe(serializeVisualManifestForExport(visual as never));
  });
});
