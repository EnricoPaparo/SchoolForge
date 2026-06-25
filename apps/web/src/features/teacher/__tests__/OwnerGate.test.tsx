import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, beforeEach, expect, it, vi } from 'vitest';

afterEach(cleanup);
import { OwnerGate } from '../OwnerGate.js';

const OWNER_UID = 'owner-uid';

const mockGetDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockSignOut = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ db: {} }));

vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({
    user: { uid: OWNER_UID, email: 'teacher@test.com' },
    signOut: mockSignOut,
  }),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  serverTimestamp: vi.fn(() => null),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OwnerGate — owner access', () => {
  it('renders children when user is the owner', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ ownerUid: OWNER_UID }),
    });
    render(
      <OwnerGate>
        <div>Area docente</div>
      </OwnerGate>,
    );
    expect(await screen.findByText('Area docente')).toBeTruthy();
  });
});

describe('OwnerGate — setup flow (no owner configured)', () => {
  it('shows setup page when getDoc fails (no owner yet)', async () => {
    mockGetDoc.mockRejectedValue({ code: 'permission-denied' });
    render(
      <OwnerGate>
        <div>Area docente</div>
      </OwnerGate>,
    );
    expect(await screen.findByRole('heading', { name: /Inizializza SchoolForge/i })).toBeTruthy();
  });

  it('renders children after successful ownership claim', async () => {
    mockGetDoc.mockRejectedValue({ code: 'permission-denied' });
    mockSetDoc.mockResolvedValue(undefined);
    render(
      <OwnerGate>
        <div>Area docente</div>
      </OwnerGate>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Diventa proprietario/i }));
    expect(await screen.findByText('Area docente')).toBeTruthy();
  });
});

describe('OwnerGate — non-owner blocked', () => {
  it('shows blocked message when claim fails (owner already exists)', async () => {
    mockGetDoc.mockRejectedValue({ code: 'permission-denied' });
    mockSetDoc.mockRejectedValue({ code: 'permission-denied' });
    render(
      <OwnerGate>
        <div>Area docente</div>
      </OwnerGate>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Diventa proprietario/i }));
    expect(await screen.findByRole('heading', { name: /Accesso non autorizzato/i })).toBeTruthy();
  });

  it('shows blocked and logout button when uid mismatches (defensive check)', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ ownerUid: 'different-uid' }),
    });
    mockSetDoc.mockRejectedValue({ code: 'permission-denied' });
    render(
      <OwnerGate>
        <div>Area docente</div>
      </OwnerGate>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Diventa proprietario/i }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Accesso non autorizzato/i })).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Esci' })).toBeTruthy();
  });
});

describe('OwnerGate — loading state', () => {
  it('shows loading indicator while checking owner', () => {
    mockGetDoc.mockReturnValue(new Promise(() => {})); // never resolves
    render(
      <OwnerGate>
        <div>Area docente</div>
      </OwnerGate>,
    );
    expect(screen.getByText('Caricamento…')).toBeTruthy();
  });
});
