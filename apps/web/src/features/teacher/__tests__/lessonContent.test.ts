import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseStorage } from 'firebase/storage';
import { fetchLessonContent } from '../lessonContent.js';

// Mock firebase/storage
vi.mock('firebase/storage', () => ({
  getDownloadURL: vi.fn(),
  ref: vi.fn(),
}));

import { getDownloadURL, ref } from 'firebase/storage';

const mockGetDownloadURL = getDownloadURL as ReturnType<typeof vi.fn>;
const mockRef = ref as ReturnType<typeof vi.fn>;

const mockStorage = {} as FirebaseStorage;

beforeEach(() => {
  vi.clearAllMocks();
  mockRef.mockReturnValue({});
});

describe('fetchLessonContent', () => {
  it('returns markdown string on success', async () => {
    mockGetDownloadURL.mockResolvedValue('https://storage.example.com/lesson.md');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# Hello\nContent here'),
    } as Response);

    const result = await fetchLessonContent('some/path/lesson.md', mockStorage);
    expect(result).toBe('# Hello\nContent here');
    expect(mockRef).toHaveBeenCalledWith(mockStorage, 'some/path/lesson.md');
    expect(mockGetDownloadURL).toHaveBeenCalled();
  });

  it('throws on network error', async () => {
    mockGetDownloadURL.mockRejectedValue(new Error('Storage unavailable'));

    await expect(fetchLessonContent('some/path/lesson.md', mockStorage)).rejects.toThrow(
      'Storage unavailable',
    );
  });

  it('throws when fetch response is not ok', async () => {
    mockGetDownloadURL.mockResolvedValue('https://storage.example.com/lesson.md');
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    } as Response);

    await expect(fetchLessonContent('some/path/lesson.md', mockStorage)).rejects.toThrow(
      'Failed to fetch lesson content: 403 Forbidden',
    );
  });
});
