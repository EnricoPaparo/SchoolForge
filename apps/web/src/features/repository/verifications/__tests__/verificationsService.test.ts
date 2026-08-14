import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock firebase modules
vi.mock('../../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

const mockGetDocs = vi.fn();
const mockGetDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockDoc = vi.fn();
const mockCollection = vi.fn();
const mockQuery = vi.fn((...args: unknown[]) => ({ args }));
const mockWhere = vi.fn((...args: unknown[]) => ({ where: args }));
const mockServerTimestamp = vi.fn(() => ({ _type: 'serverTimestamp' }));
const mockRunTransaction = vi.fn();
const mockTxGet = vi.fn();
const mockTxUpdate = vi.fn();
const mockTxSet = vi.fn();
const mockTxDelete = vi.fn();
const mockBatchSet = vi.fn();
const mockBatchDelete = vi.fn();
const mockBatchCommit = vi.fn();
const mockWriteBatch = vi.fn((_db?: unknown) => ({
  set: mockBatchSet,
  delete: mockBatchDelete,
  commit: mockBatchCommit,
}));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  limit: (n: number) => ({ limit: n }),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
  writeBatch: (db: unknown) => mockWriteBatch(db),
  serverTimestamp: () => mockServerTimestamp(),
}));

// loadSelectedQuestionsWithSolutions hits Storage directly — mocked out
// here so activateVerification tests stay pure unit tests. Its own
// behaviour (pool parsing, concurrency, dedup) is covered by
// loadSelectedQuestionsWithSolutions.test.ts.
const mockLoadSelectedQuestionsWithSolutions = vi.fn();
vi.mock('../loadSelectedQuestionsWithSolutions.js', () => ({
  loadSelectedQuestionsWithSolutions: (...args: unknown[]) =>
    mockLoadSelectedQuestionsWithSolutions(...args),
}));

// UI-VERIFICHE-06B — l'albero canonico del corso è letto una sola volta,
// nell'attivazione, per ricostruire autorevolmente il perimetro didattico.
// Qui è mockato: l'ordine canonico e la deduplicazione hanno i loro test puri
// in topicOutline.test.ts.
const mockListUdas = vi.fn();
const mockListLessons = vi.fn();
vi.mock('../../programs/programsService.js', () => ({
  listUdas: (...args: unknown[]) => mockListUdas(...args),
  listLessons: (...args: unknown[]) => mockListLessons(...args),
}));

import {
  listVerifications,
  listActiveOnlineVerificationClassIds,
  createVerification,
  updateVerificationConfig,
  validateForActivation,
  activateVerification,
  setVerificationVisibility,
  setVerificationOnlineEnabled,
  setVerificationStudentPdfEnabled,
  closeVerification,
  reopenVerification,
  deleteVerification,
  VERIFICATION_TITLE_MAX_LENGTH,
} from '../verificationsService.js';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import type { VerificationConfig, VerificationDoc } from '../../../../types/firestore.js';

const fakeDb = {} as Firestore;
const fakeStorage = {} as FirebaseStorage;
const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-uid';
const fakeDocRef = { id: 'new-ver-id' };
const TEST_TIMESTAMP = { seconds: 1, nanoseconds: 0, toMillis: () => 1000 };

const VALID_CONFIG: VerificationConfig = {
  title: 'Verifica 1',
  classId: 'class-1',
  programId: 'prog-1',
  importId: 'imp-1',
  verificationDate: '2026-02-02',
  questionRefs: [
    {
      questionIndexEntryId: 'qi-1',
      questionLocalId: 'q1',
      udaDir: 'UDA1',
      lessonFilename: 'lezione1.md',
      poolStorageRef: 'gs://bucket/imports/imp-1/UDA1/lezione1.pool.md',
      tipo: 'chiusa_singola',
      difficolta: 2,
      maxPoints: 2,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDoc.mockReturnValue(fakeDocRef);
  mockCollection.mockReturnValue({ id: 'verifications' });
  mockSetDoc.mockResolvedValue(undefined);
  mockBatchCommit.mockResolvedValue(undefined);
  mockRunTransaction.mockImplementation(async (_db: unknown, callback: (tx: unknown) => unknown) =>
    callback({ get: mockTxGet, update: mockTxUpdate, set: mockTxSet, delete: mockTxDelete }),
  );
  mockListUdas.mockResolvedValue([{ dir: 'UDA1', titolo: 'Il Web' }]);
  mockListLessons.mockResolvedValue([
    { udaDir: 'UDA1', filename: 'lezione1.md', titolo: 'Come funziona Internet' },
    { udaDir: 'UDA1', filename: 'lezione2.md', titolo: 'Il server' },
  ]);
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

describe('listActiveOnlineVerificationClassIds', () => {
  it('returns unique non-null class ids from the bounded active-online query', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        { data: () => ({ config: { classId: 'class-1' } }) },
        { data: () => ({ config: { classId: 'class-1' } }) },
        { data: () => ({ config: { classId: 'class-2' } }) },
        { data: () => ({ config: { classId: null } }) },
      ],
    });

    await expect(listActiveOnlineVerificationClassIds(OWNER_UID, fakeDb)).resolves.toEqual([
      'class-1',
      'class-2',
    ]);
    expect(mockWhere).toHaveBeenCalledWith('ownerUid', '==', OWNER_UID);
    expect(mockWhere).toHaveBeenCalledWith('status', '==', 'active');
    expect(mockWhere).toHaveBeenCalledWith('onlineEnabled', '==', true);
  });
});

// ─── createVerification ───────────────────────────────────────────────────────

