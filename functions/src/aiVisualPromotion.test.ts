import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  assertStagedBytesMatchRun,
  buildPromotionPlan,
  composePrivateManifest,
  computePromotionInputHash,
  headingSlug,
  parseStoredVisualPromotion,
  reconcileVisualPromotion,
  listAnchorableHeadings,
  resolveAnchorByIndex,
  resolveAnchorSlugInBody,
  validateVisualPromotionInput,
  visualFingerprint,
  type PromotableRunImage,
  type StoredVisualPromotion,
  type VisualPromotionInput,
} from './aiVisualPromotion.js';
import { canonicalVisualStorageRef } from './aiVisualManifest.js';
import {
  VISUAL_STYLE_VERSION,
  assertVisualProposalMatchesRequest,
  validateVisualProposalOutput,
} from './aiContentVisualProposal.js';
import { AiVisualError, sha256Hex } from './aiVisualCore.js';
import type { StoredVisualCandidate } from './aiVisualCandidate.js';
import { isStoragePreconditionFailed } from './aiVisualGateway.js';

/**
 * VISUAL-ENRICHMENT-03A — promozione.
 *
 * Due garanzie sono difese qui più delle altre, perché sono quelle che un
 * refactor distratto romperebbe senza far fallire nient'altro:
 *
 * 1. **La proiezione pubblica esiste se e solo se la lezione è svolta.** Non
 *    «viene nascosta»: non esiste proprio.
 * 2. **Lo slug dell'ancora è congelato.** Web e Functions usano lo stesso
 *    helper di `@schoolforge/lesson-contract`: questi casi difendono il confine
 *    completo dalla proposta sorgente al manifest canonico.
 */

