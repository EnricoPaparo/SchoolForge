import { describe, expect, it } from 'vitest';
import { newPublicLessonId, resolvePublicLessonId } from '../publicLessonId.js';

describe('publicLessonId helper (HARD-02B-1)', () => {
  it('generates an import-scoped id', () => {
    expect(newPublicLessonId('imp-1', 'uda-01_lezione-001-http')).toBe(
      'imp-1_uda-01_lezione-001-http',
    );
  });

  it('resolves the stored import-scoped id when present', () => {
    expect(resolvePublicLessonId({ publicLessonId: 'imp-1_lesson-1' }, 'lesson-1')).toBe(
      'imp-1_lesson-1',
    );
  });

  it('falls back to the legacy lessonId when publicLessonId is absent', () => {
    expect(resolvePublicLessonId({}, 'lesson-1')).toBe('lesson-1');
    expect(resolvePublicLessonId({ publicLessonId: undefined }, 'lesson-1')).toBe('lesson-1');
  });
});
