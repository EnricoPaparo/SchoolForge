import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

const mockGetDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockServerTimestamp = vi.fn(() => ({ _type: 'serverTimestamp' }));

function isCollectionRef(value: unknown): value is { __path: string } {
  return typeof value === 'object' && value !== null && '__path' in value;
}

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
  doc: (...args: unknown[]) => {
    const [first, ...rest] = args;
    if (isCollectionRef(first) && rest.length === 0) {
      return { __path: `${first.__path}/auto-id` };
    }
    return { __path: rest.filter((s): s is string => typeof s === 'string').join('/') };
  },
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  serverTimestamp: () => mockServerTimestamp(),
}));

const mockGetBytes = vi.fn();
const mockUploadBytes = vi.fn();

vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => ({ __storagePath: path }),
  getBytes: (...args: unknown[]) => mockGetBytes(...args),
  uploadBytes: (...args: unknown[]) => mockUploadBytes(...args),
}));

import {
  updateLessonMarkdownBody,
  updateLessonMetadata,
  updateUdaMetadata,
} from '../repositoryEditorService.js';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import type { LessonDoc, UdaDoc } from '../../../../types/firestore.js';

const fakeDb = {} as Firestore;
const fakeStorage = {} as FirebaseStorage;
const OWNER_UID = 'owner-uid';

function encode(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

function writtenContent(): string {
  const call = mockUploadBytes.mock.calls[0] as [unknown, Uint8Array];
  return new TextDecoder().decode(call[1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
  mockUpdateDoc.mockResolvedValue(undefined);
  mockUploadBytes.mockResolvedValue(undefined);
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
    expect(mockGetBytes).not.toHaveBeenCalled();
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
    mockGetBytes.mockResolvedValueOnce(encode(currentContent));

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
    mockGetBytes.mockRejectedValueOnce(new Error('network down'));

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
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('throws a distinct, Firestore-specific error when Storage succeeded but the metadata update fails', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => UDA_DOC });
    mockGetBytes.mockResolvedValueOnce(encode('---\ntitolo: "Reti"\n---\n\nCorpo.'));
    mockUpdateDoc.mockRejectedValueOnce(new Error('permission-denied'));

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
    expect(mockUploadBytes).toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
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
    mockGetBytes.mockResolvedValueOnce(encode('---\ntitolo: "Vecchio"\n---\n\nCorpo lezione.'));

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
    mockGetBytes.mockResolvedValueOnce(encode('Corpo senza front matter.'));

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
    expect(mockGetBytes).not.toHaveBeenCalled();
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
    expect(mockGetBytes).not.toHaveBeenCalled();
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
    mockGetBytes.mockResolvedValueOnce(encode(currentContent));

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
    expect(mockUpdateDoc).toHaveBeenCalledWith({ __path: 'publicLessons/lesson-1' }, expectedPatch);
    expect(mockSetDoc).toHaveBeenCalledWith(
      { __path: 'auditEvents/auto-id' },
      expect.objectContaining({ action: 'lesson.updated', targetId: 'lesson-1' }),
    );
  });

  it('keeps a lesson with no front matter free of one after saving the body', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => LESSON_DOC })
      .mockResolvedValueOnce({ exists: () => false });
    mockGetBytes.mockResolvedValueOnce(encode('Corpo senza front matter.'));

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
    mockGetBytes.mockRejectedValueOnce(new Error('network down'));

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
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('throws a distinct error when Storage succeeds but the Firestore resync fails', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => LESSON_DOC });
    mockGetBytes.mockResolvedValueOnce(encode('---\ntitolo: "HTTP"\n---\n\nCorpo.'));
    mockUpdateDoc.mockRejectedValueOnce(new Error('permission-denied'));

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
    expect(mockUploadBytes).toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});
