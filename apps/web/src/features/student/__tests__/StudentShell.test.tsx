import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);
import { StudentShell } from '../StudentShell.js';

const mockSignOut = vi.fn();
const mockLoadStudentLessons = vi.fn();
const mockLoadStudentVerifications = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ app: {}, auth: {}, db: {}, storage: {} }));
vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({
    user: { uid: 'student-uid', email: 'student@test.com', displayName: null },
    signOut: mockSignOut,
  }),
}));
vi.mock('../../repository/programs/studentLessonsService.js', () => ({
  loadStudentLessons: (...args: unknown[]) => mockLoadStudentLessons(...args),
}));
vi.mock('../../repository/verifications/studentVerificationsService.js', () => ({
  loadStudentVerifications: (...args: unknown[]) => mockLoadStudentVerifications(...args),
}));

mockLoadStudentLessons.mockResolvedValue({ status: 'no-class' });
mockLoadStudentVerifications.mockResolvedValue({ status: 'no-class' });

describe('StudentShell', () => {
  it('renders exactly the Lezioni and Verifiche sections, nothing else', () => {
    render(<StudentShell />);
    const nav = screen.getByRole('navigation', { name: 'Sezioni studente' });
    const labels = within(nav)
      .getAllByRole('button')
      .map((btn) => btn.textContent?.replace(/[^\p{L}]/gu, '') ?? '');
    expect(labels).toEqual(['Lezioni', 'Verifiche']);
  });

  it('never shows teacher-only navigation entries', () => {
    render(<StudentShell />);
    for (const teacherLabel of ['Corsi', 'Classi', 'Template']) {
      expect(screen.queryByRole('button', { name: teacherLabel })).toBeNull();
    }
  });

  it('shows the Lezioni section content by default', async () => {
    render(<StudentShell />);
    await waitFor(() => expect(screen.getByText(/Nessuna classe assegnata/)).toBeTruthy());
  });

  it('shows the Verifiche section content on nav click', async () => {
    render(<StudentShell />);
    fireEvent.click(screen.getByRole('button', { name: /Verifiche/ }));
    await waitFor(() => expect(screen.getByText(/Nessuna classe assegnata/)).toBeTruthy());
  });

  it('integration: an approved student with a class sees real lesson content wired through Lezioni', async () => {
    mockLoadStudentLessons.mockResolvedValueOnce({
      status: 'ok',
      programs: [{ id: 'prog-a', title: 'Informatica', classIds: ['class-a'] }],
      lessonsByProgram: { 'prog-a': [] },
    });
    render(<StudentShell />);
    await waitFor(() => expect(screen.getByText('Informatica')).toBeTruthy());
  });

  it('integration: an approved student with a class sees real verification content wired through Verifiche', async () => {
    mockLoadStudentVerifications.mockResolvedValueOnce({
      status: 'ok',
      verifications: [
        {
          id: 'ver-1',
          title: 'Verifica Reti',
          className: 'Classe A',
          activatedAt: null,
          questionCount: 2,
          questions: [],
        },
      ],
    });
    render(<StudentShell />);
    fireEvent.click(screen.getByRole('button', { name: /Verifiche/ }));
    await waitFor(() => expect(screen.getByText('Verifica Reti')).toBeTruthy());
  });

  it('renders no verification data when no class is assigned (empty state only)', async () => {
    render(<StudentShell />);
    fireEvent.click(screen.getByRole('button', { name: /Verifiche/ }));
    await waitFor(() => expect(screen.getByText(/Nessuna classe assegnata/)).toBeTruthy());
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders avatar button with account menu', () => {
    render(<StudentShell />);
    expect(screen.getByRole('button', { name: /Account:/ })).toBeTruthy();
  });

  it('shows email and logout in dropdown when avatar clicked', () => {
    render(<StudentShell />);
    fireEvent.click(screen.getByRole('button', { name: /Account:/ }));
    expect(screen.getByText('student@test.com')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Esci' })).toBeTruthy();
  });

  it('calls signOut when Esci clicked in dropdown', () => {
    render(<StudentShell />);
    fireEvent.click(screen.getByRole('button', { name: /Account:/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Esci' }));
    expect(mockSignOut).toHaveBeenCalledOnce();
  });

  it('renders the SchoolForge wordmark logo in the header', () => {
    render(<StudentShell />);
    expect(screen.getByRole('img', { name: 'SchoolForge' })).toBeTruthy();
  });
});
