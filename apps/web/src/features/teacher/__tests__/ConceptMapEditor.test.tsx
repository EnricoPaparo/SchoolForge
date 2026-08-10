import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConceptMapEditor } from '../ConceptMapEditor.js';
import type { AiConceptMapCallables } from '../../repository/pools/aiConceptMapClient.js';

/**
 * CONCEPT-MAP-04 — la scheda «Mappa concettuale» del docente.
 *
 * Le garanzie difese qui sono quelle che costano denaro o lavoro se cadono:
 * nessuna callable alla selezione della scheda, nessun salvataggio automatico,
 * e il testo corrente che non sparisce mai senza una conferma esplicita. Sono
 * le stesse di CONCEPT-MAP-03: la macchina a stati è stata spostata, non
 * riscritta, e questi test lo dimostrano continuando a valere.
 */

const MAP = '## Ossatura della lezione\n\n- densità\n';
const NEW_MAP = '## Ossatura della lezione\n\n- nuova voce\n';
const BODY = '## La densità\n\nTesto della lezione.';

function callables(over: Partial<AiConceptMapCallables> = {}): AiConceptMapCallables {
  return {
    preview: vi.fn().mockResolvedValue({
      kind: 'concept_map',
      modelProfile: 'quality',
      estimatedInputTokens: 500,
      maxOutputTokens: 6000,
      estimatedCostMicroUsd: 1000,
      reservationCostMicroUsd: 4000,
      requestedTotal: null,
    }),
    generate: vi.fn().mockResolvedValue({
      status: 'completed',
      kind: 'concept_map',
      modelProfile: 'quality',
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
    lessonBody?: string | null;
    blockedReason?: string | null;
    onSave?: (m: string) => Promise<void>;
    onDirtyChange?: (d: boolean) => void;
    api?: AiConceptMapCallables;
  } = {},
) {
  const api = over.api ?? callables();
  const onSave = over.onSave ?? vi.fn().mockResolvedValue(undefined);
  const onDirtyChange = over.onDirtyChange ?? vi.fn();
  const view = render(
    <ConceptMapEditor
      lessonBody={'lessonBody' in over ? (over.lessonBody ?? null) : BODY}
      initialConceptMap={'initialConceptMap' in over ? (over.initialConceptMap ?? null) : null}
      blockedReason={over.blockedReason ?? null}
      callables={api}
      onSave={onSave}
      onDirtyChange={onDirtyChange}
    />,
  );
  return { api, onSave, onDirtyChange, view };
}

/** Entra in modifica: è il gesto che apre editor e anteprima. */
function openEditor() {
  fireEvent.click(screen.getByRole('button', { name: /Modifica/ }));
}

function textarea() {
  return screen.getByRole('textbox', { name: /Markdown della mappa/ }) as HTMLTextAreaElement;
}

async function requestEstimate() {
  fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
  return screen.findByRole('button', { name: 'Genera bozza' });
}

async function generateAndUseDraft() {
  const generate = await requestEstimate();
  fireEvent.click(generate);
  const useDraft = await screen.findByRole('button', { name: 'Usa questa bozza' });
  fireEvent.click(useDraft);
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('apertura della scheda', () => {
  it('non chiama nessuna callable', () => {
    const { api } = setup({ initialConceptMap: MAP });
    expect(api.preview).not.toHaveBeenCalled();
    expect(api.generate).not.toHaveBeenCalled();
  });

  it('mostra la mappa salvata in lettura, non in un editor', () => {
    setup({ initialConceptMap: MAP });
    expect(document.body.textContent).toContain('densità');
    // In lettura non c'è alcuna textarea: la mappa si legge come la legge lo
    // studente, e si modifica solo su richiesta.
    expect(screen.queryByRole('textbox', { name: /Markdown della mappa/ })).toBeNull();
  });

  it('mostra uno stato vuoto quando la mappa non esiste', () => {
    setup();
    expect(document.body.textContent).toContain('Nessuna mappa concettuale per questa lezione');
  });

  it('l’etichetta di generazione dipende dalla presenza della mappa', () => {
    setup();
    expect(screen.getByRole('button', { name: /Genera con IA/ })).toBeTruthy();
    cleanup();
    setup({ initialConceptMap: MAP });
    expect(screen.getByRole('button', { name: /Rigenera con IA/ })).toBeTruthy();
  });
});

describe('contenuto non generabile', () => {
  it('disabilita la generazione e mostra il motivo nella scheda', () => {
    setup({ blockedReason: 'Salva prima le modifiche al contenuto.' });
    const btn = screen.getByRole('button', { name: /Genera con IA/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(document.body.textContent).toContain('Salva prima le modifiche al contenuto.');
    // Il motivo è legato al pulsante, non solo scritto accanto.
    expect(btn.getAttribute('aria-describedby')).toBe('concept-map-blocked-reason');
  });

  it('la modifica manuale resta possibile anche se la generazione è bloccata', () => {
    setup({ blockedReason: 'Contenuto della lezione non disponibile.', lessonBody: null });
    openEditor();
    expect(textarea()).toBeTruthy();
  });
});

describe('generazione', () => {
  it('usa lo stesso requestId e lo stesso payload per preview e generate', async () => {
    const { api } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Genera con IA/ }));
    fireEvent.click(await requestEstimate());
    await waitFor(() => expect(api.generate).toHaveBeenCalled());

    const previewArg = (api.preview as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const generateArg = (api.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(generateArg).toEqual(previewArg);
    expect(previewArg.kind).toBe('concept_map');
  });

  it.each([
    ['lettura', false],
    ['modifica', true],
  ] as const)('apre sempre la popup con entrambi i profili da %s', (_label, edit) => {
    setup({ initialConceptMap: MAP });
    if (edit) openEditor();
    fireEvent.click(screen.getByRole('button', { name: /Rigenera con IA/ }));

    expect(screen.getByRole('dialog', { name: 'Genera mappa concettuale con IA' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Economy/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Quality/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('permette di scegliere Economy e usa la scelta sia per stima sia per generazione', async () => {
    const { api } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Genera con IA/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Economy/ }));
    fireEvent.click(await requestEstimate());
    await waitFor(() => expect(api.generate).toHaveBeenCalled());

    const previewArg = (api.preview as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const generateArg = (api.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(previewArg.modelProfile).toBe('economy');
    expect(generateArg).toEqual(previewArg);
  });

  it('non salva automaticamente la mappa generata', async () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Genera con IA/ }));
    await generateAndUseDraft();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Salva mappa/ })).toBeTruthy();
  });

  it('un errore di generazione conserva il testo precedente', async () => {
    const api = callables({ generate: vi.fn().mockRejectedValue(new Error('boom')) });
    setup({ initialConceptMap: MAP, api });
    fireEvent.click(screen.getByRole('button', { name: /Rigenera con IA/ }));
    fireEvent.click(await requestEstimate());

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(document.body.textContent).toContain('densità');
  });
});

describe('sessioni indipendenti', () => {
  it('lettura e modifica producono lo stesso payload a parità di scelta', async () => {
    const fromView = setup();
    fireEvent.click(screen.getByRole('button', { name: /Genera con IA/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Economy/ }));
    await requestEstimate();
    await waitFor(() => expect(fromView.api.preview).toHaveBeenCalled());
    const viewArg = (fromView.api.preview as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    cleanup();

    const fromEdit = setup();
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: /Genera con IA/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Economy/ }));
    await requestEstimate();
    await waitFor(() => expect(fromEdit.api.preview).toHaveBeenCalled());
    const editArg = (fromEdit.api.preview as ReturnType<typeof vi.fn>).mock.calls[0]![0];

    // Le due strade differiscono solo per la requestId, che è per definizione
    // diversa fra due generazioni distinte.
    expect({ ...viewArg, requestId: null }).toEqual({ ...editArg, requestId: null });
  });

  it('ogni nuova apertura riparte da Quality anche dopo una scelta Economy annullata', () => {
    setup({ initialConceptMap: MAP });
    fireEvent.click(screen.getByRole('button', { name: /Rigenera con IA/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Economy/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    fireEvent.click(screen.getByRole('button', { name: /Rigenera con IA/ }));
    expect(screen.getByRole('radio', { name: /Quality/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('rigenerare non sostituisce la mappa finché non si usa esplicitamente la bozza', async () => {
    const { api } = setup({ initialConceptMap: MAP });
    fireEvent.click(screen.getByRole('button', { name: /Rigenera con IA/ }));
    expect(api.preview).not.toHaveBeenCalled();
    const generate = await requestEstimate();
    fireEvent.click(generate);
    await screen.findByRole('button', { name: 'Usa questa bozza' });
    expect(document.body.textContent).toContain('densità');
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
    openEditor();
    fireEvent.change(textarea(), { target: { value: `${MAP}!` } });

    const saveBtn = screen.getByRole('button', { name: /Salva mappa/ });
    // Doppio click nello stesso tick: la guardia sincrona deve reggere anche
    // prima che React abbia riprodotto lo stato `saving`.
    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn);
    expect(onSave).toHaveBeenCalledTimes(1);
    resolveSave();
  });

  it('è disabilitato finché non c’è una modifica da salvare', () => {
    setup({ initialConceptMap: MAP });
    openEditor();
    expect(
      (screen.getByRole('button', { name: /Salva mappa/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('un errore di salvataggio conserva il testo e resta in modifica', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Firestore non disponibile.'));
    setup({ initialConceptMap: MAP, onSave });
    openEditor();
    fireEvent.change(textarea(), { target: { value: `${MAP}!` } });
    fireEvent.click(screen.getByRole('button', { name: /Salva mappa/ }));

    expect((await screen.findByRole('alert')).textContent).toContain('Firestore non disponibile.');
    expect(textarea().value).toBe(`${MAP}!`);
  });

  it('un salvataggio riuscito torna in lettura e aggiorna la baseline', async () => {
    const { onSave, onDirtyChange } = setup({ initialConceptMap: MAP });
    openEditor();
    fireEvent.change(textarea(), { target: { value: `${MAP}!` } });
    fireEvent.click(screen.getByRole('button', { name: /Salva mappa/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(`${MAP}!`));
    // Tornata in lettura: nessuna textarea, e la guardia non ha più nulla da
    // proteggere perché la baseline è la mappa appena salvata.
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: /Markdown della mappa/ })).toBeNull(),
    );
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });
});

describe('protezione del lavoro non salvato', () => {
  it('«Annulla» con modifiche passa dalla conferma modale', async () => {
    setup({ initialConceptMap: MAP });
    openEditor();
    fireEvent.change(textarea(), { target: { value: `${MAP}!` } });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(await screen.findByText('Annullare le modifiche?')).toBeTruthy();
    // Finché non si conferma, il testo è ancora lì.
    expect(textarea().value).toBe(`${MAP}!`);
  });

  it('confermare l’annullamento ripristina l’ultima mappa salvata', async () => {
    setup({ initialConceptMap: MAP });
    openEditor();
    fireEvent.change(textarea(), { target: { value: `${MAP}!` } });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Annulla le modifiche' }));
    openEditor();
    expect(textarea().value).toBe(MAP);
  });

  it('«Annulla» senza modifiche torna in lettura senza chiedere nulla', () => {
    setup({ initialConceptMap: MAP });
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.queryByText('Annullare le modifiche?')).toBeNull();
    expect(screen.queryByRole('textbox', { name: /Markdown della mappa/ })).toBeNull();
  });

  it('segnala al workspace che c’è lavoro da perdere', () => {
    const onDirtyChange = vi.fn();
    setup({ initialConceptMap: MAP, onDirtyChange });
    openEditor();
    fireEvent.change(textarea(), { target: { value: `${MAP}!` } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('smontando la scheda la guardia viene liberata', () => {
    const onDirtyChange = vi.fn();
    const { view } = setup({ initialConceptMap: MAP, onDirtyChange });
    openEditor();
    fireEvent.change(textarea(), { target: { value: `${MAP}!` } });
    view.unmount();
    // Altrimenti il workspace resterebbe bloccato da una scheda che non esiste
    // più, e ogni navigazione successiva chiederebbe conferma a vuoto.
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});
