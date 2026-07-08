import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);
import { App } from './App.js';

const OWNER_UID = 'owner-uid';

vi.mock('./lib/firebase.js', () => ({
  app: {},
  auth: {},
  db: {},
  storage: {},
}));

// Configurable auth stub — overridden per describe block via vi.mock factory caching.
let _mockUser: { uid: string; email: string; displayName: null } | null = null;

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    cb(_mockUser);
    return () => {};
  },
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}));

const mockGetDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  setDoc: vi.fn(),
  serverTimestamp: vi.fn(),
}));

describe('App — unauthenticated', () => {
  it('renders the login wordmark and removes legacy login copy when unauthenticated', async () => {
    _mockUser = null;
    render(<App />);
    expect(await screen.findByRole('img', { name: 'SchoolForge' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'SchoolForge' })).toBeNull();
    expect(screen.queryByText('Accedi al portale docente')).toBeNull();
  });
});

describe('App — owner authenticated', () => {
  it('renders teacher shell with navigation after owner check', async () => {
    _mockUser = { uid: OWNER_UID, email: 'teacher@test.com', displayName: null };
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ ownerUid: OWNER_UID }),
    });
    render(<App />);
    expect(await screen.findByRole('button', { name: /Template/ })).toBeTruthy();
  });
});
