import { describe, expect, it } from 'vitest';
import { validateLesson } from '../validateLesson.js';
import type { RawFile } from '../types.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_LESSON: RawFile = {
  path: 'uda-01-reti/lezione-001-http.md',
  content: '# HTTP\n\nContenuto didattico libero.',
};

const VALID_POOL: RawFile = {
  path: 'uda-01-reti/lezione-001-http.pool.md',
  content: `---
schema: schoolforge-pool/v1
questions:
  - id: q-001
    tipo: aperta
    difficolta: 2
    peso: 3
    testo: Spiega HTTP.
    soluzione: HTTP è un protocollo applicativo.
---`,
};

const INVALID_POOL: RawFile = {
  path: 'uda-01-reti/lezione-001-http.pool.md',
  content: `---
schema: schoolforge-pool/v1
questions:
  - id: q-001
    tipo: aperta
    testo: Domanda senza difficolta e peso.
---`,
};

const WRONG_FILENAME_LESSON: RawFile = {
  path: 'uda-01-reti/lezione-http.md',
  content: '# HTTP',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('validateLesson — valid lesson, no pool', () => {
  it('returns valid with poolStatus absent', () => {
    const result = validateLesson(VALID_LESSON);
    expect(result.valid).toBe(true);
    expect(result.poolStatus).toBe('absent');
    expect(result.issues).toHaveLength(0);
  });
});

describe('validateLesson — valid lesson with valid pool', () => {
  it('returns valid with poolStatus valid', () => {
    const result = validateLesson(VALID_LESSON, VALID_POOL);
    expect(result.valid).toBe(true);
    expect(result.poolStatus).toBe('valid');
    expect(result.issues).toHaveLength(0);
  });
});

describe('validateLesson — valid lesson with invalid pool', () => {
  it('lesson remains valid; poolStatus is invalid; issues carry pool/question errors', () => {
    const result = validateLesson(VALID_LESSON, INVALID_POOL);
    expect(result.valid).toBe(true);
    expect(result.poolStatus).toBe('invalid');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((i) => i.level === 'pool' || i.level === 'question')).toBe(true);
  });

  it('pool errors reference the pool file path', () => {
    const result = validateLesson(VALID_LESSON, INVALID_POOL);
    expect(result.issues.every((i) => i.path === INVALID_POOL.path)).toBe(true);
  });

  it('each pool error has a stable code', () => {
    const result = validateLesson(VALID_LESSON, INVALID_POOL);
    expect(result.issues.every((i) => i.code === 'POOL_ERROR')).toBe(true);
  });
});

describe('validateLesson — invalid lesson filename', () => {
  it('returns invalid when filename does not match lezione-XXX-titolo.md', () => {
    const result = validateLesson(WRONG_FILENAME_LESSON);
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].code).toBe('INVALID_LESSON_FILENAME');
    expect(result.issues[0].level).toBe('lezione');
  });

  it('invalid filename + invalid pool: lesson is still invalid; pool issues are also present', () => {
    const result = validateLesson(WRONG_FILENAME_LESSON, INVALID_POOL);
    expect(result.valid).toBe(false);
    const lessonIssues = result.issues.filter((i) => i.level === 'lezione');
    const poolIssues = result.issues.filter((i) => i.level === 'pool' || i.level === 'question');
    expect(lessonIssues.length).toBeGreaterThan(0);
    expect(poolIssues.length).toBeGreaterThan(0);
  });
});
