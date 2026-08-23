import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  validateAbandonVisualInput,
  validateCanonicalLessonVisual,
  validateDeleteVisualArtifactsInput,
  validateRemoveLessonVisualInput,
  validateSetLessonCompletedInput,
  visualRemovalId,
} from './aiVisualLifecycle.js';
import { canonicalVisualStorageRef } from './aiVisualManifest.js';

const OWNER = 'owner-1';
const IMPORT = 'import-1';
const UDA = 'uda-01-reti';
const ASSET = '123e4567-e89b-42d3-a456-426614174000';

function manifest(over: Record<string, unknown> = {}) {
  return {
    assetId: ASSET,
    storageRef: canonicalVisualStorageRef({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: UDA,
      assetId: ASSET,
    }),
    anchor: { headingSlug: 'reti', headingText: 'Reti', placement: 'after-heading' },
    caption: 'Schema dei collegamenti della rete',
    altText: 'Nodi collegati fra loro con frecce',
    width: 96,
    height: 64,
    byteLength: 128,
    sha256: 'a'.repeat(64),
    mimeType: 'image/webp',
    styleVersion: 'schoolforge-sketch/v1',
    sourceBodyHash: 'b'.repeat(64),
    approvedAt: Timestamp.fromMillis(1_700_000_000_000),
    ...over,
  };
}

describe('VE-03B — payload lifecycle chiusi', () => {
  it('accetta esclusivamente i quattro campi del completamento', () => {
    expect(
      validateSetLessonCompletedInput({
        programId: 'p',
        importId: 'i',
        lessonId: 'l',
        completed: true,
      }),
    ).toEqual({ programId: 'p', importId: 'i', lessonId: 'l', completed: true });
    expect(() =>
      validateSetLessonCompletedInput({
        programId: 'p',
        importId: 'i',
        lessonId: 'l',
        completed: true,
        ownerUid: OWNER,
      }),
    ).toThrow(/proprietà non ammesse/);
  });

  it('accetta rimozione e abbandono solo nelle forme esatte', () => {
    expect(
      validateRemoveLessonVisualInput({ programId: 'p', importId: 'i', lessonId: 'l' }),
    ).toEqual({ programId: 'p', importId: 'i', lessonId: 'l' });
    expect(
      validateAbandonVisualInput({ requestId: '123e4567-e89b-42d3-a456-426614174000' }),
    ).toBeTruthy();
    expect(() => validateAbandonVisualInput({ requestId: 'no', lessonId: 'l' })).toThrow();
  });

  it('limita il cleanup a 100 id unici e rifiuta forme non chiuse', () => {
    const lessonIds = Array.from({ length: 100 }, (_, index) => `lesson-${index}`);
    expect(
      validateDeleteVisualArtifactsInput({ programId: 'p', importId: 'i', lessonIds }),
    ).toEqual({ programId: 'p', importId: 'i', lessonIds });
    expect(() =>
      validateDeleteVisualArtifactsInput({
        programId: 'p',
        importId: 'i',
        lessonIds: [...lessonIds, 'lesson-100'],
      }),
    ).toThrow();
    expect(() =>
      validateDeleteVisualArtifactsInput({
        programId: 'p',
        importId: 'i',
        lessonIds: ['lesson-1', 'lesson-1'],
      }),
    ).toThrow(/duplicati/);
    expect(() =>
      validateDeleteVisualArtifactsInput({
        programId: 'p',
        importId: 'i',
        lessonIds: ['lesson-1'],
        storageRef: 'vietato',
      }),
    ).toThrow(/proprietà non ammesse/);
  });
});

describe('VE-03B — manifest e recovery', () => {
  it('accetta soltanto il riferimento canonico della destinazione', () => {
    expect(
      validateCanonicalLessonVisual({
        value: manifest(),
        ownerUid: OWNER,
        importId: IMPORT,
        udaDir: UDA,
      }),
    ).toMatchObject({ assetId: ASSET });
    expect(() =>
      validateCanonicalLessonVisual({
        value: manifest({ storageRef: `repository/${OWNER}/other/${UDA}/visuals/${ASSET}.webp` }),
        ownerUid: OWNER,
        importId: IMPORT,
        udaDir: UDA,
      }),
    ).toThrow();
  });

  it('produce un id recovery stabile e separato per lezione', () => {
    const input = { programId: 'p', importId: 'i', lessonId: 'l' };
    expect(visualRemovalId(OWNER, input)).toBe(visualRemovalId(OWNER, input));
    expect(visualRemovalId(OWNER, input)).not.toBe(
      visualRemovalId(OWNER, { ...input, lessonId: 'altra' }),
    );
  });
});
