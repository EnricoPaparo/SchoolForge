import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_PUBLIC_VISUAL_ITEM_KEYS,
  PUBLIC_VISUAL_ITEM_KEYS,
  adaptSingular,
  projectLessonVisualsManifest,
  readLegacyLessonVisuals,
  validateLessonVisualItem,
  validateLessonVisualsManifest,
  validatePublicLessonVisualItem,
  validatePublicLessonVisualsManifest,
} from './aiVisualMultiManifest.js';
import { VISUAL_STYLE_VERSION, validateLessonVisualManifest } from './aiContentVisualProposal.js';
import { canonicalVisualStorageRef } from './aiVisualManifest.js';
import {
  AiVisualMultiError,
  LESSON_VISUALS_CONTRACT_VERSION,
  UPLOADED_VISUAL_STYLE_VERSION,
} from './aiVisualMultiCore.js';

/**
 * MULTI-VISUAL-01 — manifest ad array: forma chiusa, 1..3 elementi,
 * `source`/`styleVersion` coerenti e assenti dal pubblico, ordine e unicità
 * degli `assetId`, matrice di lettura legacy 3×3 completa (roadmap §5, §6).
 */

const OWNER = 'owner-uid';
const IMPORT = 'imp-1';
const UDA = 'uda-01';

const ASSET_ID_1 = '11111111-2222-4333-8444-555555555555';
const ASSET_ID_2 = '22222222-2222-4333-8444-555555555555';
const ASSET_ID_3 = '33333333-2222-4333-8444-555555555555';
const ASSET_ID_4 = '44444444-2222-4333-8444-555555555555';

function storageRefFor(assetId: string): string {
  return canonicalVisualStorageRef({ ownerUid: OWNER, importId: IMPORT, udaDir: UDA, assetId });
}

function item(assetId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assetId,
    storageRef: storageRefFor(assetId),
    anchor: {
      headingSlug: 'evaporazione',
      headingText: 'Evaporazione',
      placement: 'after-heading',
    },
    caption: 'Il percorso dell’acqua.',
    altText: 'Ciclo chiuso fra superficie, atmosfera e suolo.',
    width: 8,
    height: 6,
    byteLength: 1234,
    sha256: 'a'.repeat(64),
    mimeType: 'image/webp',
    source: 'generated',
    styleVersion: VISUAL_STYLE_VERSION,
    sourceBodyHash: 'b'.repeat(64),
    approvedAt: { toMillis: () => 1_700_000_000_000 },
    ...over,
  };
}

function manifestOf(items: Record<string, unknown>[]): Record<string, unknown> {
  return { contractVersion: LESSON_VISUALS_CONTRACT_VERSION, items };
}

function singleVisual(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assetId: ASSET_ID_1,
    storageRef: storageRefFor(ASSET_ID_1),
    anchor: {
      headingSlug: 'evaporazione',
      headingText: 'Evaporazione',
      placement: 'after-heading',
    },
    caption: 'Il percorso dell’acqua.',
    altText: 'Ciclo chiuso fra superficie, atmosfera e suolo.',
    width: 8,
    height: 6,
    byteLength: 1234,
    sha256: 'a'.repeat(64),
    mimeType: 'image/webp',
    styleVersion: VISUAL_STYLE_VERSION,
    sourceBodyHash: 'b'.repeat(64),
    approvedAt: { toMillis: () => 1_700_000_000_000 },
    ...over,
  };
}

// ─── Singola immagine dell'array ────────────────────────────────────────────────

