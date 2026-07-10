import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock firebase/storage
vi.mock('firebase/storage', () => ({
  getBytes: vi.fn(),
  ref: vi.fn(),
}));

// Mock programsService
const mockListUdas = vi.fn();
const mockListLessons = vi.fn();
vi.mock('../../repository/programs/programsService.js', () => ({
  listUdas: (...args: unknown[]) => mockListUdas(...args),
  listLessons: (...args: unknown[]) => mockListLessons(...args),
}));

import { getBytes, ref } from 'firebase/storage';
import type JSZip from 'jszip';
import { buildExportZip, exportZip } from '../exportZip.js';
import { readZipFile } from '../../repository/import/readZipFile.js';
import { validateImport } from '../../repository/validation/validateImport.js';
import { buildImportPayload } from '../../repository/import/buildImportPayload.js';
import type { ProgramItem } from '../../repository/programs/programsService.js';
import type { FirebaseStorage } from 'firebase/storage';
import type { Firestore } from 'firebase/firestore';

const mockGetBytes = getBytes as ReturnType<typeof vi.fn>;
const mockRef = ref as ReturnType<typeof vi.fn>;
const mockStorage = {} as FirebaseStorage;
const mockDb = {} as Firestore;

function encode(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

/** JSZip auto-creates implicit directory entries — order assertions only care about files. */
function fileKeys(zip: JSZip): string[] {
  return Object.keys(zip.files).filter((path) => !zip.files[path].dir);
}

const PROGRAM: ProgramItem = {
  id: 'prog-1',
  ownerUid: 'owner-uid',
  title: 'Informatica',
  activeImportId: 'imp-1',
  classIds: [],
  createdAt: null as never,
  updatedAt: null as never,
};

const UDA = {
  id: 'uda-1',
  ownerUid: 'owner-uid',
  importId: 'imp-1',
  dir: 'uda-01-reti',
  filename: 'uda-01-reti.md',
  storageBasePath: 'repository/owner-uid/imports/imp-1/uda-01-reti',
  lessonCount: 2,
};

const LESSON = {
  id: 'lesson-1',
  ownerUid: 'owner-uid',
  importId: 'imp-1',
  udaDir: 'uda-01-reti',
  path: 'uda-01-reti/lezione-001.md',
  filename: 'lezione-001.md',
  poolStatus: 'valid' as const,
  questionCount: 2,
  storageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001.md',
  poolStorageRef: null,
  completed: false,
};

const POOL_LESSON = {
  ...LESSON,
  id: 'lesson-pool',
  filename: 'lezione-001.pool.md',
  storageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001.pool.md',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRef.mockImplementation((_storage: unknown, path: string) => ({ __path: path }));
  mockGetBytes.mockResolvedValue(encode('# content'));

  global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
  global.URL.revokeObjectURL = vi.fn();
});

function stubDownloadLink() {
  const clickSpy = vi.fn();
  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'a') {
      const el = origCreate('a');
      el.click = clickSpy;
      return el;
    }
    return origCreate(tag);
  });
  return clickSpy;
}

describe('exportZip — pool file exclusion', () => {
  it('skips files ending in .pool.md', async () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON, POOL_LESSON]);

    const fetchedRefs: string[] = [];
    mockRef.mockImplementation((_storage: unknown, path: string) => {
      fetchedRefs.push(path);
      return { __path: path };
    });

    stubDownloadLink();
    await exportZip(PROGRAM, mockStorage, mockDb);

    const poolRefs = fetchedRefs.filter((r) => r.endsWith('.pool.md'));
    expect(poolRefs.length).toBe(0);

    vi.restoreAllMocks();
  });
});

describe('exportZip — included files', () => {
  it('includes regular lesson files', async () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON]);

    const fetchedPaths: string[] = [];
    mockRef.mockImplementation((_storage: unknown, path: string) => {
      fetchedPaths.push(path as string);
      return { __path: path };
    });

    stubDownloadLink();
    await exportZip(PROGRAM, mockStorage, mockDb);

    expect(fetchedPaths).toContain(LESSON.storageRef);

    vi.restoreAllMocks();
  });
});

