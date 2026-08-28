import { describe, expect, it } from 'vitest';
import {
  MAX_VISUAL_DATA_URI_LENGTH,
  composeVisualDataUri,
  isWebpDataUri,
  parsePrivateVisualManifest,
  parsePrivateVisualsManifest,
  readPublicLessonVisualBytes,
  readPublicLessonVisualBytesMulti,
  readPublicVisualManifest,
  readStudentVisualManifest,
} from '../lessonVisualContract.js';

/**
 * VE-04A — lettura fail-closed dei dati visuali.
 *
 * Il criterio è sempre lo stesso: **niente figura è meglio di una figura
 * sbagliata**. Ogni forma non conforme produce `null`, e la lezione si legge
 * com'era prima che la funzione esistesse.
 */

const ASSET = '11111111-2222-4333-8444-555555555555';

function manifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assetId: ASSET,
    anchor: {
      headingSlug: 'la-fotosintesi',
      headingText: 'La fotosintesi',
      placement: 'after-heading',
    },
    caption: 'Schema',
    altText: 'Diagramma',
    width: 1024,
    height: 768,
    ...over,
  };
}

function bytesDoc(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    publicLessonId: 'l1',
    programId: 'p1',
    importId: 'i1',
    assetId: ASSET,
    dataUri: 'data:image/webp;base64,UklGRg==',
    width: 1024,
    height: 768,
    ...over,
  };
}

function privateManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...manifest(),
    storageRef: `repository/owner/i1/uda-01/visuals/${ASSET}.webp`,
    byteLength: 100,
    sha256: 'a'.repeat(64),
    mimeType: 'image/webp',
    styleVersion: 'schoolforge-sketch/v1',
    sourceBodyHash: 'b'.repeat(64),
    approvedAt: { toMillis: () => 1_700_000_000_000 },
    ...over,
  };
}

const privateParams = (value: unknown) => ({
  value,
  ownerUid: 'owner',
  importId: 'i1',
  udaDir: 'uda-01',
});

describe('parsePrivateVisualManifest — refresh autorevole fail-closed', () => {
  it('distingue assente e valido', () => {
    expect(parsePrivateVisualManifest(privateParams(undefined))).toEqual({ kind: 'absent' });
    expect(parsePrivateVisualManifest(privateParams(privateManifest())).kind).toBe('valid');
  });

  it('rifiuta chiave extra o mancante', () => {
    expect(parsePrivateVisualManifest(privateParams(privateManifest({ extra: true }))).kind).toBe(
      'malformed',
    );
    const missing = privateManifest();
    delete missing.caption;
    expect(parsePrivateVisualManifest(privateParams(missing)).kind).toBe('malformed');
  });

  it('rifiuta assetId, path e hash malformati o divergenti', () => {
    for (const over of [
      { assetId: 'bad' },
      { storageRef: `repository/other/i1/uda-01/visuals/${ASSET}.webp` },
      { storageRef: `repository/owner/i1/uda-01/visuals/other.webp` },
      { sha256: 'x' },
      { sourceBodyHash: 'x' },
    ]) {
      expect(parsePrivateVisualManifest(privateParams(privateManifest(over))).kind).toBe(
        'malformed',
      );
    }
  });

  it('rifiuta dimensioni, byte e ancora malformati', () => {
    for (const over of [
      { width: 1_201 },
      { height: 0 },
      { byteLength: 204_801 },
      { anchor: { headingSlug: 'Non valido', headingText: 'X', placement: 'after-heading' } },
      { anchor: { headingSlug: 'x', headingText: 'X', placement: 'inline' } },
    ]) {
      expect(parsePrivateVisualManifest(privateParams(privateManifest(over))).kind).toBe(
        'malformed',
      );
    }
  });

  it('rifiuta Timestamp assente, non risolto o che lancia', () => {
    for (const approvedAt of [
      undefined,
      '2026-01-01',
      { toMillis: () => Number.NaN },
      {
        toMillis: () => {
          throw new Error('bad');
        },
      },
    ]) {
      expect(parsePrivateVisualManifest(privateParams(privateManifest({ approvedAt }))).kind).toBe(
        'malformed',
      );
    }
  });
});

