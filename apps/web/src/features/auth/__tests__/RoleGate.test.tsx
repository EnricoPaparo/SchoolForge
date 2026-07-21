import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// This suite verifies role resolution, student approval, selection of the
// correct shell, and that teacher-only content is never exposed to students.
// StudentShell's internal behavior has its own dedicated suite; mocking only
// that lazy module keeps this unit test independent from module-transform speed.
vi.mock('../../student/StudentShell.js', () => ({
  StudentShell: () => <nav aria-label="Sezioni studente">Portale studente</nav>,
}));

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
const mockUpdateDoc = vi.fn();
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
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  serverTimestamp: vi.fn(() => ({ _type: 'serverTimestamp' })),
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
  mockUpdateDoc.mockResolvedValue(undefined);
});

function seedOwnerPublic() {
  firestoreDocs['settings/ownerPublic'] = { ownerUid: OWNER_UID };
}

function seedStudentAccess(studentPortalEnabled: boolean, newStudentRequestsEnabled = false) {
  firestoreDocs['settings/studentAccess'] = { studentPortalEnabled, newStudentRequestsEnabled };
}

function seedStudentDoc(
  status: 'pending' | 'approved' | 'blocked',
  extra: Record<string, unknown> = {},
) {
  firestoreDocs[`students/${STUDENT_UID}`] = {
    uid: STUDENT_UID,
    ownerUid: OWNER_UID,
    email: 'student@test.com',
    displayName: null,
    status,
    classId: null,
    ...extra,
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

  it('never renders the children slot before the role has resolved', () => {
    seedOwnerPublic();
    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    // Synchronous assertion, before any await: role resolution is always
    // async (RoleGate's own effect), so the initial render must be the
    // 'loading' state — never the teacher slot, never StudentShell.
    expect(screen.queryByText('Area docente')).toBeNull();
    expect(screen.queryByRole('navigation', { name: /Sezioni studente/i })).toBeNull();
    expect(screen.getByText('Caricamento…')).toBeTruthy();
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

describe('RoleGate — portal access telemetry (TWU-01)', () => {
  it('stamps first + last portal access on the first real entry of an approved student', async () => {
    seedOwnerPublic();
    seedStudentAccess(true);
    seedStudentDoc('approved'); // no firstPortalAccessAt → first entry
    asStudent();

    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    await screen.findByRole('navigation', { name: /Sezioni studente/i });

    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = mockUpdateDoc.mock.calls[0];
    expect(ref.path).toBe(`students/${STUDENT_UID}`);
    expect(data.firstPortalAccessAt).toEqual({ _type: 'serverTimestamp' });
    expect(data.lastPortalAccessAt).toEqual({ _type: 'serverTimestamp' });
  });

  it('updates only last portal access on a subsequent entry (first already set)', async () => {
    seedOwnerPublic();
    seedStudentAccess(true);
    seedStudentDoc('approved', { firstPortalAccessAt: { _seconds: 1 } });
    asStudent();

    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    await screen.findByRole('navigation', { name: /Sezioni studente/i });

    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [, data] = mockUpdateDoc.mock.calls[0];
    expect(data.lastPortalAccessAt).toEqual({ _type: 'serverTimestamp' });
    expect(data.firstPortalAccessAt).toBeUndefined();
  });

  it('does NOT record access for a pending student', async () => {
    seedOwnerPublic();
    seedStudentAccess(true);
    seedStudentDoc('pending');
    asStudent();

    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    await screen.findByRole('heading', { name: /Richiesta inviata/i });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('does NOT record access for a blocked student', async () => {
    seedOwnerPublic();
    seedStudentAccess(true);
    seedStudentDoc('blocked');
    asStudent();

    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    await screen.findByRole('heading', { name: /Accesso studente bloccato/i });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('does NOT record access when the portal is disabled', async () => {
    seedOwnerPublic();
    seedStudentAccess(false);
    seedStudentDoc('approved');
    asStudent();

    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    await screen.findByRole('heading', { name: /Portale studenti temporaneamente disabilitato/i });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('records access exactly once under React StrictMode (no double write)', async () => {
    seedOwnerPublic();
    seedStudentAccess(true);
    seedStudentDoc('approved');
    asStudent();

    render(
      <StrictMode>
        <RoleGate>
          <div>Area docente</div>
        </RoleGate>
      </StrictMode>,
    );
    await screen.findByRole('navigation', { name: /Sezioni studente/i });
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
  });

  // A fresh element each render: passing the *same* element reference to
  // rerender makes React bail out of re-rendering, so useAuth would never be
  // re-read. Each call returns a new element so the [user] effect re-runs.
  const gateEl = () => (
    <RoleGate>
      <div>Area docente</div>
    </RoleGate>
  );

  it('records again after logout→login of the same uid in the same mount', async () => {
    seedOwnerPublic();
    seedStudentAccess(true);
    seedStudentDoc('approved');
    asStudent();
    const { rerender } = render(gateEl());
    await screen.findByRole('navigation', { name: /Sezioni studente/i });
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);

    // Logout resets the guard…
    currentUser = null;
    rerender(gateEl());
    // …so the same uid logging back in records a new entry.
    asStudent();
    rerender(gateEl());
    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(2));
    // Both writes targeted this student's own document.
    expect(mockUpdateDoc.mock.calls[0][0].path).toBe(`students/${STUDENT_UID}`);
    expect(mockUpdateDoc.mock.calls[1][0].path).toBe(`students/${STUDENT_UID}`);
  });

  it('records once per user when switching from uid A to uid B (no logout in between)', async () => {
    const UID_B = 'student-b-uid';
    seedOwnerPublic();
    seedStudentAccess(true);
    seedStudentDoc('approved'); // A = STUDENT_UID
    firestoreDocs[`students/${UID_B}`] = {
      uid: UID_B,
      ownerUid: OWNER_UID,
      email: 'b@test.com',
      displayName: null,
      status: 'approved',
      classId: null,
    };
    asStudent();
    const { rerender } = render(gateEl());
    await screen.findByRole('navigation', { name: /Sezioni studente/i });
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoc.mock.calls[0][0].path).toBe(`students/${STUDENT_UID}`);

    // Switch directly to user B (uid change, no null in between).
    currentUser = { uid: UID_B, email: 'b@test.com', displayName: null };
    rerender(gateEl());
    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(2));
    expect(mockUpdateDoc.mock.calls[1][0].path).toBe(`students/${UID_B}`);
  });

  it('still grants the portal when the access-telemetry write fails (non-blocking)', async () => {
    seedOwnerPublic();
    seedStudentAccess(true);
    seedStudentDoc('approved');
    asStudent();
    mockUpdateDoc.mockRejectedValue(new Error('permission-denied'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <RoleGate>
        <div>Area docente</div>
      </RoleGate>,
    );
    // Portal is shown despite the failed write.
    expect(await screen.findByRole('navigation', { name: /Sezioni studente/i })).toBeTruthy();
    // A sanitized message is logged, with no PII (no email/uid).
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).not.toContain('student@test.com');
    expect(logged).not.toContain(STUDENT_UID);
    warn.mockRestore();
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
