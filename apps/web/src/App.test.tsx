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

const STUDENT_UID = 'student-uid';

// Configurable auth stub — overridden per describe block via vi.mock factory caching.
let _mockUser: { uid: string; email: string; displayName: null } | null = null;

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    cb(_mockUser);
    return () => {};
  },
  GoogleAuthProvider: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));

// Firestore documents, keyed by "collection/id" path, configurable per test.
let firestoreDocs: Record<string, unknown> = {};

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, a: string, b?: string) => ({ path: b === undefined ? a : `${a}/${b}` }),
  collection: (_db: unknown, name: string) => ({ path: name }),
  getDoc: (ref: { path: string }) => {
    const data = firestoreDocs[ref.path];
    return Promise.resolve({ exists: () => data !== undefined, data: () => data });
  },
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  serverTimestamp: vi.fn(),
  writeBatch: () => ({ set: vi.fn(), commit: vi.fn() }),
}));

describe('App — unauthenticated', () => {
  it('renders the login wordmark and removes legacy login copy when unauthenticated', async () => {
    _mockUser = null;
    render(<App />);
    expect(await screen.findByRole('img', { name: 'SchoolForge' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'SchoolForge' })).toBeNull();
    expect(screen.queryByText('Accedi al portale docente')).toBeNull();
  });

  it('offers a Google sign-in button on the login screen', async () => {
    _mockUser = null;
    render(<App />);
    expect(await screen.findByRole('button', { name: /Accedi con Google/i })).toBeTruthy();
  });
});

describe('App — owner authenticated', () => {
  it('renders teacher shell with navigation after owner check', async () => {
    _mockUser = { uid: OWNER_UID, email: 'teacher@test.com', displayName: null };
    firestoreDocs = { 'settings/ownerPublic': { ownerUid: OWNER_UID } };
    render(<App />);
    expect(await screen.findByRole('button', { name: /Template/ })).toBeTruthy();
  });
});

describe('App — student authenticated (M3-lite)', () => {
  it('renders StudentShell, not the teacher shell, for an approved non-owner with the portal enabled', async () => {
    _mockUser = { uid: STUDENT_UID, email: 'student@test.com', displayName: null };
    firestoreDocs = {
      'settings/ownerPublic': { ownerUid: OWNER_UID },
      'settings/studentAccess': { studentPortalEnabled: true, newStudentRequestsEnabled: false },
      [`students/${STUDENT_UID}`]: {
        uid: STUDENT_UID,
        ownerUid: OWNER_UID,
        email: 'student@test.com',
        displayName: null,
        status: 'approved',
        classId: null,
      },
    };
    render(<App />);
    expect(await screen.findByRole('navigation', { name: /Sezioni studente/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Template/ })).toBeNull();
  });

  it('shows the portal-disabled screen for a non-owner when the portal is off', async () => {
    _mockUser = { uid: STUDENT_UID, email: 'student@test.com', displayName: null };
    firestoreDocs = { 'settings/ownerPublic': { ownerUid: OWNER_UID } };
    render(<App />);
    expect(
      await screen.findByRole('heading', {
        name: /Portale studenti temporaneamente disabilitato/i,
      }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Template/ })).toBeNull();
  });
});
