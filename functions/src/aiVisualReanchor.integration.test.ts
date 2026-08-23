import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { reanchorLessonVisualForOwner } from './aiVisualGateway.js';
import { canonicalVisualStorageRef } from './aiVisualManifest.js';

/**
 * VE-04A — riancoraggio contro Emulator veri.
 *
 * Il criterio non è «l'ancora cambia», ma: **cambia soltanto l'ancora, e
 * soltanto se lo stato fresco lo consente**. Ogni corsa deve produrre zero
 * scritture parziali — un riancoraggio che aggiorna il privato e non il
 * pubblico lascerebbe la figura in due posti diversi per i due ruoli.
 */

const OWNER = 've04a-owner';
const PROGRAM = 've04a-prog';
const IMPORT = 've04a-imp';
const LESSON = 've04a-lesson';
const PUBLIC_LESSON = `${IMPORT}_${LESSON}`;
const UDA = 'uda-01-reti';
const ASSET = '123e4567-e89b-42d3-a456-426614174000';
const STORAGE_REF = canonicalVisualStorageRef({
  ownerUid: OWNER,
  importId: IMPORT,
  udaDir: UDA,
  assetId: ASSET,
});

const BODY = [
  '# Lezione',
  '',
  'intro',
  '',
  '## Reti',
  '',
  'testo',
  '',
  '## Topologie',
  '',
  'altro',
].join('\n');

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

