import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockBatchUpdate = vi.fn();
const mockBatchSet = vi.fn();
const mockBatchDelete = vi.fn();
const mockBatchCommit = vi.fn();
const mockWriteBatch = vi.fn();
const mockWhere = vi.fn((...args: unknown[]) => ({ __where: args }));
const mockServerTimestamp = vi.fn(() => ({ _type: 'serverTimestamp' }));

function isCollectionRef(value: unknown): value is { __path: string } {
  return typeof value === 'object' && value !== null && '__path' in value;
}

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
  doc: (...args: unknown[]) => {
    const [first, ...rest] = args;
    if (isCollectionRef(first)) {
      if (rest.length === 0) return { __path: `${first.__path}/auto-id` };
      return { __path: `${first.__path}/${rest.join('/')}` };
    }
    return { __path: rest.filter((s): s is string => typeof s === 'string').join('/') };
  },
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  query: (collRef: unknown) => collRef,
  where: (...args: unknown[]) => mockWhere(...args),
  increment: (n: number) => ({ __increment: n }),
  writeBatch: (...args: unknown[]) => mockWriteBatch(...args),
  serverTimestamp: () => mockServerTimestamp(),
}));

const mockReadText = vi.fn();
const mockWriteText = vi.fn();
const mockDeleteFile = vi.fn();

// SGW-01: il service usa il gateway adapter, non piu firebase/storage diretto.
vi.mock('../../gateway/repositoryGatewayClient.js', () => ({
  readText: (...args: unknown[]) => mockReadText(...args),
  writeText: (...args: unknown[]) => mockWriteText(...args),
  deleteFile: (...args: unknown[]) => mockDeleteFile(...args),
}));

import {
  createLesson,
  createUda,
  deleteLesson,
  deleteUda,
  getLessonDeleteBlockers,
  getUdaDeleteBlockers,
  reorderLesson,
  reorderUda,
  RepositoryDeleteBlockedError,
  updateProgramMetadata,
  updateLessonMarkdownBody,
  updateLessonMetadata,
  updateUdaMetadata,
} from '../repositoryEditorService.js';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import type { LessonDoc, UdaDoc, VerificationDoc } from '../../../../types/firestore.js';

const fakeDb = {} as Firestore;
const fakeStorage = {} as FirebaseStorage;
const OWNER_UID = 'owner-uid';

// readText now returns a string, so `text` is an identity helper kept to
// minimise churn at the call sites that previously wrapped bytes.
function text(content: string): string {
  return content;
}

function writtenContent(): string {
  const call = mockWriteText.mock.calls[0] as [string, string];
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
  mockUpdateDoc.mockResolvedValue(undefined);
  mockWriteText.mockResolvedValue(undefined);
  mockDeleteFile.mockResolvedValue(undefined);
  mockGetDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
  mockGetDocs.mockResolvedValue({ docs: [] });
  mockBatchCommit.mockResolvedValue(undefined);
  // Keep legacy assertions readable while the production path now records
  // the same writes inside one atomic batch.
  mockBatchSet.mockImplementation((...args: unknown[]) => {
    void mockSetDoc(...args);
  });
  mockBatchUpdate.mockImplementation((...args: unknown[]) => {
    void mockUpdateDoc(...args);
  });
  mockWriteBatch.mockReturnValue({
    update: mockBatchUpdate,
    set: mockBatchSet,
    delete: mockBatchDelete,
    commit: mockBatchCommit,
  });
});

