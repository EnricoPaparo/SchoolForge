import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);
import { TeacherShell } from '../TeacherShell.js';

const mockSignOut = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ app: {}, auth: {}, db: {}, storage: {} }));
vi.mock('../templateKit.js', () => ({
  TEMPLATES: [],
  downloadTemplate: vi.fn(),
  downloadKitZip: vi.fn(),
}));
vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({
    user: { uid: 'owner-uid', email: 'teacher@test.com', displayName: null },
    signOut: mockSignOut,
  }),
}));
vi.mock('../../repository/verifications/verificationsService.js', () => ({
  listVerifications: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../repository/classes/classesService.js', () => ({
  listClasses: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../repository/programs/programsService.js', () => ({
  listPrograms: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../repository/students/studentsService.js', () => ({
  countPendingStudents: vi.fn().mockResolvedValue(0),
  listStudents: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../repository/students/studentAccessService.js', () => ({
  getStudentAccessSettings: vi
    .fn()
    .mockResolvedValue({ studentPortalEnabled: false, newStudentRequestsEnabled: false }),
}));

describe('TeacherShell', () => {
  it('renders avatar button with user initial in header', () => {
    render(<TeacherShell />);
    expect(screen.getByRole('button', { name: /Account:/ })).toBeTruthy();
  });

  it('shows email and logout in dropdown when avatar clicked', () => {
    render(<TeacherShell />);
    fireEvent.click(screen.getByRole('button', { name: /Account:/ }));
    expect(screen.getByText('teacher@test.com')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Esci' })).toBeTruthy();
  });

  it('renders all six navigation sections with new labels', () => {
    render(<TeacherShell />);
    expect(screen.getByRole('button', { name: /Template/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Corsi/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Lezioni/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Verifiche/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Classi/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Studenti/ })).toBeTruthy();
  });

  it('orders navigation sections as Lezioni, Corsi, Verifiche, Classi, Studenti, Template', () => {
    render(<TeacherShell />);
    const nav = screen.getByRole('navigation', { name: 'Sezioni docente' });
    const labels = within(nav)
      .getAllByRole('button')
      .map((btn) => btn.textContent?.replace(/[^\p{L}]/gu, '') ?? '');
    expect(labels).toEqual(['Lezioni', 'Corsi', 'Verifiche', 'Classi', 'Studenti', 'Template']);
  });

  it('shows Lezioni section by default', async () => {
    render(<TeacherShell />);
    expect(await screen.findByRole('region', { name: 'Lezioni' })).toBeTruthy();
  });

  it('switches section on nav click', () => {
    render(<TeacherShell />);
    fireEvent.click(screen.getByRole('button', { name: /Verifiche/ }));
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('shows the Lezioni section on nav click', async () => {
    render(<TeacherShell />);
    fireEvent.click(screen.getByRole('button', { name: /Lezioni/ }));
    expect(await screen.findByRole('region', { name: 'Lezioni' })).toBeTruthy();
  });

  it('calls signOut when Esci clicked in dropdown', () => {
    render(<TeacherShell />);
    fireEvent.click(screen.getByRole('button', { name: /Account:/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Esci' }));
    expect(mockSignOut).toHaveBeenCalledOnce();
  });

  it('closes the account dropdown when clicking outside', () => {
    render(<TeacherShell />);
    fireEvent.click(screen.getByRole('button', { name: /Account:/ }));
    expect(screen.getByText('teacher@test.com')).toBeTruthy();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByText('teacher@test.com')).toBeNull();
  });

  it('closes the account dropdown on Escape key', () => {
    render(<TeacherShell />);
    fireEvent.click(screen.getByRole('button', { name: /Account:/ }));
    expect(screen.getByText('teacher@test.com')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByText('teacher@test.com')).toBeNull();
  });

  it('keeps the dropdown open when clicking inside it', () => {
    render(<TeacherShell />);
    fireEvent.click(screen.getByRole('button', { name: /Account:/ }));
    fireEvent.mouseDown(screen.getByText('teacher@test.com'));
    expect(screen.getByText('teacher@test.com')).toBeTruthy();
  });

  it('renders the SchoolForge wordmark logo in the header', () => {
    render(<TeacherShell />);
    const logo = screen.getByRole('img', { name: 'SchoolForge' });
    expect(logo).toBeTruthy();
  });

  it('shows the Studenti section on nav click', async () => {
    render(<TeacherShell />);
    fireEvent.click(screen.getByRole('button', { name: /Studenti/ }));
    expect(await screen.findByRole('region', { name: 'Studenti' })).toBeTruthy();
  });

  it('does not show a pending badge when there are no pending students', () => {
    render(<TeacherShell />);
    expect(screen.queryByLabelText(/in attesa/i)).toBeNull();
  });

  it('shows a pending-count badge next to Studenti when there are pending students', async () => {
    const { countPendingStudents } = await import('../../repository/students/studentsService.js');
    vi.mocked(countPendingStudents).mockResolvedValue(3);

    render(<TeacherShell />);
    expect(await screen.findByLabelText('3 in attesa')).toBeTruthy();
  });
});
