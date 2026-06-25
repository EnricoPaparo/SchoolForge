import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

// Mock Firebase to avoid initialization with missing env vars in test environment.
// onAuthStateChanged immediately resolves to null (unauthenticated), so the
// LoginPage renders with 'SchoolForge' visible.
vi.mock('./lib/firebase.js', () => ({
  app: {},
  auth: {},
  db: {},
  storage: {},
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: null) => void) => {
    cb(null);
    return () => {};
  },
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}));

describe('App', () => {
  it('renders login page with SchoolForge when unauthenticated', async () => {
    render(<App />);
    expect(await screen.findByText('SchoolForge')).toBeTruthy();
  });
});
