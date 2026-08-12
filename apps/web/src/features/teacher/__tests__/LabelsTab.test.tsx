import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as LabelsServiceModule from '../../repository/differentiation/differentiationLabelsService.js';

afterEach(cleanup);

const mockCreate = vi.fn();
const mockRename = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ db: {} }));

vi.mock('../../repository/differentiation/differentiationLabelsService.js', async () => {
  // `describeUsage` resta quello vero: il testo mostrato dalla card è parte del
  // contratto e non ha senso verificarne una copia.
  const actual = await vi.importActual<typeof LabelsServiceModule>(
    '../../repository/differentiation/differentiationLabelsService.js',
  );
  return {
    describeUsage: actual.describeUsage,
    DifferentiationLabelError: actual.DifferentiationLabelError,
    createDifferentiationLabel: (...args: unknown[]) => mockCreate(...args),
    renameDifferentiationLabel: (...args: unknown[]) => mockRename(...args),
    deleteDifferentiationLabel: (...args: unknown[]) => mockDelete(...args),
  };
});

import { LabelsTab } from '../LabelsTab.js';
// Il validatore vero: i test sui limiti devono vedere gli stessi messaggi che
// il service farebbe emergere, non una loro imitazione.
import { normalizeLabelName } from '../../repository/differentiation/labelName.js';

const OWNER_UID = 'owner-uid';

const LABELS = [
  {
    labelId: 'label-free',
    ownerUid: OWNER_UID,
    name: 'Gruppo 2',
    nameKey: 'gruppo 2',
    assignedCount: 0,
    draftUsageCount: 0,
  },
  {
    labelId: 'label-used',
    ownerUid: OWNER_UID,
    name: 'Percorso A',
    nameKey: 'percorso a',
    assignedCount: 2,
    draftUsageCount: 1,
  },
];

function renderTab(labels = LABELS) {
  const handlers = {
    onLabelCreated: vi.fn(),
    onLabelRenamed: vi.fn(),
    onLabelDeleted: vi.fn(),
  };
  render(<LabelsTab ownerUid={OWNER_UID} labels={labels} {...handlers} />);
  return handlers;
}

function cardOf(name: string): HTMLElement {
  return screen.getByRole('listitem', { name: `Etichetta ${name}` });
}

async function openMenu(name: string) {
  fireEvent.click(within(cardOf(name)).getByRole('button', { name: `Azioni etichetta — ${name}` }));
  return screen.getByRole('menu', { name: `Azioni etichetta — ${name}` });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LabelsTab — stato vuoto', () => {
  it('mostra un testo operativo senza alcun esempio diagnostico', () => {
    renderTab([]);
    expect(screen.getByText('Nessuna etichetta')).toBeTruthy();
    const panel = screen.getByRole('button', { name: /Nuova etichetta/ }).parentElement!;
    const text = panel.textContent ?? '';
    for (const forbidden of ['PDP', 'BES', 'DSA', 'diagnos', 'certificaz', 'disabil']) {
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(screen.getByText(/Gli studenti non le vedono mai/)).toBeTruthy();
  });
});

describe('LabelsTab — lista', () => {
  it('mostra una card per etichetta con conteggio studenti nel titolo', () => {
    renderTab();
    // Il conteggio vive nella riga del titolo; lo stesso numero ricompare nel
    // motivo di blocco, quindi si interroga il titolo e non l'intera card.
    expect(within(cardOf('Gruppo 2')).getByRole('heading').textContent).toContain(
      'Nessuno studente',
    );
    expect(within(cardOf('Percorso A')).getByRole('heading').textContent).toContain('2 studenti');
  });

  it('mostra il conteggio bozze solo quando è maggiore di zero', () => {
    renderTab();
    expect(within(cardOf('Percorso A')).getByRole('heading').textContent).toContain('1 bozza');
    expect(within(cardOf('Gruppo 2')).getByRole('heading').textContent).not.toContain('bozz');
    // Nessun riferimento a bozze da nessuna parte sulla card libera.
    expect(cardOf('Gruppo 2').textContent).not.toContain('bozz');
  });
});

