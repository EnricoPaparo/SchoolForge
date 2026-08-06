import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LESSON_SIMPLE_TEMPLATE,
  UDA_SIMPLE_TEMPLATE,
} from '../../repository/structureImport/index.js';

/**
 * Feedback della copia nella sezione Template.
 *
 * Il messaggio globale sotto la griglia è stato rimosso: era la conferma di un
 * gesto fatto altrove, arrivava lontano dal pulsante premuto e, comparendo,
 * spostava il contenuto sotto la griglia. L'esito vive ora **dentro il
 * pulsante** della card interessata, e viene annunciato da una regione
 * `aria-live` che non occupa spazio.
 *
 * Ciò che va difeso, in ordine di importanza: un fallimento non deve mai
 * sembrare un successo; l'esito non deve toccare le altre card; niente si deve
 * muovere; e nulla deve aggiornarsi dopo lo smontaggio, perché la Clipboard API
 * è asincrona e il docente può cambiare pagina mentre la promessa è in volo.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

vi.mock('../templateKit.js', () => ({
  TEMPLATES: [
    { name: 'Programma', filename: 'programma-template.md', url: '/t/programma-template.md' },
  ],
  downloadTemplate: vi.fn(),
  downloadKitZip: vi.fn().mockResolvedValue(undefined),
}));

import { TemplateKitView } from '../TemplateKitView.js';

const UDA = 'Struttura UDA';
const LEZIONI = 'Struttura lezioni';

/** Il pulsante di una card, cercato per testo: l'`aria-label` cambia con lo stato. */
function copyButton(titolo: string): HTMLButtonElement {
  const card = screen.getByRole('heading', { name: titolo }).closest('article');
  const button = card!.querySelector('button');
  return button as HTMLButtonElement;
}

const labelOf = (titolo: string): string => copyButton(titolo).textContent?.trim() ?? '';

function mockClipboard(impl: () => Promise<void>) {
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClipboard(async () => {});
});

describe('nessun feedback globale sotto la griglia', () => {
  it('il messaggio «Esempio copiato negli appunti.» non esiste più, nemmeno dopo una copia', async () => {
    render(<TemplateKitView />);
    expect(screen.queryByText('Esempio copiato negli appunti.')).toBeNull();
    fireEvent.click(copyButton(UDA));
    expect(await screen.findByRole('button', { name: `${UDA}: copiato` })).toBeTruthy();
    expect(screen.queryByText('Esempio copiato negli appunti.')).toBeNull();
    expect(document.body.textContent).not.toContain('Esempio copiato negli appunti');
  });

  it('sotto la griglia non resta alcun contenitore, nemmeno vuoto', () => {
    const { container } = render(<TemplateKitView />);
    const griglia = container.querySelector('[class*="examplesGrid"]')!;
    // Ciò che seguiva la griglia era un paragrafo con `min-height`: riservava
    // una riga anche quando non diceva nulla.
    expect(griglia.nextElementSibling).toBeNull();
    expect(container.querySelector('[class*="copyStatus"]')).toBeNull();
  });

  it('la copia non aggiunge nodi alla pagina né alla card', async () => {
    const { container } = render(<TemplateKitView />);
    const prima = container.querySelectorAll('*').length;
    const nodiCard = screen
      .getByRole('heading', { name: UDA })
      .closest('article')!
      .querySelectorAll('*').length;
    fireEvent.click(copyButton(UDA));
    await screen.findByRole('button', { name: `${UDA}: copiato` });
    // L'icona cambia, ma il numero di nodi no: nessuna riga nuova.
    expect(container.querySelectorAll('*').length).toBe(prima);
    expect(
      screen.getByRole('heading', { name: UDA }).closest('article')!.querySelectorAll('*').length,
    ).toBe(nodiCard);
  });
});