describe('updateProgramMetadata', () => {
  const fields = {
    annoScolastico: ' 2026/2027 ',
    docente: ' Mario Rossi ',
    materia: 'Informatica',
    classe: '3A',
    descrizione: 'Corso aggiornato',
  };

  function existingImport() {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ ownerUid: OWNER_UID, programId: 'prog-1', importId: 'imp-1' }),
    });
  }

  it('preserves body and unrelated front matter, then commits projection and audit once', async () => {
    existingImport();
    mockReadText.mockResolvedValueOnce(
      text('---\ntitolo: Corso legacy\ncustom: valore\n---\n\nCorpo da preservare.'),
    );

    const saved = await updateProgramMetadata({
      programId: 'prog-1',
      importId: 'imp-1',
      fields,
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(saved.annoScolastico).toBe('2026/2027');
    expect(saved.docente).toBe('Mario Rossi');
    expect(writtenContent()).toContain('titolo: Corso legacy');
    expect(writtenContent()).toContain('custom: valore');
    expect(writtenContent()).toContain('descrizione: Corso aggiornato');
    expect(writtenContent()).toContain('Corpo da preservare.');
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { __path: 'programs/prog-1/imports/imp-1' },
      { programmaMeta: saved },
    );
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { __path: 'programs/prog-1' },
      { updatedAt: { _type: 'serverTimestamp' } },
    );
    expect(mockBatchSet).toHaveBeenCalledWith(
      { __path: 'auditEvents/auto-id' },
      expect.objectContaining({ action: 'program.metadataUpdated', targetId: 'prog-1' }),
    );
    expect(mockBatchCommit).toHaveBeenCalledOnce();
  });

  it('creates programma.md when the import exists but the Storage object is absent', async () => {
    existingImport();
    mockReadText.mockRejectedValueOnce({ code: 'file_not_found' });

    await updateProgramMetadata({
      programId: 'prog-1',
      importId: 'imp-1',
      fields,
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(mockWriteText.mock.calls[0]?.[0]).toEqual(
      'repository/owner-uid/imports/imp-1/programma.md',
    );
    expect(writtenContent()).toContain('anno_scolastico: 2026/2027');
    expect(writtenContent()).toContain('descrizione: Corso aggiornato');
  });

  it('does not open a Firestore batch when Storage cannot be read', async () => {
    existingImport();
    mockReadText.mockRejectedValueOnce(new Error('network down'));

    await expect(
      updateProgramMetadata({
        programId: 'prog-1',
        importId: 'imp-1',
        fields,
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Impossibile leggere il file programma.md da Storage.');
    expect(mockWriteText).not.toHaveBeenCalled();
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it('reports a distinct partial-sync error when Firestore fails after Storage', async () => {
    existingImport();
    mockReadText.mockResolvedValueOnce(text('Corpo.'));
    mockBatchCommit.mockRejectedValueOnce(new Error('firestore down'));

    await expect(
      updateProgramMetadata({
        programId: 'prog-1',
        importId: 'imp-1',
        fields,
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('aggiornato su Storage ma i metadati non sono stati sincronizzati');
    expect(mockWriteText).toHaveBeenCalledOnce();
  });
});

describe('updateUdaMetadata', () => {
  const UDA_DOC: Partial<UdaDoc> = {
    ownerUid: OWNER_UID,
    dir: 'uda-01-reti',
    filename: 'uda-01-reti.md',
    storageBasePath: 'repository/owner-uid/imports/imp-1/uda-01-reti',
    order: 3,
  };

  it('throws when the UDA document does not exist, without touching Storage', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });

    await expect(
      updateUdaMetadata({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-01',
        fields: { descrizione: 'x', competenze: [], obiettivi: [] },
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('UDA non trovata.');
    expect(mockReadText).not.toHaveBeenCalled();
  });

  it('rewrites front matter preserving titolo and the body, then updates Firestore and audit', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => UDA_DOC });
    const currentContent = `---
titolo: "Reti"
descrizione: "Vecchia descrizione"
competenze:
  - "Vecchia competenza"
obiettivi:
  - "Vecchio obiettivo"
---

Corpo della UDA, invariato.`;
    mockReadText.mockResolvedValueOnce(text(currentContent));

    await updateUdaMetadata({
      programId: 'prog-1',
      importId: 'imp-1',
      udaId: 'uda-01',
      fields: {
        descrizione: 'Nuova descrizione',
        competenze: ['Nuova competenza'],
        obiettivi: ['Nuovo obiettivo'],
      },
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    const next = writtenContent();
    expect(next).toContain('titolo: Reti');
    expect(next).toContain('descrizione: Nuova descrizione');
    expect(next).toContain('Nuova competenza');
    expect(next).toContain('Nuovo obiettivo');
    expect(next).toContain('Corpo della UDA, invariato.');
    expect(next).not.toContain('Vecchia');

    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { __path: 'programs/prog-1/imports/imp-1/udas/uda-01' },
      {
        descrizione: 'Nuova descrizione',
        competenze: ['Nuova competenza'],
        obiettivi: ['Nuovo obiettivo'],
      },
    );
    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'auditEvents/auto-id' },
      expect.objectContaining({ action: 'uda.updated', targetId: 'uda-01', actorUid: OWNER_UID }),
    );
  });

  it('throws a Storage-specific error and never touches Firestore when the Storage write fails', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => UDA_DOC });
    mockReadText.mockRejectedValueOnce(new Error('network down'));

    await expect(
      updateUdaMetadata({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-01',
        fields: { descrizione: 'x', competenze: [], obiettivi: [] },
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Impossibile aggiornare il file della UDA su Storage.');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it('throws a distinct, Firestore-specific error when Storage succeeded but the metadata update fails', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => UDA_DOC });
    mockReadText.mockResolvedValueOnce(text('---\ntitolo: "Reti"\n---\n\nCorpo.'));
    mockBatchCommit.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(
      updateUdaMetadata({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-01',
        fields: { descrizione: 'x', competenze: [], obiettivi: [] },
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow(/aggiornato su Storage ma i metadati non sono stati salvati/);
    expect(mockWriteText).toHaveBeenCalled();
    expect(mockBatchCommit).toHaveBeenCalledOnce();
  });
});

describe('updateLessonMetadata', () => {
  const LESSON_DOC: Partial<LessonDoc> = {
    ownerUid: OWNER_UID,
    udaDir: 'uda-01-reti',
    filename: 'lezione-001-http.md',
    storageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001-http.md',
    order: 0,
    poolStatus: 'absent',
  };

  const FIELDS = {
    titolo: 'HTTP',
    sottotitolo: 'Richiesta e risposta',
    difficolta: 'base',
    concettiChiave: ['client', 'server'],
    obiettivi: ['Spiegare il protocollo'],
  };

  it('updates the technical lesson doc and the publicLessons projection when it exists', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => LESSON_DOC }) // lesson doc
      .mockResolvedValueOnce({ exists: () => true }); // publicLessons doc
    mockReadText.mockResolvedValueOnce(text('---\ntitolo: "Vecchio"\n---\n\nCorpo lezione.'));

    await updateLessonMetadata({
      programId: 'prog-1',
      importId: 'imp-1',
      lessonId: 'lesson-1',
      fields: FIELDS,
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    const next = writtenContent();
    expect(next).toContain('titolo: HTTP');
    expect(next).toContain('Corpo lezione.');

    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { __path: 'programs/prog-1/imports/imp-1/lessons/lesson-1' },
      FIELDS,
    );
    expect(mockUpdateDoc).toHaveBeenCalledWith({ __path: 'publicLessons/lesson-1' }, FIELDS);
    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'auditEvents/auto-id' },
      expect.objectContaining({ action: 'lesson.updated', targetId: 'lesson-1' }),
    );
  });

  it('skips the publicLessons update when no projection exists for this lesson', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => LESSON_DOC })
      .mockResolvedValueOnce({ exists: () => false });
    mockReadText.mockResolvedValueOnce(text('Corpo senza front matter.'));

    await updateLessonMetadata({
      programId: 'prog-1',
      importId: 'imp-1',
      lessonId: 'lesson-1',
      fields: FIELDS,
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { __path: 'programs/prog-1/imports/imp-1/lessons/lesson-1' },
      FIELDS,
    );
  });

  it('throws when the lesson document does not exist', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });

    await expect(
      updateLessonMetadata({
        programId: 'prog-1',
        importId: 'imp-1',
        lessonId: 'lesson-1',
        fields: FIELDS,
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Lezione non trovata.');
    expect(mockReadText).not.toHaveBeenCalled();
  });
});

describe('updateLessonMarkdownBody', () => {
  const LESSON_DOC: Partial<LessonDoc> = {
    ownerUid: OWNER_UID,
    udaDir: 'uda-01-reti',
    filename: 'lezione-001-http.md',
    storageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001-http.md',
    order: 0,
    poolStatus: 'absent',
  };

  it('throws when the lesson document does not exist, without touching Storage', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });

    await expect(
      updateLessonMarkdownBody({
        programId: 'prog-1',
        importId: 'imp-1',
        lessonId: 'lesson-1',
        body: 'Nuovo corpo.',
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Lezione non trovata.');
    expect(mockReadText).not.toHaveBeenCalled();
  });

  it('preserves existing front matter, replaces only the body, and resyncs Firestore + publicLessons', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => LESSON_DOC })
      .mockResolvedValueOnce({ exists: () => true });
    const currentContent = `---
titolo: "HTTP"
concetti_chiave:
  - client
  - server
---

Vecchio corpo della lezione.`;
    mockReadText.mockResolvedValueOnce(text(currentContent));

    await updateLessonMarkdownBody({
      programId: 'prog-1',
      importId: 'imp-1',
      lessonId: 'lesson-1',
      body: 'Nuovo corpo della lezione, riscritto dal docente.',
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    const next = writtenContent();
    expect(next).toContain('titolo: HTTP');
    expect(next).toContain('client');
    expect(next).toContain('server');
    expect(next).toContain('Nuovo corpo della lezione, riscritto dal docente.');
    expect(next).not.toContain('Vecchio corpo');

    const expectedPatch = {
      titolo: 'HTTP',
      sottotitolo: null,
      difficolta: null,
      concettiChiave: ['client', 'server'],
      obiettivi: [],
    };
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { __path: 'programs/prog-1/imports/imp-1/lessons/lesson-1' },
      expectedPatch,
    );
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { __path: 'publicLessons/lesson-1' },
      { ...expectedPatch, content: 'Nuovo corpo della lezione, riscritto dal docente.' },
    );
    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'auditEvents/auto-id' },
      expect.objectContaining({ action: 'lesson.updated', targetId: 'lesson-1' }),
    );
  });

  it('does not add a content field to the technical lesson doc, only to publicLessons', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => LESSON_DOC })
      .mockResolvedValueOnce({ exists: () => true });
    mockReadText.mockResolvedValueOnce(text('---\ntitolo: "HTTP"\n---\n\nVecchio corpo.'));

    await updateLessonMarkdownBody({
      programId: 'prog-1',
      importId: 'imp-1',
      lessonId: 'lesson-1',
      body: 'Corpo aggiornato.',
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    const lessonDocCall = mockUpdateDoc.mock.calls.find(
      (call) =>
        (call[0] as { __path: string }).__path === 'programs/prog-1/imports/imp-1/lessons/lesson-1',
    );
    expect(lessonDocCall?.[1]).not.toHaveProperty('content');
  });

  it('rejects a body exceeding the size limit before writing anything', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => LESSON_DOC });
    mockReadText.mockResolvedValueOnce(text('---\ntitolo: "HTTP"\n---\n\nVecchio corpo.'));

    await expect(
      updateLessonMarkdownBody({
        programId: 'prog-1',
        importId: 'imp-1',
        lessonId: 'lesson-1',
        body: 'a'.repeat(800_000),
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow(/supera il limite/);
    expect(mockWriteText).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('preserves unknown front matter keys when saving the body', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => LESSON_DOC })
      .mockResolvedValueOnce({ exists: () => true });
    const currentContent = `---
titolo: "HTTP"
fonte: "libro di testo"
concetti_chiave:
  - client
---

Vecchio corpo.`;
    mockReadText.mockResolvedValueOnce(text(currentContent));

    await updateLessonMarkdownBody({
      programId: 'prog-1',
      importId: 'imp-1',
      lessonId: 'lesson-1',
      body: 'Nuovo corpo.',
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    const next = writtenContent();
    expect(next).toContain('titolo: HTTP');
    expect(next).toContain('fonte: libro di testo');
    expect(next).toContain('client');
    expect(next).toContain('Nuovo corpo.');
    expect(next).not.toContain('Vecchio corpo');
  });

  it('keeps a lesson with no front matter free of one after saving the body', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => LESSON_DOC })
      .mockResolvedValueOnce({ exists: () => false });
    mockReadText.mockResolvedValueOnce(text('Corpo senza front matter.'));

    await updateLessonMarkdownBody({
      programId: 'prog-1',
      importId: 'imp-1',
      lessonId: 'lesson-1',
      body: 'Corpo aggiornato, ancora senza front matter.',
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    const next = writtenContent();
    expect(next).not.toContain('---');
    expect(next).toBe('Corpo aggiornato, ancora senza front matter.');
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
  });

  it('throws a Storage-specific error and never touches Firestore when the Storage write fails', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => LESSON_DOC });
    mockReadText.mockRejectedValueOnce(new Error('network down'));

    await expect(
      updateLessonMarkdownBody({
        programId: 'prog-1',
        importId: 'imp-1',
        lessonId: 'lesson-1',
        body: 'Nuovo corpo.',
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Impossibile aggiornare il file della lezione su Storage.');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it('throws a distinct error when Storage succeeds but the Firestore resync fails', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => LESSON_DOC });
    mockReadText.mockResolvedValueOnce(text('---\ntitolo: "HTTP"\n---\n\nCorpo.'));
    mockBatchCommit.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(
      updateLessonMarkdownBody({
        programId: 'prog-1',
        importId: 'imp-1',
        lessonId: 'lesson-1',
        body: 'Nuovo corpo.',
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow(/aggiornato su Storage ma i metadati non sono stati sincronizzati/);
    expect(mockWriteText).toHaveBeenCalled();
    expect(mockBatchCommit).toHaveBeenCalledOnce();
  });
});

describe('createLesson', () => {
  const BASE_FIELDS = {
    titolo: 'HTTP',
    sottotitolo: null,
    difficolta: null,
    concettiChiave: [],
    obiettivi: [],
    body: '',
  };

  it('throws without touching Storage or Firestore when the title is empty', async () => {
    await expect(
      createLesson({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-01',
        udaDir: 'uda-01-reti',
        ownerUid: OWNER_UID,
        fields: { ...BASE_FIELDS, titolo: '   ' },
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Il titolo della lezione è obbligatorio.');
    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(mockWriteText).not.toHaveBeenCalled();
  });

  it('numbers the first lesson of a UDA as 001 with order 0', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    const result = await createLesson({
      programId: 'prog-1',
      importId: 'imp-1',
      udaId: 'uda-01',
      udaDir: 'uda-01-reti',
      ownerUid: OWNER_UID,
      fields: { ...BASE_FIELDS, titolo: "Introduzione all'HTTP" },
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(result.filename).toBe('lezione-001-introduzione-all-http.md');
    expect(result.lessonId).toBe('uda-01_lezione-001-introduzione-all-http');

    const next = writtenContent();
    expect(next).toContain("titolo: Introduzione all'HTTP");

    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'programs/prog-1/imports/imp-1/lessons/uda-01_lezione-001-introduzione-all-http' },
      expect.objectContaining({
        udaDir: 'uda-01-reti',
        filename: 'lezione-001-introduzione-all-http.md',
        order: 0,
        poolStatus: 'absent',
        questionCount: 0,
        poolStorageRef: null,
        storageRef:
          'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001-introduzione-all-http.md',
      }),
    );
    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'publicLessons/uda-01_lezione-001-introduzione-all-http' },
      expect.objectContaining({
        programId: 'prog-1',
        udaId: 'uda-01',
        order: 0,
        titolo: "Introduzione all'HTTP",
        content: '',
      }),
    );
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { __path: 'programs/prog-1/imports/imp-1/udas/uda-01' },
      { lessonCount: { __increment: 1 } },
    );
    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'auditEvents/auto-id' },
      expect.objectContaining({ action: 'lesson.created', targetId: result.lessonId }),
    );
  });

  it('numbers past the highest existing lesson number and order in that UDA, ignoring other UDAs', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        { data: () => ({ udaDir: 'uda-01-reti', filename: 'lezione-002-tcp.md', order: 1 }) },
        { data: () => ({ udaDir: 'uda-01-reti', filename: 'lezione-005-udp.md', order: 4 }) },
      ],
    });

    const result = await createLesson({
      programId: 'prog-1',
      importId: 'imp-1',
      udaId: 'uda-01',
      udaDir: 'uda-01-reti',
      ownerUid: OWNER_UID,
      fields: { ...BASE_FIELDS, titolo: 'DNS' },
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(result.filename).toBe('lezione-006-dns.md');
    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'programs/prog-1/imports/imp-1/lessons/uda-01_lezione-006-dns' },
      expect.objectContaining({ order: 5 }),
    );
  });

  it('accepts an empty initial body and still writes a structurally valid file', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    await createLesson({
      programId: 'prog-1',
      importId: 'imp-1',
      udaId: 'uda-01',
      udaDir: 'uda-01-reti',
      ownerUid: OWNER_UID,
      fields: { ...BASE_FIELDS },
      db: fakeDb,
      storage: fakeStorage,
    });

    const next = writtenContent();
    expect(next).toBe('---\ntitolo: HTTP\n---');
  });

  it('sets publicLessons.content to the provided body', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    await createLesson({
      programId: 'prog-1',
      importId: 'imp-1',
      udaId: 'uda-01',
      udaDir: 'uda-01-reti',
      ownerUid: OWNER_UID,
      fields: { ...BASE_FIELDS, body: 'Corpo della nuova lezione.' },
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'publicLessons/uda-01_lezione-001-http' },
      expect.objectContaining({ content: 'Corpo della nuova lezione.' }),
    );
  });

  it('rejects a body exceeding the size limit before writing anything', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    await expect(
      createLesson({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-01',
        udaDir: 'uda-01-reti',
        ownerUid: OWNER_UID,
        fields: { ...BASE_FIELDS, body: 'a'.repeat(800_000) },
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow(/supera il limite/);
    expect(mockWriteText).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('throws a Storage-specific error and never touches Firestore when the Storage write fails', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    mockWriteText.mockRejectedValueOnce(new Error('network down'));

    await expect(
      createLesson({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-01',
        udaDir: 'uda-01-reti',
        ownerUid: OWNER_UID,
        fields: BASE_FIELDS,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Impossibile creare il file della lezione su Storage.');
    expect(mockSetDoc).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('throws a distinct error when Storage succeeds but the Firestore writes fail', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    mockBatchCommit.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(
      createLesson({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-01',
        udaDir: 'uda-01-reti',
        ownerUid: OWNER_UID,
        fields: BASE_FIELDS,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow(
      'Il file della lezione è stato creato su Storage ma non è stato possibile salvare i metadati su Firestore. Riprova.',
    );
    expect(mockWriteText).toHaveBeenCalled();
  });
});

describe('createUda', () => {
  const BASE_FIELDS = {
    titolo: 'Reti',
    descrizione: null,
    competenze: [],
    obiettivi: [],
  };

  it('throws without touching Storage or Firestore when the title is empty', async () => {
    await expect(
      createUda({
        programId: 'prog-1',
        importId: 'imp-1',
        ownerUid: OWNER_UID,
        fields: { ...BASE_FIELDS, titolo: '   ' },
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Il titolo della UDA è obbligatorio.');
    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(mockWriteText).not.toHaveBeenCalled();
  });

  it('numbers the first UDA of a program as 01 with order 0', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    const result = await createUda({
      programId: 'prog-1',
      importId: 'imp-1',
      ownerUid: OWNER_UID,
      fields: { ...BASE_FIELDS, titolo: 'Reti informatiche' },
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(result.dir).toBe('uda-01-reti-informatiche');
    expect(result.udaId).toBe('uda-01-reti-informatiche');

    const next = writtenContent();
    expect(next).toBe('---\ntitolo: Reti informatiche\n---');

    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'programs/prog-1/imports/imp-1/udas/uda-01-reti-informatiche' },
      expect.objectContaining({
        dir: 'uda-01-reti-informatiche',
        filename: 'uda-01-reti-informatiche.md',
        order: 0,
        lessonCount: 0,
        storageBasePath: 'repository/owner-uid/imports/imp-1/uda-01-reti-informatiche',
        titolo: 'Reti informatiche',
        descrizione: null,
        competenze: [],
        obiettivi: [],
      }),
    );
    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'auditEvents/auto-id' },
      expect.objectContaining({ action: 'uda.created', targetId: result.udaId }),
    );
  });

  it('numbers past the highest existing UDA number and order, ignoring gaps', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        { data: () => ({ dir: 'uda-02-reti', order: 1 }) },
        { data: () => ({ dir: 'uda-05-sicurezza', order: 4 }) },
      ],
    });

    const result = await createUda({
      programId: 'prog-1',
      importId: 'imp-1',
      ownerUid: OWNER_UID,
      fields: { ...BASE_FIELDS, titolo: 'Database' },
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(result.dir).toBe('uda-06-database');
    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'programs/prog-1/imports/imp-1/udas/uda-06-database' },
      expect.objectContaining({ order: 5 }),
    );
  });

  it('derives the next order from legacy UDA dirs when order is missing', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        { data: () => ({ dir: 'uda-01-intro', filename: 'uda-01-intro.md' }) },
        { data: () => ({ dir: 'uda-09-legacy', filename: 'uda-09-legacy.md' }) },
      ],
    });

    const result = await createUda({
      programId: 'prog-1',
      importId: 'imp-1',
      ownerUid: OWNER_UID,
      fields: { ...BASE_FIELDS, titolo: 'Finale' },
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(result).toMatchObject({ dir: 'uda-10-finale', order: 9 });
    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'programs/prog-1/imports/imp-1/udas/uda-10-finale' },
      expect.objectContaining({ order: 9 }),
    );
  });

  it('writes descrizione/competenze/obiettivi to both Storage front matter and Firestore', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    await createUda({
      programId: 'prog-1',
      importId: 'imp-1',
      ownerUid: OWNER_UID,
      fields: {
        titolo: 'Reti',
        descrizione: 'Introduzione alle reti',
        competenze: ['Comprendere il modello OSI'],
        obiettivi: ['Distinguere client e server'],
      },
      db: fakeDb,
      storage: fakeStorage,
    });

    const next = writtenContent();
    expect(next).toContain('titolo: Reti');
    expect(next).toContain('descrizione: Introduzione alle reti');
    expect(next).toContain('Comprendere il modello OSI');
    expect(next).toContain('Distinguere client e server');

    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'programs/prog-1/imports/imp-1/udas/uda-01-reti' },
      expect.objectContaining({
        descrizione: 'Introduzione alle reti',
        competenze: ['Comprendere il modello OSI'],
        obiettivi: ['Distinguere client e server'],
      }),
    );
  });

  it('throws a Storage-specific error and never touches Firestore when the Storage write fails', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    mockWriteText.mockRejectedValueOnce(new Error('network down'));

    await expect(
      createUda({
        programId: 'prog-1',
        importId: 'imp-1',
        ownerUid: OWNER_UID,
        fields: BASE_FIELDS,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Impossibile creare il file della UDA su Storage.');
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('throws a distinct error when Storage succeeds but the Firestore write fails', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    mockBatchCommit.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(
      createUda({
        programId: 'prog-1',
        importId: 'imp-1',
        ownerUid: OWNER_UID,
        fields: BASE_FIELDS,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow(
      'Il file della UDA è stato creato su Storage ma non è stato possibile salvare i metadati su Firestore. Riprova.',
    );
    expect(mockWriteText).toHaveBeenCalled();
  });
});

describe('reorderUda', () => {
  it('throws when the UDA does not exist', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });

    await expect(
      reorderUda({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-01',
        neighborUdaId: 'uda-02',
        ownerUid: OWNER_UID,
        db: fakeDb,
      }),
    ).rejects.toThrow('UDA non trovata.');
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it('throws when the neighbor UDA does not exist', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ dir: 'uda-01-reti' }) })
      .mockResolvedValueOnce({ exists: () => false });

    await expect(
      reorderUda({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-01',
        neighborUdaId: 'uda-02',
        ownerUid: OWNER_UID,
        db: fakeDb,
      }),
    ).rejects.toThrow('UDA vicina non trovata.');
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it('swaps explicit order values in a single batch and writes an audit event', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ dir: 'uda-02-reti', order: 1 }) })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ dir: 'uda-01-intro', order: 0 }),
      });

    const result = await reorderUda({
      programId: 'prog-1',
      importId: 'imp-1',
      udaId: 'uda-02',
      neighborUdaId: 'uda-01',
      ownerUid: OWNER_UID,
      db: fakeDb,
    });

    expect(result).toEqual({ order: 0, neighborOrder: 1 });
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { __path: 'programs/prog-1/imports/imp-1/udas/uda-02' },
      { order: 0 },
    );
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { __path: 'programs/prog-1/imports/imp-1/udas/uda-01' },
      { order: 1 },
    );
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'auditEvents/auto-id' },
      expect.objectContaining({ action: 'uda.reordered', targetId: 'uda-02' }),
    );
  });

  it('derives the swap from the uda-XX dir prefix when order is missing on both sides', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ dir: 'uda-02-reti' }) })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ dir: 'uda-01-intro' }) });

    const result = await reorderUda({
      programId: 'prog-1',
      importId: 'imp-1',
      udaId: 'uda-02',
      neighborUdaId: 'uda-01',
      ownerUid: OWNER_UID,
      db: fakeDb,
    });

    // uda-02 -> legacy order 1, uda-01 -> legacy order 0; swapped.
    expect(result).toEqual({ order: 0, neighborOrder: 1 });
  });

  it('throws a single clear error when the batch commit fails, never a Storage-specific one', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ dir: 'uda-02-reti', order: 1 }) })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ dir: 'uda-01-intro', order: 0 }),
      });
    mockBatchCommit.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(
      reorderUda({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-02',
        neighborUdaId: 'uda-01',
        ownerUid: OWNER_UID,
        db: fakeDb,
      }),
    ).rejects.toThrow('Impossibile salvare il nuovo ordine delle UDA. Riprova.');
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});