describe('LabelsTab — creazione', () => {
  it('crea un’etichetta e notifica il parent', async () => {
    const created = {
      labelId: 'new',
      ownerUid: OWNER_UID,
      name: 'Nuova',
      nameKey: 'nuova',
      assignedCount: 0,
      draftUsageCount: 0,
    };
    mockCreate.mockResolvedValue(created);
    const handlers = renderTab();

    fireEvent.click(screen.getByRole('button', { name: /Nuova etichetta/ }));
    const input = screen.getByLabelText('Nome etichetta') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Nuova' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Nuova etichetta' }));

    await waitFor(() => expect(handlers.onLabelCreated).toHaveBeenCalledWith(created));
    await waitFor(() => expect(screen.queryByLabelText('Nome etichetta')).toBeNull());
  });

  it('mostra il contatore dei caratteri in code point', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Nuova etichetta/ }));
    expect(screen.getByText('0/40')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Nome etichetta'), { target: { value: 'Abc' } });
    expect(screen.getByText('3/40')).toBeTruthy();
    // Tre emoji = 3 code point, non 6 unità UTF-16.
    fireEvent.change(screen.getByLabelText('Nome etichetta'), { target: { value: '🎯🎯🎯' } });
    expect(screen.getByText('3/40')).toBeTruthy();
  });

  /**
   * `maxLength` HTML conta unità UTF-16: lasciarlo taglierebbe a 20 un nome di
   * 40 emoji, e lo farebbe **in silenzio**. Il limite lo decide il validatore.
   */
  it('nessun maxLength sugli input: il valore non viene mai troncato dal browser', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Nuova etichetta/ }));
    const input = screen.getByLabelText('Nome etichetta') as HTMLInputElement;
    expect(input.getAttribute('maxlength')).toBeNull();

    // 40 code point fuori dal BMP: con maxLength=40 il campo ne terrebbe 20.
    const forty = '🎯'.repeat(40);
    fireEvent.change(input, { target: { value: forty } });
    expect(input.value).toBe(forty);
    expect([...input.value].length).toBe(40);
    expect(screen.getByText('40/40')).toBeTruthy();
  });

  it('un nome entro entrambi i limiti è accettato, emoji comprese', async () => {
    const created = {
      labelId: 'new',
      ownerUid: OWNER_UID,
      name: '🎯'.repeat(30),
      nameKey: '🎯'.repeat(30),
      assignedCount: 0,
      draftUsageCount: 0,
    };
    mockCreate.mockResolvedValue(created);
    const handlers = renderTab();

    fireEvent.click(screen.getByRole('button', { name: /Nuova etichetta/ }));
    // 30 emoji = 30 code point e 120 byte: esattamente al limite in byte.
    fireEvent.change(screen.getByLabelText('Nome etichetta'), {
      target: { value: '🎯'.repeat(30) },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Nuova etichetta' }));

    await waitFor(() => expect(handlers.onLabelCreated).toHaveBeenCalledWith(created));
  });

  it('oltre i code point mostra un errore leggibile e conserva il testo', async () => {
    mockCreate.mockImplementation((raw: string) => Promise.resolve(normalizeLabelName(raw)));
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: /Nuova etichetta/ }));
    const input = screen.getByLabelText('Nome etichetta') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'a'.repeat(41) } });
    fireEvent.submit(screen.getByRole('form', { name: 'Nuova etichetta' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/40 caratteri/));
    expect((screen.getByLabelText('Nome etichetta') as HTMLInputElement).value).toBe(
      'a'.repeat(41),
    );
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('oltre i byte, pur restando entro i code point, mostra l’errore sul limite in byte', async () => {
    // 31 emoji: 31 code point (entro 40) ma 124 byte (oltre 120).
    const heavy = '🎯'.repeat(31);
    mockCreate.mockImplementation((raw: string) => Promise.resolve(normalizeLabelName(raw)));
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: /Nuova etichetta/ }));
    fireEvent.change(screen.getByLabelText('Nome etichetta'), { target: { value: heavy } });
    fireEvent.submit(screen.getByRole('form', { name: 'Nuova etichetta' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/120 byte/));
    expect((screen.getByLabelText('Nome etichetta') as HTMLInputElement).value).toBe(heavy);
  });

  it('su errore conserva il testo digitato e mostra il messaggio', async () => {
    mockCreate.mockRejectedValue(new Error('Esiste già un’etichetta con questo nome: «Nuova».'));
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: /Nuova etichetta/ }));
    const input = screen.getByLabelText('Nome etichetta') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Nuova' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Nuova etichetta' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Esiste già'));
    expect((screen.getByLabelText('Nome etichetta') as HTMLInputElement).value).toBe('Nuova');
  });

  it('due submit ravvicinati avviano una sola creazione', async () => {
    let resolve!: (value: unknown) => void;
    mockCreate.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: /Nuova etichetta/ }));
    fireEvent.change(screen.getByLabelText('Nome etichetta'), { target: { value: 'Nuova' } });
    const form = screen.getByRole('form', { name: 'Nuova etichetta' });
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    resolve({
      labelId: 'x',
      ownerUid: OWNER_UID,
      name: 'Nuova',
      nameKey: 'nuova',
      assignedCount: 0,
      draftUsageCount: 0,
    });
  });
});

