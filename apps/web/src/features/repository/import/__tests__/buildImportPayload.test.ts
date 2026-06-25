import { describe, expect, it } from 'vitest';
import { validateImport } from '../../validation/index.js';
import { buildImportPayload } from '../buildImportPayload.js';
import type { RawFile } from '../../validation/types.js';

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

const LESSON_WITH_VALID_POOL: RawFile = {
  path: 'uda-01-reti/lezione-001-http.md',
  content: '# HTTP',
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
  - id: q-002
    tipo: chiusa_singola
    difficolta: 1
    peso: 1
    testo: Quale porta usa HTTP?
    opzioni:
      - id: a
        testo: "80"
      - id: b
        testo: "443"
    soluzione: [a]
---`,
};

const LESSON_WITH_INVALID_POOL: RawFile = {
  path: 'uda-01-reti/lezione-002-https.md',
  content: '# HTTPS',
};

const INVALID_POOL: RawFile = {
  path: 'uda-01-reti/lezione-002-https.pool.md',
  content: `---
schema: schoolforge-pool/v1
questions:
  - id: q-001
    tipo: aperta
    testo: Domanda incompleta senza difficolta e peso.
---`,
};

const LESSON_NO_POOL: RawFile = {
  path: 'uda-01-reti/lezione-003-dns.md',
  content: '# DNS',
};

const OWNER_UID = 'test-owner';
const PROGRAM_ID = 'prog-01';
const IMPORT_ID = 'imp-01';

function buildAllFiles(...extra: RawFile[]) {
  return [
    UDA_FILE,
    LESSON_WITH_VALID_POOL,
    VALID_POOL,
    LESSON_WITH_INVALID_POOL,
    INVALID_POOL,
    LESSON_NO_POOL,
    ...extra,
  ];
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('buildImportPayload — structure', () => {
  it('produces one UDA entry', () => {
    const files = buildAllFiles();
    const validation = validateImport('Informatica', files);
    expect(validation.valid).toBe(true);

    const payload = buildImportPayload({
      validation,
      programmaTitle: 'Informatica',
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      files,
    });

    expect(payload.udas).toHaveLength(1);
    expect(payload.udas[0].data.dir).toBe('uda-01-reti');
    expect(payload.udas[0].data.lessonCount).toBe(3);
  });

  it('produces three lesson entries', () => {
    const files = buildAllFiles();
    const validation = validateImport('Informatica', files);
    const payload = buildImportPayload({
      validation,
      programmaTitle: 'Informatica',
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      files,
    });

    expect(payload.lessons).toHaveLength(3);
  });

  it('importMeta has correct counts', () => {
    const files = buildAllFiles();
    const validation = validateImport('Informatica', files);
    const payload = buildImportPayload({
      validation,
      programmaTitle: 'Informatica',
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      files,
    });

    expect(payload.importMeta.udaCount).toBe(1);
    expect(payload.importMeta.lessonCount).toBe(3);
    expect(payload.importMeta.questionCount).toBe(2); // only valid pool
    expect(payload.importMeta.status).toBe('committed');
    expect(payload.importMeta.ownerUid).toBe(OWNER_UID);
    expect(payload.importMeta.programId).toBe(PROGRAM_ID);
    expect(payload.importMeta.importId).toBe(IMPORT_ID);
  });
});

describe('buildImportPayload — questionIndex', () => {
  it('indexes only questions from valid pools', () => {
    const files = buildAllFiles();
    const validation = validateImport('Informatica', files);
    const payload = buildImportPayload({
      validation,
      programmaTitle: 'Informatica',
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      files,
    });

    expect(payload.questionIndex).toHaveLength(2);
    const ids = payload.questionIndex.map((q) => q.data.questionLocalId);
    expect(ids).toContain('q-001');
    expect(ids).toContain('q-002');
  });

  it('does not index questions from invalid pools', () => {
    const files = buildAllFiles();
    const validation = validateImport('Informatica', files);
    const payload = buildImportPayload({
      validation,
      programmaTitle: 'Informatica',
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      files,
    });

    const lessonPaths = payload.questionIndex.map((q) => q.data.lessonPath);
    expect(lessonPaths.every((p) => !p.includes('lezione-002-https'))).toBe(true);
  });

  it('does not index questions from absent pools', () => {
    const files = buildAllFiles();
    const validation = validateImport('Informatica', files);
    const payload = buildImportPayload({
      validation,
      programmaTitle: 'Informatica',
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      files,
    });

    const lessonPaths = payload.questionIndex.map((q) => q.data.lessonPath);
    expect(lessonPaths.every((p) => !p.includes('lezione-003-dns'))).toBe(true);
  });

  it('question entries contain metadata but NOT testo or soluzione', () => {
    const files = buildAllFiles();
    const validation = validateImport('Informatica', files);
    const payload = buildImportPayload({
      validation,
      programmaTitle: 'Informatica',
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      files,
    });

    for (const entry of payload.questionIndex) {
      expect(entry.data).toHaveProperty('tipo');
      expect(entry.data).toHaveProperty('difficolta');
      expect(entry.data).toHaveProperty('peso');
      expect(entry.data).toHaveProperty('maxPoints');
      expect(entry.data).not.toHaveProperty('testo');
      expect(entry.data).not.toHaveProperty('soluzione');
    }
  });

  it('maxPoints equals difficolta × peso', () => {
    const files = buildAllFiles();
    const validation = validateImport('Informatica', files);
    const payload = buildImportPayload({
      validation,
      programmaTitle: 'Informatica',
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      files,
    });

    for (const entry of payload.questionIndex) {
      expect(entry.data.maxPoints).toBe(entry.data.difficolta * entry.data.peso);
    }
  });

  it('question index IDs are unique and stable', () => {
    const files = buildAllFiles();
    const validation = validateImport('Informatica', files);
    const payload = buildImportPayload({
      validation,
      programmaTitle: 'Informatica',
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      files,
    });

    const ids = payload.questionIndex.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buildImportPayload — lesson poolStatus', () => {
  it('lesson with valid pool has poolStatus valid and questionCount > 0', () => {
    const files = buildAllFiles();
    const validation = validateImport('Informatica', files);
    const payload = buildImportPayload({
      validation,
      programmaTitle: 'Informatica',
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      files,
    });

    const lesson = payload.lessons.find((l) => l.data.filename === 'lezione-001-http.md');
    expect(lesson?.data.poolStatus).toBe('valid');
    expect(lesson?.data.questionCount).toBe(2);
    expect(lesson?.data.poolStorageRef).not.toBeNull();
  });

  it('lesson with invalid pool has poolStatus invalid and questionCount 0', () => {
    const files = buildAllFiles();
    const validation = validateImport('Informatica', files);
    const payload = buildImportPayload({
      validation,
      programmaTitle: 'Informatica',
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      files,
    });

    const lesson = payload.lessons.find((l) => l.data.filename === 'lezione-002-https.md');
    expect(lesson?.data.poolStatus).toBe('invalid');
    expect(lesson?.data.questionCount).toBe(0);
    expect(lesson?.data.poolStorageRef).not.toBeNull();
  });

  it('lesson without pool has poolStatus absent and questionCount 0', () => {
    const files = buildAllFiles();
    const validation = validateImport('Informatica', files);
    const payload = buildImportPayload({
      validation,
      programmaTitle: 'Informatica',
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      files,
    });

    const lesson = payload.lessons.find((l) => l.data.filename === 'lezione-003-dns.md');
    expect(lesson?.data.poolStatus).toBe('absent');
    expect(lesson?.data.questionCount).toBe(0);
    expect(lesson?.data.poolStorageRef).toBeNull();
  });
});

describe('buildImportPayload — storage paths', () => {
  it('storageRef uses repository/{ownerUid}/imports/{importId}/...', () => {
    const files = buildAllFiles();
    const validation = validateImport('Informatica', files);
    const payload = buildImportPayload({
      validation,
      programmaTitle: 'Informatica',
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      files,
    });

    for (const lesson of payload.lessons) {
      expect(lesson.data.storageRef).toMatch(
        new RegExp(`^repository/${OWNER_UID}/imports/${IMPORT_ID}/`),
      );
    }
  });

  it('pool issues are stored in importMeta.poolIssues', () => {
    const files = buildAllFiles();
    const validation = validateImport('Informatica', files);
    const payload = buildImportPayload({
      validation,
      programmaTitle: 'Informatica',
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      files,
    });

    expect(payload.importMeta.poolIssues.length).toBeGreaterThan(0);
    expect(
      payload.importMeta.poolIssues.every((i) => i.level === 'pool' || i.level === 'question'),
    ).toBe(true);
  });
});
