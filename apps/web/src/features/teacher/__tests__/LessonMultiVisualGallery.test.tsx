import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it('invia il nuovo ordine completo e aspetta la fotografia autorevole del chiamante', async () => {
    const onReorder = vi.fn().mockResolvedValue(undefined);
    const first = item('11111111-1111-4111-8111-111111111111', 'Prima');
    const second = item('22222222-2222-4222-8222-222222222222', 'Seconda');
    const view = render(
      <LessonMultiVisualGallery
        identity={identity}
        manifest={[first, second]}
        onReorder={onReorder}
        onRemove={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Su' })[1]!);
    await waitFor(() => expect(onReorder).toHaveBeenCalledWith([second.assetId, first.assetId]));
    // La risposta della callable non viene scambiata per stato autorevole.
    expect(screen.getAllByRole('strong').map((node) => node.parentElement?.textContent)).toEqual([
      'Immagine 1Sezione',
      'Immagine 2Sezione',
    ]);

    view.rerender(
      <LessonMultiVisualGallery
        identity={identity}
        manifest={[second, first]}
        onReorder={onReorder}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Seconda')).toBeTruthy();
    expect(screen.getAllByText(/Prima|Seconda/)[0]!.textContent).toBe('Seconda');
  });

  it('rimuove tramite callback, mostra errori e mantiene target nominati', async () => {
    const visual = item('11111111-1111-4111-8111-111111111111', 'Una figura');
    const onRemove = vi.fn().mockRejectedValue(new Error('no'));
    render(
      <LessonMultiVisualGallery
        identity={identity}
        manifest={[visual]}
        onReorder={vi.fn()}
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