describe('createVerification', () => {
  it('creates draft with empty questionRefs and writes audit event', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ ownerUid: OWNER_UID, activeImportId: 'i1' }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          ownerUid: OWNER_UID,
          programId: 'p1',
          importId: 'i1',
          status: 'committed',
        }),
      });
    const id = await createVerification(
      {
        title: 'Verifica 1',
        classId: null,
        programId: 'p1',
        importId: 'i1',
        verificationDate: '2026-02-02',
      },
      OWNER_UID,
      fakeDb,
    );

    expect(id).toBe('new-ver-id');
    expect(mockWriteBatch).toHaveBeenCalledWith(fakeDb);
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);

    const [, verData] = mockBatchSet.mock.calls[0];
    expect(verData.status).toBe('draft');
    expect(verData.visibility).toBe('hidden');
    expect(verData.studentPdfEnabled).toBe(false);
    expect(verData.config.questionRefs).toEqual([]);
    expect(verData.teacherSnapshot).toBeNull();
    expect(verData.activatedAt).toBeNull();
    expect(verData.closedAt).toBeNull();

    const [, auditData] = mockBatchSet.mock.calls[1];
    expect(auditData.action).toBe('verification.created');
    expect(auditData.actorUid).toBe(OWNER_UID);
  });

  it('accepts and trims a title of exactly 100 characters', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ ownerUid: OWNER_UID, activeImportId: 'i1' }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          ownerUid: OWNER_UID,
          programId: 'p1',
          importId: 'i1',
          status: 'active',
        }),
      });
    const title = 'T'.repeat(VERIFICATION_TITLE_MAX_LENGTH);

    await createVerification(
      {
        title: ` ${title} `,
        classId: null,
        programId: 'p1',
        importId: 'i1',
        verificationDate: '2026-02-02',
      },
      OWNER_UID,
      fakeDb,
    );

    expect(mockBatchSet.mock.calls[0]?.[1].config.title).toBe(title);
  });

  it('accetta una data valida sulla bozza e rifiuta una data impossibile', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      ownerUid: OWNER_UID,
      status: 'draft',
      config: VALID_CONFIG,
    };
    mockTxGet.mockResolvedValue({ exists: () => true, data: () => draftDoc });

    await updateVerificationConfig('ver-id', { verificationDate: '2026-03-15' }, OWNER_UID, fakeDb);
    expect(mockTxUpdate.mock.calls[0]?.[1].config.verificationDate).toBe('2026-03-15');

    vi.clearAllMocks();
    await expect(
      updateVerificationConfig('ver-id', { verificationDate: '2026-02-30' }, OWNER_UID, fakeDb),
    ).rejects.toThrow(/AAAA-MM-GG/);
    // Validazione prima di qualunque lettura o scrittura.
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it('rejects a 101-character title before reads or writes', async () => {
    await expect(
      createVerification(
        {
          title: 'T'.repeat(VERIFICATION_TITLE_MAX_LENGTH + 1),
          classId: null,
          programId: 'p1',
          importId: 'i1',
          verificationDate: '2026-02-02',
        },
        OWNER_UID,
        fakeDb,
      ),
    ).rejects.toThrow('non può superare 100 caratteri');

    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it('rejects an empty or stale course before opening a write batch', async () => {
    await expect(
      createVerification(
        {
          title: 'Verifica 1',
          classId: null,
          programId: 'p1',
          importId: '',
          verificationDate: '2026-02-02',
        },
        OWNER_UID,
        fakeDb,
      ),
    ).rejects.toThrow('corso pronto');
    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it('rejects when the selected import is no longer active', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ ownerUid: OWNER_UID, activeImportId: 'new-import' }),
      })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({}) });

    await expect(
      createVerification(
        {
          title: 'Verifica 1',
          classId: null,
          programId: 'p1',
          importId: 'old-import',
          verificationDate: '2026-02-02',
        },
        OWNER_UID,
        fakeDb,
      ),
    ).rejects.toThrow('non ha più questa importazione attiva');
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it('rejects a missing active import document', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ ownerUid: OWNER_UID, activeImportId: 'i1' }),
      })
      .mockResolvedValueOnce({ exists: () => false });

    await expect(
      createVerification(
        {
          title: 'Verifica 1',
          classId: null,
          programId: 'p1',
          importId: 'i1',
          verificationDate: '2026-02-02',
        },
        OWNER_UID,
        fakeDb,
      ),
    ).rejects.toThrow("L'importazione attiva del corso non esiste più");
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });
  it('richiede una data valida prima di qualunque lettura o scrittura (UI-VERIFICHE-06B)', async () => {
    for (const verificationDate of [undefined, '', '2026-2-2', '2026-02-30', '02/02/2026']) {
      vi.clearAllMocks();
      mockDoc.mockReturnValue(fakeDocRef);
      mockCollection.mockReturnValue({ id: 'verifications' });
      await expect(
        createVerification(
          {
            title: 'Verifica 1',
            classId: null,
            programId: 'p1',
            importId: 'i1',
            verificationDate: verificationDate as string,
          },
          OWNER_UID,
          fakeDb,
        ),
      ).rejects.toThrow(/AAAA-MM-GG/);
      expect(mockGetDoc).not.toHaveBeenCalled();
      expect(mockWriteBatch).not.toHaveBeenCalled();
    }
  });

  it('persiste la data esattamente come indicata, senza normalizzarla', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ ownerUid: OWNER_UID, activeImportId: 'i1' }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          ownerUid: OWNER_UID,
          programId: 'p1',
          importId: 'i1',
          status: 'active',
        }),
      });

    await createVerification(
      {
        title: 'Verifica 1',
        classId: null,
        programId: 'p1',
        importId: 'i1',
        verificationDate: '2024-02-29',
      },
      OWNER_UID,
      fakeDb,
    );

    expect(mockBatchSet.mock.calls[0]?.[1].config.verificationDate).toBe('2024-02-29');
  });
});

// ─── updateVerificationConfig ─────────────────────────────────────────────────

