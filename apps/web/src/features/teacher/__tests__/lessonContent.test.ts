import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseStorage } from 'firebase/storage';
import type { Firestore } from 'firebase/firestore';
import { fetchLessonContent, fetchPublicLessonContent } from '../lessonContent.js';

vi.mock('firebase/storage', () => ({
  getBytes: vi.fn(),
  ref: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  getDoc: vi.fn(),
  doc: vi.fn(),
}));

import { getBytes, ref } from 'firebase/storage';
import { getDoc, doc } from 'firebase/firestore';

const mockGetBytes = getBytes as ReturnType<typeof vi.fn>;
const mockRef = ref as ReturnType<typeof vi.fn>;
const mockGetDoc = getDoc as ReturnType<typeof vi.fn>;
const mockDoc = doc as ReturnType<typeof vi.fn>;

const mockStorage = {} as FirebaseStorage;
const mockDb = {} as Firestore;

beforeEach(() => {
  vi.clearAllMocks();
  mockRef.mockReturnValue({});
  mockDoc.mockReturnValue({});
});

function projectionSnap(data: Record<string, unknown> | null) {
  return { exists: () => data !== null, data: () => data };
}

const VALID = {
  lessonId: 'l1',
  programId: 'p1',
  importId: 'imp1',
  ownerUid: 'owner',
};

describe('fetchPublicLessonContent (MOB-01C)', () => {
  it('returns the projection content on a valid, matching document', async () => {
    mockGetDoc.mockResolvedValue(
      projectionSnap({
        ownerUid: 'owner',
        programId: 'p1',
        importId: 'imp1',
        content: '# Body\n\nCorpo.',
      }),
    );
    await expect(fetchPublicLessonContent(VALID, mockDb)).resolves.toBe('# Body\n\nCorpo.');
    expect(mockGetDoc).toHaveBeenCalledTimes(1);
    expect(mockDoc).toHaveBeenCalledWith(mockDb, 'publicLessons', 'l1');
  });

  it('treats a valid empty string content as usable (renderable)', async () => {
    mockGetDoc.mockResolvedValue(
      projectionSnap({ ownerUid: 'owner', programId: 'p1', importId: 'imp1', content: '' }),
    );
    await expect(fetchPublicLessonContent(VALID, mockDb)).resolves.toBe('');
  });

  it('returns null (→ legacy fallback) when the document does not exist', async () => {
    mockGetDoc.mockResolvedValue(projectionSnap(null));
    await expect(fetchPublicLessonContent(VALID, mockDb)).resolves.toBeNull();
  });

  it('returns null when content is missing or non-string (legacy projection)', async () => {
    mockGetDoc.mockResolvedValue(
      projectionSnap({ ownerUid: 'owner', programId: 'p1', importId: 'imp1' }),
    );
    await expect(fetchPublicLessonContent(VALID, mockDb)).resolves.toBeNull();
    mockGetDoc.mockResolvedValue(
      projectionSnap({ ownerUid: 'owner', programId: 'p1', importId: 'imp1', content: 42 }),
    );
    await expect(fetchPublicLessonContent(VALID, mockDb)).resolves.toBeNull();
  });

  it('returns null on ownerUid / programId / importId mismatch', async () => {
    for (const bad of [
      { ownerUid: 'intruder', programId: 'p1', importId: 'imp1', content: 'x' },
      { ownerUid: 'owner', programId: 'other', importId: 'imp1', content: 'x' },
      { ownerUid: 'owner', programId: 'p1', importId: 'stale', content: 'x' },
    ]) {
      mockGetDoc.mockResolvedValue(projectionSnap(bad));
      await expect(fetchPublicLessonContent(VALID, mockDb)).resolves.toBeNull();
    }
  });

  it('propagates a getDoc error unchanged (caller must NOT fall back to Storage)', async () => {
    const err = Object.assign(new Error('permission denied'), { code: 'permission-denied' });
    mockGetDoc.mockRejectedValue(err);
    await expect(fetchPublicLessonContent(VALID, mockDb)).rejects.toBe(err);
    expect(mockGetBytes).not.toHaveBeenCalled();
  });
});

describe('fetchLessonContent', () => {
  it('returns decoded markdown string on success', async () => {
    const content = '# Hello\nContent here';
    mockGetBytes.mockResolvedValue(new TextEncoder().encode(content));

    const result = await fetchLessonContent('some/path/lesson.md', mockStorage);
    expect(result).toBe(content);
    expect(mockRef).toHaveBeenCalledWith(mockStorage, 'some/path/lesson.md');
    expect(mockGetBytes).toHaveBeenCalled();
  });

  it('throws when getBytes fails', async () => {
    mockGetBytes.mockRejectedValue(new Error('Storage unavailable'));

    await expect(fetchLessonContent('some/path/lesson.md', mockStorage)).rejects.toThrow(
      'Storage unavailable',
    );
  });

  it('does not use fetch', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    mockGetBytes.mockResolvedValue(new TextEncoder().encode('content'));

    await fetchLessonContent('some/path/lesson.md', mockStorage);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