describe('l’esito vive nel pulsante della card interessata', () => {
  it('successo UDA: solo quel pulsante diventa «Copiato»', async () => {
    render(<TemplateKitView />);
    fireEvent.click(copyButton(UDA));
    await screen.findByRole('button', { name: `${UDA}: copiato` });
    expect(labelOf(UDA)).toBe('Copiato');
    expect(labelOf(LEZIONI)).toBe('Copia');
    expect(labelOf('Struttura ZIP')).toBe('Copia');
  });

  it('successo lezioni: solo quel pulsante cambia', async () => {
    render(<TemplateKitView />);
    fireEvent.click(copyButton(LEZIONI));
    await screen.findByRole('button', { name: `${LEZIONI}: copiato` });
    expect(labelOf(LEZIONI)).toBe('Copiato');
    expect(labelOf(UDA)).toBe('Copia');
  });

  it('errore: «Riprova» compare solo sulla card interessata', async () => {
    mockClipboard(async () => {
      throw new Error('denied');
    });
    render(<TemplateKitView />);
    fireEvent.click(copyButton(LEZIONI));
    await screen.findByRole('button', { name: `Riprova a copiare ${LEZIONI}` });
    expect(labelOf(LEZIONI)).toBe('Riprova');
    expect(labelOf(UDA)).toBe('Copia');
    expect(labelOf('Struttura ZIP')).toBe('Copia');
  });

  it('un fallimento non dichiara mai successo', async () => {
    mockClipboard(async () => {
      throw new Error('denied');
    });
    render(<TemplateKitView />);
    fireEvent.click(copyButton(UDA));
    await screen.findByRole('button', { name: `Riprova a copiare ${UDA}` });
    expect(labelOf(UDA)).not.toContain('Copiato');
    expect(document.body.textContent).not.toContain('Copiato');
    expect(screen.queryByRole('button', { name: `${UDA}: copiato` })).toBeNull();
  });

  it('«Riprova» esegue un tentativo reale, e un successo lo risolve', async () => {
    let fallisci = true;
    const writeText = mockClipboard(async () => {
      if (fallisci) throw new Error('denied');
    });
    render(<TemplateKitView />);
    fireEvent.click(copyButton(UDA));
    await screen.findByRole('button', { name: `Riprova a copiare ${UDA}` });
    expect(writeText).toHaveBeenCalledTimes(1);

    fallisci = false;
    fireEvent.click(copyButton(UDA));
    await screen.findByRole('button', { name: `${UDA}: copiato` });
    // Non è un semplice reset di stato: la Clipboard API è stata richiamata.
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenLastCalledWith(UDA_SIMPLE_TEMPLATE);
  });

  it('`aria-label` e `title` seguono lo stato e restano coerenti fra loro', async () => {
    render(<TemplateKitView />);
    const atteso = (stato: string) => {
      const b = copyButton(UDA);
      expect(b.getAttribute('aria-label')).toBe(stato);
      expect(b.getAttribute('title')).toBe(stato);
    };
    atteso(`Copia ${UDA}`);
    fireEvent.click(copyButton(UDA));
    await screen.findByRole('button', { name: `${UDA}: copiato` });
    atteso(`${UDA}: copiato`);
  });

  it('un doppio click non produce feedback incoerente', async () => {
    const writeText = mockClipboard(async () => {});
    render(<TemplateKitView />);
    fireEvent.click(copyButton(UDA));
    fireEvent.click(copyButton(UDA));
    await screen.findByRole('button', { name: `${UDA}: copiato` });
    expect(writeText).toHaveBeenCalledTimes(2);
    // Un solo pulsante in stato non-idle, e nessuna traccia di errore.
    expect(labelOf(UDA)).toBe('Copiato');
    expect(labelOf(LEZIONI)).toBe('Copia');
    expect(document.body.textContent).not.toContain('Riprova');
  });

  it('copiare una seconda card sposta l’esito, senza lasciarne due accesi', async () => {
    render(<TemplateKitView />);
    fireEvent.click(copyButton(UDA));
    await screen.findByRole('button', { name: `${UDA}: copiato` });
    fireEvent.click(copyButton(LEZIONI));
    await screen.findByRole('button', { name: `${LEZIONI}: copiato` });
    expect(labelOf(UDA)).toBe('Copia');
    expect(labelOf(LEZIONI)).toBe('Copiato');
  });
});

