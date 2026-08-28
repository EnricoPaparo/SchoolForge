import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LessonVisualItem } from '../../../types/firestore.js';
import { LessonMultiVisualGallery } from '../LessonMultiVisualGallery.js';

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function item(assetId: string, caption: string): LessonVisualItem {
  return {
    assetId,
    anchor: { headingSlug: 'sezione', headingText: 'Sezione', placement: 'after-heading' },
    caption,
    altText: `Alt ${caption}`,
    width: 1024,
    height: 768,
    storageRef: `repository/owner/import/uda/visuals/${assetId}.webp`,
    byteLength: 100,
    sha256: 'a'.repeat(64),
    mimeType: 'image/webp',
    styleVersion: 'schoolforge-sketch/v1',
    source: 'generated',
    sourceBodyHash: 'b'.repeat(64),
    approvedAt: { toMillis: () => 1 } as never,
  };
}

const identity = { programId: 'program', importId: 'import', lessonId: 'lesson' };

describe('LessonMultiVisualGallery', () => {
  it('mantiene l’ordine autorevole senza esporre controlli di riordino', () => {
    const first = item('11111111-1111-4111-8111-111111111111', 'Prima');
    const second = item('22222222-2222-4222-8222-222222222222', 'Seconda');
    render(
      <LessonMultiVisualGallery
        identity={identity}
        manifest={[first, second]}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('strong').map((node) => node.parentElement?.textContent)).toEqual([
      'Immagine 1Sezione',
      'Immagine 2Sezione',
    ]);
    expect(screen.queryByRole('button', { name: 'Su' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Giù' })).toBeNull();
  });

  it('rimuove tramite callback, mostra errori e mantiene target nominati', async () => {
    const visual = item('11111111-1111-4111-8111-111111111111', 'Una figura');
    const onRemove = vi.fn().mockRejectedValue(new Error('no'));
    render(
      <LessonMultiVisualGallery
        identity={identity}
        manifest={[visual]}
        onRemove={onRemove}
        onGenerate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi' }));
    await screen.findByRole('alert');
    expect(onRemove).toHaveBeenCalledWith(visual.assetId);
    expect(screen.getByRole('button', { name: 'Aggiungi immagine' })).toBeTruthy();
  });
});
