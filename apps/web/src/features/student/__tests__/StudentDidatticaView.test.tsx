import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentDidatticaView } from '../StudentDidatticaView.js';

vi.mock('../../../lib/firebase.js', () => ({ db: {} }));
vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({ user: { uid: 'student-uid', email: 's@test.com' } }),
}));

const mockLoadStudentLessons = vi.fn();
vi.mock('../../repository/programs/studentLessonsService.js', () => ({
  loadStudentLessons: (...args: unknown[]) => mockLoadStudentLessons(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

const PROGRAM_A = { id: 'prog-a', title: 'Informatica', classIds: ['class-a'] };
const PROGRAM_B = { id: 'prog-b', title: 'Matematica', classIds: ['class-a'] };
const LESSON_1 = {
  id: 'l1',
  ownerUid: 'owner-uid',
  programId: 'prog-a',
  importId: 'imp-1',
  udaId: 'uda-1',
  udaDir: 'uda-01-reti',
  path: 'uda-01-reti/lezione-001.md',
  filename: 'lezione-001.md',
  contentPath: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001.md',
  createdAt: null,
  titolo: 'Internet e reti',
  sottotitolo: 'Concetti fondamentali',
  difficolta: 'base',
  concettiChiave: ['internet', 'rete'],
  obiettivi: ['Comprendere il Web'],
  order: 0,
  content: '# Titolo\n\nContenuto della lezione.',
};
const LESSON_2 = {
  ...LESSON_1,
  id: 'l2',
  udaDir: 'uda-02-web',
  filename: 'lezione-002.md',
  titolo: 'Il Web',
  path: 'uda-02-web/lezione-002.md',
  contentPath: 'repository/owner-uid/imports/imp-1/uda-02-web/lezione-002.md',
};

function loadWithData() {
  mockLoadStudentLessons.mockResolvedValue({
    status: 'ok',
    programs: [PROGRAM_A, PROGRAM_B],
    lessonsByProgram: { 'prog-a': [LESSON_1, LESSON_2], 'prog-b': [] },
  });
}

describe('StudentDidatticaView — SDUX-01', () => {
  it('handles loading, no-class and load errors', async () => {
    mockLoadStudentLessons.mockReturnValueOnce(new Promise(() => {}));
    const first = render(<StudentDidatticaView />);
    expect(screen.getByText('Caricamento…')).toBeTruthy();
    first.unmount();
    mockLoadStudentLessons.mockResolvedValueOnce({ status: 'no-class' });
    const second = render(<StudentDidatticaView />);
    await screen.findByText(/Nessuna classe assegnata/);
    second.unmount();
    mockLoadStudentLessons.mockRejectedValueOnce(new Error('boom'));
    render(<StudentDidatticaView />);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Impossibile caricare la didattica.',
    );
  });

  it('renders a card library and filters it by course title', async () => {
    loadWithData();
    render(<StudentDidatticaView />);
    const list = await screen.findByRole('list', { name: 'Corsi disponibili' });
    expect(within(list).getByText('Informatica')).toBeTruthy();
    expect(within(list).getByText('Matematica')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Cerca corso' }), {
      target: { value: 'mate' },
    });
    expect(within(list).queryByText('Informatica')).toBeNull();
    expect(within(list).getByText('Matematica')).toBeTruthy();
  });

  it('opens a course, then an UDA and a lesson from the public projection', async () => {
    loadWithData();
    render(<StudentDidatticaView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Apri corso Informatica' }));
    expect(screen.getByRole('region', { name: 'Corso Informatica' })).toBeTruthy();
    expect(screen.getByText('2 UDA · 2 lezioni')).toBeTruthy();
    const structure = screen.getByRole('complementary', { name: 'Struttura del corso' });
    fireEvent.click(within(structure).getByRole('button', { name: /Reti/ }));
    fireEvent.click(within(structure).getByRole('button', { name: /Internet e reti/ }));
    expect(await screen.findByText('Contenuto della lezione.')).toBeTruthy();
    expect(screen.getByText('Concetti fondamentali')).toBeTruthy();
    expect(screen.getByText(/internet, rete/)).toBeTruthy();
  });

  it('starts with every UDA collapsed and exposes no teacher or pool actions', async () => {
    loadWithData();
    render(<StudentDidatticaView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Apri corso Informatica' }));
    expect(screen.queryByRole('button', { name: /Internet e reti/ })).toBeNull();
    for (const forbidden of [
      /Importa/i,
      /Nuova UDA/i,
      /Modifica/i,
      /Elimina/i,
      /Organizza/i,
      /Domande/i,
      /Pool/i,
    ]) {
      expect(screen.queryByRole('button', { name: forbidden })).toBeNull();
    }
  });

  it('shows a legacy projection without content as unavailable and never retries Storage', async () => {
    mockLoadStudentLessons.mockResolvedValue({
      status: 'ok',
      programs: [PROGRAM_A],
      lessonsByProgram: { 'prog-a': [{ ...LESSON_1, content: null }] },
    });
    render(<StudentDidatticaView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Apri corso Informatica' }));
    const structure = screen.getByRole('complementary', { name: 'Struttura del corso' });
    fireEvent.click(within(structure).getByRole('button', { name: /Reti/ }));
    fireEvent.click(within(structure).getByRole('button', { name: /Internet e reti/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('temporaneamente'));
    expect(screen.queryByText(/Riprova/i)).toBeNull();
  });

  it('returns to the library without reloading Firebase data', async () => {
    loadWithData();
    render(<StudentDidatticaView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Apri corso Informatica' }));
    fireEvent.click(screen.getByRole('button', { name: '← Libreria' }));
    expect(screen.getByRole('list', { name: 'Corsi disponibili' })).toBeTruthy();
    expect(mockLoadStudentLessons).toHaveBeenCalledTimes(1);
  });
});
