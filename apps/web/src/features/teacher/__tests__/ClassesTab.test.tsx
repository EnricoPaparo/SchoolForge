import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassesTab, type ClassesTabItem } from '../ClassesTab.js';

afterEach(cleanup);

const mockCreateClass = vi.fn();
const mockUpdateClass = vi.fn();
const mockDeleteClass = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ db: {} }));
vi.mock('../../repository/classes/classesService.js', () => ({
  createClass: (...args: unknown[]) => mockCreateClass(...args),
  updateClass: (...args: unknown[]) => mockUpdateClass(...args),
  deleteClass: (...args: unknown[]) => mockDeleteClass(...args),
}));

const classes = [
  {
    id: 'class-1',
    ownerUid: 'owner-uid',
    name: '3A Informatica',
    description: 'Descrizione legacy da preservare',
  } satisfies ClassesTabItem,
];

function renderTab(overrides?: Partial<ComponentProps<typeof ClassesTab>>) {
  const props: ComponentProps<typeof ClassesTab> = {
    ownerUid: 'owner-uid',
    classes,
    studentCountByClassId: new Map([['class-1', 3]]),
    onClassCreated: vi.fn(),
    onClassRenamed: vi.fn(),
    onClassDeleted: vi.fn(),
    ...overrides,
  };
  return { ...render(<ClassesTab {...props} />), props };
}

/**
 * UI-STUDENTI-CLASSI-01 — modifica ed eliminazione vivono nel menu «…» condiviso
 * (`RecordActionsMenu`). Questo helper apre il menu della classe indicata e
 * restituisce la voce richiesta, così i test restano espressi in termini di
 * azione e non di markup.
 */
function menuItem(name: RegExp | string, cardIndex = 0): HTMLButtonElement {
  const triggers = screen.getAllByRole('button', { name: /^Azioni classe/ });
  const trigger = triggers[cardIndex]!;
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  return screen.getByRole('menuitem', { name }) as HTMLButtonElement;
}

/** Apre il dialog «Nuova classe» e restituisce il campo nome. */
function openCreateDialog(): HTMLInputElement {
  fireEvent.click(screen.getByRole('button', { name: 'Nuova classe' }));
  return screen.getByLabelText('Nome classe') as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateClass.mockResolvedValue('class-2');
  mockUpdateClass.mockResolvedValue(undefined);
  mockDeleteClass.mockResolvedValue(undefined);
});

