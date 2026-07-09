import { describe, expect, it } from 'vitest';
import { resolveLessonTitle } from '../lessonTitle.js';

describe('resolveLessonTitle', () => {
  it('extracts the zero-padded number and uses the front matter titolo when present', () => {
    const result = resolveLessonTitle('lezione-001-ai-storia-definizioni.md', 'Storia della AI');
    expect(result.number).toBe('001');
    expect(result.title).toBe('Storia della AI');
  });

  it('falls back to a cleaned-up filename when titolo is absent', () => {
    const result = resolveLessonTitle('lezione-001-ai-storia-definizioni.md', null);
    expect(result.number).toBe('001');
    expect(result.title).toBe('Ai storia definizioni');
  });

  it('falls back to a cleaned-up filename when titolo is an empty string', () => {
    const result = resolveLessonTitle('lezione-002-reti.md', '   ');
    expect(result.title).toBe('Reti');
  });

  it('falls back to a cleaned-up filename when titolo is undefined', () => {
    const result = resolveLessonTitle('lezione-003-http.md', undefined);
    expect(result.title).toBe('Http');
  });

  it('returns number: null when the filename does not match the numbering pattern', () => {
    const result = resolveLessonTitle('appendice.md', null);
    expect(result.number).toBeNull();
    expect(result.title).toBe('Appendice');
  });

  it('never changes the number even when titolo is present', () => {
    const result = resolveLessonTitle('lezione-042-qualcosa.md', 'Titolo personalizzato');
    expect(result.number).toBe('042');
  });
});
