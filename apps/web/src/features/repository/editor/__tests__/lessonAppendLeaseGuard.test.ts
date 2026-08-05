import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * STRUCTURE-IMPORT-02B — nessuna mutazione manuale può saltare il lease.
 *
 * Il rischio concreto non è che la guardia sia sbagliata, ma che qualcuno la
 * aggiri: un parametro opzionale, un percorso alternativo, una nuova mutazione
 * che dimentica di chiamarla. Qui si verificano entrambe le cose — che ogni
 * mutazione la interroghi a runtime, e che la firma non torni facoltativa.
 */

vi.mock('../../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
  doc: (...args: unknown[]) => ({ __path: args.filter((s) => typeof s === 'string').join('/') }),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  query: (collRef: unknown) => collRef,
  where: (...args: unknown[]) => ({ __where: args }),
  increment: (n: number) => ({ __increment: n }),
  writeBatch: () => ({ set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn() }),
  serverTimestamp: () => ({ _type: 'serverTimestamp' }),
}));

vi.mock('../../gateway/repositoryGatewayClient.js', () => ({
  readText: vi.fn(async () => ''),
  writeText: vi.fn(async () => undefined),
  deleteFile: vi.fn(async () => undefined),
}));

const mockAssertLessonLease = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../../structureImportRuntime/lessonAppendLease.js', () => ({
  assertNoActiveLessonAppendLease: (...args: unknown[]) => mockAssertLessonLease(...args),
  LESSON_APPEND_LEASE_BUSY_MESSAGE: 'Importazione di lezioni in corso su questa UDA.',
}));

const BUSY = 'Importazione di lezioni in corso su questa UDA.';

vi.mock('../../importUda/udaImportLease.js', () => ({
  assertNoActiveUdaAppendLease: vi.fn(async () => undefined),
  UDA_APPEND_LEASE_BUSY_MESSAGE: 'busy',
}));

import {
  createLesson,
  deleteLesson,
  deleteUda,
  reorderLesson,
} from '../repositoryEditorService.js';

const db = {} as never;
const storage = {} as never;

function snapshot(data: Record<string, unknown> | null) {
  return { exists: () => data !== null, data: () => data };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAssertLessonLease.mockImplementation(async () => undefined);
  mockGetDocs.mockResolvedValue({ docs: [] });
});

describe('ogni mutazione interroga la guardia con la UDA giusta', () => {
  it('createLesson', async () => {
    await createLesson({
      programId: 'p1',
      importId: 'i1',
      udaId: 'uda-01-reti',
      udaDir: 'uda-01-reti',
      ownerUid: 'o1',
      fields: {
        titolo: 'T',
        sottotitolo: null,
        difficolta: null,
        concettiChiave: [],
        obiettivi: [],
        body: '',
      },
      db,
      storage,
    }).catch(() => undefined);
    expect(mockAssertLessonLease).toHaveBeenCalledWith('p1', 'i1', 'uda-01-reti', db);
  });

  it('reorderLesson', async () => {
    mockGetDoc.mockResolvedValue(
      snapshot({ udaDir: 'uda-01-reti', filename: 'lezione-001-a.md', order: 0 }),
    );
    await reorderLesson({
      programId: 'p1',
      importId: 'i1',
      lessonId: 'l1',
      neighborLessonId: 'l2',
      ownerUid: 'o1',
      udaId: 'uda-01-reti',
      db,
    }).catch(() => undefined);
    expect(mockAssertLessonLease).toHaveBeenCalledWith('p1', 'i1', 'uda-01-reti', db);
  });

  it('deleteLesson', async () => {
    mockGetDoc.mockResolvedValue(
      snapshot({ udaDir: 'uda-01-reti', filename: 'lezione-001-a.md', storageRef: 'r' }),
    );
    await deleteLesson({
      programId: 'p1',
      importId: 'i1',
      udaId: 'uda-01-reti',
      lessonId: 'l1',
      ownerUid: 'o1',
      db,
      storage,
    }).catch(() => undefined);
    expect(mockAssertLessonLease).toHaveBeenCalledWith('p1', 'i1', 'uda-01-reti', db);
  });

  it('deleteUda: eliminare la destinazione è bloccato come le sue lezioni', async () => {
    mockGetDoc.mockResolvedValue(
      snapshot({ dir: 'uda-01-reti', filename: 'x.md', storageBasePath: 'b' }),
    );
    await deleteUda({
      programId: 'p1',
      importId: 'i1',
      udaId: 'uda-01-reti',
      ownerUid: 'o1',
      db,
      storage,
    }).catch(() => undefined);
    expect(mockAssertLessonLease).toHaveBeenCalledWith('p1', 'i1', 'uda-01-reti', db);
  });
});

