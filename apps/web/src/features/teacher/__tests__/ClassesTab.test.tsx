import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateClass.mockResolvedValue('class-2');
  mockUpdateClass.mockResolvedValue(undefined);
  mockDeleteClass.mockResolvedValue(undefined);
});

describe('ClassesTab (DUX-05A)', () => {
  it('renders the inline creation row and the client-side student count', () => {
    renderTab();
    expect(screen.getByLabelText('Nome nuova classe')).toBeTruthy();
    const row = screen.getByText('3A Informatica').closest('tr');
    expect(row).toBeTruthy();
    expect(within(row!).getByText('3')).toBeTruthy();
    expect(screen.queryByText('Descrizione legacy da preservare')).toBeNull();
  });

  it('creates without description and patches local state through the callback', async () => {
    const onClassCreated = vi.fn();
    renderTab({ onClassCreated });
    fireEvent.change(screen.getByLabelText('Nome nuova classe'), {
      target: { value: '4B Chimica' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi' }));

    await waitFor(() =>
      expect(mockCreateClass).toHaveBeenCalledWith('4B Chimica', null, 'owner-uid', {}),
    );
    expect(onClassCreated).toHaveBeenCalledWith('class-2', '4B Chimica');
  });

  it('renames a class while preserving its hidden legacy description', async () => {
    const onClassRenamed = vi.fn();
    renderTab({ onClassRenamed });
    fireEvent.click(screen.getByRole('button', { name: 'Modifica classe 3A Informatica' }));
    fireEvent.change(screen.getByLabelText('Nome classe'), { target: { value: '3A INF' } });
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

  it('requires explicit confirmation before deleting', async () => {
    const onClassDeleted = vi.fn();
    renderTab({ onClassDeleted });
    fireEvent.click(screen.getByRole('button', { name: 'Elimina classe 3A Informatica' }));
    expect(mockDeleteClass).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Conferma' }));

    await waitFor(() => expect(mockDeleteClass).toHaveBeenCalledWith('class-1', 'owner-uid', {}));
    expect(onClassDeleted).toHaveBeenCalledWith('class-1');
  });
});
