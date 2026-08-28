import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LessonMultiVisualWorkflowDialog } from '../LessonMultiVisualWorkflowDialog.js';
import type { MultiVisualSlot } from '../../repository/programs/multiVisualClient.js';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  generate: vi.fn(),
  promote: vi.fn(),
  reorder: vi.fn(),
  remove: vi.fn(),
  edit: vi.fn(),
}));

vi.mock('../../repository/programs/multiVisualClient.js', () => ({
  createMultiVisualClient: () => ({
    authorize: mocks.authorize,
    generateSlot: mocks.generate,
    promoteSlot: mocks.promote,
    reorder: mocks.reorder,
    remove: mocks.remove,
    editSlot: mocks.edit,
  }),
  describeMultiVisualError: () => 'Errore controllato.',
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

const identity = { programId: 'p1', importId: 'i1', lessonId: 'l1' };
const baseSlot: MultiVisualSlot = {
  slotIndex: 0,
  state: 'pending',
  decision: 'image',
  subject: 'Ciclo della CPU',
  rationale: 'Rende visibile la sequenza.',
  anchor: { headingIndex: 0, headingText: 'CPU', headingSlug: 'cpu' },
  caption: 'Il ciclo della CPU',
  altText: 'Schema del ciclo della CPU',
  attempts: 0,
  lastError: null,
  staged: null,
  promotedAssetId: null,
};
const plan = (slot: MultiVisualSlot = baseSlot) => ({
  planHash: 'a'.repeat(64),
  requestId: '11111111-1111-4111-8111-111111111111',
  status: 'proposed',
  slots: [slot],
  budgetCeiling: {},
  settlement: {},
});

function currentVisual(index: number) {
  const assetId = `${index}1111111-1111-4111-8111-111111111111`;
  return {
    assetId,
    anchor: {
      headingSlug: 'cpu',
      headingText: `CPU ${index}`,
      placement: 'after-heading' as const,
    },
    caption: `Ciclo ${index}`,
    altText: `Schema ${index}`,
    width: 1024,
    height: 1024,
    storageRef: `repository/owner/import/uda/visuals/${assetId}.webp`,
    byteLength: 100,
    sha256: 'a'.repeat(64),
    mimeType: 'image/webp' as const,
    source: 'generated' as const,
    styleVersion: 'schoolforge-sketch/v1' as const,
    sourceBodyHash: 'b'.repeat(64),
    approvedAt: { toMillis: () => 1 } as never,
  };
}

function renderDialog(
  onRefresh: () => Promise<void> = vi.fn().mockResolvedValue(undefined),
  onClose = vi.fn(),
) {
  render(
    <LessonMultiVisualWorkflowDialog
      functions={{} as never}
      identity={identity}
      lessonAi={{ titolo: 'CPU', concettiChiave: ['CPU'], obiettivi: ['Comprendere'] }}
      existingCount={0}
      currentVisuals={[]}
      headings={[{ text: 'CPU', index: 0 }]}
      onRefresh={onRefresh}
      onClose={onClose}
    />,
  );
  return onRefresh;
}

describe('LessonMultiVisualWorkflowDialog', () => {
  it('autorizza una sola volta con quantità esatta e non genera all’apertura', async () => {
    mocks.authorize.mockResolvedValue(plan());
    renderDialog();
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Quantità'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Stima immagini' }));
    await screen.findByText('Ciclo della CPU');
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: { mode: 'exact', ceiling: 1 } }),
    );
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('mostra sempre le proposte in una sola colonna', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/teacher/LessonMultiVisualWorkflowDialog.module.css'),
      'utf8',
    );
    expect(css).toMatch(/\.slots\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    expect(css).not.toContain('repeat(3');
  });

  it('genera, promuove e solo dopo richiede il refresh autorevole', async () => {
    const staged = {
      storageRef: 'staging/x.webp',
      width: 1024,
      height: 1024,
      byteLength: 100,
      sha256: 'b'.repeat(64),
    };
    mocks.authorize.mockResolvedValue(plan());
    mocks.generate.mockResolvedValue(plan({ ...baseSlot, state: 'ready', staged }));
    mocks.promote.mockResolvedValue(
      plan({ ...baseSlot, state: 'promoted', staged, promotedAssetId: 'asset' }),
    );
    const onRefresh = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Stima immagini' }));
    await screen.findByText('Ciclo della CPU');
    fireEvent.click(screen.getByRole('button', { name: 'Genera immagine' }));
    await screen.findByText('Immagine generata pronta per l’applicazione.');
    expect(onRefresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Applica immagine' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
    expect(mocks.promote).toHaveBeenCalledWith(
      expect.objectContaining({ slotIndex: 0, mode: { mode: 'add' } }),
    );
  });

  it('applica tutti gli slot pronti in sequenza e aggiorna dopo ogni commit', async () => {
    const staged = {
      storageRef: 'staging/x.webp',
      width: 1024,
      height: 1024,
      byteLength: 100,
      sha256: 'b'.repeat(64),
    };
    const readySlots = [
      { ...baseSlot, state: 'ready', staged },
      { ...baseSlot, slotIndex: 1, state: 'ready', staged },
    ];
    const readyPlan = { ...plan(), slots: readySlots };
    mocks.authorize.mockResolvedValue(readyPlan);
    mocks.promote.mockResolvedValue(readyPlan);
    const onRefresh = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Stima immagini' }));
    await screen.findByRole('button', { name: 'Applica tutte' });
    fireEvent.click(screen.getByRole('button', { name: 'Applica tutte' }));

    await waitFor(() => expect(mocks.promote).toHaveBeenCalledTimes(2));
    expect(mocks.promote.mock.calls.map(([input]) => input.slotIndex)).toEqual([0, 1]);
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it('consente il replace a galleria piena e forza un solo slot', async () => {
    const staged = {
      storageRef: 'staging/x.webp',
      width: 1024,
      height: 1024,
      byteLength: 100,
      sha256: 'b'.repeat(64),
    };
    mocks.authorize.mockResolvedValue(plan({ ...baseSlot, state: 'ready', staged }));
    mocks.promote.mockResolvedValue(
      plan({ ...baseSlot, state: 'promoted', staged, promotedAssetId: 'new-asset' }),
    );
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <LessonMultiVisualWorkflowDialog
        functions={{} as never}
        identity={identity}
        lessonAi={{ titolo: 'CPU' }}
        existingCount={3}
        currentVisuals={[currentVisual(1), currentVisual(2), currentVisual(3)]}
        headings={[{ text: 'CPU', index: 0 }]}
        onRefresh={onRefresh}
        onClose={vi.fn()}
      />,
    );

    expect(
      (screen.getByRole('button', { name: 'Stima immagini' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Sostituisci' })[1]!);
    expect(screen.getByRole('status').textContent).toContain('sostituirà');
    expect(
      (screen.getByRole('button', { name: 'Stima immagini' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Stima immagini' }));
    await screen.findByRole('button', { name: 'Applica immagine' });
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: { mode: 'exact', ceiling: 1 } }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Applica immagine' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
    expect(mocks.promote).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: { mode: 'replace', replaceAssetId: currentVisual(2).assetId },
      }),
    );
  });

  it('mantiene il piano visibile e mostra un errore senza refresh', async () => {
    mocks.authorize.mockResolvedValue(plan());
    mocks.generate.mockRejectedValue(new Error('provider'));
    const onRefresh = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Stima immagini' }));
    await screen.findByText('Ciclo della CPU');
    fireEvent.click(screen.getByRole('button', { name: 'Genera immagine' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Errore controllato.');
    expect(screen.getByText('Ciclo della CPU')).toBeTruthy();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('rimuove un visual esistente, poi esegue il refresh autorevole', async () => {
    mocks.remove.mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <LessonMultiVisualWorkflowDialog
        functions={{} as never}
        identity={identity}
        lessonAi={{ titolo: 'CPU' }}
        existingCount={1}
        currentVisuals={[
          {
            assetId: '11111111-1111-4111-8111-111111111111',
            anchor: { headingSlug: 'cpu', headingText: 'CPU', placement: 'after-heading' },
            caption: 'Ciclo',
            altText: 'Schema',
            width: 1024,
            height: 1024,
            storageRef:
              'repository/owner/import/uda/visuals/11111111-1111-4111-8111-111111111111.webp',
            byteLength: 100,
            sha256: 'a'.repeat(64),
            mimeType: 'image/webp',
            source: 'generated',
            styleVersion: 'schoolforge-sketch/v1',
            sourceBodyHash: 'b'.repeat(64),
            approvedAt: { toMillis: () => 1 } as never,
          },
        ]}
        headings={[{ text: 'CPU', index: 0 }]}
        onRefresh={onRefresh}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
    expect(mocks.remove).toHaveBeenCalledWith({
      ...identity,
      assetId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('rende il fallimento della rimozione e non esegue il refresh', async () => {
    mocks.remove.mockRejectedValue(new Error('remove'));
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <LessonMultiVisualWorkflowDialog
        functions={{} as never}
        identity={identity}
        lessonAi={{ titolo: 'CPU' }}
        existingCount={1}
        currentVisuals={[
          {
            assetId: '11111111-1111-4111-8111-111111111111',
            anchor: { headingSlug: 'cpu', headingText: 'CPU', placement: 'after-heading' },
            caption: 'Ciclo',
            altText: 'Schema',
            width: 1024,
            height: 1024,
            storageRef:
              'repository/owner/import/uda/visuals/11111111-1111-4111-8111-111111111111.webp',
            byteLength: 100,
            sha256: 'a'.repeat(64),
            mimeType: 'image/webp',
            source: 'generated',
            styleVersion: 'schoolforge-sketch/v1',
            sourceBodyHash: 'b'.repeat(64),
            approvedAt: { toMillis: () => 1 } as never,
          },
        ]}
        headings={[{ text: 'CPU', index: 0 }]}
        onRefresh={onRefresh}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Errore controllato.');
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('chiude con Escape prima della spesa e mantiene un solo focus trap', async () => {
    const onClose = vi.fn();
    renderDialog(vi.fn().mockResolvedValue(undefined), onClose);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
});