describe('reorderLesson', () => {
  it('throws when the lesson does not exist', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });

    await expect(
      reorderLesson({
        programId: 'prog-1',
        importId: 'imp-1',
        lessonId: 'lesson-1',
        neighborLessonId: 'lesson-2',
        ownerUid: OWNER_UID,
        db: fakeDb,
      }),
    ).rejects.toThrow('Lezione non trovata.');
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it('throws when the neighbor lesson does not exist', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ udaDir: 'uda-01-reti', filename: 'lezione-002-tcp.md' }),
      })
      .mockResolvedValueOnce({ exists: () => false });

    await expect(
      reorderLesson({
        programId: 'prog-1',
        importId: 'imp-1',
        lessonId: 'lesson-1',
        neighborLessonId: 'lesson-2',
        ownerUid: OWNER_UID,
        db: fakeDb,
      }),
    ).rejects.toThrow('Lezione vicina non trovata.');
  });

  it('rejects a swap between lessons of different UDAs', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ udaDir: 'uda-01-reti', filename: 'lezione-001-http.md', order: 0 }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ udaDir: 'uda-02-sicurezza', filename: 'lezione-001-intro.md', order: 0 }),
      });

    await expect(
      reorderLesson({
        programId: 'prog-1',
        importId: 'imp-1',
        lessonId: 'lesson-1',
        neighborLessonId: 'lesson-2',
        ownerUid: OWNER_UID,
        db: fakeDb,
      }),
    ).rejects.toThrow('Le lezioni non appartengono alla stessa UDA.');
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it('swaps order and updates publicLessons for both lessons when the projection exists', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ udaDir: 'uda-01-reti', filename: 'lezione-002-tcp.md', order: 1 }),
      }) // lesson
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ udaDir: 'uda-01-reti', filename: 'lezione-001-http.md', order: 0 }),
      }) // neighbor
      .mockResolvedValueOnce({ exists: () => true }) // publicLessons/lesson-1
      .mockResolvedValueOnce({ exists: () => true }); // publicLessons/lesson-2

    const result = await reorderLesson({
      programId: 'prog-1',
      importId: 'imp-1',
      lessonId: 'lesson-1',
      neighborLessonId: 'lesson-2',
      ownerUid: OWNER_UID,
      db: fakeDb,
    });

    expect(result).toEqual({ order: 0, neighborOrder: 1 });
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { __path: 'programs/prog-1/imports/imp-1/lessons/lesson-1' },
      { order: 0 },
    );
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { __path: 'programs/prog-1/imports/imp-1/lessons/lesson-2' },
      { order: 1 },
    );
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { __path: 'publicLessons/lesson-1' },
      { order: 0 },
    );
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { __path: 'publicLessons/lesson-2' },
      { order: 1 },
    );
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'auditEvents/auto-id' },
      expect.objectContaining({ action: 'lesson.reordered', targetId: 'lesson-1' }),
    );
  });

  it('skips the publicLessons update when no projection exists for either lesson', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ udaDir: 'uda-01-reti', filename: 'lezione-002-tcp.md', order: 1 }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ udaDir: 'uda-01-reti', filename: 'lezione-001-http.md', order: 0 }),
      })
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => false });

    await reorderLesson({
      programId: 'prog-1',
      importId: 'imp-1',
      lessonId: 'lesson-1',
      neighborLessonId: 'lesson-2',
      ownerUid: OWNER_UID,
      db: fakeDb,
    });

    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    expect(mockBatchUpdate).not.toHaveBeenCalledWith(
      { __path: 'publicLessons/lesson-1' },
      expect.anything(),
    );
  });

  it('derives the swap from the lezione-XXX filename prefix when order is missing on both sides', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ udaDir: 'uda-01-reti', filename: 'lezione-002-tcp.md' }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ udaDir: 'uda-01-reti', filename: 'lezione-001-http.md' }),
      })
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => false });

    const result = await reorderLesson({
      programId: 'prog-1',
      importId: 'imp-1',
      lessonId: 'lesson-1',
      neighborLessonId: 'lesson-2',
      ownerUid: OWNER_UID,
      db: fakeDb,
    });

    // lezione-002 -> legacy order 1, lezione-001 -> legacy order 0; swapped.
    expect(result).toEqual({ order: 0, neighborOrder: 1 });
  });

  it('derives the swap from lezione-XXX.md filenames without a slug', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ udaDir: 'uda-01-reti', filename: 'lezione-002.md' }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ udaDir: 'uda-01-reti', filename: 'lezione-003.md' }),
      })
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => false });

    const result = await reorderLesson({
      programId: 'prog-1',
      importId: 'imp-1',
      lessonId: 'lesson-2',
      neighborLessonId: 'lesson-3',
      ownerUid: OWNER_UID,
      db: fakeDb,
    });

    expect(result).toEqual({ order: 2, neighborOrder: 1 });
  });

  it('throws a single clear error when the batch commit fails', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ udaDir: 'uda-01-reti', filename: 'lezione-002-tcp.md', order: 1 }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ udaDir: 'uda-01-reti', filename: 'lezione-001-http.md', order: 0 }),
      })
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => false });
    mockBatchCommit.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(
      reorderLesson({
        programId: 'prog-1',
        importId: 'imp-1',
        lessonId: 'lesson-1',
        neighborLessonId: 'lesson-2',
        ownerUid: OWNER_UID,
        db: fakeDb,
      }),
    ).rejects.toThrow('Impossibile salvare il nuovo ordine delle lezioni. Riprova.');
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});

