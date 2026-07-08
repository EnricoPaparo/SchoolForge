import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);
import { StudentShell } from '../StudentShell.js';

const mockSignOut = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ app: {}, auth: {}, db: {}, storage: {} }));
vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({
    user: { uid: 'student-uid', email: 'student@test.com', displayName: null },
    signOut: mockSignOut,
  }),
}));

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

  it('shows the Lezioni placeholder by default', () => {
    render(<StudentShell />);
    expect(screen.getByText('Lezioni disponibili — in arrivo')).toBeTruthy();
  });

  it('shows the Verifiche placeholder on nav click', () => {
    render(<StudentShell />);
    fireEvent.click(screen.getByRole('button', { name: /Verifiche/ }));
    expect(screen.getByText('Verifiche pubblicate — in arrivo')).toBeTruthy();
  });

  it('renders no real lesson or verification data (placeholder only)', () => {
    render(<StudentShell />);
    fireEvent.click(screen.getByRole('button', { name: /Verifiche/ }));
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
