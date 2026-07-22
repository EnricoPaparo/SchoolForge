import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadTexts = vi.fn();
vi.mock('../../repository/gateway/repositoryGatewayClient.js', () => ({
  readTexts: (...args: unknown[]) => mockReadTexts(...args),
}));

// Mock programsService
const mockListUdas = vi.fn();
const mockListLessons = vi.fn();
vi.mock('../../repository/programs/programsService.js', () => ({
  listUdas: (...args: unknown[]) => mockListUdas(...args),
  listLessons: (...args: unknown[]) => mockListLessons(...args),
}));

import type JSZip from 'jszip';
import { buildExportZip, exportZip } from '../exportZip.js';
import { readZipFile } from '../../repository/import/readZipFile.js';
import { validateImport } from '../../repository/validation/validateImport.js';
import { buildImportPayload } from '../../repository/import/buildImportPayload.js';
import type { ProgramItem } from '../../repository/programs/programsService.js';
import type { FirebaseStorage } from 'firebase/storage';
import type { Firestore } from 'firebase/firestore';

const mockStorage = {} as FirebaseStorage;
const mockDb = {} as Firestore;

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
  mockReadTexts.mockImplementation(async (paths: string[]) =>
    paths.map((path) => ({ ok: true, path, content: '# content' })),
  );

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

    stubDownloadLink();
    await exportZip(PROGRAM, mockStorage, mockDb);

    const fetchedRefs = mockReadTexts.mock.calls[0]?.[0] as string[];
    const poolRefs = fetchedRefs.filter((r) => r.endsWith('.pool.md'));
    expect(poolRefs.length).toBe(0);

    vi.restoreAllMocks();
  });
});

describe('exportZip — included files', () => {
  it('includes regular lesson files', async () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON]);

    stubDownloadLink();
    await exportZip(PROGRAM, mockStorage, mockDb);

    const fetchedPaths = mockReadTexts.mock.calls[0]?.[0] as string[];
    expect(fetchedPaths).toContain(LESSON.storageRef);

    vi.restoreAllMocks();
  });
});

describe('exportZip — gateway batch-read', () => {
  it('uses one batch-read and performs no Storage SDK operation', async () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON]);

    stubDownloadLink();
    await exportZip(PROGRAM, mockStorage, mockDb);

    expect(mockReadTexts).toHaveBeenCalledTimes(1);

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
    mockReadTexts.mockImplementation(async (paths: string[]) =>
      paths.map((path) => ({
        ok: true,
        path,
        content: '---\ntitolo: "Titolo modificato"\n---\n\nCorpo modificato dal docente.',
      })),
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

    const zip = await buildExportZip(PROGRAM, mockStorage, mockDb);

    // Still uda-01-a first, matching listUdas input order — not resolution order.
    expect(fileKeys(zip)).toEqual(['uda-01-a/uda-01-a.md', 'uda-02-b/uda-02-b.md']);
  });

  it('adds lesson files to the archive in listLessons order, grouped per UDA', async () => {
    // The lessons' UDA must be committed (present in listUdas) for reader
    // coherence to keep them — a real course always has its UdaDoc.
    mockListUdas.mockResolvedValue([UDA_A]);
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

    expect(fileKeys(zip)).toEqual([
      'uda-01-a/uda-01-a.md',
      'uda-01-a/lezione-001-http.md',
      'uda-01-a/lezione-002-tcp.md',
    ]);
  });
});

describe('exportZip — pool round-trip (TWU-04B)', () => {
  const POOL_CONTENT = `---
schema: schoolforge-pool/v2
questions:
  - id: q-001
    tipo: aperta
    difficolta: 2
    testo: Spiega HTTP.
    soluzione: HTTP è un protocollo applicativo.
---`;

  const LESSON_WITH_POOL = {
    ...LESSON,
    id: 'l-with-pool',
    udaDir: 'uda-01-reti',
    path: 'uda-01-reti/lezione-001-http.md',
    filename: 'lezione-001-http.md',
    storageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001-http.md',
    poolStatus: 'valid' as const,
    poolStorageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001-http.pool.md',
  };

  it('exports the companion .pool.md for a lesson with a valid pool', async () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_WITH_POOL]);

    const zip = await buildExportZip(PROGRAM, mockStorage, mockDb);

    const fetched = mockReadTexts.mock.calls[0]?.[0] as string[];
    expect(fetched).toContain(LESSON_WITH_POOL.poolStorageRef);
    expect(fileKeys(zip)).toEqual([
      'uda-01-reti/uda-01-reti.md',
      'uda-01-reti/lezione-001-http.md',
      'uda-01-reti/lezione-001-http.pool.md',
    ]);
  });

  it('never exports a pool for an absent/invalid pool (no regression for pool-less courses)', async () => {
    const NO_POOL = { ...LESSON_WITH_POOL, poolStatus: 'absent' as const, poolStorageRef: null };
    const INVALID_POOL = {
      ...LESSON_WITH_POOL,
      id: 'l-invalid',
      filename: 'lezione-002-tcp.md',
      storageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-002-tcp.md',
      poolStatus: 'invalid' as const,
      poolStorageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-002-tcp.pool.md',
    };
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([NO_POOL, INVALID_POOL]);

    const zip = await buildExportZip(PROGRAM, mockStorage, mockDb);

    expect(fileKeys(zip).some((p) => p.endsWith('.pool.md'))).toBe(false);
  });

  it('round-trips export → reimport preserving the pool questions', async () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON_WITH_POOL]);
    mockReadTexts.mockImplementation(async (paths: string[]) =>
      paths.map((path) => ({
        ok: true,
        path,
        content: path.endsWith('uda-01-reti.md')
          ? '---\ntitolo: "Reti"\ncompetenze:\n  - "Comp"\nobiettivi:\n  - "Obj"\n---\n'
          : path.endsWith('.pool.md')
            ? POOL_CONTENT
            : '---\ntitolo: "HTTP"\n---\n\nCorpo.',
      })),
    );

    const zip = await buildExportZip(PROGRAM, mockStorage, mockDb);
    const blob = await zip.generateAsync({ type: 'blob' });
    const file = new File([blob], 'export.zip', { type: 'application/zip' });

    const rawFiles = await readZipFile(file);
    // The pool companion survived the archive.
    expect(rawFiles.some((f) => f.path.endsWith('lezione-001-http.pool.md'))).toBe(true);

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

    // The reimported lesson carries its pool and its question index entry.
    const lesson = payload.lessons.find((l) => l.data.filename === 'lezione-001-http.md');
    expect(lesson?.data.poolStatus).toBe('valid');
    expect(lesson?.data.questionCount).toBe(1);
    expect(payload.questionIndex).toHaveLength(1);
    expect(payload.questionIndex[0]?.data.questionLocalId).toBe('q-001');
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

    mockReadTexts.mockImplementation(async (paths: string[]) =>
      paths.map((path) => ({
        ok: true,
        path,
        content: path.endsWith('uda-01-a.md')
          ? '---\ntitolo: "A"\ncompetenze:\n  - "Comp A"\nobiettivi:\n  - "Obj A"\n---\n'
          : path.endsWith('uda-02-b.md')
            ? '---\ntitolo: "B"\ncompetenze:\n  - "Comp B"\nobiettivi:\n  - "Obj B"\n---\n'
            : '---\ntitolo: "Lezione"\n---\n\nCorpo.',
      })),
    );

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
