import { describe, expect, it } from 'vitest';
import { validateUda } from '../validateUda.js';
import type { RawFile } from '../types.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_UDA_FILE: RawFile = {
  path: 'uda-01-reti/uda-01-reti.md',
  content: `---
titolo: Reti di computer
competenze:
  - Comprendere il modello ISO/OSI
  - Distinguere protocolli di livello applicativo
obiettivi:
  - Spiegare il funzionamento di HTTP e HTTPS
---

## Contenuto opzionale
`,
};

const VALID_LESSON: RawFile = {
  path: 'uda-01-reti/lezione-001-http.md',
  content: '# HTTP\n\nContenuto libero.',
};

const VALID_POOL: RawFile = {
  path: 'uda-01-reti/lezione-001-http.pool.md',
  content: `---
schema: schoolforge-pool/v1
questions:
  - id: q-001
    tipo: aperta
    difficolta: 1
    peso: 2
    testo: Cos'è HTTP?
    soluzione: Protocollo di trasferimento ipertestuale.
---`,
};

const LESSON_WITHOUT_POOL: RawFile = {
  path: 'uda-01-reti/lezione-002-https.md',
  content: '# HTTPS',
};

const INVALID_POOL: RawFile = {
  path: 'uda-01-reti/lezione-001-http.pool.md',
  content: `---
schema: schoolforge-pool/v1
questions:
  - id: q-001
    tipo: aperta
    testo: Domanda incompleta.
---`,
};

const MISSING_FIELDS_UDA: RawFile = {
  path: 'uda-02-web/uda-02-web.md',
  content: `---
titolo: Web
---
`,
};

const BAD_FILENAME_UDA: RawFile = {
  path: 'uda-01-reti/unita-didattica.md',
  content: `---
titolo: Reti
competenze:
  - Comprendere TCP/IP
obiettivi:
  - Analizzare pacchetti
---
`,
};

const NO_FM_UDA: RawFile = {
  path: 'uda-01-reti/uda-01-reti.md',
  content: '# UDA senza front matter',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('validateUda — valid UDA, one lesson with valid pool, one without pool', () => {
  it('is valid with correct front matter', () => {
    const poolFiles = new Map([[VALID_POOL.path, VALID_POOL]]);
    const result = validateUda(VALID_UDA_FILE, [VALID_LESSON, LESSON_WITHOUT_POOL], poolFiles);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.lessons).toHaveLength(2);
    expect(result.lessons[0].poolStatus).toBe('valid');
    expect(result.lessons[1].poolStatus).toBe('absent');
  });
});

describe('validateUda — valid UDA with invalid pool', () => {
  it('UDA is valid; pool issues are attached to the lesson result', () => {
    const poolFiles = new Map([[INVALID_POOL.path, INVALID_POOL]]);
    const result = validateUda(VALID_UDA_FILE, [VALID_LESSON], poolFiles);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.lessons[0].valid).toBe(true);
    expect(result.lessons[0].poolStatus).toBe('invalid');
    expect(result.lessons[0].issues.length).toBeGreaterThan(0);
  });
});

describe('validateUda — invalid UDA filename', () => {
  it('returns invalid when filename does not match uda-XX-titolo.md', () => {
    const result = validateUda(BAD_FILENAME_UDA, [VALID_LESSON], new Map());
    expect(result.valid).toBe(false);
    const filenameIssue = result.issues.find((i) => i.code === 'INVALID_UDA_FILENAME');
    expect(filenameIssue).toBeDefined();
    expect(filenameIssue?.level).toBe('uda');
  });
});

describe('validateUda — missing front matter', () => {
  it('reports MISSING_FRONT_MATTER error', () => {
    const result = validateUda(NO_FM_UDA, [VALID_LESSON], new Map());
    expect(result.valid).toBe(false);
    expect(result.issues.find((i) => i.code === 'MISSING_FRONT_MATTER')).toBeDefined();
  });
});

describe('validateUda — missing required front matter fields', () => {
  it('reports errors for missing competenze and obiettivi', () => {
    const result = validateUda(MISSING_FIELDS_UDA, [VALID_LESSON], new Map());
    expect(result.valid).toBe(false);
    const codes = result.issues.map((i) => i.field);
    expect(codes).toContain('competenze');
    expect(codes).toContain('obiettivi');
  });
});

describe('validateUda — no lesson files', () => {
  it('reports NO_LESSONS when UDA directory has no lessons', () => {
    const result = validateUda(VALID_UDA_FILE, [], new Map());
    expect(result.valid).toBe(false);
    expect(result.issues.find((i) => i.code === 'NO_LESSONS')).toBeDefined();
  });
});