describe('exportZip — no Firebase Storage writes', () => {
  it('only uses getBytes (read) — no write/upload functions called', async () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON]);

    stubDownloadLink();
    await exportZip(PROGRAM, mockStorage, mockDb);

    // Only getBytes (read) should be called from the firebase/storage mock.
    expect(mockGetBytes).toHaveBeenCalled();
    // The mock only defines getBytes and ref — no uploadBytes, deleteObject,
    // etc. This verifies no write calls are made.

    vi.restoreAllMocks();
  });
});

describe('exportZip — no activeImportId', () => {
  it('throws when program has no active import', async () => {
    const programNoImport = { ...PROGRAM, activeImportId: null };
    await expect(exportZip(programNoImport, mockStorage, mockDb)).rejects.toThrow(
      'Program has no active import.',
    );
  });
});

describe('buildExportZip — reflects the current Repository Editor state (RE-06)', () => {
  it('exports whatever content is currently in Storage — e.g. after a metadata/body edit', async () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON]);
    mockGetBytes.mockResolvedValue(
      encode('---\ntitolo: "Titolo modificato"\n---\n\nCorpo modificato dal docente.'),
    );

    const zip = await buildExportZip(PROGRAM, mockStorage, mockDb);

    const content = await zip.file(`${LESSON.udaDir}/${LESSON.filename}`)?.async('string');
    expect(content).toBe('---\ntitolo: "Titolo modificato"\n---\n\nCorpo modificato dal docente.');
  });

  it('never includes a UDA/lesson no longer returned by listUdas/listLessons — e.g. after an RE-05 deletion', async () => {
    const DELETED_UDA = {
      ...UDA,
      id: 'uda-deleted',
      dir: 'uda-02-eliminata',
      filename: 'uda-02-eliminata.md',
      storageBasePath: 'repository/owner-uid/imports/imp-1/uda-02-eliminata',
    };
    // listUdas/listLessons already reflect the deletion — the deleted UDA
    // and its lesson simply never appear in what they return.
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON]);

    const zip = await buildExportZip(PROGRAM, mockStorage, mockDb);

    expect(fileKeys(zip).some((path) => path.includes(DELETED_UDA.dir))).toBe(false);
    expect(fileKeys(zip)).toEqual([
      `${UDA.dir}/${UDA.filename}`,
      `${LESSON.udaDir}/${LESSON.filename}`,
    ]);
  });
});

describe('buildExportZip — order preservation (RE-06)', () => {
  const UDA_A = {
    ...UDA,
    id: 'uda-a',
    dir: 'uda-01-a',
    filename: 'uda-01-a.md',
    storageBasePath: 'repository/owner-uid/imports/imp-1/uda-01-a',
  };
  const UDA_B = {
    ...UDA,
    id: 'uda-b',
    dir: 'uda-02-b',
    filename: 'uda-02-b.md',
    storageBasePath: 'repository/owner-uid/imports/imp-1/uda-02-b',
  };

  it('adds UDA files to the archive in listUdas order, not filename order', async () => {
    // Simulates a RE-04 reorder: uda-02-b now sorts first by `order`, even
    // though its dir/filename still carries the higher creation number.
    mockListUdas.mockResolvedValue([UDA_B, UDA_A]);
    mockListLessons.mockResolvedValue([]);

    const zip = await buildExportZip(PROGRAM, mockStorage, mockDb);

    expect(fileKeys(zip)).toEqual(['uda-02-b/uda-02-b.md', 'uda-01-a/uda-01-a.md']);
  });

  it('keeps listUdas order even when content fetches resolve out of order', async () => {
    mockListUdas.mockResolvedValue([UDA_A, UDA_B]);
    mockListLessons.mockResolvedValue([]);

    // uda-01-a's fetch resolves after extra microtask ticks — simulating a
    // slower network response — while uda-02-b resolves immediately.
    mockGetBytes.mockImplementation((fileRef: { __path?: string }) => {
      const bytes = encode('# content');
      if (fileRef.__path?.includes('uda-01-a')) {
        return Promise.resolve()
          .then(() => Promise.resolve())
          .then(() => bytes);
      }
      return Promise.resolve(bytes);
    });

    const zip = await buildExportZip(PROGRAM, mockStorage, mockDb);

    // Still uda-01-a first, matching listUdas input order — not resolution order.
    expect(fileKeys(zip)).toEqual(['uda-01-a/uda-01-a.md', 'uda-02-b/uda-02-b.md']);
  });

  it('adds lesson files to the archive in listLessons order, grouped per UDA', async () => {
    mockListUdas.mockResolvedValue([]);
    const LESSON_A2 = {
      ...LESSON,
      id: 'l-a2',
      udaDir: 'uda-01-a',
      filename: 'lezione-002-tcp.md',
      storageRef: 'repository/owner-uid/imports/imp-1/uda-01-a/lezione-002-tcp.md',
    };
    const LESSON_A1 = {
      ...LESSON,
      id: 'l-a1',
      udaDir: 'uda-01-a',
      filename: 'lezione-001-http.md',
      storageRef: 'repository/owner-uid/imports/imp-1/uda-01-a/lezione-001-http.md',
    };
    // Already sorted by `order` as listLessons would return them: lezione-001 before lezione-002.
    mockListLessons.mockResolvedValue([LESSON_A1, LESSON_A2]);

    const zip = await buildExportZip(PROGRAM, mockStorage, mockDb);

    expect(fileKeys(zip)).toEqual(['uda-01-a/lezione-001-http.md', 'uda-01-a/lezione-002-tcp.md']);
  });
});