describe('LabelsTab — rinomina', () => {
  it('precompila il nome corrente e salva', async () => {
    const renamed = { ...LABELS[0]!, name: 'Gruppo 3', nameKey: 'gruppo 3' };
    mockRename.mockResolvedValue(renamed);
    const handlers = renderTab();

    const menu = await openMenu('Gruppo 2');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Modifica etichetta Gruppo 2' }));

    const input = screen.getByLabelText('Nome etichetta') as HTMLInputElement;
    expect(input.value).toBe('Gruppo 2');
    fireEvent.change(input, { target: { value: 'Gruppo 3' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Modifica etichetta' }));

    await waitFor(() => expect(handlers.onLabelRenamed).toHaveBeenCalledWith(renamed));
    expect(mockRename).toHaveBeenCalledWith('label-free', 'Gruppo 3', OWNER_UID, {});
  });

  it('su errore conserva il testo e non chiude il dialog', async () => {
    mockRename.mockRejectedValue(new Error('Esiste già un’etichetta con questo nome.'));
    renderTab();

    const menu = await openMenu('Gruppo 2');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Modifica etichetta Gruppo 2' }));
    fireEvent.change(screen.getByLabelText('Nome etichetta'), { target: { value: 'Percorso A' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Modifica etichetta' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Esiste già'));
    expect((screen.getByLabelText('Nome etichetta') as HTMLInputElement).value).toBe('Percorso A');
  });
});

describe('LabelsTab — eliminazione', () => {
  it('l’etichetta libera si elimina dopo conferma', async () => {
    mockDelete.mockResolvedValue(undefined);
    const handlers = renderTab();

    const menu = await openMenu('Gruppo 2');
    const item = within(menu).getByRole('menuitem', { name: 'Elimina etichetta Gruppo 2' });
    expect((item as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(item);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Gruppo 2');
    expect(dialog.textContent).toContain('irreversibile');
    fireEvent.click(within(dialog).getByRole('button', { name: /Elimina/ }));

    await waitFor(() => expect(handlers.onLabelDeleted).toHaveBeenCalledWith('label-free'));
  });

  it('l’etichetta in uso ha Elimina disabilitata con motivo accessibile', async () => {
    renderTab();
    const menu = await openMenu('Percorso A');
    const item = within(menu).getByRole('menuitem', {
      name: 'Elimina etichetta Percorso A',
    }) as HTMLButtonElement;

    expect(item.disabled).toBe(true);
    const hintId = item.getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    const hint = document.getElementById(hintId!);
    expect(hint?.textContent).toContain('2 studenti');
    expect(hint?.textContent).toContain('1 bozza');
  });

  it('se il service rifiuta, il dialog resta aperto e mostra l’errore', async () => {
    mockDelete.mockRejectedValue(
      new Error('L’etichetta «Gruppo 2» è assegnata a 1 studente: rimuovi prima questi utilizzi.'),
    );
    const handlers = renderTab();

    const menu = await openMenu('Gruppo 2');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Elimina etichetta Gruppo 2' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: /Elimina/ }),
    );

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('rimuovi prima questi utilizzi'),
    );
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(handlers.onLabelDeleted).not.toHaveBeenCalled();
  });

  it('due click ravvicinati avviano una sola eliminazione', async () => {
    let resolve!: (value: unknown) => void;
    mockDelete.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    renderTab();

    const menu = await openMenu('Gruppo 2');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Elimina etichetta Gruppo 2' }));
    const button = within(screen.getByRole('alertdialog')).getByRole('button', { name: /Elimina/ });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(mockDelete).toHaveBeenCalledTimes(1);
    resolve(undefined);
  });
});
