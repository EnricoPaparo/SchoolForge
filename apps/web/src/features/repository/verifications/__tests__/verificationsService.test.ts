import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock firebase modules
vi.mock('../../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

const mockGetDocs = vi.fn();
const mockGetDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockDoc = vi.fn();
const mockCollection = vi.fn();
const mockServerTimestamp = vi.fn(() => ({ _type: 'serverTimestamp' }));
const mockRunTransaction = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
  serverTimestamp: () => mockServerTimestamp(),
}));

import {
  listVerifications,
  createVerification,
  updateVerificationConfig,
  validateForActivation,
  activateVerification,
  closeVerification,
} from '../verificationsService.js';
import type { Firestore } from 'firebase/firestore';
import type { VerificationConfig, VerificationDoc } from '../../../../types/firestore.js';

const fakeDb = {} as Firestore;
const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-uid';
const fakeDocRef = { id: 'new-ver-id' };

const VALID_CONFIG: VerificationConfig = {
  title: 'Verifica 1',
  classId: 'class-1',
  programId: 'prog-1',
  importId: 'imp-1',
  questionRefs: [{ lessonId: 'lesson-1', questionIndex: 0 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDoc.mockReturnValue(fakeDocRef);
  mockCollection.mockReturnValue({ id: 'verifications' });
  mockSetDoc.mockResolvedValue(undefined);
});

// ─── listVerifications ────────────────────────────────────────────────────────

describe('listVerifications', () => {
  it('returns items filtered by ownerUid', async () => {
    const draft: Partial<VerificationDoc> = {
      ownerUid: OWNER_UID,
      status: 'draft',
      config: VALID_CONFIG,
    };
    const other: Partial<VerificationDoc> = {
      ownerUid: OTHER_UID,
      status: 'draft',
      config: VALID_CONFIG,
    };
    mockGetDocs.mockResolvedValue({
      docs: [
        { id: 'v1', data: () => draft },
        { id: 'v2', data: () => other },
      ],
    });

    const result = await listVerifications(OWNER_UID, fakeDb);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('v1');
  });
});

// ─── createVerification ───────────────────────────────────────────────────────

describe('createVerification', () => {
  it('creates draft with empty questionRefs and writes audit event', async () => {
    const id = await createVerification(
      { title: 'Verifica 1', classId: null, programId: 'p1', importId: 'i1' },
      OWNER_UID,
      fakeDb,
    );

    expect(id).toBe('new-ver-id');
    expect(mockSetDoc).toHaveBeenCalledTimes(2);

    const [, verData] = mockSetDoc.mock.calls[0];
    expect(verData.status).toBe('draft');
    expect(verData.config.questionRefs).toEqual([]);
    expect(verData.teacherSnapshot).toBeNull();
    expect(verData.activatedAt).toBeNull();
    expect(verData.closedAt).toBeNull();

    const [, auditData] = mockSetDoc.mock.calls[1];
    expect(auditData.action).toBe('verification.created');
    expect(auditData.actorUid).toBe(OWNER_UID);
  });
});

// ─── updateVerificationConfig ─────────────────────────────────────────────────

describe('updateVerificationConfig', () => {
  it('updates config when status is draft', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ data: () => draftDoc });

    await updateVerificationConfig('ver-id', { title: 'Nuovo titolo' }, OWNER_UID, fakeDb);

    expect(mockSetDoc).toHaveBeenCalledTimes(2); // update + audit
    const [, mergedData] = mockSetDoc.mock.calls[0];
    expect(mergedData.config.title).toBe('Nuovo titolo');
  });

  it('throws when status is not draft', async () => {
    const activeDoc: Partial<VerificationDoc> = {
      status: 'active',
      config: VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ data: () => activeDoc });

    await expect(
      updateVerificationConfig('ver-id', { title: 'X' }, OWNER_UID, fakeDb),
    ).rejects.toThrow('Verifica non modificabile: non è in bozza');
  });
});

// ─── validateForActivation ────────────────────────────────────────────────────

describe('validateForActivation', () => {
  it('returns valid=true for complete config', () => {
    const result = validateForActivation(VALID_CONFIG);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns errors for missing title', () => {
    const result = validateForActivation({ ...VALID_CONFIG, title: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('titolo'))).toBe(true);
  });

  it('returns errors for empty questionRefs', () => {
    const result = validateForActivation({ ...VALID_CONFIG, questionRefs: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('domanda'))).toBe(true);
  });
});

// ─── activateVerification ─────────────────────────────────────────────────────

describe('activateVerification', () => {
  it('calls runTransaction and sets status=active with teacherSnapshot', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: VALID_CONFIG,
    };

    mockRunTransaction.mockImplementation(
      async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        const mockTx = {
          get: vi.fn().mockResolvedValue({ exists: () => true, data: () => draftDoc }),
          update: vi.fn(),
        };
        await fn(mockTx);
        return mockTx.update.mock.calls[0];
      },
    );

    const classItem = {
      id: 'class-1',
      ownerUid: OWNER_UID,
      name: 'Classe A',
      description: null,
      createdAt: {} as never,
      updatedAt: {} as never,
    };

    await activateVerification('ver-id', classItem, OWNER_UID, fakeDb);

    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(mockSetDoc).toHaveBeenCalledTimes(1); // audit event

    const [, auditData] = mockSetDoc.mock.calls[0];
    expect(auditData.action).toBe('verification.activated');
  });

  it('throws if status is not draft', async () => {
    const activeDoc: Partial<VerificationDoc> = {
      status: 'active',
      config: VALID_CONFIG,
    };

    mockRunTransaction.mockImplementation(
      async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        const mockTx = {
          get: vi.fn().mockResolvedValue({ exists: () => true, data: () => activeDoc }),
          update: vi.fn(),
        };
        await fn(mockTx);
      },
    );

    await expect(activateVerification('ver-id', null, OWNER_UID, fakeDb)).rejects.toThrow(
      'Verifica non attivabile: non è in bozza',
    );
  });

  it('throws if validateForActivation fails', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: { ...VALID_CONFIG, questionRefs: [] }, // invalid: no questions
    };

    mockRunTransaction.mockImplementation(
      async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        const mockTx = {
          get: vi.fn().mockResolvedValue({ exists: () => true, data: () => draftDoc }),
          update: vi.fn(),
        };
        await fn(mockTx);
      },
    );

    await expect(activateVerification('ver-id', null, OWNER_UID, fakeDb)).rejects.toThrow(
      'Verifica non valida:',
    );
  });
});

// ─── closeVerification ────────────────────────────────────────────────────────

describe('closeVerification', () => {
  it('sets status=closed when active', async () => {
    const activeDoc: Partial<VerificationDoc> = { status: 'active', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => activeDoc });

    await closeVerification('ver-id', OWNER_UID, fakeDb);

    expect(mockSetDoc).toHaveBeenCalledTimes(2); // update + audit
    const [, closedData] = mockSetDoc.mock.calls[0];
    expect(closedData.status).toBe('closed');
    expect(closedData.closedAt).toBeDefined();

    const [, auditData] = mockSetDoc.mock.calls[1];
    expect(auditData.action).toBe('verification.closed');
  });

  it('throws if not active', async () => {
    const draftDoc: Partial<VerificationDoc> = { status: 'draft', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => draftDoc });

    await expect(closeVerification('ver-id', OWNER_UID, fakeDb)).rejects.toThrow(
      'Verifica non chiudibile: non è attiva',
    );
  });
});
