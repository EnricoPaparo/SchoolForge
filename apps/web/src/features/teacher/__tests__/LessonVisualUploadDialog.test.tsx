import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LessonVisualItem } from '../../../types/firestore.js';
import { LessonVisualUploadDialog } from '../LessonVisualUploadDialog.js';

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  promote: vi.fn(),
  abandon: vi.fn(),
}));

vi.mock('../../repository/programs/visualUploadClient.js', () => ({
  MAX_VISUAL_UPLOAD_BYTES: 2_000_000,
  VISUAL_UPLOAD_MIME_TYPES: ['image/png', 'image/jpeg', 'image/webp'],
  createVisualUploadClient: () => mocks,
  describeVisualUploadError: () => 'Errore upload controllato.',
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.abandon.mockResolvedValue({ status: 'abandoned' });
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:test'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const identity = { programId: 'program', importId: 'import', lessonId: 'lesson' };
const headings = [
  { index: 0, text: 'Introduzione' },
  { index: 1, text: 'Approfondimento' },
];

function setup(overrides: Partial<Parameters<typeof LessonVisualUploadDialog>[0]> = {}) {
  const props = {
    functions: {} as never,
    identity,
    headings,
    currentVisuals: [],
    onRefresh: vi.fn().mockResolvedValue(undefined),
    onBack: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<LessonVisualUploadDialog {...props} />);
  return props;
}

function fillForm() {
  const input = screen.getByLabelText(/Scegli o trascina/) as HTMLInputElement;
  const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'schema.png', {
    type: 'image/png',
  });
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.change(screen.getByLabelText('Posizione nella lezione'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Didascalia'), { target: { value: 'Schema finale' } });
  fireEvent.change(screen.getByLabelText('Testo alternativo'), {
    target: { value: 'Schema dettagliato del processo' },
  });
}

describe('LessonVisualUploadDialog', () => {
  it('esegue accept → promote → refresh autorevole con metadati espliciti', async () => {
    mocks.accept.mockResolvedValue({ status: 'ready', replayed: false, lastError: null });
    mocks.promote.mockResolvedValue({ replayed: false, assetId: 'asset' });
    const props = setup();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Carica e applica' }));

    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
    expect(mocks.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        ...identity,
        anchor: { anchorHeadingIndex: 1, anchorHeadingText: 'Approfondimento' },
        caption: 'Schema finale',
        altText: 'Schema dettagliato del processo',
      }),
    );
    expect(mocks.promote).toHaveBeenCalledWith(expect.objectContaining({ mode: { mode: 'add' } }));
    expect(props.onRefresh).toHaveBeenCalledOnce();
    expect(mocks.abandon).not.toHaveBeenCalled();
  });

  it('riusa requestId e promotionRequestId quando il tentativo viene ripetuto', async () => {
    mocks.accept
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ status: 'ready', replayed: true, lastError: null });
    mocks.promote
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ assetId: 'a' });
    const props = setup();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Carica e applica' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Riprova upload' }));
    await waitFor(() => expect(mocks.promote).toHaveBeenCalledOnce());
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Riprova upload' }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());

    const acceptIds = mocks.accept.mock.calls.map(([request]) => request.requestId);
    const promotionIds = mocks.promote.mock.calls.map(([request]) => request.promotionRequestId);
    expect(new Set(acceptIds).size).toBe(1);
    expect(new Set(promotionIds).size).toBe(1);
  });

  it('abbandona un tentativo non promosso quando si torna al menu', async () => {
    mocks.accept.mockResolvedValue({ status: 'ready', replayed: false, lastError: null });
    mocks.promote.mockRejectedValue(new Error('offline'));
    const props = setup();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Carica e applica' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Indietro' }));

    await waitFor(() => expect(props.onBack).toHaveBeenCalledOnce());
    expect(mocks.abandon).toHaveBeenCalledWith(mocks.accept.mock.calls[0]![0].requestId);
  });

  it('se l’abbandono fallisce resta aperto, mostra un errore e consente di ritentare', async () => {
    mocks.accept.mockResolvedValue({ status: 'ready', replayed: false, lastError: null });
    mocks.promote.mockRejectedValue(new Error('offline'));
    mocks.abandon.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      status: 'abandoned',
    });
    const props = setup();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Carica e applica' }));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Indietro' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Impossibile annullare');
    expect(screen.getByRole('alert').textContent).toContain('Riprova upload');
    expect(props.onBack).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Indietro' }));
    await waitFor(() => expect(props.onBack).toHaveBeenCalledOnce());
    expect(mocks.abandon).toHaveBeenCalledTimes(2);
  });

  it('un errore di abbandono su chiusura non chiude; il retry riuscito chiude', async () => {
    mocks.accept.mockResolvedValue({ status: 'ready', replayed: false, lastError: null });
    mocks.promote.mockRejectedValue(new Error('offline'));
    mocks.abandon.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      status: 'already_abandoned',
    });
    const props = setup();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Carica e applica' }));
    await screen.findByRole('alert');

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect((await screen.findByRole('alert')).textContent).toContain('Impossibile annullare');
    expect(props.onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
    expect(mocks.abandon).toHaveBeenCalledTimes(2);
  });

  it('dopo la promozione fallita solo nel refresh non tenta abandon e può uscire', async () => {
    mocks.accept.mockResolvedValue({ status: 'ready', replayed: false, lastError: null });
    mocks.promote.mockResolvedValue({ replayed: false, assetId: 'asset' });
    const props = setup({ onRefresh: vi.fn().mockRejectedValue(new Error('offline')) });
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Carica e applica' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Immagine salvata');

    fireEvent.click(screen.getByRole('button', { name: 'Indietro' }));
    await waitFor(() => expect(props.onBack).toHaveBeenCalledOnce());
    expect(mocks.abandon).not.toHaveBeenCalled();
  });

  it('non aggiorna lo stato quando l’abbandono termina dopo lo smontaggio', async () => {
    let resolveAbandon: ((value: { status: 'abandoned' }) => void) | undefined;
    mocks.accept.mockResolvedValue({ status: 'ready', replayed: false, lastError: null });
    mocks.promote.mockRejectedValue(new Error('offline'));
    mocks.abandon.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAbandon = resolve;
        }),
    );
    const props = setup();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Carica e applica' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Indietro' }));
    await waitFor(() => expect(mocks.abandon).toHaveBeenCalledOnce());

    cleanup();
    resolveAbandon?.({ status: 'abandoned' });
    await Promise.resolve();
    expect(props.onBack).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('rifiuta formato e peso non ammessi prima di invocare il server', () => {
    setup();
    const input = screen.getByLabelText(/Scegli o trascina/) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['svg'], 'x.svg', { type: 'image/svg+xml' })] },
    });
    expect(screen.getByRole('alert').textContent).toContain('Formato non ammesso');
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it('con tre immagini impone la sostituzione e invia il target scelto', async () => {
    const currentVisuals = [1, 2, 3].map((index) => ({
      assetId: `${index}1111111-1111-4111-8111-111111111111`,
      anchor: {
        headingSlug: `s-${index}`,
        headingText: `Sezione ${index}`,
        placement: 'after-heading',
      },
      caption: `Figura ${index}`,
      altText: `Alt ${index}`,
    })) as unknown as LessonVisualItem[];
    mocks.accept.mockResolvedValue({ status: 'ready', replayed: false, lastError: null });
    mocks.promote.mockResolvedValue({ replayed: false, assetId: 'new' });
    setup({ currentVisuals });
    fillForm();
    expect(
      (screen.getByRole('radio', { name: 'Aggiungi immagine' }) as HTMLInputElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('Immagine da sostituire'), {
      target: { value: currentVisuals[1].assetId },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Carica e applica' }));

    await waitFor(() => expect(mocks.promote).toHaveBeenCalledOnce());
    expect(mocks.promote).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: { mode: 'replace', replaceAssetId: currentVisuals[1].assetId },
      }),
    );
  });

  it('revoca l’URL della preview locale allo smontaggio', () => {
    setup();
    const input = screen.getByLabelText(/Scegli o trascina/) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['png'], 'x.png', { type: 'image/png' })] },
    });
    cleanup();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});