describe('validateLessonVisualItem', () => {
  it("accetta un'immagine generata valida", () => {
    const parsed = validateLessonVisualItem(item(ASSET_ID_1));
    expect(parsed.source).toBe('generated');
    expect(parsed.styleVersion).toBe(VISUAL_STYLE_VERSION);
  });

  it("accetta un'immagine caricata valida", () => {
    const parsed = validateLessonVisualItem(
      item(ASSET_ID_1, { source: 'uploaded', styleVersion: UPLOADED_VISUAL_STYLE_VERSION }),
    );
    expect(parsed.source).toBe('uploaded');
    expect(parsed.styleVersion).toBe(UPLOADED_VISUAL_STYLE_VERSION);
  });

  it('rifiuta source "generated" con styleVersion "uploaded/v1"', () => {
    expect(() =>
      validateLessonVisualItem(item(ASSET_ID_1, { styleVersion: UPLOADED_VISUAL_STYLE_VERSION })),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta source "uploaded" con styleVersion "schoolforge-sketch/v1"', () => {
    expect(() => validateLessonVisualItem(item(ASSET_ID_1, { source: 'uploaded' }))).toThrow(
      AiVisualMultiError,
    );
  });

  it('rifiuta un source non ammesso', () => {
    expect(() => validateLessonVisualItem(item(ASSET_ID_1, { source: 'imported' }))).toThrow();
  });

  it('rifiuta chiavi extra', () => {
    expect(() => validateLessonVisualItem(item(ASSET_ID_1, { extra: true }))).toThrow();
  });

  it('rifiuta una chiave mancante', () => {
    const broken = item(ASSET_ID_1);
    delete broken.caption;
    expect(() => validateLessonVisualItem(broken)).toThrow();
  });
});

// ─── Manifest ad array — cardinalità, ordine, unicità ──────────────────────────

describe('validateLessonVisualsManifest', () => {
  it('accetta 1, 2 o 3 elementi', () => {
    expect(validateLessonVisualsManifest(manifestOf([item(ASSET_ID_1)])).items).toHaveLength(1);
    expect(
      validateLessonVisualsManifest(manifestOf([item(ASSET_ID_1), item(ASSET_ID_2)])).items,
    ).toHaveLength(2);
    expect(
      validateLessonVisualsManifest(
        manifestOf([item(ASSET_ID_1), item(ASSET_ID_2), item(ASSET_ID_3)]),
      ).items,
    ).toHaveLength(3);
  });

  it('rifiuta 0 elementi', () => {
    expect(() => validateLessonVisualsManifest(manifestOf([]))).toThrow(AiVisualMultiError);
  });

  it('rifiuta 4 elementi', () => {
    expect(() =>
      validateLessonVisualsManifest(
        manifestOf([item(ASSET_ID_1), item(ASSET_ID_2), item(ASSET_ID_3), item(ASSET_ID_4)]),
      ),
    ).toThrow(AiVisualMultiError);
  });

  it("preserva l'ordine dell'array", () => {
    const parsed = validateLessonVisualsManifest(
      manifestOf([item(ASSET_ID_3), item(ASSET_ID_1), item(ASSET_ID_2)]),
    );
    expect(parsed.items.map((i) => i.assetId)).toEqual([ASSET_ID_3, ASSET_ID_1, ASSET_ID_2]);
  });

  it('rifiuta assetId duplicati', () => {
    expect(() =>
      validateLessonVisualsManifest(manifestOf([item(ASSET_ID_1), item(ASSET_ID_1)])),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta contractVersion non letterale', () => {
    expect(() =>
      validateLessonVisualsManifest({
        contractVersion: 'lesson-visuals/v2',
        items: [item(ASSET_ID_1)],
      }),
    ).toThrow(AiVisualMultiError);
  });
});

// ─── Proiezione pubblica ────────────────────────────────────────────────────────

describe('manifest pubblico', () => {
  it('PUBLIC_VISUAL_ITEM_KEYS non contiene "source"', () => {
    expect((PUBLIC_VISUAL_ITEM_KEYS as readonly string[]).includes('source')).toBe(false);
  });

  it('FORBIDDEN_PUBLIC_VISUAL_ITEM_KEYS contiene "source"', () => {
    expect((FORBIDDEN_PUBLIC_VISUAL_ITEM_KEYS as readonly string[]).includes('source')).toBe(true);
  });

  it('validatePublicLessonVisualItem rifiuta un oggetto con "source"', () => {
    expect(() =>
      validatePublicLessonVisualItem({
        assetId: ASSET_ID_1,
        anchor: {
          headingSlug: 'evaporazione',
          headingText: 'Evaporazione',
          placement: 'after-heading',
        },
        caption: 'Didascalia.',
        altText: 'Alt.',
        width: 8,
        height: 6,
        source: 'generated',
      }),
    ).toThrow(AiVisualMultiError);
  });

  it('projectLessonVisualsManifest deriva il pubblico senza source/storageRef/sha256/…', () => {
    const priv = validateLessonVisualsManifest(manifestOf([item(ASSET_ID_1), item(ASSET_ID_2)]));
    const pub = projectLessonVisualsManifest(priv);
    expect(pub.items).toHaveLength(2);
    for (const publicItem of pub.items) {
      expect(Object.keys(publicItem).sort()).toEqual([...PUBLIC_VISUAL_ITEM_KEYS].sort());
      expect('source' in publicItem).toBe(false);
    }
    expect(pub.items.map((i) => i.assetId)).toEqual([ASSET_ID_1, ASSET_ID_2]);
  });

  it('validatePublicLessonVisualsManifest accetta 1..3 e rifiuta 0/4', () => {
    expect(
      validatePublicLessonVisualsManifest({
        contractVersion: LESSON_VISUALS_CONTRACT_VERSION,
        items: [
          {
            assetId: ASSET_ID_1,
            anchor: { headingSlug: 'a', headingText: 'A', placement: 'after-heading' },
            caption: 'C',
            altText: 'A',
            width: 8,
            height: 6,
          },
        ],
      }).items,
    ).toHaveLength(1);
    expect(() =>
      validatePublicLessonVisualsManifest({
        contractVersion: LESSON_VISUALS_CONTRACT_VERSION,
        items: [],
      }),
    ).toThrow(AiVisualMultiError);
  });
});

// ─── adaptSingular ──────────────────────────────────────────────────────────────

describe('adaptSingular', () => {
  it('è equivalente campo per campo al manifest singolo, con source: "generated"', () => {
    const single = validateLessonVisualManifest(singleVisual());
    const adapted = adaptSingular(single);
    expect(adapted).toEqual({
      assetId: single.assetId,
      storageRef: single.storageRef,
      anchor: single.anchor,
      caption: single.caption,
      altText: single.altText,
      width: single.width,
      height: single.height,
      byteLength: single.byteLength,
      sha256: single.sha256,
      mimeType: single.mimeType,
      source: 'generated',
      styleVersion: single.styleVersion,
      sourceBodyHash: single.sourceBodyHash,
      approvedAt: single.approvedAt,
    });
  });
});

// ─── Matrice di lettura legacy 3×3 (roadmap §6.1) ──────────────────────────────

describe('readLegacyLessonVisuals — matrice completa', () => {
  const validVisuals = manifestOf([item(ASSET_ID_1)]);
  const validVisual = singleVisual();
  const malformed = { notAField: true };

  it.each([
    ['assente', 'assente', {}, 'none'],
    ['assente', 'valido', { visual: validVisual }, 'ok'],
    ['assente', 'malformato', { visual: malformed }, 'visual_legacy_malformed'],
    ['valido', 'assente', { visuals: validVisuals }, 'ok'],
    ['valido', 'valido', { visuals: validVisuals, visual: validVisual }, 'visual_legacy_conflict'],
    [
      'valido',
      'malformato',
      { visuals: validVisuals, visual: malformed },
      'visual_legacy_conflict',
    ],
    ['malformato', 'assente', { visuals: malformed }, 'visuals_malformed'],
    ['malformato', 'valido', { visuals: malformed, visual: validVisual }, 'visual_legacy_conflict'],
    [
      'malformato',
      'malformato',
      { visuals: malformed, visual: malformed },
      'visual_legacy_conflict',
    ],
  ] as const)('visuals=%s, visual=%s ⇒ %s', (_v, _s, doc, expectedStatus) => {
    const outcome = readLegacyLessonVisuals(doc);
    expect(outcome.status).toBe(expectedStatus);
  });

  it('visuals valido produce adoptedFromSingular: false', () => {
    const outcome = readLegacyLessonVisuals({ visuals: validVisuals });
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.adoptedFromSingular).toBe(false);
  });

  it('visual singolare valido produce adoptedFromSingular: true e adaptSingular equivalente', () => {
    const outcome = readLegacyLessonVisuals({ visual: validVisual });
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.adoptedFromSingular).toBe(true);
      expect(outcome.manifest.items).toHaveLength(1);
      expect(outcome.manifest.items[0]?.source).toBe('generated');
      expect(outcome.manifest.items[0]?.assetId).toBe(ASSET_ID_1);
    }
  });

  it('nessuno dei due campi presenti ⇒ nessuna immagine', () => {
    expect(readLegacyLessonVisuals({})).toEqual({ status: 'none' });
  });

  it('un campo esplicitamente undefined è trattato come assente', () => {
    expect(readLegacyLessonVisuals({ visual: undefined, visuals: undefined })).toEqual({
      status: 'none',
    });
  });
});
