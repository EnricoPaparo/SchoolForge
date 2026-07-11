import { describe, expect, it } from 'vitest';
import {
  MAX_LESSON_CONTENT_BYTES,
  assertLessonContentSize,
  isLessonContentSizeValid,
  normalizeLessonContent,
  utf8ByteLength,
} from '../lessonContentSize.js';

describe('utf8ByteLength', () => {
  it('matches string length for pure ASCII', () => {
    expect(utf8ByteLength('hello')).toBe(5);
  });

  it('counts multi-byte UTF-8 characters correctly, not UTF-16 code units', () => {
    // 'à' is 2 bytes in UTF-8 but 1 UTF-16 code unit.
    expect(utf8ByteLength('à')).toBe(2);
    // An emoji is a surrogate pair (2 UTF-16 code units) but 4 UTF-8 bytes.
    expect(utf8ByteLength('😀')).toBe(4);
    expect('😀'.length).toBe(2);
  });

  it('returns 0 for an empty string', () => {
    expect(utf8ByteLength('')).toBe(0);
  });
});

describe('isLessonContentSizeValid / assertLessonContentSize', () => {
  it('accepts content at or under the limit', () => {
    const content = 'a'.repeat(MAX_LESSON_CONTENT_BYTES);
    expect(isLessonContentSizeValid(content)).toBe(true);
    expect(() => assertLessonContentSize(content, 'lezione.md')).not.toThrow();
  });

  it('rejects content one byte over the limit', () => {
    const content = 'a'.repeat(MAX_LESSON_CONTENT_BYTES + 1);
    expect(isLessonContentSizeValid(content)).toBe(false);
    expect(() => assertLessonContentSize(content, 'lezione.md')).toThrow(/lezione\.md/);
  });

  it('throws a clear error message including byte count and limit', () => {
    const content = 'a'.repeat(MAX_LESSON_CONTENT_BYTES + 10);
    expect(() => assertLessonContentSize(content, 'lezione-troppo-grande.md')).toThrow(
      new RegExp(`${MAX_LESSON_CONTENT_BYTES + 10}.*${MAX_LESSON_CONTENT_BYTES}`),
    );
  });
});

describe('normalizeLessonContent', () => {
  it('returns the string as-is when content is a valid string', () => {
    expect(normalizeLessonContent('corpo')).toBe('corpo');
  });

  it('returns an empty string as-is (distinct from missing)', () => {
    expect(normalizeLessonContent('')).toBe('');
  });

  it('returns null for undefined (legacy document, no content field)', () => {
    expect(normalizeLessonContent(undefined)).toBeNull();
  });

  it('returns null for a corrupt non-string value', () => {
    expect(normalizeLessonContent(42)).toBeNull();
    expect(normalizeLessonContent(null)).toBeNull();
    expect(normalizeLessonContent({})).toBeNull();
  });
});