// ─── Protected deletion (RE-05) ────────────────────────────────────────────

function verificationDoc(
  id: string,
  overrides: Partial<VerificationDoc['config']> = {},
): { id: string; data: () => VerificationDoc } {
  return {
    id,
    data: () =>
      ({
        ownerUid: OWNER_UID,
        status: 'draft',
        config: {
          title: `Verifica ${id}`,
          classId: null,
          programId: 'prog-1',
          importId: 'imp-1',
          questionRefs: [
            {
              questionIndexEntryId: `${id}-q1`,
              questionLocalId: 'q1',
              udaDir: 'uda-01-reti',
              lessonFilename: 'lezione-001-http.md',
              poolStorageRef:
                'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001-http.pool.md',
              tipo: 'aperta',
              difficolta: 1,
              peso: 1,
              maxPoints: 1,
            },
          ],
          questionsPerStudent: null,
          ...overrides,
        },
        teacherSnapshot: null,
        createdAt: null,
        updatedAt: null,
        activatedAt: null,
        closedAt: null,
      }) as unknown as VerificationDoc,
  };
}

describe('getUdaDeleteBlockers / getLessonDeleteBlockers', () => {
  it('maps verification documents into blockers for a matching UDA', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [verificationDoc('v1')] });

    const blockers = await getUdaDeleteBlockers(
      OWNER_UID,
      'prog-1',
      'imp-1',
      'uda-01-reti',
      fakeDb,
    );

    expect(blockers).toEqual([{ verificationId: 'v1', title: 'Verifica v1', status: 'draft' }]);
  });

  it('returns no blockers for a UDA no verification references', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [verificationDoc('v1')] });

    const blockers = await getUdaDeleteBlockers(
      OWNER_UID,
      'prog-1',
      'imp-1',
      'uda-02-sicurezza',
      fakeDb,
    );

    expect(blockers).toEqual([]);
  });

  it('maps verification documents into blockers for a matching lesson only', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [verificationDoc('v1')] });

    const blockers = await getLessonDeleteBlockers(
      OWNER_UID,
      'prog-1',
      'imp-1',
      'uda-01-reti',
      'lezione-002-tcp.md',
      fakeDb,
    );

    expect(blockers).toEqual([]);
  });

  it('narrows the guard query to config.programId + config.importId, not an owner-wide scan (PERF-SEC-01B-3)', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    await getUdaDeleteBlockers(OWNER_UID, 'prog-1', 'imp-1', 'uda-01-reti', fakeDb);

    expect(mockWhere).toHaveBeenCalledWith('config.programId', '==', 'prog-1');
    expect(mockWhere).toHaveBeenCalledWith('config.importId', '==', 'imp-1');
    expect(mockWhere).not.toHaveBeenCalledWith('ownerUid', '==', OWNER_UID);
  });
});

