import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_PUBLIC_VISUAL_DOC_KEYS,
  FORBIDDEN_PUBLIC_VISUAL_KEYS,
  PUBLIC_LESSON_VISUAL_KEYS,
  PUBLIC_VISUAL_KEYS,
  canonicalVisualStorageRef,
  composePublicLessonVisual,
  projectLessonVisual,
  validateLessonVisualPrivateManifest,
  validateLessonVisualPublicManifest,
  validatePublicLessonVisualDoc,
  type LessonVisualPrivateManifest,
} from './aiVisualManifest.js';
import { MAX_VISUAL_BYTES, VISUAL_STYLE_VERSION } from './aiContentVisualProposal.js';
import { AiVisualError, sha256Hex } from './aiVisualCore.js';

/**
 * VISUAL-ENRICHMENT-03 — i tre contratti persistenti.
 *
 * La garanzia che conta più di tutte, e che questi test difendono per prima, è
 * **negativa**: ciò che è privato non deve poter raggiungere lo studente. Un
 * `storageRef` proiettato rivelerebbe la struttura del repository del docente,
 * un `sourceBodyHash` direbbe di quale testo si parlava, un `sha256` sarebbe un
 * identificatore stabile dei byte. Nessuno dei tre serve a mostrare l'immagine.
 */

const ASSET_ID = '11111111-2222-4333-8444-555555555555';
const OWNER = 'owner-uid';
const IMPORT = 'imp-1';
const UDA = 'uda-01';

/**
 * WebP reale minimo, generato una volta e riusato: i validatori ispezionano i
 * byte davvero, quindi un placeholder non passerebbe.
 */
function tinyWebp(width = 8, height = 6): Buffer {
  // Contenitore RIFF/WEBP con chunk VP8L: sufficiente per `inspectWebp`.
  // Payload di lunghezza **pari**: i chunk RIFF sono allineati a byte pari, e
  // `inspectWebp` verifica che l'ultimo chunk finisca esattamente sul fondo del
  // contenitore. Con 9 byte servirebbe un byte di padding.
  const vp8l = Buffer.alloc(10);
  vp8l.writeUInt8(0x2f, 0);
  const w = width - 1;
  const h = height - 1;
  // 14 bit larghezza, 14 bit altezza, little-endian sui primi 4 byte.
  const bits = (w & 0x3fff) | ((h & 0x3fff) << 14);
  vp8l.writeUInt32LE(bits >>> 0, 1);
  const chunk = Buffer.concat([
    Buffer.from('VP8L', 'ascii'),
    (() => {
      const len = Buffer.alloc(4);
      len.writeUInt32LE(vp8l.length, 0);
      return len;
    })(),
    vp8l,
  ]);
  const riffLen = Buffer.alloc(4);
  riffLen.writeUInt32LE(4 + chunk.length, 0);
  return Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    riffLen,
    Buffer.from('WEBP', 'ascii'),
    chunk,
  ]);
}

const BYTES = tinyWebp();
const DATA_URI = `data:image/webp;base64,${BYTES.toString('base64')}`;

function privateManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assetId: ASSET_ID,
    storageRef: canonicalVisualStorageRef({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: UDA,
      assetId: ASSET_ID,
    }),
    anchor: {
      headingSlug: 'evaporazione',
      headingText: 'Evaporazione',
      placement: 'after-heading',
    },
    caption: 'Il percorso dell’acqua.',
    altText: 'Ciclo chiuso fra superficie, atmosfera e suolo.',
    width: 8,
    height: 6,
    byteLength: BYTES.byteLength,
    sha256: sha256Hex(BYTES),
    mimeType: 'image/webp',
    styleVersion: VISUAL_STYLE_VERSION,
    sourceBodyHash: 'b'.repeat(64),
    approvedAt: { toMillis: () => 1_700_000_000_000 },
    ...over,
  };
}

function publicManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assetId: ASSET_ID,
    anchor: {
      headingSlug: 'evaporazione',
      headingText: 'Evaporazione',
      placement: 'after-heading',
    },
    caption: 'Il percorso dell’acqua.',
    altText: 'Ciclo chiuso fra superficie, atmosfera e suolo.',
    width: 8,
    height: 6,
    ...over,
  };
}

function publicDoc(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    publicLessonId: `${IMPORT}_lesson-1`,
    programId: 'prog-1',
    importId: IMPORT,
    assetId: ASSET_ID,
    dataUri: DATA_URI,
    width: 8,
    height: 6,
    ...over,
  };
}

// ─── Percorso canonico ────────────────────────────────────────────────────────

describe('percorso canonico dell’oggetto approvato', () => {
  it('è sotto il prefisso dell’import, così deleteImportPrefix lo raggiunge', () => {
    const ref = canonicalVisualStorageRef({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: UDA,
      assetId: ASSET_ID,
    });
    expect(ref).toBe(`repository/${OWNER}/${IMPORT}/${UDA}/visuals/${ASSET_ID}.webp`);
    expect(ref.startsWith(`repository/${OWNER}/${IMPORT}/`)).toBe(true);
  });

  it('rifiuta segmenti non validi e assetId non UUID v4', () => {
    for (const bad of ['', ' owner', 'a/b', '.', '..']) {
      expect(() =>
        canonicalVisualStorageRef({
          ownerUid: bad,
          importId: IMPORT,
          udaDir: UDA,
          assetId: ASSET_ID,
        }),
      ).toThrow(AiVisualError);
    }
    expect(() =>
      canonicalVisualStorageRef({
        ownerUid: OWNER,
        importId: IMPORT,
        udaDir: UDA,
        assetId: 'non-un-uuid',
      }),
    ).toThrow(AiVisualError);
  });
});

// ─── Manifest privato ─────────────────────────────────────────────────────────

describe('manifest privato', () => {
  it('accetta un manifest conforme', () => {
    const m = validateLessonVisualPrivateManifest(privateManifest());
    expect(m.assetId).toBe(ASSET_ID);
    expect(m.mimeType).toBe('image/webp');
    expect(m.styleVersion).toBe(VISUAL_STYLE_VERSION);
  });

  it('è lo stesso validatore di VE-01, non una seconda definizione', () => {
    // Se ne esistessero due, divergerebbero al primo cambiamento e uno dei due
    // sarebbe quello sbagliato.
    expect(() => validateLessonVisualPrivateManifest(privateManifest({ note: 'extra' }))).toThrow();
    expect(() =>
      validateLessonVisualPrivateManifest(privateManifest({ approvedAt: 1_700_000_000_000 })),
    ).toThrow(/approvedAt/);
    expect(() =>
      validateLessonVisualPrivateManifest(
        privateManifest({ storageRef: `repository/${OWNER}/${IMPORT}/${UDA}/images/x.webp` }),
      ),
    ).toThrow();
  });
});

// ─── Manifest pubblico ────────────────────────────────────────────────────────

