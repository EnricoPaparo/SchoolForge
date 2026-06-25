import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock firebase/storage
vi.mock('firebase/storage', () => ({
  getDownloadURL: vi.fn(),
  ref: vi.fn(),
}));

// Mock programsService
const mockListUdas = vi.fn();
const mockListLessons = vi.fn();
vi.mock('../../repository/programs/programsService.js', () => ({
  listUdas: (...args: unknown[]) => mockListUdas(...args),
  listLessons: (...args: unknown[]) => mockListLessons(...args),
}));

import { getDownloadURL, ref } from 'firebase/storage';
import { exportZip } from '../exportZip.js';
import type { ProgramItem } from '../../repository/programs/programsService.js';
import type { FirebaseStorage } from 'firebase/storage';
import type { Firestore } from 'firebase/firestore';

const mockGetDownloadURL = getDownloadURL as ReturnType<typeof vi.fn>;
const mockRef = ref as ReturnType<typeof vi.fn>;
const mockStorage = {} as FirebaseStorage;
const mockDb = {} as Firestore;

const PROGRAM: ProgramItem = {
  id: 'prog-1',
  ownerUid: 'owner-uid',
  title: 'Informatica',
  activeImportId: 'imp-1',
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
  mockRef.mockReturnValue({});

  // Setup URL mock
  global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
  global.URL.revokeObjectURL = vi.fn();
});

describe('exportZip — pool file exclusion', () => {
  it('skips files ending in .pool.md', async () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON, POOL_LESSON]);

    // Track which storage refs were requested
    const fetchedRefs: string[] = [];
    mockGetDownloadURL.mockImplementation(() => {
      return Promise.resolve('https://storage.example.com/file');
    });
    mockRef.mockImplementation((_storage: unknown, path: string) => {
      fetchedRefs.push(path);
      return {};
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# content'),
    } as Response);

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

    await exportZip(PROGRAM, mockStorage, mockDb);

    // Pool file should never be fetched
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
    mockGetDownloadURL.mockResolvedValue('https://storage.example.com/file');
    mockRef.mockImplementation((_storage: unknown, path: string) => {
      fetchedPaths.push(path as string);
      return {};
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# content'),
    } as Response);

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

    await exportZip(PROGRAM, mockStorage, mockDb);

    // The lesson storage ref should have been fetched
    expect(fetchedPaths).toContain(LESSON.storageRef);

    vi.restoreAllMocks();
  });
});

describe('exportZip — no Firebase Storage writes', () => {
  it('only uses getDownloadURL (read) — no write/upload functions called', async () => {
    mockListUdas.mockResolvedValue([UDA]);
    mockListLessons.mockResolvedValue([LESSON]);
    mockGetDownloadURL.mockResolvedValue('https://storage.example.com/file');
    mockRef.mockReturnValue({});

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# content'),
    } as Response);

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

    await exportZip(PROGRAM, mockStorage, mockDb);

    // Only getDownloadURL (read) should be called from firebase/storage mock
    expect(mockGetDownloadURL).toHaveBeenCalled();
    // The mock only defines getDownloadURL and ref — no uploadBytes, uploadString, etc.
    // This verifies no write calls are made.

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