describe('un lease vivo blocca davvero la mutazione', () => {
  beforeEach(() => {
    mockAssertLessonLease.mockImplementation(async () => {
      throw new Error(BUSY);
    });
  });

  it('createLesson si ferma prima di scrivere', async () => {
    await expect(
      createLesson({
        programId: 'p1',
        importId: 'i1',
        udaId: 'uda-01-reti',
        udaDir: 'uda-01-reti',
        ownerUid: 'o1',
        fields: {
          titolo: 'T',
          sottotitolo: null,
          difficolta: null,
          concettiChiave: [],
          obiettivi: [],
          body: '',
        },
        db,
        storage,
      }),
    ).rejects.toThrow(BUSY);
    // Nemmeno la lettura delle lezioni esistenti è stata eseguita.
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('reorderLesson si ferma prima di riordinare', async () => {
    mockGetDoc.mockResolvedValue(
      snapshot({ udaDir: 'uda-01-reti', filename: 'lezione-001-a.md', order: 0 }),
    );
    await expect(
      reorderLesson({
        programId: 'p1',
        importId: 'i1',
        lessonId: 'l1',
        neighborLessonId: 'l2',
        ownerUid: 'o1',
        udaId: 'uda-01-reti',
        db,
      }),
    ).rejects.toThrow(BUSY);
  });

  it('deleteLesson e deleteUda si fermano', async () => {
    mockGetDoc.mockResolvedValue(
      snapshot({
        udaDir: 'uda-01-reti',
        dir: 'uda-01-reti',
        filename: 'lezione-001-a.md',
        storageRef: 'r',
        storageBasePath: 'b',
      }),
    );
    await expect(
      deleteLesson({
        programId: 'p1',
        importId: 'i1',
        udaId: 'uda-01-reti',
        lessonId: 'l1',
        ownerUid: 'o1',
        db,
        storage,
      }),
    ).rejects.toThrow(BUSY);
    await expect(
      deleteUda({
        programId: 'p1',
        importId: 'i1',
        udaId: 'uda-01-reti',
        ownerUid: 'o1',
        db,
        storage,
      }),
    ).rejects.toThrow(BUSY);
  });
});

describe('firme: nessun percorso alternativo', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const service = readFileSync(resolve(__dirname, '../repositoryEditorService.ts'), 'utf8');

  it('`udaId` non è opzionale in nessuna mutazione di lezione', () => {
    // Un `udaId?: string` permetterebbe a un chiamante di saltare la guardia.
    expect(service).not.toMatch(/udaId\?\s*:/);
  });

  it('la guardia non è mai chiamata sotto condizione', () => {
    expect(service).not.toMatch(/if \([^)]*\)\s*await assertNoActiveLessonAppendLease/);
    // Quattro punti: createLesson, reorderLesson, deleteLesson, deleteUda.
    expect(service.match(/await assertNoActiveLessonAppendLease\(/g) ?? []).toHaveLength(4);
  });

  it('ogni mutazione che tocca le lezioni di una UDA la interroga', () => {
    for (const fn of ['createLesson', 'reorderLesson', 'deleteLesson', 'deleteUda']) {
      const start = service.indexOf(`export async function ${fn}(`);
      expect(start).toBeGreaterThan(-1);
      const body = service.slice(start, start + 3000);
      expect(body).toContain('assertNoActiveLessonAppendLease');
    }
  });
});