describe('updateVerificationConfig', () => {
  it('updates config when status is draft', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      ownerUid: OWNER_UID,
      status: 'draft',
      config: VALID_CONFIG,
    };
    mockTxGet.mockResolvedValue({ exists: () => true, data: () => draftDoc });

    await updateVerificationConfig('ver-id', { title: 'Nuovo titolo' }, OWNER_UID, fakeDb);

    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
    expect(mockTxSet).toHaveBeenCalledTimes(1);
    const [, mergedData] = mockTxUpdate.mock.calls[0];
    expect(mergedData.config.title).toBe('Nuovo titolo');
  });

  it('rejects a 101-character title before reads or writes', async () => {
    await expect(
      updateVerificationConfig(
        'ver-id',
        { title: 'T'.repeat(VERIFICATION_TITLE_MAX_LENGTH + 1) },
        OWNER_UID,
        fakeDb,
      ),
    ).rejects.toThrow('non può superare 100 caratteri');

    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('throws when status is not draft', async () => {
    const activeDoc: Partial<VerificationDoc> = {
      ownerUid: OWNER_UID,
      status: 'active',
      config: VALID_CONFIG,
    };
    mockTxGet.mockResolvedValue({ exists: () => true, data: () => activeDoc });

    await expect(
      updateVerificationConfig('ver-id', { title: 'X' }, OWNER_UID, fakeDb),
    ).rejects.toThrow('Verifica non modificabile: non è in bozza');
  });

  it('muove draftUsageCount solo per il diff di insiemi e nello stesso commit', async () => {
    const differentiation = {
      version: 1 as const,
      questions: [
        { baseQuestionIndexEntryId: 'qi-1', choices: { 'label-1': { kind: 'none' as const } } },
      ],
    };
    const draftDoc: Partial<VerificationDoc> = {
      ownerUid: OWNER_UID,
      status: 'draft',
      config: VALID_CONFIG,
    };
    mockTxGet
      .mockResolvedValueOnce({ exists: () => true, data: () => draftDoc })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          labelId: 'label-1',
          ownerUid: OWNER_UID,
          name: 'Percorso A',
          nameKey: 'percorso a',
          assignedCount: 0,
          draftUsageCount: 2,
          createdAt: TEST_TIMESTAMP,
          updatedAt: TEST_TIMESTAMP,
        }),
      });

    await updateVerificationConfig('ver-id', { differentiation }, OWNER_UID, fakeDb);

    expect(mockTxGet).toHaveBeenCalledTimes(2);
    expect(mockTxUpdate).toHaveBeenCalledTimes(2);
    expect(mockTxUpdate.mock.calls[0]?.[1]).toMatchObject({ draftUsageCount: 3 });
    expect(mockTxUpdate.mock.calls[1]?.[1].config.differentiation).toEqual(differentiation);
    expect(mockTxSet).toHaveBeenCalledOnce();
  });

  it('non legge né scrive etichette quando l’insieme resta invariato', async () => {
    const differentiation = {
      version: 1 as const,
      questions: [
        { baseQuestionIndexEntryId: 'qi-1', choices: { 'label-1': { kind: 'none' as const } } },
      ],
    };
    mockTxGet.mockResolvedValue({
      exists: () => true,
      data: () => ({
        ownerUid: OWNER_UID,
        status: 'draft',
        config: { ...VALID_CONFIG, differentiation },
      }),
    });

    await updateVerificationConfig('ver-id', { title: 'Titolo diverso' }, OWNER_UID, fakeDb);
    expect(mockTxGet).toHaveBeenCalledOnce();
    expect(mockTxUpdate).toHaveBeenCalledOnce();
    expect(mockTxSet).toHaveBeenCalledOnce();
  });

  it('un replay identico è un no-op senza secondo audit', async () => {
    mockTxGet.mockResolvedValue({
      exists: () => true,
      data: () => ({ ownerUid: OWNER_UID, status: 'draft', config: VALID_CONFIG }),
    });
    await updateVerificationConfig('ver-id', { title: VALID_CONFIG.title }, OWNER_UID, fakeDb);
    expect(mockTxGet).toHaveBeenCalledOnce();
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it('rifiuta il decremento sotto zero con zero scritture', async () => {
    const differentiation = {
      version: 1 as const,
      questions: [
        { baseQuestionIndexEntryId: 'qi-1', choices: { 'label-1': { kind: 'none' as const } } },
      ],
    };
    mockTxGet
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          ownerUid: OWNER_UID,
          status: 'draft',
          config: { ...VALID_CONFIG, differentiation },
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          labelId: 'label-1',
          ownerUid: OWNER_UID,
          name: 'Percorso A',
          nameKey: 'percorso a',
          assignedCount: 0,
          draftUsageCount: 0,
          createdAt: TEST_TIMESTAMP,
          updatedAt: TEST_TIMESTAMP,
        }),
      });
    await expect(
      updateVerificationConfig('ver-id', { differentiation: undefined }, OWNER_UID, fakeDb),
    ).rejects.toThrow(/contatore delle bozze incoerente/);
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it('rifiuta una base differenziata inserita contemporaneamente in VEX', async () => {
    const differentiation = {
      version: 1 as const,
      questions: [
        { baseQuestionIndexEntryId: 'qi-1', choices: { 'label-1': { kind: 'none' as const } } },
      ],
    };
    mockTxGet.mockResolvedValue({
      exists: () => true,
      data: () => ({ ownerUid: OWNER_UID, status: 'draft', config: VALID_CONFIG }),
    });
    await expect(
      updateVerificationConfig(
        'ver-id',
        {
          differentiation,
          equivalentGroups: [{ id: 'g', questionIndexEntryIds: ['qi-1'] }],
        },
        OWNER_UID,
        fakeDb,
      ),
    ).rejects.toThrow(/gruppo equivalente/);
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockTxSet).not.toHaveBeenCalled();
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

  /*
   * VDIF-04 — il blocco temporaneo di VDIF-03 è **rimosso**: una bozza
   * differenziata è ora attivabile, e ciò che la ferma sono le guardie reali
   * G03→G21, non un rifiuto generico in `validateForActivation`. Questo test
   * difende esattamente quella rimozione: la validazione di forma non deve più
   * conoscere la differenziazione.
   */
  it('VDIF-04 — una bozza differenziata supera la validazione di forma', () => {
    const result = validateForActivation({
      ...VALID_CONFIG,
      differentiation: {
        version: 1,
        questions: [
          {
            baseQuestionIndexEntryId: 'qi-1',
            choices: {
              'label-1': { kind: 'alternative', questionIndexEntryId: 'qi-alt' },
            },
          },
        ],
      },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('POOL-SIMPLE-02 — accepts difficoltà 5 with maxPoints 5', () => {
    const ref = { ...VALID_CONFIG.questionRefs[0]!, difficolta: 5 as const, maxPoints: 5 };
    const result = validateForActivation({ ...VALID_CONFIG, questionRefs: [ref] });
    expect(result.valid).toBe(true);
  });

  it('POOL-SIMPLE-02 fail-closed — rejects an incoherent ref before activation (invalid difficoltà or maxPoints !== difficolta)', () => {
    const badDifficolta = {
      ...VALID_CONFIG.questionRefs[0]!,
      difficolta: 6 as unknown as 5,
      maxPoints: 6,
    };
    const badMaxPoints = { ...VALID_CONFIG.questionRefs[0]!, difficolta: 3 as const, maxPoints: 4 };
    for (const ref of [badDifficolta, badMaxPoints]) {
      const result = validateForActivation({ ...VALID_CONFIG, questionRefs: [ref] });
      expect(result.valid).toBe(false);
    }
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
        soluzione: 'a',
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
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue(LOADED_QUESTIONS_OK);
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
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue(LOADED_QUESTIONS_OK);
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

  // ─── UI-VERIFICHE-06B — data e argomenti congelati all'attivazione ──────────

  it('congela data e argomenti nello snapshot e nella proiezione', async () => {
    const draftDoc: Partial<VerificationDoc> = { status: 'draft', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue(LOADED_QUESTIONS_OK);
    const capture = setupTransactionCapture(draftDoc);

    await activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage);

    const snapshot = capture.getUpdate()?.teacherSnapshot as Record<string, unknown>;
    expect(snapshot.verificationDate).toBe('2026-02-02');
    expect(snapshot.topicOutline).toEqual([
      { udaTitle: 'Il Web', lessonTitles: ['Come funziona Internet'] },
    ]);
    const projection = capture.getProjection();
    expect(projection?.verificationDate).toBe('2026-02-02');
    expect(projection?.topicOutline).toEqual(snapshot.topicOutline);
    // Il perimetro pubblicato non contiene nulla oltre i titoli.
    expect(JSON.stringify(projection?.topicOutline)).not.toContain('UDA1');
    expect(JSON.stringify(projection?.topicOutline)).not.toContain('lezione1.md');
  });

  it('ricostruisce il perimetro dai dati canonici e ignora un valore del client', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: {
        ...VALID_CONFIG,
        // Valore arbitrario salvato nella bozza: non deve mai finire nello
        // snapshot né nella proiezione.
        topicOutline: [{ udaTitle: 'FALSO', lessonTitles: ['FALSO'] }],
      },
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue(LOADED_QUESTIONS_OK);
    const capture = setupTransactionCapture(draftDoc);

    await activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage);

    expect(JSON.stringify(capture.getUpdate())).not.toContain('FALSO');
    expect(JSON.stringify(capture.getProjection())).not.toContain('FALSO');
    expect(capture.getProjection()?.topicOutline).toEqual([
      { udaTitle: 'Il Web', lessonTitles: ['Come funziona Internet'] },
    ]);
  });

  it('non attiva se il perimetro non è costruibile (fail-closed, nessuna scrittura)', async () => {
    const draftDoc: Partial<VerificationDoc> = { status: 'draft', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue(LOADED_QUESTIONS_OK);
    mockListUdas.mockResolvedValue([{ dir: 'UDA1', titolo: '   ' }]);
    setupTransactionCapture(draftDoc);

    await expect(
      activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage),
    ).rejects.toThrow(/Impossibile attivare/);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it('attiva una bozza legacy senza data, omettendo il campo invece di inventarlo', async () => {
    const legacyConfig = { ...VALID_CONFIG };
    delete legacyConfig.verificationDate;
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: legacyConfig as typeof VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue(LOADED_QUESTIONS_OK);
    const capture = setupTransactionCapture(draftDoc);

    await activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage);

    const snapshot = capture.getUpdate()?.teacherSnapshot as Record<string, unknown>;
    expect(snapshot).not.toHaveProperty('verificationDate');
    expect(capture.getProjection()).not.toHaveProperty('verificationDate');
    // Il perimetro invece è sempre ricostruito: non dipende dalla data.
    expect(snapshot.topicOutline).toHaveLength(1);
  });

  it('writes onlineEnabled: false into publishedProjection when the verification has no toggle yet (M3F-04 preflight)', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue(LOADED_QUESTIONS_OK);
    const capture = setupTransactionCapture(draftDoc);

    await activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage);

    expect(capture.getProjection()?.onlineEnabled).toBe(false);
  });

  it('mirrors onlineEnabled: true into publishedProjection when already set on the verification', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: VALID_CONFIG,
      onlineEnabled: true,
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue(LOADED_QUESTIONS_OK);
    const capture = setupTransactionCapture(draftDoc);

    await activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage);

    expect(capture.getProjection()?.onlineEnabled).toBe(true);
  });

  it('writes studentPdfEnabled: false into publishedProjection when never toggled on the draft (M3F-09)', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue(LOADED_QUESTIONS_OK);
    const capture = setupTransactionCapture(draftDoc);

    await activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage);

    expect(capture.getProjection()?.studentPdfEnabled).toBe(false);
  });

  it('mirrors studentPdfEnabled: true into publishedProjection when already toggled on the draft (M3F-09)', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: VALID_CONFIG,
      studentPdfEnabled: true,
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue(LOADED_QUESTIONS_OK);
    const capture = setupTransactionCapture(draftDoc);

    await activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage);

    expect(capture.getProjection()?.studentPdfEnabled).toBe(true);
  });

  it('writes classId: null into publishedProjection when the verification has no class (M3L-D)', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: { ...VALID_CONFIG, classId: null },
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue(LOADED_QUESTIONS_OK);
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
    expect(mockLoadSelectedQuestionsWithSolutions).not.toHaveBeenCalled();
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

  it('VEX-01B: activates equivalent_variants — snapshot carries VEX order fields, projection is common-only', async () => {
    const commonRef = { ...VALID_CONFIG.questionRefs[0]!, questionIndexEntryId: 'qi-1' };
    const altA = {
      ...VALID_CONFIG.questionRefs[0]!,
      questionIndexEntryId: 'qi-2',
      questionLocalId: 'q2',
      tipo: 'aperta' as const,
    };
    const altB = {
      ...VALID_CONFIG.questionRefs[0]!,
      questionIndexEntryId: 'qi-3',
      questionLocalId: 'q3',
      tipo: 'aperta' as const,
    };
    const vexDraft: Partial<VerificationDoc> = {
      status: 'draft',
      config: {
        ...VALID_CONFIG,
        questionRefs: [commonRef, altA, altB],
        distributionMode: 'equivalent_variants',
        equivalentGroups: [{ id: 'g1', questionIndexEntryIds: ['qi-2', 'qi-3'] }],
      },
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => vexDraft });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue({
      ok: true as const,
      questions: [
        {
          ref: commonRef,
          testo: 'Q1?',
          tipo: 'chiusa_singola' as const,
          opzioni: [],
          soluzione: 'a',
        },
        { ref: altA, testo: 'Q2?', tipo: 'aperta' as const, soluzione: 'sol2' },
        { ref: altB, testo: 'Q3?', tipo: 'aperta' as const, soluzione: 'sol3' },
      ],
    });
    const capture = setupTransactionCapture(vexDraft);

    await activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage);

    const snapshot = capture.getUpdate()?.teacherSnapshot as {
      distributionMode?: string;
      commonQuestionOrders?: number[];
      equivalentGroups?: { id: string; alternativeOrders: number[] }[];
      questions?: { order: number }[];
    };
    expect(snapshot.distributionMode).toBe('equivalent_variants');
    expect(snapshot.commonQuestionOrders).toEqual([0]);
    expect(snapshot.equivalentGroups).toEqual([{ id: 'g1', alternativeOrders: [1, 2] }]);
    // teacherSnapshot keeps ALL selected questions (common + every alternative).
    expect(snapshot.questions).toHaveLength(3);
    // Published projection exposes ONLY the common question — alternatives never leak.
    const projectionQuestions = capture.getProjection()?.questions as { order: number }[];
    expect(projectionQuestions.map((q) => q.order)).toEqual([0]);
  });

  it('VEX-01A: same_questions activates unchanged and records distributionMode in the snapshot', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: { ...VALID_CONFIG, distributionMode: 'same_questions' },
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue(LOADED_QUESTIONS_OK);
    const capture = setupTransactionCapture(draftDoc);

    await activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage);

    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    const snapshot = capture.getUpdate()?.teacherSnapshot as { distributionMode?: string };
    expect(snapshot.distributionMode).toBe('same_questions');
  });

  it('throws when the pool cannot be loaded from Storage, before opening the transaction', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue({
      ok: false,
      error: 'Pool non trovato',
    });

    await expect(
      activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage),
    ).rejects.toThrow('Impossibile attivare');
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it('throws when a solution is missing/invalid, before opening the transaction', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue({
      ok: true,
      questions: [{ ...LOADED_QUESTIONS_OK.questions[0], soluzione: '' }],
    });

    await expect(
      activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage),
    ).rejects.toThrow(/soluzione/i);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it('rejects activation if questionRefs change after the Storage preflight', async () => {
    const preflightDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: VALID_CONFIG,
    };
    const changedRef = {
      ...VALID_CONFIG.questionRefs[0]!,
      questionIndexEntryId: 'qi-changed',
      questionLocalId: 'q-changed',
    };
    const transactionDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: { ...VALID_CONFIG, questionRefs: [changedRef] },
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => preflightDoc });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue(LOADED_QUESTIONS_OK);
    const capture = setupTransactionCapture(transactionDoc);

    await expect(
      activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage),
    ).rejects.toThrow(/selezione delle domande è cambiata/i);

    expect(capture.getUpdate()).toBeUndefined();
    expect(capture.getProjection()).toBeUndefined();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('reads each pool exactly once for both teacherSnapshot.questions and publishedProjection', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue(LOADED_QUESTIONS_OK);
    setupTransactionCapture(draftDoc);

    await activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage);

    expect(mockLoadSelectedQuestionsWithSolutions).toHaveBeenCalledTimes(1);
  });

  it('writes teacherSnapshot.questions with order, testo, opzioni, maxPoints and soluzione frozen', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue(LOADED_QUESTIONS_OK);
    const capture = setupTransactionCapture(draftDoc);

    await activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage);

    const teacherSnapshot = capture.getUpdate()?.teacherSnapshot as
      | { questions?: Record<string, unknown>[]; questionRefs?: unknown[] }
      | undefined;
    expect(teacherSnapshot?.questions).toHaveLength(1);
    const q = teacherSnapshot!.questions![0]!;
    expect(q.order).toBe(0);
    expect(q.tipo).toBe('chiusa_singola');
    expect(q.maxPoints).toBe(VALID_CONFIG.questionRefs[0]!.maxPoints);
    expect(q.testo).toBe('Domanda 1?');
    expect(q.opzioni).toEqual(LOADED_QUESTIONS_OK.questions[0].opzioni);
    expect(q.soluzione).toBe('a');
    // questionRefs is still kept alongside questions, for tracking/compatibility.
    expect(teacherSnapshot?.questionRefs).toEqual(VALID_CONFIG.questionRefs);
  });

  it('freezes teacherSnapshot.questions in the same order as questionRefs, for multiple questions', async () => {
    const refA = { ...VALID_CONFIG.questionRefs[0]!, questionIndexEntryId: 'qi-a' };
    const refB = { ...VALID_CONFIG.questionRefs[0]!, questionIndexEntryId: 'qi-b' };
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: { ...VALID_CONFIG, questionRefs: [refA, refB] },
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue({
      ok: true,
      questions: [
        { ref: refA, testo: 'Domanda A', tipo: 'aperta' as const, soluzione: 'Risposta A' },
        { ref: refB, testo: 'Domanda B', tipo: 'aperta' as const, soluzione: 'Risposta B' },
      ],
    });
    const capture = setupTransactionCapture(draftDoc);

    await activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage);

    const teacherSnapshot = capture.getUpdate()?.teacherSnapshot as {
      questions: Record<string, unknown>[];
    };
    expect(teacherSnapshot.questions.map((q) => q.testo)).toEqual(['Domanda A', 'Domanda B']);
    expect(teacherSnapshot.questions.map((q) => q.order)).toEqual([0, 1]);
  });

  it('derives publishedProjection.questions from the same loaded result — never a second Storage read', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue(LOADED_QUESTIONS_OK);
    const capture = setupTransactionCapture(draftDoc);

    await activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage);

    expect(mockLoadSelectedQuestionsWithSolutions).toHaveBeenCalledTimes(1);
    const projectionQuestion = (capture.getProjection()?.questions as Record<string, unknown>[])[0];
    expect(projectionQuestion.testo).toBe('Domanda 1?');
    expect(projectionQuestion).not.toHaveProperty('soluzione');
  });

  it('blocks activation before the transaction when the snapshot would be too large', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      status: 'draft',
      config: VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => draftDoc });
    // A single question whose testo alone exceeds the conservative byte
    // threshold — cheaper than constructing many questions to reach it.
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue({
      ok: true,
      questions: [
        {
          ref: VALID_CONFIG.questionRefs[0],
          testo: 'x'.repeat(800_000),
          tipo: 'aperta' as const,
          soluzione: 'y',
        },
      ],
    });

    await expect(
      activateVerification('ver-id', null, OWNER_UID, fakeDb, fakeStorage),
    ).rejects.toThrow(/troppo grande/i);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });
});

