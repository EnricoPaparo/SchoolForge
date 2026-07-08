import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);
import { LoginPage } from '../LoginPage.js';

const mockSignIn = vi.fn();
const mockSignInWithGoogle = vi.fn();

vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({
    signIn: mockSignIn,
    signInWithGoogle: mockSignInWithGoogle,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LoginPage — Google sign-in', () => {
  it('renders an "Accedi con Google" button', () => {
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: /Accedi con Google/i })).toBeTruthy();
  });

  it('calls the Google sign-in wrapper when clicked', async () => {
    mockSignInWithGoogle.mockResolvedValue(undefined);
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /Accedi con Google/i }));
    await waitFor(() => expect(mockSignInWithGoogle).toHaveBeenCalledOnce());
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('shows an error message if Google sign-in fails', async () => {
    mockSignInWithGoogle.mockRejectedValue(new Error('popup-closed-by-user'));
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /Accedi con Google/i }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('LoginPage — email/password (unchanged)', () => {
  it('still renders the email/password form', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accedi' })).toBeTruthy();
  });

  it('calls signIn (not Google) on form submit', async () => {
    mockSignIn.mockResolvedValue(undefined);
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accedi' }));
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('a@b.com', 'secret'));
    expect(mockSignInWithGoogle).not.toHaveBeenCalled();
  });
});