describe('manifest pubblico', () => {
  it('accetta la forma chiusa', () => {
    expect(validateLessonVisualPublicManifest(publicManifest())).toEqual({
      assetId: ASSET_ID,
      anchor: {
        headingSlug: 'evaporazione',
        headingText: 'Evaporazione',
        placement: 'after-heading',
      },
      caption: 'Il percorso dell’acqua.',
      altText: 'Ciclo chiuso fra superficie, atmosfera e suolo.',
      width: 8,
      height: 6,
    });
  });

  it.each([...FORBIDDEN_PUBLIC_VISUAL_KEYS])(
    'rifiuta esplicitamente il campo privato %s',
    (key) => {
      // L'errore deve **nominare** il campo: se un giorno qualcuno proiettasse
      // storageRef, il test che fallisce deve dire quale confine è caduto.
      expect(() => validateLessonVisualPublicManifest(publicManifest({ [key]: 'x' }))).toThrow(
        new RegExp(key),
      );
    },
  );

  it('rifiuta chiavi extra non previste e chiavi mancanti', () => {
    expect(() => validateLessonVisualPublicManifest(publicManifest({ extra: 1 }))).toThrow(
      /chiavi non ammesse/,
    );
    const incomplete = publicManifest();
    delete incomplete.caption;
    expect(() => validateLessonVisualPublicManifest(incomplete)).toThrow(/chiavi non ammesse/);
  });

  it('rifiuta valori fuori contratto', () => {
    expect(() => validateLessonVisualPublicManifest(publicManifest({ assetId: 'x' }))).toThrow();
    expect(() => validateLessonVisualPublicManifest(publicManifest({ width: 0 }))).toThrow();
    expect(() => validateLessonVisualPublicManifest(publicManifest({ width: 1201 }))).toThrow();
    expect(() => validateLessonVisualPublicManifest(publicManifest({ caption: ' x' }))).toThrow();
    expect(() =>
      validateLessonVisualPublicManifest(publicManifest({ anchor: { headingSlug: 'x' } })),
    ).toThrow();
  });
});

describe('proiezione dal privato al pubblico', () => {
  it('porta i campi di rendering e nient’altro', () => {
    const priv = validateLessonVisualPrivateManifest(privateManifest());
    const pub = projectLessonVisual(priv);
    expect(Object.keys(pub).sort()).toEqual([...PUBLIC_VISUAL_KEYS].sort());
  });

  it('non lascia passare alcun campo di governo', () => {
    const priv = validateLessonVisualPrivateManifest(privateManifest());
    const serialized = JSON.stringify(projectLessonVisual(priv));
    for (const forbidden of FORBIDDEN_PUBLIC_VISUAL_KEYS) {
      expect(serialized).not.toContain(forbidden);
    }
    // In particolare il percorso Storage e l'hash del corpo lezione.
    expect(serialized).not.toContain('repository/');
    expect(serialized).not.toContain(priv.sha256);
    expect(serialized).not.toContain(priv.sourceBodyHash);
  });

  it('è l’unica porta: un campo privato nuovo resta privato per default', () => {
    // La proiezione elenca esplicitamente ciò che copia. Un campo aggiunto al
    // manifest privato non compare finché non lo si aggiunge **qui**.
    const priv = validateLessonVisualPrivateManifest(privateManifest());
    const withExtra = { ...priv, futuroCampoPrivato: 'segreto' } as LessonVisualPrivateManifest;
    expect(JSON.stringify(projectLessonVisual(withExtra))).not.toContain('segreto');
  });
});

// ─── Byte pubblici ────────────────────────────────────────────────────────────

