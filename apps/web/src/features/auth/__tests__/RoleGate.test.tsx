import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);
import { RoleGate } from '../RoleGate.js';

const OWNER_UID = 'owner-uid';
const STUDENT_UID = 'student-uid';

const mockSignOut = vi.fn();

// Configurable auth stub — overridden per test via reassignment before render.
let currentUser: { uid: string; email: string | null; displayName: string | null } | null = null;

vi.mock('../../../lib/firebase.js', () => ({ db: {} }));

vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({
    user: currentUser,
    signOut: mockSignOut,
  }),
}));

// Firestore documents, keyed by "collection/id" path, configurable per test.
let firestoreDocs: Record<string, unknown> = {};
let firestoreErrors: Set<string> = new Set();
const mockSetDoc = vi.fn();
const mockBatchSet = vi.fn();
const mockBatchCommit = vi.fn();

function pathFor(_db: unknown, a: string, b?: string): string {
  return b === undefined ? a : `${a}/${b}`;
}

vi.mock('firebase/firestore', () => ({
  doc: (db: unknown, a: string, b?: string) => ({ path: pathFor(db, a, b) }),
  collection: (_db: unknown, name: string) => ({ path: name }),
  getDoc: (ref: { path: string }) => {
    if (firestoreErrors.has(ref.path)) return Promise.reject(new Error('boom'));
    const data = firestoreDocs[ref.path];
    return Promise.resolve({
      exists: () => data !== undefined,
      data: () => data,
    });
  },
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  serverTimestamp: vi.fn(() => null),
  writeBatch: () => ({
    set: mockBatchSet,
    commit: (...args: unknown[]) => mockBatchCommit(...args),
  }),
  // StudentShell (M3F-07) opens a single onSnapshot listener on
  // settings/studentAccess. Report the safe "no document" state and return
  // a no-op unsubscribe — this suite doesn't exercise Modalità verifica.
  onSnapshot: (_ref: unknown, onNext: (snap: unknown) => void) => {
    onNext({ exists: () => false });
    return () => {};
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  firestoreDocs = {};
  firestoreErrors = new Set();
  currentUser = { uid: OWNER_UID, email: 'teacher@test.com', displayName: null };
  mockSetDoc.mockResolvedValue(undefined);
});

function seedOwnerPublic() {
  firestoreDocs['settings/ownerPublic'] = { ownerUid: OWNER_UID };
}

function seedStudentAccess(studentPortalEnabled: boolean, newStudentRequestsEnabled = false) {
  firestoreDocs['settings/studentAccess'] = { studentPortalEnabled, newStudentRequestsEnabled };
}

function seedStudentDoc(status: 'pending' | 'approved' | 'blocked') {
  firestoreDocs[`students/${STUDENT_UID}`] = {
    uid: STUDENT_UID,
    ownerUid: OWNER_UID,
    email: 'student@test.com',
    displayName: null,
    status,
    classId: null,
  };
}

function asStudent() {
  currentUser = { uid: STUDENT_UID, email: 'student@test.com', displayName: null };
}

describe('RoleGate — owner access', () => {
  it('renders children (TeacherShell slot) when uid matches ownerUid', async () => {
    seedOwnerPublic();
    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(await screen.findByText('Area docente')).toBeTruthy();
  });
});

describe('RoleGate — approved student', () => {
  it('renders StudentShell when approved and the portal is enabled', async () => {
    seedOwnerPublic();
    seedStudentAccess(true);
    seedStudentDoc('approved');
    asStudent();

    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(await screen.findByRole('navigation', { name: /Sezioni studente/i })).toBeTruthy();
    expect(screen.queryByText('Area docente')).toBeNull();
  });

  it('never renders teacher-only content for an approved student', async () => {
    seedOwnerPublic();
    seedStudentAccess(true);
    seedStudentDoc('approved');
    asStudent();

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

describe('RoleGate — portal disabled (only gates an approved student)', () => {
  it('shows the disabled screen for an approved student when the portal is off', async () => {
    seedOwnerPublic();
    seedStudentAccess(false);
    seedStudentDoc('approved');
    asStudent();

    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(
      await screen.findByRole('heading', {
        name: /Portale studenti temporaneamente disabilitato/i,
      }),
    ).toBeTruthy();
    expect(screen.queryByText('Area docente')).toBeNull();
  });

  it('shows the disabled screen for an approved student when settings/studentAccess does not exist', async () => {
    seedOwnerPublic();
    // seedStudentAccess() never called — safe default is "disabled".
    seedStudentDoc('approved');
    asStudent();

    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(
      await screen.findByRole('heading', {
        name: /Portale studenti temporaneamente disabilitato/i,
      }),
    ).toBeTruthy();
  });
});

describe('RoleGate — pending student (shown regardless of the portal toggle)', () => {
  it('shows the pending screen when the student status is pending and the portal is on', async () => {
    seedOwnerPublic();
    seedStudentAccess(true);
    seedStudentDoc('pending');
    asStudent();

    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(await screen.findByRole('heading', { name: /Richiesta inviata/i })).toBeTruthy();
    expect(screen.queryByText('Area docente')).toBeNull();
  });

  it('shows the pending screen when the student status is pending and the portal is off', async () => {
    seedOwnerPublic();
    seedStudentAccess(false);
    seedStudentDoc('pending');
    asStudent();

    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(await screen.findByRole('heading', { name: /Richiesta inviata/i })).toBeTruthy();
  });
});

describe('RoleGate — blocked student (shown regardless of the portal toggle)', () => {
  it('shows the blocked screen when the student status is blocked and the portal is on', async () => {
    seedOwnerPublic();
    seedStudentAccess(true);
    seedStudentDoc('blocked');
    asStudent();

    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(await screen.findByRole('heading', { name: /Accesso studente bloccato/i })).toBeTruthy();
    expect(screen.queryByText('Area docente')).toBeNull();
  });

  it('shows the blocked screen when the student status is blocked and the portal is off', async () => {
    seedOwnerPublic();
    seedStudentAccess(false);
    seedStudentDoc('blocked');
    asStudent();

    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(await screen.findByRole('heading', { name: /Accesso studente bloccato/i })).toBeTruthy();
  });
});

describe('RoleGate — no students/{uid} document yet (independent of the portal toggle)', () => {
  it('shows requests-closed and does not create a document when requests are disabled, portal on', async () => {
    seedOwnerPublic();
    seedStudentAccess(true, false);
    asStudent();

    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(
      await screen.findByRole('heading', { name: /Nuove richieste studenti chiuse/i }),
    ).toBeTruthy();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('shows requests-closed and does not create a document when requests are disabled, portal off', async () => {
    seedOwnerPublic();
    seedStudentAccess(false, false);
    asStudent();

    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(
      await screen.findByRole('heading', { name: /Nuove richieste studenti chiuse/i }),
    ).toBeTruthy();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('creates a pending request and shows the pending screen when requests are enabled, portal on', async () => {
    seedOwnerPublic();
    seedStudentAccess(true, true);
    asStudent();

    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(await screen.findByRole('heading', { name: /Richiesta inviata/i })).toBeTruthy();
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = mockSetDoc.mock.calls[0];
    expect(ref.path).toBe(`students/${STUDENT_UID}`);
    expect(data.status).toBe('pending');
    expect(data.classId).toBeNull();
    expect(data.uid).toBe(STUDENT_UID);
    expect(data.ownerUid).toBe(OWNER_UID);
  });

  it('creates a pending request and shows the pending screen when requests are enabled, portal off (bug fix)', async () => {
    // Regression test: "Portale studenti" OFF must never block an unknown
    // candidate from filing a request when "Nuove richieste" is ON — the
    // two toggles are independent.
    seedOwnerPublic();
    seedStudentAccess(false, true);
    asStudent();

    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(await screen.findByRole('heading', { name: /Richiesta inviata/i })).toBeTruthy();
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = mockSetDoc.mock.calls[0];
    expect(ref.path).toBe(`students/${STUDENT_UID}`);
    expect(data.status).toBe('pending');
  });
});

describe('RoleGate — setup flow (no owner configured)', () => {
  it('shows setup page when ownerPublic does not exist yet', async () => {
    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(await screen.findByRole('heading', { name: /Inizializza SchoolForge/i })).toBeTruthy();
  });

  it('renders children after successful ownership claim', async () => {
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

describe('RoleGate — resolution error', () => {
  it('shows a readable error screen instead of an infinite loading state', async () => {
    seedOwnerPublic();
    seedStudentAccess(true);
    // students/{uid} read fails unexpectedly (not "permission denied due to
    // missing doc" — a genuine transient error) — getOwnStudentDoc doesn't
    // swallow this, so it must surface as a readable screen, not a crash
    // or an infinite spinner.
    firestoreErrors.add(`students/${STUDENT_UID}`);
    asStudent();

    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(
      await screen.findByRole('heading', { name: /Impossibile verificare l.accesso/i }),
    ).toBeTruthy();
    expect(screen.queryByText('Area docente')).toBeNull();
  });
});

describe('RoleGate — loading state', () => {
  it('shows loading indicator while resolving role', () => {
    seedOwnerPublic();
    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    expect(screen.getByText('Caricamento…')).toBeTruthy();
  });
});
