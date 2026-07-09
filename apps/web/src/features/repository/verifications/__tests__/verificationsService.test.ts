import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock firebase modules
vi.mock('../../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

const mockGetDocs = vi.fn();
const mockGetDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockDeleteDoc = vi.fn();
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
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
  serverTimestamp: () => mockServerTimestamp(),
}));

// loadSelectedQuestions hits Storage directly — mocked out here so
// activateVerification tests stay pure unit tests. Its own behaviour
// (pool parsing, "never includes soluzione") is covered by
// loadSelectedQuestions.test.ts.
const mockLoadSelectedQuestions = vi.fn();
vi.mock('../loadSelectedQuestions.js', () => ({
  loadSelectedQuestions: (...args: unknown[]) => mockLoadSelectedQuestions(...args),
}));

import {
  listVerifications,
  createVerification,
  updateVerificationConfig,
  validateForActivation,
  activateVerification,
  setVerificationVisibility,
  closeVerification,
  deleteVerification,
} from '../verificationsService.js';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import type { VerificationConfig, VerificationDoc } from '../../../../types/firestore.js';

const fakeDb = {} as Firestore;
const fakeStorage = {} as FirebaseStorage;
const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-uid';
const fakeDocRef = { id: 'new-ver-id' };

const VALID_CONFIG: VerificationConfig = {
  title: 'Verifica 1',
  classId: 'class-1',
  programId: 'prog-1',
  importId: 'imp-1',
  questionRefs: [
    {
      questionIndexEntryId: 'qi-1',
      questionLocalId: 'q1',
      udaDir: 'UDA1',
      lessonFilename: 'lezione1.md',
      poolStorageRef: 'gs://bucket/imports/imp-1/UDA1/lezione1.pool.md',
      tipo: 'chiusa_singola',
      difficolta: 2,
      peso: 1,
      maxPoints: 2,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDoc.mockReturnValue(fakeDocRef);
  mockCollection.mockReturnValue({ id: 'verifications' });
  mockSetDoc.mockResolvedValue(undefined);
  mockDeleteDoc.mockResolvedValue(undefined);
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

  it('normalizes a missing visibility field (pre-M3-lite document) to "hidden"', async () => {
    const legacyDoc: Partial<VerificationDoc> = {
      ownerUid: OWNER_UID,
      status: 'active',
      config: VALID_CONFIG,
      // no `visibility` field at all — simulates a document written before M3-lite
    };
    mockGetDocs.mockResolvedValue({ docs: [{ id: 'v1', data: () => legacyDoc }] });

    const result = await listVerifications(OWNER_UID, fakeDb);
    expect(result[0].visibility).toBe('hidden');
  });

  it('preserves an explicit visibility field', async () => {
    const doc: Partial<VerificationDoc> = {
      ownerUid: OWNER_UID,
      status: 'active',
      visibility: 'public',
      config: VALID_CONFIG,
    };
    mockGetDocs.mockResolvedValue({ docs: [{ id: 'v1', data: () => doc }] });

    const result = await listVerifications(OWNER_UID, fakeDb);
    expect(result[0].visibility).toBe('public');
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
    expect(verData.visibility).toBe('hidden');
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
  const LOADED_QUESTIONS_OK = {
    ok: true as const,
    questions: [
      {
        ref: VALID_CONFIG.questionRefs[0],
        testo: 'Domanda 1?',
        tipo: 'chiusa_singola' as const,
        opzioni: [
          { id: 'a', testo: 'Opzione A' },
          { id: 'b', testo: 'Opzione B' },
        ],
      },
    ],
  };

  function setupTransactionCapture(existingDoc: Partial<VerificationDoc>) {
    let capturedUpdate: Record<string, unknown> | undefined;
    let capturedProjection: Record<string, unknown> | undefined;
    mockRunTransaction.mockImplementation(
      async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
        const mockTx = {
          get: vi.fn().mockResolvedValue({ exists: () => true, data: () => existingDoc }),
          update: vi.fn((_ref: unknown, data: Record<string, unknown>) => {
            capturedUpdate = data;
          }),
          set: vi.fn((_ref: unknown, data: Record<string, unknown>) => {
            capturedProjection = data;
          }),
        };
        await fn(mockTx);
      },
    );
    return {
      getUpdate: () => capturedUpdate,
      getProjection: () => capturedProjection,
    };
  }

  it('calls runTransaction and sets status=active, visibility=hidden, with teacherSnapshot', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestions.mockResolvedValue(LOADED_QUESTIONS_OK);
    const capture = setupTransactionCapture(draftDoc);

    const classItem = {
      id: 'class-1',
      ownerUid: OWNER_UID,
      name: 'Classe A',
      description: null,
      createdAt: {} as never,
      updatedAt: {} as never,
    };

    await activateVerification('ver-id', classItem, OWNER_UID, fakeDb, fakeStorage);

    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(mockSetDoc).toHaveBeenCalledTimes(1); // audit event

    const [, auditData] = mockSetDoc.mock.calls[0];
    expect(auditData.action).toBe('verification.activated');

    const capturedUpdate = capture.getUpdate();
    expect(capturedUpdate?.status).toBe('active');
    expect(capturedUpdate?.visibility).toBe('hidden');
    // Top-level activatedAt (shown in the verification list) must be set,
    // in addition to teacherSnapshot.activatedAt.
    expect(capturedUpdate?.activatedAt).toBeDefined();
    expect(
      (capturedUpdate?.teacherSnapshot as { activatedAt?: unknown } | undefined)?.activatedAt,
    ).toBeDefined();
  });

  it('writes a solution-free publishedProjection alongside teacherSnapshot', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestions.mockResolvedValue(LOADED_QUESTIONS_OK);
    const capture = setupTransactionCapture(draftDoc);

    await activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage);

    const projection = capture.getProjection();
    expect(projection?.title).toBe(VALID_CONFIG.title);
    expect(projection?.classId).toBe(VALID_CONFIG.classId);
    expect(projection?.questions).toHaveLength(1);
    const question = (projection?.questions as Record<string, unknown>[])[0];
    expect(question.testo).toBe('Domanda 1?');
    expect(question.opzioni).toEqual(LOADED_QUESTIONS_OK.questions[0].opzioni);
    // Never leak pool/technical references into the student-facing projection.
    expect(question).not.toHaveProperty('soluzione');
    expect(question).not.toHaveProperty('poolStorageRef');
    expect(question).not.toHaveProperty('questionLocalId');
    expect(question).not.toHaveProperty('questionIndexEntryId');
    expect(JSON.stringify(projection)).not.toContain('poolStorageRef');
  });

  it('writes classId: null into publishedProjection when the verification has no class (M3L-D)', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: { ...VALID_CONFIG, classId: null },
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestions.mockResolvedValue(LOADED_QUESTIONS_OK);
    const capture = setupTransactionCapture(draftDoc);

    await activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage);

    expect(capture.getProjection()?.classId).toBeNull();
  });

  it('throws if status is not draft (checked before touching Storage or the transaction)', async () => {
    const activeDoc: Partial<VerificationDoc> = {
      status: 'active',
      config: VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => activeDoc });

    await expect(
      activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage),
    ).rejects.toThrow('Verifica non attivabile: non è in bozza');
    expect(mockLoadSelectedQuestions).not.toHaveBeenCalled();
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it('throws if validateForActivation fails', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: { ...VALID_CONFIG, questionRefs: [] }, // invalid: no questions
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });

    await expect(
      activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage),
    ).rejects.toThrow('Verifica non valida:');
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it('throws when the pool cannot be loaded from Storage', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestions.mockResolvedValue({ ok: false, error: 'Pool non trovato' });

    await expect(
      activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage),
    ).rejects.toThrow('Impossibile generare la proiezione pubblica');
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });
});