emulatorDescribe('VE-04A riancoraggio — Firestore Emulator', () => {
  let app: App;
  let db: Firestore;

  const lessonRef = () => db.doc(`programs/${PROGRAM}/imports/${IMPORT}/lessons/${LESSON}`);
  const publicRef = () => db.doc(`publicLessons/${PUBLIC_LESSON}`);
  const publicBytesRef = () => db.doc(`publicLessonVisuals/${PUBLIC_LESSON}`);
  const identity = { programId: PROGRAM, importId: IMPORT, lessonId: LESSON };

  beforeAll(() => {
    const projectId = process.env.GCLOUD_PROJECT ?? 'demo-schoolforge';
    app = initializeApp({ projectId }, `ai-visual-reanchor-${randomUUID()}`);
    db = getFirestore(app);
  });

  afterEach(async () => {
    const audit = await db.collection('auditEvents').get();
    await Promise.all(audit.docs.map((d) => d.ref.delete()));
    await Promise.all([lessonRef().delete(), publicRef().delete(), publicBytesRef().delete()]);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  function manifest(over: Record<string, unknown> = {}) {
    return {
      assetId: ASSET,
      storageRef: STORAGE_REF,
      anchor: { headingSlug: 'reti', headingText: 'Reti', placement: 'after-heading' },
      caption: 'Schema dei nodi',
      altText: 'Tre nodi collegati',
      width: 1024,
      height: 768,
      byteLength: 1234,
      sha256: 'a'.repeat(64),
      mimeType: 'image/webp',
      styleVersion: 'schoolforge-sketch/v1',
      sourceBodyHash: 'b'.repeat(64),
      approvedAt: Timestamp.fromMillis(1_700_000_000_000),
      ...over,
    };
  }

  async function seed(params: { completed?: boolean; visual?: unknown; body?: string } = {}) {
    const { completed = false, visual = manifest(), body = BODY } = params;
    await lessonRef().set({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: UDA,
      path: `${UDA}/lezione-001.md`,
      filename: 'lezione-001.md',
      publicLessonId: PUBLIC_LESSON,
      completed,
      ...(visual === null ? {} : { visual }),
    });
    await publicRef().set({
      ownerUid: OWNER,
      programId: PROGRAM,
      importId: IMPORT,
      udaId: UDA,
      udaDir: UDA,
      path: `${UDA}/lezione-001.md`,
      filename: 'lezione-001.md',
      contentPath: `${UDA}/lezione-001.md`,
      content: body,
      completed,
      createdAt: Timestamp.fromMillis(1_700_000_000_000),
      ...(completed && visual !== null
        ? {
            visual: {
              assetId: ASSET,
              anchor: { headingSlug: 'reti', headingText: 'Reti', placement: 'after-heading' },
              caption: 'Schema dei nodi',
              altText: 'Tre nodi collegati',
              width: 1024,
              height: 768,
            },
          }
        : {}),
    });
    // I byte non sono toccati dal riancoraggio: esistono per dimostrarlo.
    await publicBytesRef().set({
      publicLessonId: PUBLIC_LESSON,
      programId: PROGRAM,
      importId: IMPORT,
      assetId: ASSET,
      dataUri: 'data:image/webp;base64,UklGRg==',
      width: 1024,
      height: 768,
    });
  }

  const reanchor = (anchorHeadingText: string, beforeTransaction?: () => Promise<void>) =>
    reanchorLessonVisualForOwner({
      db,
      ownerUid: OWNER,
      input: { ...identity, anchorHeadingText },
      beforeTransaction,
    });

  async function auditActions(): Promise<string[]> {
    const snap = await db.collection('auditEvents').get();
    return snap.docs.map((d) => d.get('action') as string);
  }

  // ── Caso normale ────────────────────────────────────────────────────────────

  it('lezione non svolta: aggiorna solo il privato e scrive l’audit', async () => {
    await seed({ completed: false });

    const result = await reanchor('Topologie');
    expect(result).toEqual({ status: 'reanchored', headingSlug: 'topologie' });

    const visual = (await lessonRef().get()).get('visual');
    expect(visual.anchor).toEqual({
      headingSlug: 'topologie',
      headingText: 'Topologie',
      placement: 'after-heading',
    });
    // Nessuna proiezione su lezione non svolta: il confine dati resta quello.
    expect((await publicRef().get()).get('visual')).toBeUndefined();
    expect(await auditActions()).toEqual(['lesson.visualReanchored']);
  });

  it('lezione svolta: privato e pubblico nello stesso commit', async () => {
    await seed({ completed: true });

    await reanchor('Topologie');

    expect((await lessonRef().get()).get('visual').anchor.headingSlug).toBe('topologie');
    const projected = (await publicRef().get()).get('visual');
    expect(projected.anchor.headingSlug).toBe('topologie');
    // La proiezione resta senza campi privati.
    for (const key of ['storageRef', 'sha256', 'byteLength', 'sourceBodyHash', 'approvedAt']) {
      expect(projected[key]).toBeUndefined();
    }
    expect(await auditActions()).toEqual(['lesson.visualReanchored']);
  });

  /** I byte sono identici: riscriverli sarebbe pagare per non cambiare nulla. */
  it('non tocca publicLessonVisuals', async () => {
    await seed({ completed: true });
    const before = (await publicBytesRef().get()).data();

    await reanchor('Topologie');

    expect((await publicBytesRef().get()).data()).toEqual(before);
  });

  it('non modifica alcun altro campo del manifest', async () => {
    await seed({ completed: true });
    const before = (await lessonRef().get()).get('visual');

    await reanchor('Topologie');
    const after = (await lessonRef().get()).get('visual');

    for (const key of [
      'assetId',
      'storageRef',
      'caption',
      'altText',
      'width',
      'height',
      'byteLength',
      'sha256',
      'mimeType',
      'styleVersion',
      'sourceBodyHash',
    ]) {
      expect(after[key]).toEqual(before[key]);
    }
    expect(after.approvedAt.toMillis()).toBe(before.approvedAt.toMillis());
  });

  // ── Replay ──────────────────────────────────────────────────────────────────

  /**
   * Riancorare dove già si è: doppio clic, retry, risposta persa. Deve costare
   * zero scritture e zero audit — una traccia racconterebbe un'operazione che
   * non è avvenuta.
   */
  it('replay: stessa ancora ⇒ zero scritture e zero audit', async () => {
    await seed({ completed: true });
    const before = (await lessonRef().get()).updateTime;

    const result = await reanchor('Reti');

    expect(result).toEqual({ status: 'replayed', headingSlug: 'reti' });
    expect((await lessonRef().get()).updateTime.isEqual(before)).toBe(true);
    expect(await auditActions()).toEqual([]);
  });

  // ── Fail-closed ─────────────────────────────────────────────────────────────

  it('rifiuta se l’heading non esiste nel corpo', async () => {
    await seed({ completed: true });
    await expect(reanchor('Sezione inesistente')).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await lessonRef().get()).get('visual').anchor.headingSlug).toBe('reti');
    expect(await auditActions()).toEqual([]);
  });

  it('rifiuta se la lezione non ha alcuna immagine', async () => {
    await seed({ visual: null });
    await expect(reanchor('Topologie')).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await auditActions()).toEqual([]);
  });

  it('rifiuta un manifest malformato invece di ripararlo', async () => {
    await seed({ visual: { assetId: 'non-un-uuid' } });
    await expect(reanchor('Topologie')).rejects.toMatchObject({ code: 'corrupted_state' });
    expect(await auditActions()).toEqual([]);
  });

  it('rifiuta la lezione di un altro docente', async () => {
    await seed();
    await expect(
      reanchorLessonVisualForOwner({
        db,
        ownerUid: 'altro-docente',
        input: { ...identity, anchorHeadingText: 'Topologie' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  /** Un heading di livello 1 non riceve `id`: non è ancorabile. */
  it('rifiuta un heading che il renderer non identifica', async () => {
    await seed({ completed: true });
    await expect(reanchor('Lezione')).rejects.toMatchObject({ code: 'invalid_input' });
  });

  // ── Corse ───────────────────────────────────────────────────────────────────

  /**
   * Il corpo cambia fra preflight e commit: l'ancora si risolve sul corpo
   * **fresco**, quindi una sezione sparita nel frattempo non viene usata.
   */
  it('corsa sul corpo: la sezione sparisce prima del commit', async () => {
    await seed({ completed: true });

    await expect(
      reanchor('Topologie', async () => {
        await publicRef().update({ content: '# Lezione\n\n## Reti\n\ntesto\n' });
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });

    expect((await lessonRef().get()).get('visual').anchor.headingSlug).toBe('reti');
    expect((await publicRef().get()).get('visual').anchor.headingSlug).toBe('reti');
    expect(await auditActions()).toEqual([]);
  });

  it('corsa sul manifest: sostituito prima del commit', async () => {
    await seed({ completed: true });

    await expect(
      reanchor('Topologie', async () => {
        await lessonRef().update({ visual: { assetId: 'non-un-uuid' } });
      }),
    ).rejects.toMatchObject({ code: 'corrupted_state' });

    expect(await auditActions()).toEqual([]);
  });

  /**
   * La lezione viene smarcata fra preflight e commit: il gate di identità
   * rileva la divergenza fra `LessonDoc` e proiezione e ferma tutto.
   */
  it('corsa sullo stato di svolgimento: smarcata prima del commit', async () => {
    await seed({ completed: true });

    await expect(
      reanchor('Topologie', async () => {
        await lessonRef().update({ completed: false });
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });

    expect((await lessonRef().get()).get('visual').anchor.headingSlug).toBe('reti');
    expect(await auditActions()).toEqual([]);
  });

  it('corsa sulla proiezione: smette di corrispondere alla lezione', async () => {
    await seed({ completed: true });

    await expect(
      reanchor('Topologie', async () => {
        await publicRef().update({ filename: 'lezione-002.md' });
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });

    expect((await lessonRef().get()).get('visual').anchor.headingSlug).toBe('reti');
    expect(await auditActions()).toEqual([]);
  });

  it('corsa sull’immagine: rimossa prima del commit', async () => {
    await seed({ completed: true });

    await expect(
      reanchor('Topologie', async () => {
        await lessonRef().update({ visual: null });
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });

    expect(await auditActions()).toEqual([]);
  });
});