describe('documento dei byte pubblici', () => {
  it('accetta la forma chiusa con un WebP reale', () => {
    const doc = validatePublicLessonVisualDoc(publicDoc());
    expect(doc.assetId).toBe(ASSET_ID);
    expect(doc.dataUri.startsWith('data:image/webp;base64,')).toBe(true);
  });

  it.each([...FORBIDDEN_PUBLIC_VISUAL_DOC_KEYS])('rifiuta il campo privato %s', (key) => {
    expect(() => validatePublicLessonVisualDoc(publicDoc({ [key]: 'x' }))).toThrow(new RegExp(key));
  });

  it('rifiuta chiavi extra o mancanti', () => {
    expect(() => validatePublicLessonVisualDoc(publicDoc({ extra: 1 }))).toThrow(
      /chiavi non ammesse/,
    );
    const incomplete = publicDoc();
    delete incomplete.dataUri;
    expect(() => validatePublicLessonVisualDoc(incomplete)).toThrow(/chiavi non ammesse/);
  });

  it('rifiuta una data URI malformata, di un altro MIME o non base64', () => {
    for (const bad of [
      'non-una-data-uri',
      'data:image/png;base64,AAAA',
      'data:image/webp;base64,!!!!',
      'data:image/webp;base64,',
      '',
      42,
      null,
    ]) {
      expect(() => validatePublicLessonVisualDoc(publicDoc({ dataUri: bad }))).toThrow(
        AiVisualError,
      );
    }
  });

  it('rifiuta byte che non sono un WebP reale', () => {
    const notWebp = `data:image/webp;base64,${Buffer.from('non sono webp').toString('base64')}`;
    expect(() => validatePublicLessonVisualDoc(publicDoc({ dataUri: notWebp }))).toThrow(
      AiVisualError,
    );
  });

  it('rifiuta dimensioni che non corrispondono ai byte', () => {
    // Un manifest che giura 1200×800 su byte 8×6 farebbe riservare al layout
    // uno spazio che nessuna immagine riempie.
    expect(() => validatePublicLessonVisualDoc(publicDoc({ width: 100 }))).toThrow(
      /non corrispondono ai byte/,
    );
    expect(() => validatePublicLessonVisualDoc(publicDoc({ height: 100 }))).toThrow(
      /non corrispondono ai byte/,
    );
  });

  it('rifiuta un payload oltre il cap dei byte', () => {
    const tooBig = `data:image/webp;base64,${Buffer.alloc(MAX_VISUAL_BYTES + 1, 1).toString('base64')}`;
    expect(() => validatePublicLessonVisualDoc(publicDoc({ dataUri: tooBig }))).toThrow(
      AiVisualError,
    );
  });

  it('rifiuta identificatori non canonici', () => {
    for (const key of ['publicLessonId', 'programId', 'importId']) {
      for (const bad of ['', ' x', 'a/b', 42, null]) {
        expect(() => validatePublicLessonVisualDoc(publicDoc({ [key]: bad }))).toThrow(
          AiVisualError,
        );
      }
    }
  });
});

describe('composizione dei byte pubblici dal manifest', () => {
  const priv = () => validateLessonVisualPrivateManifest(privateManifest());

  it('compone un documento valido quando i byte sono quelli approvati', () => {
    const doc = composePublicLessonVisual({
      manifest: priv(),
      bytes: BYTES,
      publicLessonId: `${IMPORT}_lesson-1`,
      programId: 'prog-1',
      importId: IMPORT,
    });
    expect(doc.assetId).toBe(ASSET_ID);
    expect(doc.width).toBe(8);
    expect(Object.keys(doc).sort()).toEqual([...PUBLIC_LESSON_VISUAL_KEYS].sort());
  });

  it('rifiuta byte che non sono quelli del manifest', () => {
    /*
     * Manifest e byte arrivano da due letture diverse — Firestore e Storage — e
     * questa è l'unica funzione che li vede insieme: se divergessero, lo
     * studente riceverebbe byte che nessuno ha approvato.
     */
    const other = tinyWebp(10, 4);
    expect(() =>
      composePublicLessonVisual({
        manifest: priv(),
        bytes: other,
        publicLessonId: `${IMPORT}_lesson-1`,
        programId: 'prog-1',
        importId: IMPORT,
      }),
    ).toThrow(/non corrispondono al manifest/);
  });

  it('rifiuta una dimensione dichiarata diversa da quella reale', () => {
    const manifest = { ...priv(), byteLength: BYTES.byteLength + 1 };
    expect(() =>
      composePublicLessonVisual({
        manifest,
        bytes: BYTES,
        publicLessonId: `${IMPORT}_lesson-1`,
        programId: 'prog-1',
        importId: IMPORT,
      }),
    ).toThrow(/dimensione dei byte/);
  });

  it('il documento composto non contiene nulla di privato', () => {
    const manifest = priv();
    const serialized = JSON.stringify(
      composePublicLessonVisual({
        manifest,
        bytes: BYTES,
        publicLessonId: `${IMPORT}_lesson-1`,
        programId: 'prog-1',
        importId: IMPORT,
      }),
    );
    expect(serialized).not.toContain(manifest.storageRef);
    expect(serialized).not.toContain(manifest.sourceBodyHash);
    expect(serialized).not.toContain(manifest.sha256);
    expect(serialized).not.toContain(OWNER);
  });
});
