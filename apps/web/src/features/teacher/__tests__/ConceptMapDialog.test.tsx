import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConceptMapDialog } from '../ConceptMapDialog.js';
import type { AiConceptMapCallables } from '../../repository/pools/aiConceptMapClient.js';

/**
 * CONCEPT-MAP-03 — la finestra della mappa.
 *
 * Le garanzie difese qui sono quelle che costano denaro o lavoro se cadono:
 * nessuna callable all'apertura, nessun salvataggio automatico, e il testo
 * corrente che non sparisce mai senza una conferma esplicita.
 */

const MAP = '## Ossatura della lezione\n\n- densità\n';
const NEW_MAP = '## Ossatura della lezione\n\n- nuova voce\n';

function callables(over: Partial<AiConceptMapCallables> = {}): AiConceptMapCallables {
  return {
    preview: vi.fn().mockResolvedValue({
      kind: 'concept_map',
      modelProfile: 'economy',
      estimatedInputTokens: 500,
      maxOutputTokens: 2000,
      estimatedCostMicroUsd: 1000,
      reservationCostMicroUsd: 4000,
      requestedTotal: null,
    }),
    generate: vi.fn().mockResolvedValue({
      status: 'completed',
      kind: 'concept_map',
      modelProfile: 'economy',
      output: { conceptMapMarkdown: NEW_MAP },
      actualCostMicroUsd: 900,
      replayed: false,
    }),
    ...over,
  } as AiConceptMapCallables;
}