// ─── setVerificationVisibility ──────────────────────────────────────────────

describe('setVerificationVisibility', () => {
  it('atomically batches parent visibility/updatedAt + projection mirror + audit', async () => {
    const activeDoc: Partial<VerificationDoc> = { status: 'active', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => activeDoc });

    await setVerificationVisibility('ver-id', 'public', OWNER_UID, fakeDb);

    expect(mockWriteBatch).toHaveBeenCalledWith(fakeDb);
    expect(mockBatchSet).toHaveBeenCalledTimes(3); // parent + projection + audit, exactly
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    expect(mockSetDoc).not.toHaveBeenCalled(); // no sequential setDoc anywhere

    const [, updateData, options] = mockBatchSet.mock.calls[0];
    expect(updateData.visibility).toBe('public');
    expect(Object.keys(updateData).sort()).toEqual(['updatedAt', 'visibility']);
    expect(options).toEqual({ merge: true });

    const [, auditData] = mockBatchSet.mock.calls[2];
    expect(auditData.action).toBe('verification.visibilityChanged');
    expect(auditData.actorUid).toBe(OWNER_UID);
  });

  it('mirrors the new visibility onto publishedProjection/data (M3L-D)', async () => {
    const activeDoc: Partial<VerificationDoc> = { status: 'active', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => activeDoc });

    await setVerificationVisibility('ver-id', 'public', OWNER_UID, fakeDb);

    const [, projectionData, projectionOptions] = mockBatchSet.mock.calls[1];
    expect(projectionData).toEqual({ visibility: 'public' });
    expect(projectionOptions).toEqual({ merge: true });
  });

  it('throws when the verification is a draft, without opening a batch or committing', async () => {
    const draftDoc: Partial<VerificationDoc> = { status: 'draft', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => draftDoc });

    await expect(setVerificationVisibility('ver-id', 'public', OWNER_UID, fakeDb)).rejects.toThrow(
      'Visibilità modificabile solo su una verifica attiva o chiusa',
    );
    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(mockBatchSet).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('allows changing visibility on a closed verification', async () => {
    const closedDoc: Partial<VerificationDoc> = { status: 'closed', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => closedDoc });

    await setVerificationVisibility('ver-id', 'hidden', OWNER_UID, fakeDb);
    expect(mockWriteBatch).toHaveBeenCalledTimes(1);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });
});

