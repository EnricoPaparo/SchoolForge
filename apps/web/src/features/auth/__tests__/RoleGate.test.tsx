import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, beforeEach, expect, it, vi } from 'vitest';

afterEach(cleanup);
import { RoleGate } from '../RoleGate.js';

const OWNER_UID = 'owner-uid';
const STUDENT_UID = 'student-uid';

const mockGetDoc = vi.fn();
const mockBatchSet = vi.fn();
const mockBatchCommit = vi.fn();
const mockSignOut = vi.fn();

// Configurable auth stub — overridden per test via reassignment before render.
let currentUser: { uid: string; email: string; displayName: null } | null = null;

vi.mock('../../../lib/firebase.js', () => ({ db: {} }));

vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({
    user: currentUser,
    signOut: mockSignOut,
  }),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  serverTimestamp: vi.fn(() => null),
  writeBatch: () => ({
    set: mockBatchSet,
    commit: (...args: unknown[]) => mockBatchCommit(...args),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = { uid: OWNER_UID, email: 'teacher@test.com', displayName: null };
});

describe('RoleGate — owner access', () => {
  it('renders children (TeacherShell slot) when uid matches ownerUid', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ ownerUid: OWNER_UID }),
    });
    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(await screen.findByText('Area docente')).toBeTruthy();
  });
});

describe('RoleGate — student access', () => {
  it('renders StudentShell when an authenticated user is not the owner', async () => {
    currentUser = { uid: STUDENT_UID, email: 'student@test.com', displayName: null };
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ ownerUid: OWNER_UID }),
    });
    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(await screen.findByRole('navigation', { name: /Sezioni studente/i })).toBeTruthy();
    expect(screen.queryByText('Area docente')).toBeNull();
  });

  it('never reads or renders teacher-only content for a student', async () => {
    currentUser = { uid: STUDENT_UID, email: 'student@test.com', displayName: null };
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ ownerUid: OWNER_UID }),
    });
    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    await screen.findByRole('navigation', { name: /Sezioni studente/i });
    expect(screen.queryByRole('button', { name: /Diventa proprietario/i })).toBeNull();
    expect(screen.queryByText('Area docente')).toBeNull();
  });
});

describe('RoleGate — setup flow (no owner configured)', () => {
  it('shows setup page when ownerPublic does not exist yet', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(await screen.findByRole('heading', { name: /Inizializza SchoolForge/i })).toBeTruthy();
  });

  it('shows setup page when getDoc fails', async () => {
    mockGetDoc.mockRejectedValue({ code: 'permission-denied' });
    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(await screen.findByRole('heading', { name: /Inizializza SchoolForge/i })).toBeTruthy();
  });

  it('renders children after successful ownership claim', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    mockBatchCommit.mockResolvedValue(undefined);
    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Diventa proprietario/i }));
    expect(await screen.findByText('Area docente')).toBeTruthy();
  });
});

describe('RoleGate — non-owner blocked during claim attempt', () => {
  it('shows blocked message when the claim batch fails (owner already exists)', async () => {
    mockGetDoc.mockRejectedValue({ code: 'permission-denied' });
    mockBatchCommit.mockRejectedValue({ code: 'permission-denied' });
    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Diventa proprietario/i }));
    expect(await screen.findByRole('heading', { name: /Accesso non autorizzato/i })).toBeTruthy();
  });
});

describe('RoleGate — loading state', () => {
  it('shows loading indicator while resolving role', () => {
    mockGetDoc.mockReturnValue(new Promise(() => {})); // never resolves
    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(screen.getByText('Caricamento…')).toBeTruthy();
  });
});
