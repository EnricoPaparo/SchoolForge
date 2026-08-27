import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import {
  projectEditorialVisuals,
  removeVisualFromManifest,
  reorderVisualsManifest,
  sameAssetOrder,
  validateReorderVisualsInput,
  validateVisualCleanupRecoveryRecord,
} from './aiVisualMultiEditorial.js';
import { LESSON_VISUALS_CONTRACT_VERSION } from './aiVisualMultiCore.js';

const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
] as const;
function item(assetId: string) {
  return {
    assetId,
    storageRef: `repository/owner/import/uda-01/visuals/${assetId}.webp`,
    anchor: { headingSlug: 'titolo', headingText: 'Titolo', placement: 'after-heading' as const },
    caption: 'Didascalia',
    altText: 'Descrizione',
    width: 100,
    height: 100,
    byteLength: 1000,
    sha256: 'a'.repeat(64),
    mimeType: 'image/webp' as const,
    source: 'generated' as const,
    styleVersion: 'schoolforge-sketch/v1' as const,
    sourceBodyHash: 'b'.repeat(64),
    approvedAt: Timestamp.fromMillis(10),
  };
}
function manifest() {
  return { contractVersion: LESSON_VISUALS_CONTRACT_VERSION, items: ids.map(item) };
}

describe('MULTI-VISUAL-03C editorial pure contract', () => {
  it('riordina solo gli asset esistenti e conserva i campi', () => {
    const result = reorderVisualsManifest(manifest(), [ids[2], ids[0], ids[1]]);
    expect(result.items.map((x) => x.assetId)).toEqual([ids[2], ids[0], ids[1]]);
    expect(result.items[0].storageRef).toContain(ids[2]);
  });
  it('rifiuta cardinalità o asset nuovi nel riordino', () => {
    expect(() =>
      validateReorderVisualsInput({ expectedAssetIds: ids, nextAssetIds: ids.slice(0, 2) }),
    ).toThrow();
    expect(() =>
      validateReorderVisualsInput({
        expectedAssetIds: ids,
        nextAssetIds: [...ids.slice(0, 2), '44444444-4444-4444-8444-444444444444'],
      }),
    ).toThrow();
  });
  it('mantiene il confronto d’ordine sensibile alla posizione', () => {
    expect(sameAssetOrder(ids, ids)).toBe(true);
    expect(sameAssetOrder(ids, [ids[1], ids[0], ids[2]])).toBe(false);
  });
  it('rimuove un asset e produce null sull’ultimo', () => {
    const one = { contractVersion: LESSON_VISUALS_CONTRACT_VERSION, items: [item(ids[0])] };
    expect(removeVisualFromManifest(manifest(), ids[1])?.items).toHaveLength(2);
    expect(removeVisualFromManifest(one, ids[0])).toBeNull();
  });
  it('proietta senza campi privati e gestisce assenza', () => {
    expect(projectEditorialVisuals(null)).toBeNull();
    const publicManifest = projectEditorialVisuals(manifest());
    expect(publicManifest?.items[0]).toEqual({
      assetId: ids[0],
      anchor: item(ids[0]).anchor,
      caption: 'Didascalia',
      altText: 'Descrizione',
      width: 100,
      height: 100,
    });
    expect(publicManifest?.items[0]).not.toHaveProperty('storageRef');
  });
  it('valida il recovery per più asset e percorsi canonici', () => {
    const record = {
      ownerUid: 'owner',
      programId: 'program',
      importId: 'import',
      lessonId: 'lesson',
      publicLessonId: 'public',
      udaDir: 'uda-01',
      assetIds: [...ids],
      storageRefs: ids.map((id) => `repository/owner/import/uda-01/visuals/${id}.webp`),
      createdAt: Timestamp.fromMillis(10),
    };
    expect(validateVisualCleanupRecoveryRecord(record).assetIds).toEqual(ids);
  });
  it.each([
    [
      'asset count',
      {
        assetIds: ids.slice(0, 2),
        storageRefs: ids.map((id) => `repository/owner/import/uda-01/visuals/${id}.webp`),
      },
    ],
    [
      'duplicate',
      {
        assetIds: [ids[0], ids[0]],
        storageRefs: ids
          .slice(0, 2)
          .map((id) => `repository/owner/import/uda-01/visuals/${id}.webp`),
      },
    ],
    [
      'wrong path',
      { assetIds: [ids[0]], storageRefs: ['repository/owner/import/uda-01/visuals/wrong.webp'] },
    ],
    [
      'wrong timestamp',
      {
        assetIds: [ids[0]],
        storageRefs: [`repository/owner/import/uda-01/visuals/${ids[0]}.webp`],
        createdAt: '10',
      },
    ],
  ])('rifiuta recovery corrotto: %s', (_label, change) => {
    const base = {
      ownerUid: 'owner',
      programId: 'program',
      importId: 'import',
      lessonId: 'lesson',
      publicLessonId: 'public',
      udaDir: 'uda-01',
      assetIds: [ids[0]],
      storageRefs: [`repository/owner/import/uda-01/visuals/${ids[0]}.webp`],
      createdAt: Timestamp.fromMillis(10),
    };
    expect(() => validateVisualCleanupRecoveryRecord({ ...base, ...change })).toThrow();
  });
});
