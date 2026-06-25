import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

import { ClassesView } from '../ClassesView.js';

const mockListClasses = vi.fn();
const mockCreateClass = vi.fn();
const mockUpdateClass = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ db: {} }));
vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({ user: { uid: 'owner-uid' } }),
}));
vi.mock('../../repository/classes/classesService.js', () => ({
  listClasses: (...args: unknown[]) => mockListClasses(...args),
  createClass: (...args: unknown[]) => mockCreateClass(...args),
  updateClass: (...args: unknown[]) => mockUpdateClass(...args),
}));

describe('ClassesView', () => {
  it('shows loading state initially', () => {
    mockListClasses.mockReturnValue(new Promise(() => {}));
    render(<ClassesView />);
    expect(screen.getByText(/caricamento/i)).toBeTruthy();
  });

  it('shows empty state when no classes', async () => {
    mockListClasses.mockResolvedValue([]);
    render(<ClassesView />);
    await waitFor(() => expect(screen.getByText(/nessuna classe/i)).toBeTruthy());
  });

  it('renders class list', async () => {
    mockListClasses.mockResolvedValue([
      {
        id: 'c1',
        ownerUid: 'owner-uid',
        name: 'Classe 3A',
        description: 'Liceo scientifico',
        createdAt: null,
        updatedAt: null,
      },
      {
        id: 'c2',
        ownerUid: 'owner-uid',
        name: 'Classe 4B',
        description: null,
        createdAt: null,
        updatedAt: null,
      },
    ]);
    render(<ClassesView />);
    await waitFor(() => {
      expect(screen.getByText('Classe 3A')).toBeTruthy();
      expect(screen.getByText('Classe 4B')).toBeTruthy();
    });
  });

  it('calls createClass on form submit', async () => {
    mockListClasses.mockResolvedValue([]);
    mockCreateClass.mockResolvedValue('new-id');
    render(<ClassesView />);
    await waitFor(() => screen.getByLabelText('Nome'));

    // Use the id-targeted input for new class name
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    fireEvent.change(document.getElementById('new-class-name')!, { target: { value: 'Nuova Classe' } });
    fireEvent.click(screen.getByRole('button', { name: /crea classe/i }));

    await waitFor(() =>
      expect(mockCreateClass).toHaveBeenCalledWith('Nuova Classe', null, 'owner-uid', {}),
    );
  });

  it('shows inline edit form on edit click', async () => {
    mockListClasses.mockResolvedValue([
      {
        id: 'c1',
        ownerUid: 'owner-uid',
        name: 'Classe 3A',
        description: null,
        createdAt: null,
        updatedAt: null,
      },
    ]);
    render(<ClassesView />);
    await waitFor(() => screen.getByText('Classe 3A'));

    fireEvent.click(screen.getByRole('button', { name: /modifica/i }));
    expect(screen.getByRole('form', { name: /modifica classe/i })).toBeTruthy();
  });

  it('calls updateClass on save', async () => {
    mockListClasses.mockResolvedValue([
      {
        id: 'c1',
        ownerUid: 'owner-uid',
        name: 'Classe 3A',
        description: null,
        createdAt: null,
        updatedAt: null,
      },
    ]);
    mockUpdateClass.mockResolvedValue(undefined);
    render(<ClassesView />);
    await waitFor(() => screen.getByText('Classe 3A'));

    fireEvent.click(screen.getByRole('button', { name: /modifica/i }));

    const nameInput = screen.getByDisplayValue('Classe 3A');
    fireEvent.change(nameInput, { target: { value: 'Classe 3A modificata' } });
    fireEvent.click(screen.getByRole('button', { name: /salva/i }));

    await waitFor(() =>
      expect(mockUpdateClass).toHaveBeenCalledWith(
        'c1',
        'Classe 3A modificata',
        null,
        'owner-uid',
        {},
      ),
    );
  });
});