describe('annuncio accessibile', () => {
  it('l’esito passa da una regione aria-live non visibile', async () => {
    const { container } = render(<TemplateKitView />);
    const live = container.querySelector('[role="status"][aria-live="polite"]')!;
    expect(live).toBeTruthy();
    // Non visibile, e soprattutto fuori dal flusso: non può spostare nulla.
    expect(live.className).toMatch(/srOnly/);
    expect(live.textContent).toBe('');

    fireEvent.click(copyButton(UDA));
    await screen.findByRole('button', { name: `${UDA}: copiato` });
    expect(live.textContent).toBe(`${UDA}: esempio copiato negli appunti.`);
  });

  it('anche il fallimento è annunciato, e dice cosa fare', async () => {
    mockClipboard(async () => {
      throw new Error('denied');
    });
    const { container } = render(<TemplateKitView />);
    fireEvent.click(copyButton(UDA));
    await screen.findByRole('button', { name: `Riprova a copiare ${UDA}` });
    const live = container.querySelector('[role="status"][aria-live="polite"]')!;
    expect(live.textContent).toContain('impossibile copiare negli appunti');
    expect(live.textContent).toContain('Seleziona il testo manualmente');
  });
});

describe('timer e ciclo di vita', () => {
  it('la conferma torna automaticamente a «Copia»', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<TemplateKitView />);
    fireEvent.click(copyButton(UDA));
    await screen.findByRole('button', { name: `${UDA}: copiato` });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(labelOf(UDA)).toBe('Copia');
  });

  it('l’errore invece resta: è il docente a doverlo risolvere, non un timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockClipboard(async () => {
      throw new Error('denied');
    });
    render(<TemplateKitView />);
    fireEvent.click(copyButton(UDA));
    await screen.findByRole('button', { name: `Riprova a copiare ${UDA}` });
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(labelOf(UDA)).toBe('Riprova');
  });

  it('il timer viene cancellato allo smontaggio e non sopravvive al componente', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = render(<TemplateKitView />);
    fireEvent.click(copyButton(UDA));
    await screen.findByRole('button', { name: `${UDA}: copiato` });
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('un risultato tardivo dopo lo smontaggio non aggiorna lo stato', async () => {
    // React 18 non avvisa più sul `setState` dopo l'unmount, quindi la prova non
    // può essere «nessun warning»: sarebbe vera anche senza la guardia. Ciò che
    // è davvero osservabile è il timer di reset — il ramo di successo lo
    // programma **dopo** aver scritto lo stato, quindi se la guardia mancasse
    // resterebbe un timer pendente su un componente che non esiste più.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let risolvi: () => void = () => {};
    mockClipboard(
      () =>
        new Promise<void>((resolve) => {
          risolvi = resolve;
        }),
    );

    const { unmount } = render(<TemplateKitView />);
    fireEvent.click(copyButton(UDA));
    unmount();
    await act(async () => {
      risolvi();
      await Promise.resolve();
    });

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('sorgente unica del testo copiato', () => {
  it('ogni card copia esattamente la propria costante', async () => {
    const writeText = mockClipboard(async () => {});
    render(<TemplateKitView />);
    for (const [titolo, canonical] of [
      [UDA, UDA_SIMPLE_TEMPLATE],
      [LEZIONI, LESSON_SIMPLE_TEMPLATE],
    ] as const) {
      fireEvent.click(copyButton(titolo));
      await screen.findByRole('button', { name: `${titolo}: copiato` });
      expect(writeText).toHaveBeenLastCalledWith(canonical);
    }
  });
});