function setup(
  over: {
    initialConceptMap?: string | null;
    lessonBody?: string;
    onSave?: (m: string) => Promise<void>;
    onClose?: () => void;
    api?: AiConceptMapCallables;
  } = {},
) {
  const api = over.api ?? callables();
  const onSave = over.onSave ?? vi.fn().mockResolvedValue(undefined);
  const onClose = over.onClose ?? vi.fn();
  render(
    <ConceptMapDialog
      lessonTitle="La densità"
      lessonBody={over.lessonBody ?? '## La densità\n\nTesto della lezione.'}
      initialConceptMap={'initialConceptMap' in over ? (over.initialConceptMap ?? null) : null}
      callables={api}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { api, onSave, onClose };
}

/** Il dialog vive in un portale: la radice delle query è il dialog stesso. */
function dialog() {
  return screen.getAllByRole('dialog')[0]!;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('apertura', () => {
  it('non chiama nessuna callable all’apertura', () => {
    const { api } = setup({ initialConceptMap: MAP });
    expect(api.preview).not.toHaveBeenCalled();
    expect(api.generate).not.toHaveBeenCalled();
  });

  it('apre in anteprima quando una mappa esiste già, mostrandone il testo', () => {
    setup({ initialConceptMap: MAP });
    expect(screen.getByRole('tab', { name: 'Anteprima' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(dialog().textContent).toContain('densità');
  });

  it('apre in editor quando la mappa non esiste', () => {
    setup();
    expect(screen.getByRole('tab', { name: 'Editor' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('generazione', () => {
  it('usa lo stesso requestId e lo stesso payload per preview e generate', async () => {
    const { api } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Genera con IA/ }));
    await screen.findByRole('button', { name: 'Genera mappa' });
    fireEvent.click(screen.getByRole('button', { name: 'Genera mappa' }));
    await waitFor(() => expect(api.generate).toHaveBeenCalled());

    const previewArg = (api.preview as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const generateArg = (api.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(generateArg).toEqual(previewArg);
    expect(previewArg.modelProfile).toBe('economy');
    expect(previewArg.kind).toBe('concept_map');
  });

  it('non salva automaticamente la mappa generata', async () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Genera con IA/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Genera mappa' }));
    await waitFor(() => expect(dialog().textContent).toContain('Non è ancora salvata'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('un errore di generazione conserva il testo precedente', async () => {
    const api = callables({ generate: vi.fn().mockRejectedValue(new Error('boom')) });
    setup({ initialConceptMap: MAP, api });
    fireEvent.click(screen.getByRole('button', { name: /Rigenera con IA/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rigenera' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Genera mappa' }));

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('tab', { name: 'Editor' }));
    expect(
      (screen.getByRole('textbox', { name: /Markdown della mappa/ }) as HTMLTextAreaElement).value,
    ).toBe(MAP);
  });
});

describe('rigenerazione', () => {
  it('chiede conferma quando esiste già del testo', async () => {
    const { api } = setup({ initialConceptMap: MAP });
    fireEvent.click(screen.getByRole('button', { name: /Rigenera con IA/ }));
    expect(await screen.findByText('Rigenerare la mappa?')).toBeTruthy();
    // La stima non parte finché la conferma non è accettata.
    expect(api.preview).not.toHaveBeenCalled();
  });

  it('«Continua la modifica» conserva il testo e non chiama nulla', async () => {
    const { api } = setup({ initialConceptMap: MAP });
    fireEvent.click(screen.getByRole('button', { name: /Rigenera con IA/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continua la modifica' }));
    expect(api.preview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Editor' }));
    expect(
      (screen.getByRole('textbox', { name: /Markdown della mappa/ }) as HTMLTextAreaElement).value,
    ).toBe(MAP);
  });

  it('la nuova proposta non sostituisce il testo prima della conferma di generazione', async () => {
    setup({ initialConceptMap: MAP });
    fireEvent.click(screen.getByRole('button', { name: /Rigenera con IA/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rigenera' }));
    // Siamo alla stima: il testo è ancora quello vecchio.
    await screen.findByRole('button', { name: 'Genera mappa' });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Editor' }));
    expect(
      (screen.getByRole('textbox', { name: /Markdown della mappa/ }) as HTMLTextAreaElement).value,
    ).toBe(MAP);
  });

  it('non chiede conferma quando non c’è nulla da perdere', async () => {
    const { api } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Genera con IA/ }));
    await waitFor(() => expect(api.preview).toHaveBeenCalled());
    expect(screen.queryByText('Rigenerare la mappa?')).toBeNull();
  });
});

describe('salvataggio', () => {
  it('chiama il service una sola volta anche con doppio click', async () => {
    let resolveSave: () => void = () => undefined;
    const onSave = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveSave = res;
        }),
    );
    setup({ initialConceptMap: MAP, onSave });
    fireEvent.click(screen.getByRole('tab', { name: 'Editor' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Markdown della mappa/ }), {
      target: { value: `${MAP}!` },
    });

    const saveBtn = screen.getByRole('button', { name: /Salva mappa/ });
    // Doppio click nello stesso tick: la guardia sincrona deve reggere anche
    // prima che React abbia riprodotto lo stato `saving`.
    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn);
    expect(onSave).toHaveBeenCalledTimes(1);
    resolveSave();
  });

  it('è disabilitato finché non c’è una modifica da salvare', async () => {
    setup({ initialConceptMap: MAP });
    expect(
      (screen.getByRole('button', { name: /Salva mappa/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('un errore di salvataggio conserva il testo e non chiude il dialog', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Firestore non disponibile.'));
    const { onClose } = setup({ initialConceptMap: MAP, onSave });
    fireEvent.click(screen.getByRole('tab', { name: 'Editor' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Markdown della mappa/ }), {
      target: { value: `${MAP}!` },
    });
    fireEvent.click(screen.getByRole('button', { name: /Salva mappa/ }));

    expect((await screen.findByRole('alert')).textContent).toContain('Firestore non disponibile.');
    expect(onClose).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('textbox', { name: /Markdown della mappa/ }) as HTMLTextAreaElement).value,
    ).toBe(`${MAP}!`);
  });

  it('chiude dopo un salvataggio riuscito', async () => {
    const { onClose, onSave } = setup({ initialConceptMap: MAP });
    fireEvent.click(screen.getByRole('tab', { name: 'Editor' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Markdown della mappa/ }), {
      target: { value: `${MAP}!` },
    });
    fireEvent.click(screen.getByRole('button', { name: /Salva mappa/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(`${MAP}!`);
  });
});

describe('protezione del lavoro non salvato', () => {
  it('la chiusura con modifiche passa dalla conferma modale', async () => {
    const { onClose } = setup({ initialConceptMap: MAP });
    fireEvent.click(screen.getByRole('tab', { name: 'Editor' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Markdown della mappa/ }), {
      target: { value: `${MAP}!` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));

    expect(await screen.findByText('Chiudere senza salvare?')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape non scarta una proposta non salvata', async () => {
    const { onClose } = setup({ initialConceptMap: MAP });
    fireEvent.click(screen.getByRole('tab', { name: 'Editor' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Markdown della mappa/ }), {
      target: { value: `${MAP}!` },
    });
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('chiude senza conferma quando non c’è nulla di modificato', async () => {
    const { onClose } = setup({ initialConceptMap: MAP });
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(onClose).toHaveBeenCalled();
  });
});