describe('parsePrivateVisualsManifest — array autorevole fail-closed', () => {
  const multiItem = (over: Record<string, unknown> = {}) => ({
    ...privateManifest(),
    source: 'generated',
    ...over,
  });
  it('accetta la radice chiusa e conserva l’ordine', () => {
    const second = '99999999-8888-4777-8666-555555555555';
    const result = parsePrivateVisualsManifest(
      privateParams({
        contractVersion: 'lesson-visuals/v1',
        items: [
          multiItem(),
          multiItem({
            assetId: second,
            storageRef: `repository/owner/i1/uda-01/visuals/${second}.webp`,
          }),
        ],
      }),
    );
    expect(result.kind).toBe('valid');
    if (result.kind === 'valid') {
      expect(result.manifest.items.map((item) => item.assetId)).toEqual([ASSET, second]);
    }
  });

  it.each([
    { contractVersion: 'lesson-visuals/v1', items: [], extra: true },
    { contractVersion: 'lesson-visuals/v2', items: [] },
    { contractVersion: 'lesson-visuals/v1', items: [multiItem({ extra: true })] },
    { contractVersion: 'lesson-visuals/v1', items: [multiItem(), multiItem()] },
    {
      contractVersion: 'lesson-visuals/v1',
      items: [multiItem(), multiItem(), multiItem(), multiItem()],
    },
  ])('rifiuta radici, voci, duplicati e cardinalità non canonici', (value) => {
    expect(parsePrivateVisualsManifest(privateParams(value)).kind).toBe('malformed');
  });
});

describe('readPublicVisualManifest', () => {
  it('accetta il manifest chiuso', () => {
    expect(readPublicVisualManifest(manifest())).toEqual(manifest());
  });

  it('rifiuta ciò che non è un oggetto', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      expect(readPublicVisualManifest(bad)).toBeNull();
    }
  });

  /**
   * Una chiave in più non è un dettaglio: significherebbe che la proiezione ha
   * guadagnato un campo che nessuno ha progettato — magari uno di quelli
   * privati che VE-03A ha lavorato per tenere fuori.
   */
  it('rifiuta chiavi in più, anche private', () => {
    for (const key of ['storageRef', 'sha256', 'byteLength', 'sourceBodyHash', 'approvedAt']) {
      expect(readPublicVisualManifest(manifest({ [key]: 'x' }))).toBeNull();
    }
  });

  it('rifiuta chiavi mancanti', () => {
    for (const key of ['assetId', 'anchor', 'caption', 'altText', 'width', 'height']) {
      const partial = manifest();
      delete partial[key];
      expect(readPublicVisualManifest(partial)).toBeNull();
    }
  });

  it('rifiuta assetId non UUID v4', () => {
    for (const bad of ['', 'x', '11111111-2222-3333-4444-555555555555', 42]) {
      expect(readPublicVisualManifest(manifest({ assetId: bad }))).toBeNull();
    }
  });

  it('rifiuta dimensioni non intere o non positive', () => {
    for (const bad of [0, -1, 1.5, '1024', null, Number.NaN]) {
      expect(readPublicVisualManifest(manifest({ width: bad }))).toBeNull();
      expect(readPublicVisualManifest(manifest({ height: bad }))).toBeNull();
    }
  });

  it('rifiuta caption e altText vuoti o non stringa', () => {
    for (const bad of ['', 42, null]) {
      expect(readPublicVisualManifest(manifest({ caption: bad }))).toBeNull();
      expect(readPublicVisualManifest(manifest({ altText: bad }))).toBeNull();
    }
  });

  it('rifiuta un’ancora malformata o con placement diverso', () => {
    expect(readPublicVisualManifest(manifest({ anchor: null }))).toBeNull();
    expect(
      readPublicVisualManifest(
        manifest({ anchor: { headingSlug: 'x', headingText: 'X', placement: 'inline' } }),
      ),
    ).toBeNull();
    expect(
      readPublicVisualManifest(
        manifest({
          anchor: { headingSlug: 'Non Slug', headingText: 'X', placement: 'after-heading' },
        }),
      ),
    ).toBeNull();
    expect(
      readPublicVisualManifest(
        manifest({
          anchor: { headingSlug: 'x', headingText: 'X', placement: 'after-heading', extra: 1 },
        }),
      ),
    ).toBeNull();
  });
});

describe('readStudentVisualManifest — invariante di visibilità', () => {
  /**
   * Lo stesso ragionamento della mappa concettuale: l'invariante è già imposto
   * dalle Rules e dal server, ma viene riapplicato in lettura perché un
   * documento rimasto indietro non deve poter mostrare un'immagine su una
   * lezione che il docente non ha ancora svolto.
   */
  it('legge il manifest solo su lezione svolta', () => {
    expect(readStudentVisualManifest({ completed: true, visual: manifest() })).not.toBeNull();
    expect(readStudentVisualManifest({ completed: false, visual: manifest() })).toBeNull();
    expect(readStudentVisualManifest({ visual: manifest() })).toBeNull();
  });

  it('una proiezione senza visual legge null', () => {
    expect(readStudentVisualManifest({ completed: true })).toBeNull();
    expect(readStudentVisualManifest({ completed: true, visual: null })).toBeNull();
  });
});