// ─── setVerificationVisibility ──────────────────────────────────────────────

describe('setVerificationVisibility', () => {
  it('updates only visibility and updatedAt on an active verification', async () => {
    const activeDoc: Partial<VerificationDoc> = { status: 'active', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => activeDoc });

    await setVerificationVisibility('ver-id', 'public', OWNER_UID, fakeDb);

    expect(mockSetDoc).toHaveBeenCalledTimes(3); // parent update + projection mirror + audit
    const [, updateData, options] = mockSetDoc.mock.calls[0];
    expect(updateData.visibility).toBe('public');
    expect(Object.keys(updateData).sort()).toEqual(['updatedAt', 'visibility']);
    expect(options).toEqual({ merge: true });

    const [, auditData] = mockSetDoc.mock.calls[2];
    expect(auditData.action).toBe('verification.visibilityChanged');
    expect(auditData.actorUid).toBe(OWNER_UID);
  });

  it('mirrors the new visibility onto publishedProjection/data (M3L-D)', async () => {
    const activeDoc: Partial<VerificationDoc> = { status: 'active', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => activeDoc });

    await setVerificationVisibility('ver-id', 'public', OWNER_UID, fakeDb);

    const [, projectionData, projectionOptions] = mockSetDoc.mock.calls[1];
    expect(projectionData).toEqual({ visibility: 'public' });
    expect(projectionOptions).toEqual({ merge: true });
  });

  it('throws when the verification is a draft', async () => {
    const draftDoc: Partial<VerificationDoc> = { status: 'draft', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => draftDoc });

    await expect(setVerificationVisibility('ver-id', 'public', OWNER_UID, fakeDb)).rejects.toThrow(
      'Visibilità modificabile solo su una verifica attiva',
    );
  });

  it('throws when the verification is closed', async () => {
    const closedDoc: Partial<VerificationDoc> = { status: 'closed', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => closedDoc });

    await expect(setVerificationVisibility('ver-id', 'hidden', OWNER_UID, fakeDb)).rejects.toThrow(
      'Visibilità modificabile solo su una verifica attiva',
    );
  });
});

