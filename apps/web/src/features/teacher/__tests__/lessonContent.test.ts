import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseStorage } from 'firebase/storage';
import { fetchLessonContent } from '../lessonContent.js';

vi.mock('firebase/storage', () => ({
  getBytes: vi.fn(),
  ref: vi.fn(),
}));

import { getBytes, ref } from 'firebase/storage';

const mockGetBytes = getBytes as ReturnType<typeof vi.fn>;
const mockRef = ref as ReturnType<typeof vi.fn>;

const mockStorage = {} as FirebaseStorage;

beforeEach(() => {
  vi.clearAllMocks();
  mockRef.mockReturnValue({});
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
