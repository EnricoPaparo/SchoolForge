import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

describe('TeacherShell', () => {
  it('renders user email in header', () => {
    render(<TeacherShell />);
    expect(screen.getByText('teacher@test.com')).toBeTruthy();
  });

  it('renders logout button', () => {
    render(<TeacherShell />);
    expect(screen.getByRole('button', { name: 'Esci' })).toBeTruthy();
  });

  it('renders all four navigation sections', () => {
    render(<TeacherShell />);
    expect(screen.getByRole('button', { name: 'Repository didattico' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Programmi / UDA / Lezioni' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Verifiche cartacee' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Impostazioni' })).toBeTruthy();
  });

  it('shows default section heading and template kit section', () => {
    render(<TeacherShell />);
    expect(screen.getByRole('heading', { name: 'Repository didattico' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Kit template' })).toBeTruthy();
  });

  it('switches section on nav click', () => {
    render(<TeacherShell />);
    fireEvent.click(screen.getByRole('button', { name: 'Verifiche cartacee' }));
    expect(screen.getByRole('heading', { name: 'Verifiche cartacee' })).toBeTruthy();
  });

  it('calls signOut when logout button is clicked', () => {
    render(<TeacherShell />);
    fireEvent.click(screen.getByRole('button', { name: 'Esci' }));
    expect(mockSignOut).toHaveBeenCalledOnce();
  });
});