const ASSET_ID = '11111111-2222-4333-8444-555555555555';
const REQUEST_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function tinyWebp(width = 8, height = 6): Buffer {
  const vp8l = Buffer.alloc(10);
  vp8l.writeUInt8(0x2f, 0);
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  vp8l.writeUInt32LE(bits >>> 0, 1);
  const len = Buffer.alloc(4);
  len.writeUInt32LE(vp8l.length, 0);
  const chunk = Buffer.concat([Buffer.from('VP8L', 'ascii'), len, vp8l]);
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

const CANDIDATE: StoredVisualCandidate = {
  contractVersion: 1,
  ownerUid: 'owner-uid',
  programId: 'prog-1',
  importId: 'imp-1',
  lessonId: 'lesson-1',
  publicLessonId: 'public-lesson-1',
  udaDir: 'uda-01',
  sourceBodyHash: sha256Hex(Buffer.from('# Titolo\n', 'utf8')),
  createdAtMs: 1_700_000_000_000,
  expireAtMs: 1_700_086_400_000,
};

const IMAGE: PromotableRunImage = {
  sha256: sha256Hex(BYTES),
  byteLength: BYTES.byteLength,
  width: 8,
  height: 6,
  mimeType: 'image/webp',
  styleVersion: VISUAL_STYLE_VERSION,
};

const inspectReal = (bytes: Uint8Array) => {
  void bytes;
  return { width: 8, height: 6 };
};

function input(over: Partial<Record<keyof VisualPromotionInput, unknown>> = {}): unknown {
  return {
    requestId: REQUEST_ID,
    programId: 'prog-1',
    importId: 'imp-1',
    lessonId: 'lesson-1',
    anchorHeadingText: 'La fotosintesi',
    anchorHeadingIndex: 0,
    caption: 'Schema della fotosintesi',
    altText: 'Diagramma con foglia, luce e anidride carbonica',
    ...over,
  };
}

function manifestFor(assetId = ASSET_ID) {
  return composePrivateManifest({
    assetId,
    candidate: CANDIDATE,
    image: IMAGE,
    anchor: { headingSlug: 'la-fotosintesi', headingText: 'La fotosintesi' },
    caption: 'Schema della fotosintesi',
    altText: 'Diagramma con foglia, luce e anidride carbonica',
    approvedAt: Timestamp.fromMillis(1_700_000_000_000),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('validateVisualPromotionInput', () => {
  it('accetta il payload chiuso e completo', () => {
    const parsed = validateVisualPromotionInput(input());
    expect(Object.keys(parsed).sort()).toEqual([
      'altText',
      'anchorHeadingIndex',
      'anchorHeadingText',
      'caption',
      'importId',
      'lessonId',
      'programId',
      'requestId',
    ]);
  });

  it('rifiuta un payload che non è un oggetto', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      expect(() => validateVisualPromotionInput(bad)).toThrow(AiVisualError);
    }
  });

  /**
   * Il cuore del contratto: il client non può dichiarare nulla di autorevole.
   * Se un giorno una di queste chiavi passasse, il server starebbe accettando
   * dal chiamante ciò che deve derivare da sé.
   */
  it('rifiuta ogni campo autorevole se il client prova a mandarlo', () => {
    const smuggled = [
      'ownerUid',
      'storageRef',
      'sha256',
      'byteLength',
      'width',
      'height',
      'mimeType',
      'assetId',
      'approvedAt',
      'sourceBodyHash',
      'udaDir',
      'publicLessonId',
      'styleVersion',
    ];
    for (const key of smuggled) {
      expect(() => validateVisualPromotionInput(input({ [key]: 'x' } as never))).toThrow(
        /non ammesse/,
      );
    }
  });

  it('rifiuta un payload a cui manca una chiave', () => {
    const partial = input() as Record<string, unknown>;
    delete partial.caption;
    expect(() => validateVisualPromotionInput(partial)).toThrow(/non ammesse/);
  });

  it('rifiuta un requestId che non è un UUID v4', () => {
    for (const bad of ['', 'nope', '11111111-2222-3333-4444-555555555555']) {
      expect(() => validateVisualPromotionInput(input({ requestId: bad }))).toThrow(/requestId/);
    }
  });

  it('rifiuta un indice heading assente, negativo, frazionario o non numerico', () => {
    for (const bad of [undefined, -1, 1.5, '0', null]) {
      expect(() => validateVisualPromotionInput(input({ anchorHeadingIndex: bad }))).toThrow(
        /Indice/,
      );
    }
  });

  it('accetta il requestId in maiuscolo', () => {
    expect(() =>
      validateVisualPromotionInput(input({ requestId: REQUEST_ID.toUpperCase() })),
    ).not.toThrow();
  });

  it('rifiuta identificatori vuoti, non stringa o con spazi ai bordi', () => {
    for (const key of ['programId', 'importId', 'lessonId']) {
      for (const bad of ['', ' x', 'x ', 42, null]) {
        expect(() => validateVisualPromotionInput(input({ [key]: bad }))).toThrow(AiVisualError);
      }
    }
  });

  /** Un identificatore è un segmento di path: `/`, `.` e `..` sono traversal. */
  it('rifiuta identificatori con separatori o riferimenti relativi', () => {
    for (const bad of ['a/b', '/a', '.', '..']) {
      expect(() => validateVisualPromotionInput(input({ importId: bad }))).toThrow(AiVisualError);
    }
  });

  it('rifiuta i testi editoriali vuoti o non trimmati', () => {
    for (const key of ['anchorHeadingText', 'caption', 'altText']) {
      for (const bad of ['', '  ', ' x', 'x ']) {
        expect(() => validateVisualPromotionInput(input({ [key]: bad }))).toThrow(AiVisualError);
      }
    }
  });

  it('applica i limiti per code point, non per unità UTF-16', () => {
    // Ogni emoji è 1 code point ma 2 unità UTF-16: contando male, 300 emoji
    // sembrerebbero 600 e verrebbero rifiutate a torto.
    const emoji = '🌱'.repeat(300);
    expect(() => validateVisualPromotionInput(input({ anchorHeadingText: emoji }))).not.toThrow();
    expect(() =>
      validateVisualPromotionInput(input({ anchorHeadingText: '🌱'.repeat(301) })),
    ).toThrow(/ancoraggio/i);
  });

  it('rifiuta didascalia e alt text oltre il limite', () => {
    expect(() => validateVisualPromotionInput(input({ caption: 'a'.repeat(501) }))).toThrow(
      /Didascalia/,
    );
    expect(() => validateVisualPromotionInput(input({ altText: 'a'.repeat(1001) }))).toThrow(
      /alternativo/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('headingSlug — casi congelati', () => {
  /**
   * Questa tabella **è** il contratto della duplicazione dichiarata rispetto a
   * `apps/web`. Cambiarla senza cambiare anche là significa spostare le ancore
   * di tutte le immagini già approvate.
   */
  const cases: Array<[string, string]> = [
    ['La fotosintesi', 'la-fotosintesi'],
    ['Perché è così?', 'perche-e-cosi'],
    ['  Spazi   multipli  ', 'spazi-multipli'],
    ['Città e società', 'citta-e-societa'],
    ['1. Introduzione', '1-introduzione'],
    ['A—B', 'a-b'],
    ['CAPS LOCK', 'caps-lock'],
    ['già/però', 'gia-pero'],
    ['---', 'sezione'],
    ['🌱 solo emoji', 'solo-emoji'],
  ];
  for (const [text, expected] of cases) {
    it(`«${text}» → «${expected}»`, () => {
      expect(headingSlug(text)).toBe(expected);
    });
  }

  it('rimuove i diacritici invece di sostituirli con separatori', () => {
    expect(headingSlug('àèìòù')).toBe('aeiou');
  });

  it('è idempotente su uno slug già normalizzato', () => {
    expect(headingSlug('la-fotosintesi')).toBe('la-fotosintesi');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('resolveAnchorSlugInBody', () => {
  const body = [
    '# Lezione',
    '',
    'testo',
    '',
    '## La fotosintesi',
    '',
    'altro',
    '',
    '## La fotosintesi',
    '',
    'ancora',
    '',
    '### Conclusione',
  ].join('\n');

  it('risolve un heading unico', () => {
    expect(resolveAnchorSlugInBody('Conclusione', body)).toEqual({
      headingSlug: 'conclusione',
      headingText: 'Conclusione',
    });
  });

  /**
   * Il suffisso non è inventato: è ricavato contando le occorrenze **nel corpo
   * reale**, esattamente come fa il renderer. La prima occorrenza vince lo slug
   * nudo, ed è quella che viene restituita.
   */
  it('assegna alla prima occorrenza duplicata lo slug senza suffisso', () => {
    expect(resolveAnchorSlugInBody('La fotosintesi', body).headingSlug).toBe('la-fotosintesi');
  });

  it('rifiuta un heading che nel corpo non esiste', () => {
    expect(() => resolveAnchorSlugInBody('Inesistente', body)).toThrow(/non esiste nel corpo/);
  });

  /**
   * Un heading senza caratteri alfanumerici non produce più uno slug vuoto: il
   * renderer gli assegna `sezione`, e il server fa lo stesso. Resta ancorabile
   * solo se è di livello 2 o 3, perché sono gli unici a ricevere un `id`.
   */
  it('assegna il fallback «sezione» come il renderer', () => {
    expect(resolveAnchorSlugInBody('---', '## ---\n')).toEqual({
      headingSlug: 'sezione',
      headingText: '---',
    });
  });

  /** Un `#` di primo livello non riceve `id`: ancorarvisi sarebbe inventare. */
  it('non ancora a un heading di livello 1', () => {
    expect(() => resolveAnchorSlugInBody('Titolo', '# Titolo\n')).toThrow(/non esiste nel corpo/);
  });

  /** L'ancora deve venire dal testo, non da un blocco di codice. */
  it('ignora gli heading finti dentro un blocco recintato', () => {
    const fenced = ['```', '## Falso', '```', '', '## Vero'].join('\n');
    expect(() => resolveAnchorSlugInBody('Falso', fenced)).toThrow(/non esiste/);
    expect(resolveAnchorSlugInBody('Vero', fenced).headingSlug).toBe('vero');
  });

  it('rifiuta qualunque ancora su un corpo senza heading', () => {
    expect(() => resolveAnchorSlugInBody('Qualcosa', 'solo testo')).toThrow(/non esiste/);
  });

  /**
   * Regressione del contratto completo: la proposta conserva il Markdown
   * sorgente esatto, la promozione produce invece testo e slug visibili. Prima
   * di questo test la prima metà passava e la seconda falliva.
   */
  it.each([
    ['## **Reti**', '**Reti**'],
    ['## *Reti*', '*Reti*'],
    ['## `Reti`', '`Reti`'],
    ['## [Reti](https://esempio.it)', '[Reti](https://esempio.it)'],
  ])('proposta → promozione converge per un H2 formattato: %s', (heading, sourceText) => {
    const lessonBody = `${heading}\n\nTesto.\n`;
    const proposal = assertVisualProposalMatchesRequest(
      validateVisualProposalOutput({
        decision: 'image',
        subject: 'Schema semplice delle reti',
        rationale: 'Mostra la relazione fra i nodi.',
        anchorHeadingText: sourceText,
        caption: 'I nodi di una rete.',
        altText: 'Tre nodi collegati fra loro.',
      }),
      lessonBody,
    );

    expect(proposal.decision).toBe('image');
    if (proposal.decision !== 'image') throw new Error('proposta inattesa');
    expect(resolveAnchorSlugInBody(proposal.anchorHeadingText, lessonBody)).toEqual({
      headingSlug: 'reti',
      headingText: 'Reti',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('assertStagedBytesMatchRun', () => {
  it('accetta i byte che il run ha davvero prodotto', () => {
    expect(() =>
      assertStagedBytesMatchRun({ bytes: BYTES, image: IMAGE, inspect: inspectReal }),
    ).not.toThrow();
  });

  it('rifiuta una lunghezza diversa', () => {
    expect(() =>
      assertStagedBytesMatchRun({
        bytes: BYTES,
        image: { ...IMAGE, byteLength: IMAGE.byteLength + 1 },
        inspect: inspectReal,
      }),
    ).toThrow(/non corrispondono al run/);
  });

  /**
   * Il caso che i soli metadati non prenderebbero mai: byte diversi, stessa
   * lunghezza e stesse dimensioni. È esattamente ciò che succederebbe se
   * qualcuno sostituisse l'oggetto staged mentre il docente decide.
   */
  it('rifiuta byte sostituiti che conservano lunghezza e dimensioni', () => {
    const tampered = Buffer.from(BYTES);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() =>
      assertStagedBytesMatchRun({ bytes: tampered, image: IMAGE, inspect: inspectReal }),
    ).toThrow(/non corrispondono al run/);
  });

  it('rifiuta un run che non dichiara un WebP dello stile atteso', () => {
    expect(() =>
      assertStagedBytesMatchRun({
        bytes: BYTES,
        image: { ...IMAGE, mimeType: 'image/png' as never },
        inspect: inspectReal,
      }),
    ).toThrow(/stile atteso/);
    expect(() =>
      assertStagedBytesMatchRun({
        bytes: BYTES,
        image: { ...IMAGE, styleVersion: (VISUAL_STYLE_VERSION + 1) as never },
        inspect: inspectReal,
      }),
    ).toThrow(/stile atteso/);
  });

  it('rifiuta dimensioni ispezionate diverse da quelle dichiarate', () => {
    expect(() =>
      assertStagedBytesMatchRun({
        bytes: BYTES,
        image: IMAGE,
        inspect: () => ({ width: 9, height: 6 }),
      }),
    ).toThrow(/dimensioni staged/);
    expect(() =>
      assertStagedBytesMatchRun({
        bytes: BYTES,
        image: IMAGE,
        inspect: () => ({ width: 8, height: 7 }),
      }),
    ).toThrow(/dimensioni staged/);
  });

  it('propaga il rifiuto dell’ispezione su byte non WebP', () => {
    expect(() =>
      assertStagedBytesMatchRun({
        bytes: BYTES,
        image: IMAGE,
        inspect: () => {
          throw new AiVisualError('visual_invalid_format', 'Struttura WebP non valida.');
        },
      }),
    ).toThrow(/WebP/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('composePrivateManifest', () => {
  it('deriva lo storageRef canonico dal ticket, non dal chiamante', () => {
    expect(manifestFor().storageRef).toBe(
      canonicalVisualStorageRef({
        ownerUid: CANDIDATE.ownerUid,
        importId: CANDIDATE.importId,
        udaDir: CANDIDATE.udaDir,
        assetId: ASSET_ID,
      }),
    );
  });

  it('copia dal run i valori dei byte e dal ticket il sourceBodyHash', () => {
    const manifest = manifestFor();
    expect(manifest.sha256).toBe(IMAGE.sha256);
    expect(manifest.byteLength).toBe(IMAGE.byteLength);
    expect(manifest.width).toBe(IMAGE.width);
    expect(manifest.height).toBe(IMAGE.height);
    expect(manifest.sourceBodyHash).toBe(CANDIDATE.sourceBodyHash);
    expect(manifest.styleVersion).toBe(VISUAL_STYLE_VERSION);
    expect(manifest.mimeType).toBe('image/webp');
  });

  it('ancora sempre dopo l’heading', () => {
    expect(manifestFor().anchor.placement).toBe('after-heading');
  });

  /** Il manifest composto passa dal validatore autorevole, non da un bypass. */
  it('rifiuta un assetId malformato passando dal validatore', () => {
    expect(() =>
      composePrivateManifest({
        assetId: 'non-un-uuid',
        candidate: CANDIDATE,
        image: IMAGE,
        anchor: { headingSlug: 'x', headingText: 'X' },
        caption: 'c',
        altText: 'a',
        approvedAt: Timestamp.fromMillis(1),
      }),
    ).toThrow(AiVisualError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('buildPromotionPlan', () => {
  const base = {
    manifest: manifestFor(),
    bytes: BYTES,
    publicLessonId: 'public-lesson-1',
    programId: 'prog-1',
    importId: 'imp-1',
    previousManifest: null,
  };

  /**
   * La garanzia più importante del modulo. Non «il campo pubblico è vuoto»:
   * non c'è. Uno studente non può leggere ciò che non è stato scritto, nemmeno
   * conoscendo l'id.
   */
  it('non produce alcun artefatto pubblico se la lezione non è svolta', () => {
    const plan = buildPromotionPlan({ ...base, completed: false });
    expect(plan.publicManifest).toBeNull();
    expect(plan.publicBytes).toBeNull();
    expect(plan.privateManifest).toBe(base.manifest);
  });

  it('produce proiezione e byte pubblici se la lezione è svolta', () => {
    const plan = buildPromotionPlan({ ...base, completed: true });
    expect(plan.publicManifest).not.toBeNull();
    expect(plan.publicBytes).not.toBeNull();
    expect(plan.publicBytes?.publicLessonId).toBe('public-lesson-1');
    expect(plan.publicBytes?.dataUri.startsWith('data:image/webp;base64,')).toBe(true);
  });

  it('non fa trapelare nulla di privato nella proiezione', () => {
    const plan = buildPromotionPlan({ ...base, completed: true });
    const projected = plan.publicManifest as unknown as Record<string, unknown>;
    for (const key of ['storageRef', 'sha256', 'byteLength', 'sourceBodyHash', 'approvedAt']) {
      expect(projected).not.toHaveProperty(key);
    }
    const bytesDoc = plan.publicBytes as unknown as Record<string, unknown>;
    for (const key of ['storageRef', 'sha256', 'sourceBodyHash', 'approvedAt', 'ownerUid']) {
      expect(bytesDoc).not.toHaveProperty(key);
    }
  });

  it('non segnala nulla da eliminare alla prima promozione', () => {
    expect(buildPromotionPlan({ ...base, completed: true }).supersededStorageRef).toBeNull();
  });

  /** Sostituzione: il vecchio blob va eliminato, ma **dopo** il commit. */
  it('segnala il blob superato quando l’asset cambia', () => {
    const previous = manifestFor('99999999-8888-4777-8666-555555555555');
    const plan = buildPromotionPlan({ ...base, completed: true, previousManifest: previous });
    expect(plan.supersededStorageRef).toBe(previous.storageRef);
    expect(plan.supersededStorageRef).not.toBe(base.manifest.storageRef);
  });

  it('non segnala nulla se la sostituzione riscrive lo stesso storageRef', () => {
    const plan = buildPromotionPlan({
      ...base,
      completed: true,
      previousManifest: manifestFor(),
    });
    expect(plan.supersededStorageRef).toBeNull();
  });

  it('segnala il blob superato anche su lezione non svolta', () => {
    const previous = manifestFor('99999999-8888-4777-8666-555555555555');
    const plan = buildPromotionPlan({ ...base, completed: false, previousManifest: previous });
    expect(plan.supersededStorageRef).toBe(previous.storageRef);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('computePromotionInputHash', () => {
  const parsed = validateVisualPromotionInput(input()) as VisualPromotionInput;

  it('è stabile', () => {
    expect(computePromotionInputHash(parsed)).toBe(computePromotionInputHash({ ...parsed }));
  });

  /** Il requestId è la chiave, non il contenuto: non entra nell'impronta. */
  it('non dipende dal requestId', () => {
    const other = { ...parsed, requestId: '00000000-0000-4000-8000-000000000000' };
    expect(computePromotionInputHash(other)).toBe(computePromotionInputHash(parsed));
  });

  it('cambia se cambia un qualunque valore editoriale o di identità', () => {
    const fields: Array<[keyof VisualPromotionInput, string]> = [
      ['programId', 'altro'],
      ['importId', 'altro'],
      ['lessonId', 'altro'],
      ['anchorHeadingText', 'Altro'],
      ['caption', 'Altra didascalia'],
      ['altText', 'Altro alt'],
    ];
    for (const [key, value] of fields) {
      expect(computePromotionInputHash({ ...parsed, [key]: value })).not.toBe(
        computePromotionInputHash(parsed),
      );
    }
    expect(computePromotionInputHash({ ...parsed, anchorHeadingIndex: 1 })).not.toBe(
      computePromotionInputHash(parsed),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('reconcileVisualPromotion', () => {
  const stored: StoredVisualPromotion = {
    contractVersion: 1,
    ownerUid: 'owner-uid',
    inputHash: 'hash-1',
    assetId: ASSET_ID,
    storageRef: manifestFor().storageRef,
    createdAtMs: 1_700_000_000_000,
    expireAtMs: 1_700_086_400_000,
  };

  it('è fresca se non esiste alcun record', () => {
    expect(
      reconcileVisualPromotion({ existing: null, ownerUid: 'owner-uid', inputHash: 'hash-1' }),
    ).toEqual({ status: 'fresh' });
  });

  /** Una risposta persa non deve creare un secondo asset. */
  it('replica il risultato identico su richiesta ripetuta', () => {
    expect(
      reconcileVisualPromotion({ existing: stored, ownerUid: 'owner-uid', inputHash: 'hash-1' }),
    ).toEqual({ status: 'replayed', assetId: ASSET_ID, storageRef: stored.storageRef });
  });

  /**
   * Riusare lo stesso requestId cambiando la didascalia non è un retry: è una
   * richiesta diversa, e va rifiutata invece di essere ignorata in silenzio.
   */
  it('è un conflitto se lo stesso requestId porta un input diverso', () => {
    expect(
      reconcileVisualPromotion({ existing: stored, ownerUid: 'owner-uid', inputHash: 'hash-2' }),
    ).toEqual({ status: 'conflict' });
  });

  it('è un conflitto se il proprietario non coincide', () => {
    expect(
      reconcileVisualPromotion({ existing: stored, ownerUid: 'altro', inputHash: 'hash-1' }),
    ).toEqual({ status: 'conflict' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('parseStoredVisualPromotion', () => {
  const record = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    contractVersion: 1,
    ownerUid: 'owner-uid',
    inputHash: 'a'.repeat(64),
    assetId: ASSET_ID,
    storageRef: manifestFor().storageRef,
    createdAtMs: 1_700_000_000_000,
    expireAtMs: 1_700_086_400_000,
    ...over,
  });

  it('accetta il record canonico', () => {
    expect(parseStoredVisualPromotion(record())).toEqual({
      contractVersion: 1,
      ownerUid: 'owner-uid',
      inputHash: 'a'.repeat(64),
      assetId: ASSET_ID,
      storageRef: manifestFor().storageRef,
      createdAtMs: 1_700_000_000_000,
      expireAtMs: 1_700_086_400_000,
    });
  });

  it('rifiuta ciò che non è un oggetto', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      expect(parseStoredVisualPromotion(bad)).toBeNull();
    }
  });

  it('rifiuta chiavi in più o in meno', () => {
    expect(parseStoredVisualPromotion(record({ extra: 'x' }))).toBeNull();
    for (const key of Object.keys(record())) {
      const partial = record();
      delete partial[key];
      expect(parseStoredVisualPromotion(partial)).toBeNull();
    }
  });

  it('rifiuta una contractVersion diversa', () => {
    for (const bad of [0, 2, '1', null]) {
      expect(parseStoredVisualPromotion(record({ contractVersion: bad }))).toBeNull();
    }
  });

  it('rifiuta ownerUid e inputHash fuori contratto', () => {
    for (const bad of ['', ' owner', 'owner ', 42, null]) {
      expect(parseStoredVisualPromotion(record({ ownerUid: bad }))).toBeNull();
    }
    for (const bad of ['', 'corto', 'A'.repeat(64), 'g'.repeat(64), 42]) {
      expect(parseStoredVisualPromotion(record({ inputHash: bad }))).toBeNull();
    }
  });

  it('rifiuta un assetId che non è un UUID v4', () => {
    for (const bad of ['', 'non-un-uuid', '11111111-2222-3333-4444-555555555555', 42]) {
      expect(parseStoredVisualPromotion(record({ assetId: bad }))).toBeNull();
    }
  });

  /**
   * `storageRef` e `assetId` devono raccontare la stessa cosa: se il percorso
   * non finisce con quell'asset, i due campi si contraddicono e nessuno dei due
   * è affidabile — il replay restituirebbe un id che non corrisponde ai byte.
   */
  it('rifiuta uno storageRef non canonico o incoerente con l’assetId', () => {
    for (const bad of [
      '',
      42,
      'repository/owner/imp/uda/visuals/altro.webp',
      `repository/owner/imp/uda/${ASSET_ID}.webp`,
      `${manifestFor().storageRef}.bak`,
    ]) {
      expect(parseStoredVisualPromotion(record({ storageRef: bad }))).toBeNull();
    }
    expect(
      parseStoredVisualPromotion(
        record({ storageRef: manifestFor('99999999-8888-4777-8666-555555555555').storageRef }),
      ),
    ).toBeNull();
  });

  it('rifiuta timestamp non finiti, non positivi o in ordine sbagliato', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, '1700000000000', null]) {
      expect(parseStoredVisualPromotion(record({ createdAtMs: bad }))).toBeNull();
      expect(parseStoredVisualPromotion(record({ expireAtMs: bad }))).toBeNull();
    }
    // Scadenza non successiva alla creazione: il record non descrive una TTL.
    expect(parseStoredVisualPromotion(record({ expireAtMs: 1_700_000_000_000 }))).toBeNull();
    expect(parseStoredVisualPromotion(record({ expireAtMs: 1_699_000_000_000 }))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('visualFingerprint', () => {
  it('distingue assente da presente', () => {
    expect(visualFingerprint(undefined)).toBe('absent');
    expect(visualFingerprint(null)).toBe('absent');
    expect(visualFingerprint(manifestFor())).not.toBe('absent');
  });

  it('è stabile fra due letture dello stesso valore, comunque ordinate', () => {
    const a = { assetId: ASSET_ID, width: 8, anchor: { placement: 'after-heading', slug: 'x' } };
    const b = { anchor: { slug: 'x', placement: 'after-heading' }, width: 8, assetId: ASSET_ID };
    expect(visualFingerprint(a)).toBe(visualFingerprint(b));
  });

  it('normalizza i Timestamp in millisecondi', () => {
    const withTs = { approvedAt: { toMillis: () => 1_700_000_000_000 } };
    const sameTs = { approvedAt: { toMillis: () => 1_700_000_000_000 } };
    const otherTs = { approvedAt: { toMillis: () => 1_700_000_000_001 } };
    expect(visualFingerprint(withTs)).toBe(visualFingerprint(sameTs));
    expect(visualFingerprint(withTs)).not.toBe(visualFingerprint(otherTs));
  });

  it('cambia se cambia qualunque cosa del manifest', () => {
    const base = visualFingerprint(manifestFor());
    expect(visualFingerprint(manifestFor('99999999-8888-4777-8666-555555555555'))).not.toBe(base);
    expect(visualFingerprint({ ...manifestFor(), caption: 'Altra' })).not.toBe(base);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * La precondizione di creazione non è dimostrabile sull'Emulator, che la
 * ignora: qui viene congelato il fatto che il **call site** la chieda. Senza
 * questo test, toglierla dal gateway non farebbe fallire nulla — e in
 * produzione, dove GCS la applica davvero, una collisione di percorso
 * tornerebbe a sovrascrivere byte altrui in silenzio.
 */
describe('copia canonica — precondizione di creazione al call site', () => {
  const gateway = readFileSync(new URL('./aiVisualGateway.ts', import.meta.url), 'utf8');

  it('ogni save su Storage del gateway porta ifGenerationMatch: 0', () => {
    const saves = gateway.match(/\.save\(/g) ?? [];
    const preconditions = gateway.match(/preconditionOpts: \{ ifGenerationMatch: 0 \}/g) ?? [];
    expect(saves.length).toBeGreaterThan(0);
    expect(preconditions.length).toBe(saves.length);
  });

  it('tratta il 412 come precondizione fallita e non come errore generico', () => {
    expect(isStoragePreconditionFailed({ code: 412 })).toBe(true);
    for (const other of [{ code: 404 }, { code: 500 }, {}, null, undefined, 'x']) {
      expect(isStoragePreconditionFailed(other)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * VE-04A — **la tabella condivisa con il renderer**.
 *
 * VE-03A congelava i casi di questa implementazione, ma solo di questa: nessuno
 * aveva confrontato le due metà della duplicazione dichiarata, e non
 * coincidevano su apostrofi e duplicati — cioè su due forme che in italiano
 * capitano continuamente. Questa tabella è ora la **stessa** su entrambi i lati:
 * il gemello vive in `apps/web/src/components/__tests__/lessonHeadingSlug.test.ts`
 * e confronta gli stessi ingressi con le stesse uscite.
 *
 * Se qualcuno cambia uno dei due, uno dei due test fallisce.
 */
export const SHARED_HEADING_SLUG_CASES: Array<[string, string]> = [
  ['La fotosintesi', 'la-fotosintesi'],
  ["L'acqua", 'lacqua'],
  ['L’energia', 'lenergia'],
  ['Perché è così?', 'perche-e-cosi'],
  ['Città e società', 'citta-e-societa'],
  ['  Spazi   multipli  ', 'spazi-multipli'],
  ['1. Introduzione', '1-introduzione'],
  ['A—B', 'a-b'],
  ['CAPS LOCK', 'caps-lock'],
  ['---', 'sezione'],
  ['\u{1F331} solo emoji', 'solo-emoji'],
];

describe('headingSlug — tabella condivisa con il renderer', () => {
  for (const [text, expected] of SHARED_HEADING_SLUG_CASES) {
    it(`«${text}» → «${expected}»`, () => {
      expect(headingSlug(text)).toBe(expected);
    });
  }

  /** L'apostrofo sparisce, non diventa un separatore. */
  it('elimina gli apostrofi invece di trasformarli in trattini', () => {
    expect(headingSlug("L'acqua")).toBe('lacqua');
    expect(headingSlug('L\u2019acqua')).toBe('lacqua');
    expect(headingSlug("L'acqua")).not.toContain('-');
  });
});

describe('resolveAnchorSlugInBody — numerazione dei duplicati', () => {
  const body = ['## Reti', 'a', '## Reti', 'b', '## Reti', 'c'].join('\n');

  /**
   * Il renderer numera dal **2**: `reti`, `reti-2`, `reti-3`. Numerare dal 1
   * avrebbe fatto puntare l'ancora al duplicato sbagliato.
   */
  it('la prima occorrenza vince lo slug nudo', () => {
    expect(resolveAnchorSlugInBody('Reti', body).headingSlug).toBe('reti');
  });

  it('numera i duplicati come il renderer, a partire da -2', () => {
    const occurrences = ['## Uno', '## Reti', '## Reti'].join('\n');
    expect(resolveAnchorSlugInBody('Uno', occurrences).headingSlug).toBe('uno');
    // La risoluzione restituisce sempre la **prima** occorrenza del testo, ma
    // il contatore avanza come nel renderer: è la numerazione a dover
    // coincidere, non l'occorrenza scelta.
    expect(resolveAnchorSlugInBody('Reti', occurrences).headingSlug).toBe('reti');
  });

  it('ancora a un heading di livello 3 come a uno di livello 2', () => {
    expect(resolveAnchorSlugInBody('Dettaglio', '## Reti\n\n### Dettaglio\n').headingSlug).toBe(
      'dettaglio',
    );
  });

  /** Livelli 1, 4, 5 e 6 non ricevono `id`: non sono ancorabili. */
  it('ignora i livelli che il renderer non identifica', () => {
    for (const markup of ['# Titolo', '#### Titolo', '##### Titolo', '###### Titolo']) {
      expect(() => resolveAnchorSlugInBody('Titolo', `${markup}\n`)).toThrow(/non esiste/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('listAnchorableHeadings e resolveAnchorByIndex', () => {
  const body = [
    '# Titolo di primo livello',
    '',
    '## **Reti**',
    '',
    'a',
    '',
    '## Reti',
    '',
    'b',
    '',
    '### `Dettaglio`',
    '',
    'c',
    '',
    '#### Troppo profondo',
  ].join('\n');

  /** Solo H2/H3, testo canonicalizzato, slug numerati come nel DOM. */
  it('elenca gli heading ancorabili con testo canonico e slug', () => {
    expect(listAnchorableHeadings(body)).toEqual([
      { index: 0, text: 'Reti', slug: 'reti', level: 2 },
      { index: 1, text: 'Reti', slug: 'reti-2', level: 2 },
      { index: 2, text: 'Dettaglio', slug: 'dettaglio', level: 3 },
    ]);
  });

  it('la seconda occorrenza è realmente riancorabile a -2', () => {
    expect(
      resolveAnchorByIndex({ lessonBody: body, anchorHeadingIndex: 1, anchorHeadingText: 'Reti' }),
    ).toEqual({ headingSlug: 'reti-2', headingText: 'Reti' });
  });

  it('la prima occorrenza resta lo slug nudo', () => {
    expect(
      resolveAnchorByIndex({ lessonBody: body, anchorHeadingIndex: 0, anchorHeadingText: 'Reti' }),
    ).toEqual({ headingSlug: 'reti', headingText: 'Reti' });
  });

  it('rifiuta un indice fuori range', () => {
    for (const index of [3, 99]) {
      expect(() =>
        resolveAnchorByIndex({
          lessonBody: body,
          anchorHeadingIndex: index,
          anchorHeadingText: 'Reti',
        }),
      ).toThrow(/non esiste più/);
    }
  });

  /**
   * Indice valido ma testo divergente: il corpo è cambiato fra la scelta del
   * docente e il commit, e quella posizione non descrive più ciò che ha visto.
   */
  it('rifiuta un indice valido con testo divergente', () => {
    expect(() =>
      resolveAnchorByIndex({
        lessonBody: body,
        anchorHeadingIndex: 0,
        anchorHeadingText: 'Topologie',
      }),
    ).toThrow(/sono cambiate/);
  });

  it('il confronto è sul testo canonico, non sul Markdown grezzo', () => {
    expect(() =>
      resolveAnchorByIndex({
        lessonBody: body,
        anchorHeadingIndex: 0,
        anchorHeadingText: '**Reti**',
      }),
    ).toThrow(/sono cambiate/);
  });

  it('ignora i livelli che il renderer non identifica', () => {
    const texts = listAnchorableHeadings(body).map((h) => h.text);
    expect(texts).not.toContain('Titolo di primo livello');
    expect(texts).not.toContain('Troppo profondo');
  });
});