describe('isWebpDataUri', () => {
  it('accetta un data URI WebP canonico', () => {
    expect(isWebpDataUri('data:image/webp;base64,UklGRg==')).toBe(true);
  });

  it('rifiuta prefissi diversi', () => {
    for (const bad of [
      'data:image/png;base64,UklGRg==',
      'https://example.org/a.webp',
      'UklGRg==',
      '',
      42,
      null,
    ]) {
      expect(isWebpDataUri(bad)).toBe(false);
    }
  });

  it('rifiuta base64 non canonico', () => {
    expect(isWebpDataUri('data:image/webp;base64,UklGR')).toBe(false);
    expect(isWebpDataUri('data:image/webp;base64,Ukl!Rg==')).toBe(false);
    expect(isWebpDataUri('data:image/webp;base64,')).toBe(false);
  });

  it('rifiuta un data URI oltre il tetto', () => {
    const huge = `data:image/webp;base64,${'A'.repeat(MAX_VISUAL_DATA_URI_LENGTH)}`;
    expect(isWebpDataUri(huge)).toBe(false);
  });
});

describe('readPublicLessonVisualBytes — coerenza con il manifest', () => {
  const parsed = readPublicVisualManifest(manifest())!;

  it('accetta un documento coerente', () => {
    expect(
      readPublicLessonVisualBytes({ data: bytesDoc(), publicLessonId: 'l1', manifest: parsed }),
    ).toMatchObject({ assetId: ASSET, width: 1024, height: 768 });
  });

  /**
   * Il caso che conta: i due documenti sono scritti nello stesso commit, ma
   * sono due. Un documento rimasto indietro non deve essere mostrato al posto
   * di quello giusto.
   */
  it('rifiuta un assetId divergente dal manifest', () => {
    expect(
      readPublicLessonVisualBytes({
        data: bytesDoc({ assetId: '99999999-8888-4777-8666-555555555555' }),
        publicLessonId: 'l1',
        manifest: parsed,
      }),
    ).toBeNull();
  });

  it('rifiuta un publicLessonId divergente', () => {
    expect(
      readPublicLessonVisualBytes({ data: bytesDoc(), publicLessonId: 'l2', manifest: parsed }),
    ).toBeNull();
  });

  it('rifiuta dimensioni divergenti dal manifest', () => {
    for (const over of [{ width: 800 }, { height: 600 }]) {
      expect(
        readPublicLessonVisualBytes({
          data: bytesDoc(over),
          publicLessonId: 'l1',
          manifest: parsed,
        }),
      ).toBeNull();
    }
  });

  it('rifiuta forma chiusa violata e data URI non WebP', () => {
    expect(
      readPublicLessonVisualBytes({
        data: bytesDoc({ storageRef: 'x' }),
        publicLessonId: 'l1',
        manifest: parsed,
      }),
    ).toBeNull();
    expect(
      readPublicLessonVisualBytes({
        data: bytesDoc({ dataUri: 'data:image/png;base64,AAAA' }),
        publicLessonId: 'l1',
        manifest: parsed,
      }),
    ).toBeNull();
    expect(
      readPublicLessonVisualBytes({ data: null, publicLessonId: 'l1', manifest: parsed }),
    ).toBeNull();
  });
});

describe('readPublicLessonVisualBytesMulti — forma chiusa', () => {
  const publicManifest = readPublicVisualManifest(manifest())!;
  const valid = {
    contractVersion: 'lesson-visuals/v1',
    publicLessonId: 'l1',
    programId: 'p1',
    importId: 'i1',
    bytes: {
      [ASSET]: {
        dataUri: 'data:image/webp;base64,UklGRg==',
        mimeType: 'image/webp',
        width: 1024,
        height: 768,
      },
    },
  };

  it('accetta soltanto la coppia esatta manifest-byte', () => {
    expect(
      readPublicLessonVisualBytesMulti({
        data: valid,
        publicLessonId: 'l1',
        manifests: [publicManifest],
      }),
    ).toHaveProperty(ASSET);
  });

  it.each([
    { ...valid, extra: true },
    { ...valid, bytes: { ...valid.bytes, alien: valid.bytes[ASSET] } },
    {
      ...valid,
      bytes: { [ASSET]: { ...valid.bytes[ASSET], storageRef: 'privato' } },
    },
    { ...valid, publicLessonId: 'altra' },
  ])('rifiuta extra, asset estranei e identità divergenti', (data) => {
    expect(
      readPublicLessonVisualBytesMulti({
        data,
        publicLessonId: 'l1',
        manifests: [publicManifest],
      }),
    ).toBeNull();
  });
});

describe('composeVisualDataUri', () => {
  it('compone un data URI WebP dal base64 verificato', () => {
    expect(composeVisualDataUri('UklGRg==')).toBe('data:image/webp;base64,UklGRg==');
  });

  it('rifiuta base64 non utilizzabile invece di produrre un’immagine rotta', () => {
    for (const bad of ['', 'UklGR', 'Ukl!Rg==', 42, null, undefined]) {
      expect(composeVisualDataUri(bad)).toBeNull();
    }
  });

  it('rifiuta un payload oltre il tetto', () => {
    expect(composeVisualDataUri('A'.repeat(MAX_VISUAL_DATA_URI_LENGTH))).toBeNull();
  });
});