// ─── setVerificationOnlineEnabled ────────────────────────────────────────────

describe('setVerificationOnlineEnabled', () => {
  it('atomically batches parent onlineEnabled/updatedAt + projection mirror + audit', async () => {
    const activeDoc: Partial<VerificationDoc> = { status: 'active', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => activeDoc });

    await setVerificationOnlineEnabled('ver-id', true, OWNER_UID, fakeDb);

    expect(mockWriteBatch).toHaveBeenCalledWith(fakeDb);
    expect(mockBatchSet).toHaveBeenCalledTimes(3); // parent + projection + audit
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    expect(mockSetDoc).not.toHaveBeenCalled();

    const [, parentData, parentOptions] = mockBatchSet.mock.calls[0];
    expect(parentData).toEqual({ onlineEnabled: true, updatedAt: mockServerTimestamp() });
    expect(parentOptions).toEqual({ merge: true });

    const [, projectionData, projectionOptions] = mockBatchSet.mock.calls[1];
    expect(projectionData).toEqual({ onlineEnabled: true });
    expect(projectionOptions).toEqual({ merge: true });

    const [, auditData] = mockBatchSet.mock.calls[2];
    expect(auditData.action).toBe('verification.onlineEnabledChanged');
    expect(auditData.actorUid).toBe(OWNER_UID);
    expect(auditData.reason).toBe('onlineEnabled -> true');
  });

  it('rejects enabling online when the verification has no class assigned', async () => {
    const activeDoc: Partial<VerificationDoc> = {
      status: 'active',
      config: { ...VALID_CONFIG, classId: null },
    };
    mockGetDoc.mockResolvedValue({ data: () => activeDoc });

    await expect(setVerificationOnlineEnabled('ver-id', true, OWNER_UID, fakeDb)).rejects.toThrow(
      "Assegnare una classe prima di attivare l'online",
    );
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it('allows disabling online even without a class assigned', async () => {
    const activeDoc: Partial<VerificationDoc> = {
      status: 'active',
      config: { ...VALID_CONFIG, classId: null },
      onlineEnabled: true,
    };
    mockGetDoc.mockResolvedValue({ data: () => activeDoc });

    await setVerificationOnlineEnabled('ver-id', false, OWNER_UID, fakeDb);

    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('rejects when the verification is a draft', async () => {
    const draftDoc: Partial<VerificationDoc> = { status: 'draft', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => draftDoc });

    await expect(setVerificationOnlineEnabled('ver-id', true, OWNER_UID, fakeDb)).rejects.toThrow(
      'Online modificabile solo su una verifica attiva',
    );
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it('rejects when the verification is closed', async () => {
    const closedDoc: Partial<VerificationDoc> = { status: 'closed', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => closedDoc });

    await expect(setVerificationOnlineEnabled('ver-id', false, OWNER_UID, fakeDb)).rejects.toThrow(
      'Online modificabile solo su una verifica attiva',
    );
  });
});

// ─── setVerificationStudentPdfEnabled ────────────────────────────────────────

describe('setVerificationStudentPdfEnabled', () => {
  it('atomically batches parent studentPdfEnabled/updatedAt + projection mirror + audit, on an active verification', async () => {
    const activeDoc: Partial<VerificationDoc> = { status: 'active', config: VALID_CONFIG };
    mockGetDoc
      .mockResolvedValueOnce({ data: () => activeDoc }) // verification
      .mockResolvedValueOnce({ exists: () => true }); // publishedProjection

    await setVerificationStudentPdfEnabled('ver-id', true, OWNER_UID, fakeDb);

    expect(mockWriteBatch).toHaveBeenCalledWith(fakeDb);
    expect(mockBatchSet).toHaveBeenCalledTimes(3); // parent + projection + audit
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);

    const [, parentData, parentOptions] = mockBatchSet.mock.calls[0];
    expect(parentData).toEqual({ studentPdfEnabled: true, updatedAt: mockServerTimestamp() });
    expect(parentOptions).toEqual({ merge: true });

    const [, projectionData, projectionOptions] = mockBatchSet.mock.calls[1];
    expect(projectionData).toEqual({ studentPdfEnabled: true });
    expect(projectionOptions).toEqual({ merge: true });

    const [, auditData] = mockBatchSet.mock.calls[2];
    expect(auditData.action).toBe('verification.studentPdfEnabledChanged');
    expect(auditData.actorUid).toBe(OWNER_UID);
    expect(auditData.reason).toBe('studentPdfEnabled -> true');
  });

  it('allows the toggle on a draft verification, and skips the projection mirror (none exists yet)', async () => {
    const draftDoc: Partial<VerificationDoc> = { status: 'draft', config: VALID_CONFIG };
    mockGetDoc
      .mockResolvedValueOnce({ data: () => draftDoc })
      .mockResolvedValueOnce({ exists: () => false });

    await setVerificationStudentPdfEnabled('ver-id', true, OWNER_UID, fakeDb);

    expect(mockBatchSet).toHaveBeenCalledTimes(2); // parent + audit only
    const [, parentData] = mockBatchSet.mock.calls[0];
    expect(parentData).toEqual({ studentPdfEnabled: true, updatedAt: mockServerTimestamp() });
    const [, auditData] = mockBatchSet.mock.calls[1];
    expect(auditData.action).toBe('verification.studentPdfEnabledChanged');
  });

  it('allows the toggle on a closed verification, mirroring the projection', async () => {
    const closedDoc: Partial<VerificationDoc> = { status: 'closed', config: VALID_CONFIG };
    mockGetDoc
      .mockResolvedValueOnce({ data: () => closedDoc })
      .mockResolvedValueOnce({ exists: () => true });

    await setVerificationStudentPdfEnabled('ver-id', false, OWNER_UID, fakeDb);

    expect(mockBatchSet).toHaveBeenCalledTimes(3);
    const [, parentData] = mockBatchSet.mock.calls[0];
    expect(parentData).toEqual({ studentPdfEnabled: false, updatedAt: mockServerTimestamp() });
    const [, projectionData] = mockBatchSet.mock.calls[1];
    expect(projectionData).toEqual({ studentPdfEnabled: false });
  });

  it('never touches status/visibility/onlineEnabled/config on the parent document', async () => {
    const activeDoc: Partial<VerificationDoc> = { status: 'active', config: VALID_CONFIG };
    mockGetDoc
      .mockResolvedValueOnce({ data: () => activeDoc })
      .mockResolvedValueOnce({ exists: () => true });

    await setVerificationStudentPdfEnabled('ver-id', true, OWNER_UID, fakeDb);

    const [, parentData] = mockBatchSet.mock.calls[0];
    expect(Object.keys(parentData).sort()).toEqual(['studentPdfEnabled', 'updatedAt']);
  });

  it('throws when the verification does not exist', async () => {
    mockGetDoc.mockResolvedValueOnce({ data: () => undefined });

    await expect(
      setVerificationStudentPdfEnabled('ver-id', true, OWNER_UID, fakeDb),
    ).rejects.toThrow('Verifica non trovata');
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });
});

// ─── closeVerification ────────────────────────────────────────────────────────

describe('closeVerification', () => {
  it('atomically batches parent status=closed/closedAt/updatedAt + projection hidden + audit', async () => {
    const activeDoc: Partial<VerificationDoc> = { status: 'active', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => activeDoc });

    await closeVerification('ver-id', OWNER_UID, fakeDb);

    expect(mockWriteBatch).toHaveBeenCalledWith(fakeDb);
    expect(mockBatchSet).toHaveBeenCalledTimes(3); // parent + projection + audit, exactly
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    expect(mockSetDoc).not.toHaveBeenCalled(); // no sequential setDoc anywhere

    const [, closedData] = mockBatchSet.mock.calls[0];
    expect(closedData.status).toBe('closed');
    expect(closedData.closedAt).toBeDefined();

    const [, auditData] = mockBatchSet.mock.calls[2];
    expect(auditData.action).toBe('verification.closed');
  });

  it('marks publishedProjection/data closed while preserving visibility', async () => {
    const activeDoc: Partial<VerificationDoc> = { status: 'active', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => activeDoc });

    await closeVerification('ver-id', OWNER_UID, fakeDb);

    const [, projectionData, projectionOptions] = mockBatchSet.mock.calls[1];
    expect(projectionData).toEqual({ status: 'closed' });
    expect(projectionOptions).toEqual({ merge: true });
  });

  it('throws when the document does not exist, without opening a batch or committing', async () => {
    mockGetDoc.mockResolvedValue({ data: () => undefined });

    await expect(closeVerification('ver-id', OWNER_UID, fakeDb)).rejects.toThrow(
      'Verifica non trovata',
    );
    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('throws when draft, without opening a batch or committing', async () => {
    const draftDoc: Partial<VerificationDoc> = { status: 'draft', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => draftDoc });

    await expect(closeVerification('ver-id', OWNER_UID, fakeDb)).rejects.toThrow(
      'Verifica non chiudibile: non è attiva',
    );
    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('throws when already closed, without opening a batch or committing', async () => {
    const closedDoc: Partial<VerificationDoc> = { status: 'closed', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => closedDoc });

    await expect(closeVerification('ver-id', OWNER_UID, fakeDb)).rejects.toThrow(
      'Verifica non chiudibile: non è attiva',
    );
    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});

// ─── reopenVerification ───────────────────────────────────────────────────────

describe('reopenVerification', () => {
  it('atomically reopens parent and projection and records an audit event', async () => {
    const closedDoc: Partial<VerificationDoc> = { status: 'closed', config: VALID_CONFIG };
    mockGetDoc.mockResolvedValue({ data: () => closedDoc });

    await reopenVerification('ver-id', OWNER_UID, fakeDb);

    expect(mockBatchSet).toHaveBeenCalledTimes(3);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    const [, parentData] = mockBatchSet.mock.calls[0];
    expect(parentData).toMatchObject({ status: 'active', closedAt: null });
    const [, projectionData, projectionOptions] = mockBatchSet.mock.calls[1];
    expect(projectionData).toEqual({ status: 'active' });
    expect(projectionOptions).toEqual({ merge: true });
    const [, auditData] = mockBatchSet.mock.calls[2];
    expect(auditData.action).toBe('verification.reopened');
  });

  it('rejects a missing or non-closed verification before opening a batch', async () => {
    mockGetDoc.mockResolvedValueOnce({ data: () => undefined });
    await expect(reopenVerification('ver-id', OWNER_UID, fakeDb)).rejects.toThrow(
      'Verifica non trovata',
    );
    expect(mockWriteBatch).not.toHaveBeenCalled();

    mockGetDoc.mockResolvedValueOnce({
      data: () => ({ status: 'active', config: VALID_CONFIG }),
    });
    await expect(reopenVerification('ver-id', OWNER_UID, fakeDb)).rejects.toThrow(
      'Verifica non riapribile: non è chiusa',
    );
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });
});

// ─── deleteVerification ────────────────────────────────────────────────────────

describe('deleteVerification', () => {
  it('atomically deletes parent and student projection and writes an audit event when closed', async () => {
    const closedDoc: Partial<VerificationDoc> = {
      ownerUid: OWNER_UID,
      status: 'closed',
      config: VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ data: () => closedDoc });
    mockGetDocs.mockResolvedValue({ empty: true, docs: [] });
    mockTxGet.mockResolvedValue({ exists: () => true, data: () => closedDoc });

    await deleteVerification('ver-id', OWNER_UID, fakeDb);

    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxDelete).toHaveBeenCalledTimes(2);
    expect(mockTxSet).toHaveBeenCalledTimes(1); // audit event only
    expect(mockTxUpdate).not.toHaveBeenCalled();
    const [, auditData] = mockTxSet.mock.calls[0];
    expect(auditData.action).toBe('verification.deleted');
    expect(auditData.actorUid).toBe(OWNER_UID);
    expect(auditData.targetId).toBe('ver-id');
  });

  it('atomically deletes parent and projection and writes an audit event when draft', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      ownerUid: OWNER_UID,
      status: 'draft',
      config: VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ data: () => draftDoc });
    mockGetDocs.mockResolvedValue({ empty: true, docs: [] });
    mockTxGet.mockResolvedValue({ exists: () => true, data: () => draftDoc });

    await deleteVerification('ver-id', OWNER_UID, fakeDb);

    expect(mockTxDelete).toHaveBeenCalledTimes(2);
    const [, auditData] = mockTxSet.mock.calls[0];
    expect(auditData.action).toBe('verification.deleted');
  });

  it('VDIF-03 — eliminando una bozza decrementa una volta ogni etichetta riferita', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      ownerUid: OWNER_UID,
      status: 'draft',
      config: {
        ...VALID_CONFIG,
        differentiation: {
          version: 1,
          questions: [
            {
              baseQuestionIndexEntryId: 'qi-1',
              choices: {
                l1: { kind: 'none' },
                l2: { kind: 'alternative', questionIndexEntryId: 'alt' },
              },
            },
          ],
        },
      },
    };
    mockGetDoc.mockResolvedValue({ data: () => draftDoc });
    mockGetDocs.mockResolvedValue({ empty: true, docs: [] });
    mockTxGet
      .mockResolvedValueOnce({ exists: () => true, data: () => draftDoc })
      .mockResolvedValueOnce({
        data: () => ({
          labelId: 'l1',
          ownerUid: OWNER_UID,
          name: 'A',
          nameKey: 'a',
          assignedCount: 0,
          draftUsageCount: 1,
          createdAt: TEST_TIMESTAMP,
          updatedAt: TEST_TIMESTAMP,
        }),
      })
      .mockResolvedValueOnce({
        data: () => ({
          labelId: 'l2',
          ownerUid: OWNER_UID,
          name: 'B',
          nameKey: 'b',
          assignedCount: 0,
          draftUsageCount: 3,
          createdAt: TEST_TIMESTAMP,
          updatedAt: TEST_TIMESTAMP,
        }),
      });

    await deleteVerification('ver-id', OWNER_UID, fakeDb);

    expect(mockTxUpdate).toHaveBeenCalledTimes(2);
    expect(mockTxUpdate.mock.calls.map((call) => call[1].draftUsageCount).sort()).toEqual([0, 2]);
    expect(mockTxDelete).toHaveBeenCalledTimes(2);
  });

  it('VDIF-03 fail-closed — non elimina una bozza se un contatore è già a zero', async () => {
    const draftDoc: Partial<VerificationDoc> = {
      ownerUid: OWNER_UID,
      status: 'draft',
      config: {
        ...VALID_CONFIG,
        differentiation: {
          version: 1,
          questions: [{ baseQuestionIndexEntryId: 'qi-1', choices: { l1: { kind: 'none' } } }],
        },
      },
    };
    mockGetDoc.mockResolvedValue({ data: () => draftDoc });
    mockGetDocs.mockResolvedValue({ empty: true, docs: [] });
    mockTxGet
      .mockResolvedValueOnce({ exists: () => true, data: () => draftDoc })
      .mockResolvedValueOnce({
        data: () => ({
          labelId: 'l1',
          ownerUid: OWNER_UID,
          name: 'A',
          nameKey: 'a',
          assignedCount: 0,
          draftUsageCount: 0,
          createdAt: TEST_TIMESTAMP,
          updatedAt: TEST_TIMESTAMP,
        }),
      });

    await expect(deleteVerification('ver-id', OWNER_UID, fakeDb)).rejects.toThrow(/contatore/i);
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockTxDelete).not.toHaveBeenCalled();
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it('rejects when status is active, without opening a batch', async () => {
    const activeDoc: Partial<VerificationDoc> = {
      ownerUid: OWNER_UID,
      status: 'active',
      config: VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ data: () => activeDoc });

    await expect(deleteVerification('ver-id', OWNER_UID, fakeDb)).rejects.toThrow(
      'Verifica non eliminabile: deve essere in bozza o chiusa',
    );
    expect(mockTxDelete).not.toHaveBeenCalled();
  });

  it('refuses to delete a closed verification that still owns a submission, writing nothing', async () => {
    const closedDoc: Partial<VerificationDoc> = {
      ownerUid: OWNER_UID,
      status: 'closed',
      config: VALID_CONFIG,
    };
    mockGetDoc.mockResolvedValue({ data: () => closedDoc });
    mockTxGet.mockResolvedValue({ exists: () => true, data: () => closedDoc });
    // Preflight query finds a linked submission.
    mockGetDocs.mockResolvedValue({ empty: false, docs: [{ id: 'v1_s1', data: () => ({}) }] });

    await expect(deleteVerification('ver-id', OWNER_UID, fakeDb)).rejects.toThrow(
      /Elimina prima tutte le consegne/i,
    );
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockTxSet).not.toHaveBeenCalled();
    // The preflight query is targeted (ownerUid + verificationId), never a full scan.
    expect(mockWhere).toHaveBeenCalledWith('ownerUid', '==', OWNER_UID);
    expect(mockWhere).toHaveBeenCalledWith('verificationId', '==', 'ver-id');
  });
});