// ─── closeVerification ────────────────────────────────────────────────────────

describe('closeVerification', () => {
  it('sets status=closed when active', async () => {
    const activeDoc: Partial<VerificationDoc> = { status: 'active', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => activeDoc });

    await closeVerification('ver-id', OWNER_UID, fakeDb);

    expect(mockSetDoc).toHaveBeenCalledTimes(3); // parent update + projection mirror + audit
    const [, closedData] = mockSetDoc.mock.calls[0];
    expect(closedData.status).toBe('closed');
    expect(closedData.closedAt).toBeDefined();

    const [, auditData] = mockSetDoc.mock.calls[2];
    expect(auditData.action).toBe('verification.closed');
  });

  it('forces publishedProjection/data.visibility back to hidden on close (M3L-D)', async () => {
    const activeDoc: Partial<VerificationDoc> = { status: 'active', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => activeDoc });

    await closeVerification('ver-id', OWNER_UID, fakeDb);

    const [, projectionData, projectionOptions] = mockSetDoc.mock.calls[1];
    expect(projectionData).toEqual({ visibility: 'hidden' });
    expect(projectionOptions).toEqual({ merge: true });
  });

  it('throws if not active', async () => {
    const draftDoc: Partial<VerificationDoc> = { status: 'draft', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => draftDoc });

    await expect(closeVerification('ver-id', OWNER_UID, fakeDb)).rejects.toThrow(
      'Verifica non chiudibile: non è attiva',
    );
  });
});

// ─── deleteVerification ────────────────────────────────────────────────────────

describe('deleteVerification', () => {
  it('deletes the document and writes an audit event when status is closed', async () => {
    const closedDoc: Partial<VerificationDoc> = { status: 'closed', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => closedDoc });

    await deleteVerification('ver-id', OWNER_UID, fakeDb);

    expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
    expect(mockSetDoc).toHaveBeenCalledTimes(1); // audit event only
    const [, auditData] = mockSetDoc.mock.calls[0];
    expect(auditData.action).toBe('verification.deleted');
    expect(auditData.actorUid).toBe(OWNER_UID);
    expect(auditData.targetId).toBe('ver-id');
  });

  it('deletes the document and writes an audit event when status is draft', async () => {
    const draftDoc: Partial<VerificationDoc> = { status: 'draft', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => draftDoc });

    await deleteVerification('ver-id', OWNER_UID, fakeDb);

    expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
    const [, auditData] = mockSetDoc.mock.calls[0];
    expect(auditData.action).toBe('verification.deleted');
  });

  it('rejects when status is active, without calling deleteDoc', async () => {
    const activeDoc: Partial<VerificationDoc> = { status: 'active', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => activeDoc });

    await expect(deleteVerification('ver-id', OWNER_UID, fakeDb)).rejects.toThrow(
      'Verifica non eliminabile: deve essere in bozza o chiusa',
    );
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });
});