describe('exportZip — reimport round-trip (RE-06)', () => {
  it('produces an archive that reimports via readZipFile/validateImport with the same UDA order', async () => {
    const UDA_A = {
      ...UDA,
      id: 'uda-a',
      dir: 'uda-01-a',
      filename: 'uda-01-a.md',
      storageBasePath: 'repository/owner-uid/imports/imp-1/uda-01-a',
    };
    const UDA_B = {
      ...UDA,
      id: 'uda-b',
      dir: 'uda-02-b',
      filename: 'uda-02-b.md',
      storageBasePath: 'repository/owner-uid/imports/imp-1/uda-02-b',
    };
    const LESSON_A = {
      ...LESSON,
      id: 'l-a',
      udaDir: 'uda-01-a',
      path: 'uda-01-a/lezione-001-intro.md',
      filename: 'lezione-001-intro.md',
      storageRef: 'repository/owner-uid/imports/imp-1/uda-01-a/lezione-001-intro.md',
    };
    const LESSON_B = {
      ...LESSON,
      id: 'l-b',
      udaDir: 'uda-02-b',
      path: 'uda-02-b/lezione-001-intro.md',
      filename: 'lezione-001-intro.md',
      storageRef: 'repository/owner-uid/imports/imp-1/uda-02-b/lezione-001-intro.md',
    };

    // uda-02-b now comes first — a reorder that happened without renaming.
    mockListUdas.mockResolvedValue([UDA_B, UDA_A]);
    mockListLessons.mockResolvedValue([LESSON_B, LESSON_A]);

    mockGetBytes.mockImplementation((fileRef: { __path: string }) => {
      if (fileRef.__path.endsWith('uda-01-a.md')) {
        return Promise.resolve(
          encode('---\ntitolo: "A"\ncompetenze:\n  - "Comp A"\nobiettivi:\n  - "Obj A"\n---\n'),
        );
      }
      if (fileRef.__path.endsWith('uda-02-b.md')) {
        return Promise.resolve(
          encode('---\ntitolo: "B"\ncompetenze:\n  - "Comp B"\nobiettivi:\n  - "Obj B"\n---\n'),
        );
      }
      return Promise.resolve(encode('---\ntitolo: "Lezione"\n---\n\nCorpo.'));
    });

    const zip = await buildExportZip(PROGRAM, mockStorage, mockDb);
    const blob = await zip.generateAsync({ type: 'blob' });
    const file = new File([blob], 'export.zip', { type: 'application/zip' });

    const rawFiles = await readZipFile(file);
    const validation = validateImport('Informatica', rawFiles);
    expect(validation.valid).toBe(true);

    const payload = buildImportPayload({
      validation,
      programmaTitle: 'Informatica',
      ownerUid: 'owner-uid',
      programId: 'prog-1',
      importId: 'imp-2',
      files: rawFiles,
    });

    const udaB = payload.udas.find((u) => u.data.dir === 'uda-02-b');
    const udaA = payload.udas.find((u) => u.data.dir === 'uda-01-a');
    expect(udaB?.data.order).toBe(0);
    expect(udaA?.data.order).toBe(1);
  });
});
