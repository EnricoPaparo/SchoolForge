import { describe, expect, it, vi } from 'vitest';

const mockCallable = vi.fn();
vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockCallable,
}));

import type { Functions } from 'firebase/functions';
import type { LessonVisualItem } from '../../../../types/firestore.js';
import { createTeacherMultiVisualReader } from '../multiVisualReadClients.js';

const A = '11111111-2222-4333-8444-555555555555';
const B = '99999999-8888-4777-8666-555555555555';

function manifest(assetId: string): LessonVisualItem {
  return {
    assetId,
    storageRef: `repository/owner/import/uda/visuals/${assetId}.webp`,
    anchor: { headingSlug: 'reti', headingText: 'Reti', placement: 'after-heading' },
    caption: `Schema ${assetId}`,
    altText: `Diagramma ${assetId}`,
    width: 800,
    height: 600,
    byteLength: 4,
    sha256: 'a'.repeat(64),
    mimeType: 'image/webp',
    source: 'generated',
    styleVersion: 'schoolforge-sketch/v1',
    sourceBodyHash: 'b'.repeat(64),
    approvedAt: {} as LessonVisualItem['approvedAt'],
  };
}

const asset = (assetId: string) => ({
  assetId,
  manifestJson: '{}\n',
  base64: 'UklGRg==',
  byteLength: 4,
});

describe('createTeacherMultiVisualReader', () => {
  it('legge un solo batch autorevole e riconcilia ordine e dimensioni', async () => {
    mockCallable.mockReset();
    mockCallable.mockResolvedValue({
      data: { items: [{ lessonId: 'lesson-1', status: 'multi', assets: [asset(A), asset(B)] }] },
    });
    const read = createTeacherMultiVisualReader({} as Functions);

    await expect(
      read({
        programId: 'program-1',
        importId: 'import-1',
        lessonId: 'lesson-1',
        manifests: [manifest(A), manifest(B)],
      }),
    ).resolves.toEqual([
      { assetId: A, dataUri: 'data:image/webp;base64,UklGRg==', width: 800, height: 600 },
      { assetId: B, dataUri: 'data:image/webp;base64,UklGRg==', width: 800, height: 600 },
    ]);
    expect(mockCallable).toHaveBeenCalledWith({
      programId: 'program-1',
      importId: 'import-1',
      lessonIds: ['lesson-1'],
    });
  });

  it('fallisce chiuso se gateway e manifest divergono per ordine o cardinalità', async () => {
    const read = createTeacherMultiVisualReader({} as Functions);
    for (const assets of [[asset(B), asset(A)], [asset(A)]]) {
      mockCallable.mockReset();
      mockCallable.mockResolvedValue({
        data: { items: [{ lessonId: 'lesson-1', status: 'multi', assets }] },
      });
      await expect(
        read({
          programId: 'program-1',
          importId: 'import-1',
          lessonId: 'lesson-1',
          manifests: [manifest(A), manifest(B)],
        }),
      ).rejects.toThrow(/divergente/);
    }
  });
});