describe('deleteLesson', () => {
  // filename matches verificationDoc()'s default questionRef so the
  // "blocked" test below actually triggers the guard.
  const LESSON_DOC: Partial<LessonDoc> = {
    udaDir: 'uda-01-reti',
    filename: 'lezione-001-http.md',
    storageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001-http.md',
    poolStorageRef: null,
    order: 1,
  };

  it('throws when the lesson does not exist, without checking blockers', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });

    await expect(
      deleteLesson({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-01',
        lessonId: 'lesson-1',
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Lezione non trovata.');
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('blocks deletion and touches neither Storage nor Firestore when a verification references the lesson', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => LESSON_DOC });
    mockGetDocs.mockResolvedValueOnce({ docs: [verificationDoc('v1')] }); // verifications

    const error = await deleteLesson({
      programId: 'prog-1',
      importId: 'imp-1',
      udaId: 'uda-01',
      lessonId: 'lesson-1',
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RepositoryDeleteBlockedError);
    expect((error as InstanceType<typeof RepositoryDeleteBlockedError>).blockers).toEqual([
      { verificationId: 'v1', title: 'Verifica v1', status: 'draft' },
    ]);
    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('deletes Storage files, Firestore docs, decrements lessonCount and writes an audit event when free', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ ...LESSON_DOC, poolStorageRef: 'repository/.../lezione-002-tcp.pool.md' }),
    });
    mockGetDocs
      .mockResolvedValueOnce({ docs: [] }) // verifications — none blocking
      .mockResolvedValueOnce({ docs: [{ ref: { __path: 'questionIndex/q1' } }] }); // questionIndex

    await deleteLesson({
      programId: 'prog-1',
      importId: 'imp-1',
      udaId: 'uda-01',
      lessonId: 'lesson-1',
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(mockDeleteFile).toHaveBeenCalledWith(
      'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001-http.md',
    );
    expect(mockDeleteFile).toHaveBeenCalledWith('repository/.../lezione-002-tcp.pool.md');
    expect(mockBatchDelete).toHaveBeenCalledWith({
      __path: 'programs/prog-1/imports/imp-1/lessons/lesson-1',
    });
    expect(mockBatchDelete).toHaveBeenCalledWith({ __path: 'publicLessons/lesson-1' });
    expect(mockBatchDelete).toHaveBeenCalledWith({ __path: 'questionIndex/q1' });
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { __path: 'programs/prog-1/imports/imp-1/udas/uda-01' },
      { lessonCount: { __increment: -1 } },
    );
    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'auditEvents/auto-id' },
      expect.objectContaining({ action: 'lesson.deleted', targetId: 'lesson-1' }),
    );
  });

  it('tolerates a Storage file that is already gone (gateway delete is idempotent)', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => LESSON_DOC });
    mockGetDocs.mockResolvedValueOnce({ docs: [] }).mockResolvedValueOnce({ docs: [] });
    // The gateway resolves even when the file is already absent (deleted:false).
    mockDeleteFile.mockResolvedValueOnce(undefined);

    await expect(
      deleteLesson({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-01',
        lessonId: 'lesson-1',
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).resolves.toBeUndefined();
  });

  it('throws a Storage-specific error and never touches Firestore when a real Storage failure occurs', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => LESSON_DOC });
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    mockDeleteFile.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(
      deleteLesson({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-01',
        lessonId: 'lesson-1',
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Impossibile eliminare il file della lezione su Storage.');
    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('throws a distinct error when Storage succeeded but the Firestore cleanup failed', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => LESSON_DOC });
    mockGetDocs.mockResolvedValueOnce({ docs: [] }).mockResolvedValueOnce({ docs: [] });
    mockBatchCommit.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(
      deleteLesson({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-01',
        lessonId: 'lesson-1',
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow(/eliminato da Storage ma non è stato possibile rimuovere/);
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});

describe('deleteUda', () => {
  const UDA_DOC: Partial<UdaDoc> = {
    dir: 'uda-01-reti',
    filename: 'uda-01-reti.md',
    storageBasePath: 'repository/owner-uid/imports/imp-1/uda-01-reti',
    order: 0,
  };

  const LESSON_1 = {
    udaDir: 'uda-01-reti',
    filename: 'lezione-001-http.md',
    storageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001-http.md',
    poolStorageRef: null,
  };
  const LESSON_2 = {
    udaDir: 'uda-01-reti',
    filename: 'lezione-002-tcp.md',
    storageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-002-tcp.md',
    poolStorageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-002-tcp.pool.md',
  };

  it('throws when the UDA does not exist, without checking blockers', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });

    await expect(
      deleteUda({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-01',
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('UDA non trovata.');
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('blocks deletion and touches neither Storage nor Firestore when a verification references any lesson inside', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => UDA_DOC });
    mockGetDocs.mockResolvedValueOnce({ docs: [verificationDoc('v1')] }); // verifications

    const error = await deleteUda({
      programId: 'prog-1',
      importId: 'imp-1',
      udaId: 'uda-01',
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RepositoryDeleteBlockedError);
    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it('deletes every lesson, the UDA file/doc, questionIndex entries and writes an audit event when free', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => UDA_DOC });
    mockGetDocs
      .mockResolvedValueOnce({ docs: [] }) // verifications — none blocking
      .mockResolvedValueOnce({
        docs: [
          { id: 'lesson-1', ref: { __path: 'lessons/lesson-1' }, data: () => LESSON_1 },
          { id: 'lesson-2', ref: { __path: 'lessons/lesson-2' }, data: () => LESSON_2 },
        ],
      }) // lessons
      .mockResolvedValueOnce({ docs: [{ ref: { __path: 'questionIndex/q1' } }] }); // questionIndex

    await deleteUda({
      programId: 'prog-1',
      importId: 'imp-1',
      udaId: 'uda-01',
      ownerUid: OWNER_UID,
      db: fakeDb,
      storage: fakeStorage,
    });

    expect(mockDeleteFile).toHaveBeenCalledWith(
      'repository/owner-uid/imports/imp-1/uda-01-reti/uda-01-reti.md',
    );
    expect(mockDeleteFile).toHaveBeenCalledWith(LESSON_1.storageRef);
    expect(mockDeleteFile).toHaveBeenCalledWith(LESSON_2.storageRef);
    expect(mockDeleteFile).toHaveBeenCalledWith(LESSON_2.poolStorageRef);
    expect(mockBatchDelete).toHaveBeenCalledWith({ __path: 'lessons/lesson-1' });
    expect(mockBatchDelete).toHaveBeenCalledWith({ __path: 'lessons/lesson-2' });
    expect(mockBatchDelete).toHaveBeenCalledWith({ __path: 'questionIndex/q1' });
    expect(mockBatchDelete).toHaveBeenCalledWith({ __path: 'publicLessons/lesson-1' });
    expect(mockBatchDelete).toHaveBeenCalledWith({ __path: 'publicLessons/lesson-2' });
    expect(mockBatchDelete).toHaveBeenCalledWith({
      __path: 'programs/prog-1/imports/imp-1/udas/uda-01',
    });
    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'auditEvents/auto-id' },
      expect.objectContaining({ action: 'uda.deleted', targetId: 'uda-01' }),
    );
  });

  it('throws a Storage-specific error and never touches Firestore when a real Storage failure occurs', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => UDA_DOC });
    mockGetDocs
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] });
    mockDeleteFile.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(
      deleteUda({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-01',
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow('Impossibile eliminare i file della UDA su Storage.');
    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('throws a distinct error when Storage succeeded but the Firestore cleanup failed', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => UDA_DOC });
    mockGetDocs
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] });
    mockBatchCommit.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(
      deleteUda({
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-01',
        ownerUid: OWNER_UID,
        db: fakeDb,
        storage: fakeStorage,
      }),
    ).rejects.toThrow(/eliminati da Storage ma non è stato possibile rimuovere/);
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});