describe('ClassesTab (DUX-05A)', () => {
  it('mostra una card per classe, full-width, col conteggio studenti già disponibile', () => {
    renderTab();
    const list = screen.getByRole('list', { name: 'Classi' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(1);
    // Titolo e conteggio sulla stessa riga semantica: «3A Informatica · 3 studenti».
    const heading = within(cards[0]!).getByRole('heading');
    expect(heading.textContent).toBe('3A Informatica · 3 studenti');
    expect(screen.queryByText('Descrizione legacy da preservare')).toBeNull();
    // Nessuna tabella: la lista è verticale.
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('usa il singolare per una sola classe con uno studente', () => {
    renderTab({ studentCountByClassId: new Map([['class-1', 1]]) });
    expect(screen.getByRole('heading').textContent).toBe('3A Informatica · 1 studente');
  });

  it('espone «Nuova classe» come azione a larghezza piena che apre il dialog', () => {
    renderTab();
    expect(screen.queryByRole('dialog')).toBeNull();
    const input = openCreateDialog();
    expect(screen.getByRole('dialog', { name: 'Nuova classe' })).toBeTruthy();
    expect(input.tagName).toBe('INPUT');
  });

  it('creates without description and patches local state through the callback', async () => {
    const onClassCreated = vi.fn();
    renderTab({ onClassCreated });
    fireEvent.change(openCreateDialog(), { target: { value: '4B Chimica' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi' }));

    await waitFor(() =>
      expect(mockCreateClass).toHaveBeenCalledWith('4B Chimica', null, 'owner-uid', {}),
    );
    expect(onClassCreated).toHaveBeenCalledWith('class-2', '4B Chimica');
    // Il dialog si chiude da solo dopo la creazione riuscita.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renames a class while preserving its hidden legacy description', async () => {
    const onClassRenamed = vi.fn();
    renderTab({ onClassRenamed });
    fireEvent.click(menuItem('Modifica classe 3A Informatica'));
    fireEvent.change(screen.getByLabelText('Nome classe'), { target: { value: '  3A INF  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() =>
      expect(mockUpdateClass).toHaveBeenCalledWith(
        'class-1',
        '3A INF',
        'Descrizione legacy da preservare',
        'owner-uid',
        {},
      ),
    );
    expect(onClassRenamed).toHaveBeenCalledWith('class-1', '3A INF');
  });

  it('enters edit mode without submitting when the edit action is chosen', () => {
    renderTab();

    const edit = menuItem('Modifica classe 3A Informatica');
    act(() => {
      edit.click();
    });

    const input = screen.getByRole('textbox', { name: 'Nome classe' });
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(mockUpdateClass).not.toHaveBeenCalled();
  });

  it('saves once with Enter and closes the editor', async () => {
    const onClassRenamed = vi.fn();
    renderTab({ onClassRenamed });
    fireEvent.click(menuItem('Modifica classe 3A Informatica'));
    const input = screen.getByRole('textbox', { name: 'Nome classe' });
    fireEvent.change(input, { target: { value: '3A Sistemi' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(mockUpdateClass).toHaveBeenCalledTimes(1));
    expect(onClassRenamed).toHaveBeenCalledWith('class-1', '3A Sistemi');
    expect(screen.queryByRole('textbox', { name: 'Nome classe' })).toBeNull();
  });

  it('cancels with Escape without writing and restores the original name', () => {
    renderTab();
    fireEvent.click(menuItem('Modifica classe 3A Informatica'));
    const input = screen.getByRole('textbox', { name: 'Nome classe' });
    fireEvent.change(input, { target: { value: 'Nome temporaneo' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(mockUpdateClass).not.toHaveBeenCalled();
    // Il nome originale resta quello mostrato: nessuna scrittura, nessun residuo.
    expect(screen.getByRole('heading').textContent).toContain('3A Informatica');
    // Il ripristino del focus è ora responsabilità del menu condiviso (Escape sul
    // menu riporta al trigger «…»): l'editor non ha più un proprio pulsante.
    expect(screen.queryByRole('textbox', { name: 'Nome classe' })).toBeNull();
  });

  it('cancels with the explicit button without writing', () => {
    renderTab();
    fireEvent.click(menuItem('Modifica classe 3A Informatica'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome classe' }), {
      target: { value: 'Nome temporaneo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));

    expect(mockUpdateClass).not.toHaveBeenCalled();
    expect(screen.getByRole('heading').textContent).toContain('3A Informatica');
  });

  it('does not write an empty or unchanged name', () => {
    renderTab();
    fireEvent.click(menuItem('Modifica classe 3A Informatica'));
    const input = screen.getByRole('textbox', { name: 'Nome classe' });
    const save = screen.getByRole('button', { name: 'Salva' }) as HTMLButtonElement;

    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '   ' } });
    expect(save.disabled).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockUpdateClass).not.toHaveBeenCalled();
  });

  it('guards a pending save against double submission', async () => {
    let resolveSave!: () => void;
    mockUpdateClass.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveSave = resolve)),
    );
    renderTab();
    fireEvent.click(menuItem('Modifica classe 3A Informatica'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome classe' }), {
      target: { value: '3A Sistemi' },
    });
    const save = screen.getByRole('button', { name: 'Salva' });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(mockUpdateClass).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Salvataggio…' })).toBeTruthy();
    expect(
      (screen.getByRole('textbox', { name: 'Nome classe' }) as HTMLInputElement).disabled,
    ).toBe(true);

    resolveSave();
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Nome classe' })).toBeNull());
  });

  it('keeps the editor and typed value after a service error, then permits retry', async () => {
    mockUpdateClass.mockRejectedValueOnce(new Error('duplicate'));
    renderTab();
    fireEvent.click(menuItem('Modifica classe 3A Informatica'));
    const input = screen.getByRole('textbox', { name: 'Nome classe' });
    fireEvent.change(input, { target: { value: '3A Sistemi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Impossibile modificare la classe. Riprova.',
    );
    expect((screen.getByRole('textbox', { name: 'Nome classe' }) as HTMLInputElement).value).toBe(
      '3A Sistemi',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    await waitFor(() => expect(mockUpdateClass).toHaveBeenCalledTimes(2));
  });

  it('requires explicit confirmation before deleting', async () => {
    const onClassDeleted = vi.fn();
    renderTab({ onClassDeleted });
    fireEvent.click(menuItem('Elimina classe 3A Informatica'));
    expect(mockDeleteClass).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Conferma' }));

    await waitFor(() => expect(mockDeleteClass).toHaveBeenCalledWith('class-1', 'owner-uid', {}));
    expect(onClassDeleted).toHaveBeenCalledWith('class-1');
  });
});

describe('ClassesTab — card e menu azioni (UI-STUDENTI-CLASSI-01)', () => {
  it('raccoglie modifica ed eliminazione nel menu «…», con l’eliminazione distruttiva', () => {
    renderTab();
    const card = screen.getByRole('listitem', { name: 'Classe 3A Informatica' });
    // Un solo pulsante sulla card a riposo: il trigger «…».
    expect(within(card).getAllByRole('button')).toHaveLength(1);

    fireEvent.click(within(card).getByRole('button', { name: /^Azioni classe/ }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Modifica classe', 'Elimina classe']);
    expect(items[1]!.className).toMatch(/menuDanger/);
  });

  it('non introduce una falsa apertura della card: nessuna superficie apribile', () => {
    renderTab();
    const card = screen.getByRole('listitem', { name: 'Classe 3A Informatica' });
    expect(within(card).queryByRole('button', { name: /^Apri/ })).toBeNull();
    expect(card.querySelector('button[aria-label^="Apri"]')).toBeNull();
  });

  it('non annida pulsanti dentro pulsanti', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /^Azioni classe/ }));
    for (const button of screen.getAllByRole('button')) {
      expect(button.querySelector('button')).toBeNull();
    }
  });

  it('il dialog di creazione si chiude con Annulla senza scrivere', () => {
    renderTab();
    openCreateDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockCreateClass).not.toHaveBeenCalled();
  });

  it('non crea una classe con nome vuoto', () => {
    renderTab();
    const input = openCreateDialog();
    const submit = screen.getByRole('button', { name: 'Aggiungi' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '   ' } });
    expect(submit.disabled).toBe(true);
    expect(mockCreateClass).not.toHaveBeenCalled();
  });

  it('mostra l’errore di creazione dentro il dialog, senza chiuderlo', async () => {
    mockCreateClass.mockRejectedValueOnce(new Error('boom'));
    renderTab();
    fireEvent.change(openCreateDialog(), { target: { value: '4B Chimica' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Impossibile creare la classe. Riprova.',
    );
    expect(screen.getByRole('dialog', { name: 'Nuova classe' })).toBeTruthy();
  });

  it('mostra lo stato vuoto quando non esiste ancora nessuna classe', () => {
    renderTab({ classes: [], studentCountByClassId: new Map() });
    expect(screen.getByText('Nessuna classe ancora creata.')).toBeTruthy();
    // L'azione primaria resta comunque disponibile.
    expect(screen.getByRole('button', { name: 'Nuova classe' })).toBeTruthy();
  });
});
