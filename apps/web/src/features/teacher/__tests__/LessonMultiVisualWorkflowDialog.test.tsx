import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MultiVisualSlot } from '../../repository/programs/multiVisualClient.js';
import { LessonMultiVisualWorkflowDialog } from '../LessonMultiVisualWorkflowDialog.js';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  generate: vi.fn(),
  promote: vi.fn(),
  remove: vi.fn(),
  edit: vi.fn(),
}));

vi.mock('../../repository/programs/multiVisualClient.js', () => ({
  createMultiVisualClient: () => ({
    authorize: mocks.authorize,
    generateSlot: mocks.generate,
    promoteSlot: mocks.promote,
    remove: mocks.remove,
    editSlot: mocks.edit,
  }),
  describeMultiVisualError: () => 'Errore controllato.',
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

const identity = { programId: 'p1', importId: 'i1', lessonId: 'l1' };
const staged = {
  storageRef: 'staging/x.webp',
  width: 1024,
  height: 1024,
  byteLength: 100,
  sha256: 'b'.repeat(64),
};
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

function makePlan(slots: MultiVisualSlot[] = [baseSlot]) {
  return {
    planHash: 'a'.repeat(64),
    requestId: '11111111-1111-4111-8111-111111111111',
    status: 'proposed',
    slots,
    budgetCeiling: {},
    settlement: {},
  };
}

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

function renderDialog({
  onRefresh = vi.fn().mockResolvedValue(undefined),
  onClose = vi.fn(),
  existingCount = 0,
  currentVisuals = [],
}: {
  onRefresh?: () => Promise<void>;
  onClose?: () => void;
  existingCount?: number;
  currentVisuals?: ReturnType<typeof currentVisual>[];
} = {}) {
  render(
    <LessonMultiVisualWorkflowDialog
      functions={{} as never}
      identity={identity}
      lessonAi={{ titolo: 'CPU', concettiChiave: ['CPU'], obiettivi: ['Comprendere'] }}
      existingCount={existingCount}
      currentVisuals={currentVisuals}
      headings={[
        { text: 'CPU', index: 0 },
        { text: 'Memoria', index: 1 },
      ]}
      onRefresh={onRefresh}
      onClose={onClose}
    />,
  );
  return { onRefresh, onClose };
}

describe('LessonMultiVisualWorkflowDialog', () => {
  it('stima al primo click senza conferma e senza generare immagini', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    mocks.authorize.mockResolvedValue(makePlan());
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Stima immagini' }));
    await screen.findByText('Ciclo della CPU');

    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.authorize).toHaveBeenCalledOnce();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('modifica soggetto, didascalia, testo alternativo e posizione', async () => {
    mocks.authorize.mockResolvedValue(makePlan());
    mocks.edit.mockResolvedValue(
      makePlan([
        {
          ...baseSlot,
          subject: 'Nuovo soggetto',
          caption: 'Nuova didascalia',
          altText: 'Nuovo testo alternativo',
          anchor: { headingIndex: 1, headingText: 'Memoria', headingSlug: 'memoria' },
        },
      ]),
    );
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Stima immagini' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Modifica' }));

    fireEvent.change(screen.getByLabelText('Cosa deve mostrare l’immagine'), {
      target: { value: 'Nuovo soggetto' },
    });
    fireEvent.change(screen.getByLabelText('Didascalia'), {
      target: { value: 'Nuova didascalia' },
    });
    fireEvent.change(screen.getByLabelText('Testo alternativo'), {
      target: { value: 'Nuovo testo alternativo' },
    });
    fireEvent.change(screen.getByLabelText('Posizione nella lezione'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salva modifiche' }));

    await waitFor(() =>
      expect(mocks.edit).toHaveBeenCalledWith(
        expect.objectContaining({
          abandon: false,
          subject: 'Nuovo soggetto',
          caption: 'Nuova didascalia',
          altText: 'Nuovo testo alternativo',
          anchorHeadingIndex: 1,
          anchorHeadingText: 'Memoria',
        }),
      ),
    );
  });

  it('genera e applica più immagini in sequenza con un solo refresh e riepilogo', async () => {
    const second = { ...baseSlot, slotIndex: 1, subject: 'Memoria' };
    const proposed = makePlan([baseSlot, second]);
    const readyFirst = makePlan([{ ...baseSlot, state: 'ready', staged }, second]);
    const promotedFirst = makePlan([
      { ...baseSlot, state: 'promoted', promotedAssetId: 'asset-1' },
      second,
    ]);
    const readySecond = makePlan([
      { ...baseSlot, state: 'promoted', promotedAssetId: 'asset-1' },
      { ...second, state: 'ready', staged },
    ]);
    const completed = makePlan([
      { ...baseSlot, state: 'promoted', promotedAssetId: 'asset-1' },
      { ...second, state: 'promoted', promotedAssetId: 'asset-2' },
    ]);
    mocks.authorize.mockResolvedValue(proposed);
    mocks.generate.mockResolvedValueOnce(readyFirst).mockResolvedValueOnce(readySecond);
    mocks.promote.mockResolvedValueOnce(promotedFirst).mockResolvedValueOnce(completed);
    const { onRefresh } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Stima immagini' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Genera e applica 2 immagini' }));

    await screen.findByRole('heading', { name: 'Immagini applicate alla lezione' });
    expect(screen.getByText('Sono state applicate 2 immagini.')).toBeTruthy();
    expect(mocks.generate.mock.calls.map(([input]) => input.slotIndex)).toEqual([0, 1]);
    expect(mocks.promote.mock.calls.map(([input]) => input.slotIndex)).toEqual([0, 1]);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('salta la generazione di uno slot staged e riusa promotionRequestId al retry', async () => {
    const ready = makePlan([{ ...baseSlot, state: 'ready', staged }]);
    mocks.authorize.mockResolvedValue(ready);
    mocks.promote
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(
        makePlan([{ ...baseSlot, state: 'promoted', promotedAssetId: 'asset-1' }]),
      );
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Stima immagini' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Genera e applica 1 immagine' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Genera e applica 1 immagine' }));
    await screen.findByRole('heading', { name: 'Immagini applicate alla lezione' });

    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.promote).toHaveBeenCalledTimes(2);
    expect(mocks.promote.mock.calls[0]![0].promotionRequestId).toBe(
      mocks.promote.mock.calls[1]![0].promotionRequestId,
    );
  });

  it('scarta un promotionRequestId di sessione corrotto invece di inviarlo al server', async () => {
    const ready = makePlan([{ ...baseSlot, state: 'ready', staged }]);
    window.sessionStorage.setItem(
      `schoolforge:multi-visual:promotion:${identity.programId}:${identity.importId}:${identity.lessonId}:${ready.requestId}:0`,
      'valore-corrotto',
    );
    mocks.authorize.mockResolvedValue(ready);
    mocks.promote.mockResolvedValue(
      makePlan([{ ...baseSlot, state: 'promoted', promotedAssetId: 'asset-1' }]),
    );
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Stima immagini' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Genera e applica 1 immagine' }));
    await screen.findByRole('heading', { name: 'Immagini applicate alla lezione' });

    expect(mocks.promote).toHaveBeenCalledWith(
      expect.objectContaining({ promotionRequestId: expect.not.stringContaining('corrotto') }),
    );
    expect(mocks.promote.mock.calls[0]![0].promotionRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('mostra avanzamento accessibile e blocca la chiusura durante il lavoro', async () => {
    let resolveAuthorize!: (value: ReturnType<typeof makePlan>) => void;
    mocks.authorize.mockReturnValue(
      new Promise((resolve) => {
        resolveAuthorize = resolve;
      }),
    );
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Stima immagini' }));

    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toContain('preparando');
    expect((screen.getByRole('button', { name: 'Annulla' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    resolveAuthorize(makePlan());
    await screen.findByText('Ciclo della CPU');
  });

  it('scarta una proposta e la esclude dal comando finale', async () => {
    const second = { ...baseSlot, slotIndex: 1, subject: 'Memoria' };
    mocks.authorize.mockResolvedValue(makePlan([baseSlot, second]));
    mocks.edit.mockResolvedValue(makePlan([{ ...baseSlot, state: 'abandoned' }, second]));
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Stima immagini' }));
    const cards = await screen.findAllByRole('article');
    fireEvent.click(within(cards[0]!).getByRole('button', { name: 'Scarta proposta' }));

    await screen.findByRole('button', { name: 'Genera e applica 1 immagine' });
    expect(mocks.edit).toHaveBeenCalledWith(
      expect.objectContaining({ abandon: true, slotIndex: 0 }),
    );
  });

  it('riusa lo stesso editRequestId quando la risposta allo scarto si perde', async () => {
    mocks.authorize.mockResolvedValue(makePlan());
    mocks.edit
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(makePlan([{ ...baseSlot, state: 'abandoned' }]));
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Stima immagini' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Scarta proposta' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Scarta proposta' }));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(2));

    expect(mocks.edit.mock.calls[0]![0].editRequestId).toBe(
      mocks.edit.mock.calls[1]![0].editRequestId,
    );
  });

  it('salta uno slot terminale e completa quello sano successivo', async () => {
    const terminal = {
      ...baseSlot,
      state: 'failed',
      attempts: 2,
      lastError: 'transient_error',
    };
    const healthy = { ...baseSlot, slotIndex: 1, subject: 'Memoria' };
    const proposed = makePlan([terminal, healthy]);
    const ready = makePlan([terminal, { ...healthy, state: 'ready', staged }]);
    const completed = makePlan([
      terminal,
      { ...healthy, state: 'promoted', promotedAssetId: 'asset-2' },
    ]);
    mocks.authorize.mockResolvedValue(proposed);
    mocks.generate.mockResolvedValue(ready);
    mocks.promote.mockResolvedValue(completed);
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Stima immagini' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Genera e applica 1 immagine' }));

    await screen.findByRole('heading', { name: 'Immagini applicate alla lezione' });
    expect(screen.getByText('È stata applicata 1 immagine.')).toBeTruthy();
    expect(
      screen.getByText('Una proposta non era più generabile ed è stata lasciata invariata.'),
    ).toBeTruthy();
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ slotIndex: 1 }));
    expect(mocks.promote).toHaveBeenCalledWith(expect.objectContaining({ slotIndex: 1 }));
  });

  it('consente sostituzione a galleria piena senza controlli di riordino', async () => {
    mocks.authorize.mockResolvedValue(makePlan([{ ...baseSlot, state: 'ready', staged }]));
    renderDialog({
      existingCount: 3,
      currentVisuals: [currentVisual(1), currentVisual(2), currentVisual(3)],
    });

    expect(screen.queryByRole('button', { name: 'Su' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Giù' })).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Stima immagini' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Sostituisci' })[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Stima immagini' }));
    await screen.findByRole('button', { name: 'Genera e applica 1 immagine' });
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ replacementAssetId: currentVisual(2).assetId }),
    );
  });

  it('rimuove un’immagine esistente e mantiene la conferma distruttiva', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.remove.mockResolvedValue(undefined);
    const { onRefresh } = renderDialog({
      existingCount: 1,
      currentVisuals: [currentVisual(1)],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
    expect(mocks.remove).toHaveBeenCalledWith({ ...identity, assetId: currentVisual(1).assetId });
  });

  it('congela layout e rimozione dei vecchi controlli frammentati', async () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/teacher/LessonMultiVisualWorkflowDialog.module.css'),
      'utf8',
    );
    expect(css).toMatch(/\.slots\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    expect(css).toMatch(/\.slotActions\s*\{[^}]*display:\s*flex/s);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*\.slotActions\s*\{[^}]*flex-direction:\s*column/,
    );

    mocks.authorize.mockResolvedValue(makePlan());
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Stima immagini' }));
    await screen.findByText('Ciclo della CPU');
    expect(screen.queryByRole('button', { name: 'Genera immagine' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Applica immagine' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Applica tutte' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Abbandona slot' })).toBeNull();
  });
});
