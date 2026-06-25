import { describe, expect, it } from 'vitest';
import { validateImport } from '../validateImport.js';
import type { RawFile } from '../types.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const UDA_FILE: RawFile = {
  path: 'uda-01-reti/uda-01-reti.md',
  content: `---
titolo: Reti di computer
competenze:
  - Comprendere ISO/OSI
obiettivi:
  - Descrivere HTTP
---
`,
};

const LESSON_WITH_POOL: RawFile = {
  path: 'uda-01-reti/lezione-001-http.md',
  content: '# HTTP',
};

const POOL_FILE: RawFile = {
  path: 'uda-01-reti/lezione-001-http.pool.md',
  content: `---
schema: schoolforge-pool/v1
questions:
  - id: q-001
    tipo: aperta
    difficolta: 1
    peso: 1
    testo: Cos'è HTTP?
    soluzione: Protocollo applicativo.
---`,
};

const LESSON_WITHOUT_POOL: RawFile = {
  path: 'uda-01-reti/lezione-002-https.md',
  content: '# HTTPS',
};

const INVALID_POOL_FILE: RawFile = {
  path: 'uda-01-reti/lezione-001-http.pool.md',
  content: `---
schema: schoolforge-pool/v1
questions:
  - id: q-001
    tipo: aperta
    testo: Domanda incompleta senza difficolta e peso.
---`,
};

const UDA2_FILE: RawFile = {
  path: 'uda-02-web/uda-02-web.md',
  content: `---
titolo: Applicazioni web
competenze:
  - Sviluppare applicazioni HTTP
obiettivi:
  - Costruire una API REST
---
`,
};

const LESSON2: RawFile = {
  path: 'uda-02-web/lezione-001-rest.md',
  content: '# REST',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('validateImport — valid program (one UDA, one lesson with pool, one without)', () => {
  it('is valid and has no structural issues', () => {
    const result = validateImport('Informatica', [
      UDA_FILE,
      LESSON_WITH_POOL,
      POOL_FILE,
      LESSON_WITHOUT_POOL,
    ]);
    expect(result.valid).toBe(true);
    expect(result.udas).toHaveLength(1);
    const lessons = result.udas[0].lessons;
    expect(lessons).toHaveLength(2);
    expect(lessons.find((l) => l.poolStatus === 'valid')).toBeDefined();
    expect(lessons.find((l) => l.poolStatus === 'absent')).toBeDefined();
  });
});

describe('validateImport — valid program with multiple UDAs', () => {
  it('returns two UDAs both valid', () => {
    const result = validateImport('Informatica', [
      UDA_FILE,
      LESSON_WITHOUT_POOL,
      UDA2_FILE,
      LESSON2,
    ]);
    expect(result.valid).toBe(true);
    expect(result.udas).toHaveLength(2);
    expect(result.udas.every((u) => u.valid)).toBe(true);
  });
});

describe('validateImport — lesson with invalid pool (import still valid)', () => {
  it('overall import is valid; pool issues are present but do not block', () => {
    const result = validateImport('Informatica', [UDA_FILE, LESSON_WITH_POOL, INVALID_POOL_FILE]);
    expect(result.valid).toBe(true);
    const poolIssues = result.issues.filter((i) => i.level === 'pool' || i.level === 'question');
    expect(poolIssues.length).toBeGreaterThan(0);
    expect(result.udas[0].lessons[0].poolStatus).toBe('invalid');
    expect(result.udas[0].lessons[0].valid).toBe(true);
  });
});

describe('validateImport — missing programma title', () => {
  it('is invalid when title is empty', () => {
    const result = validateImport('', [UDA_FILE, LESSON_WITHOUT_POOL]);
    expect(result.valid).toBe(false);
    expect(
      result.issues.find((i) => i.code === 'MISSING_FIELD' && i.field === 'title'),
    ).toBeDefined();
  });

  it('is invalid when title is whitespace only', () => {
    const result = validateImport('   ', [UDA_FILE, LESSON_WITHOUT_POOL]);
    expect(result.valid).toBe(false);
  });
});

describe('validateImport — directory without UDA file', () => {
  it('reports MISSING_UDA_FILE for the directory', () => {
    const orphanLesson: RawFile = { path: 'uda-99-orphan/lezione-001-solo.md', content: '# X' };
    const result = validateImport('Informatica', [orphanLesson]);
    expect(result.valid).toBe(false);
    expect(result.issues.find((i) => i.code === 'MISSING_UDA_FILE')).toBeDefined();
    expect(result.issues.find((i) => i.code === 'NO_UDAS')).toBeDefined();
  });
});

describe('validateImport — empty import (no files)', () => {
  it('reports NO_UDAS', () => {
    const result = validateImport('Informatica', []);
    expect(result.valid).toBe(false);
    expect(result.issues.find((i) => i.code === 'NO_UDAS')).toBeDefined();
  });
});

describe('validateImport — invalid UDA front matter', () => {
  it('is invalid when UDA is missing required front matter fields', () => {
    const badUda: RawFile = {
      path: 'uda-01-reti/uda-01-reti.md',
      content: `---\ntitolo: Solo titolo\n---\n`,
    };
    const result = validateImport('Informatica', [badUda, LESSON_WITHOUT_POOL]);
    expect(result.valid).toBe(false);
    expect(result.udas[0].valid).toBe(false);
    const fields = result.udas[0].issues.map((i) => i.field);
    expect(fields).toContain('competenze');
    expect(fields).toContain('obiettivi');
  });
});

describe('validateImport — issue structure', () => {
  it('every issue has level, path, field, code and message', () => {
    const result = validateImport('', []);
    for (const issue of result.issues) {
      expect(typeof issue.level).toBe('string');
      expect(typeof issue.path).toBe('string');
      expect(typeof issue.field).toBe('string');
      expect(typeof issue.code).toBe('string');
      expect(typeof issue.message).toBe('string');
    }
  });
});
