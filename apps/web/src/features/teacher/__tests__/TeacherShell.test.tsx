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

  it('renders all four navigation sections with new labels', () => {
    render(<TeacherShell />);
    expect(screen.getByRole('button', { name: /Template/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Corsi/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Verifiche/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Classi/ })).toBeTruthy();
  });

  it('shows template kit section by default', () => {
    render(<TeacherShell />);
    expect(screen.getByRole('region', { name: 'Kit template' })).toBeTruthy();
  });

  it('switches section on nav click', () => {
    render(<TeacherShell />);
    fireEvent.click(screen.getByRole('button', { name: /Verifiche/ }));
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('calls signOut when Esci clicked in dropdown', () => {
    render(<TeacherShell />);
    fireEvent.click(screen.getByRole('button', { name: /Account:/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Esci' }));
    expect(mockSignOut).toHaveBeenCalledOnce();
  });
});
