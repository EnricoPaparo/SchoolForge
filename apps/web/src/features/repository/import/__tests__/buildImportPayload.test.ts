import { describe, expect, it } from 'vitest';
import { validateImport } from '../../validation/index.js';
import { buildImportPayload, buildQuestionPreview } from '../buildImportPayload.js';
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

const LESSON_WITH_FRONT_MATTER: RawFile = {
  path: 'uda-01-reti/lezione-004-ftp.md',
  content: `---
titolo: "FTP"
difficolta: "intermedia"
sottotitolo: "Trasferimento file"
concetti_chiave:
  - "Client/server"
obiettivi:
  - "Descrivere il protocollo FTP"
---

# FTP

Contenuto della lezione.`,
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
    expect(payload.udas[0].data.order).toBe(0);
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
      expect(entry.data).not.toHaveProperty('correctAnswer');
      expect(entry.data).not.toHaveProperty('answers');
      expect(entry.data).not.toHaveProperty('spiegazione');
    }
  });

  it('question entries carry a questionPreview derived from testo, truncated to 100 chars', () => {
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

    const q001 = payload.questionIndex.find((q) => q.data.questionLocalId === 'q-001');
    expect(q001?.data.questionPreview).toBe('Spiega HTTP.');

    const q002 = payload.questionIndex.find((q) => q.data.questionLocalId === 'q-002');
    expect(q002?.data.questionPreview).toBe('Quale porta usa HTTP?');

    for (const entry of payload.questionIndex) {
      expect(entry.data.questionPreview.length).toBeLessThanOrEqual(100);
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

describe('buildImportPayload — lesson IDs across UDAs', () => {
  it('does not collide when two UDAs each have a lesson with the same filename', () => {
    const files: RawFile[] = [
      {
        path: 'uda-01-intro/uda-01-intro.md',
        content: `---
titolo: Introduzione
competenze:
  - Competenza A
obiettivi:
  - Obiettivo 1
---
`,
      },
      { path: 'uda-01-intro/lezione-001-titolo.md', content: '# Lezione 1.1' },
      {
        path: 'uda-02-avanzato/uda-02-avanzato.md',
        content: `---
titolo: Avanzato
competenze:
  - Competenza B
obiettivi:
  - Obiettivo 2
---
`,
      },
      { path: 'uda-02-avanzato/lezione-001-titolo.md', content: '# Lezione 2.1' },
    ];
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

    expect(payload.lessons).toHaveLength(2);
    const ids = payload.lessons.map((l) => l.id);
    expect(new Set(ids).size).toBe(2);
    const udaDirs = payload.lessons.map((l) => l.data.udaDir).sort();
    expect(udaDirs).toEqual(['uda-01-intro', 'uda-02-avanzato']);
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

describe('buildImportPayload — UDA metadata (info panel)', () => {
  it('carries descrizione/competenze/obiettivi through to the UDA payload', () => {
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

    expect(payload.udas).toHaveLength(1);
    expect(payload.udas[0].data.competenze).toEqual(['Comprendere ISO/OSI']);
    expect(payload.udas[0].data.obiettivi).toEqual(['Descrivere HTTP']);
  });
});

describe('buildImportPayload — lesson front matter (titolo/difficolta)', () => {
  it('a lesson with front matter remains importable and carries titolo/difficolta to both payloads', () => {
    const files = buildAllFiles(LESSON_WITH_FRONT_MATTER);
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

    const lesson = payload.lessons.find((l) => l.data.path === LESSON_WITH_FRONT_MATTER.path);
    expect(lesson?.data.titolo).toBe('FTP');
    expect(lesson?.data.sottotitolo).toBe('Trasferimento file');
    expect(lesson?.data.difficolta).toBe('intermedia');
    expect(lesson?.data.concettiChiave).toEqual(['Client/server']);
    expect(lesson?.data.obiettivi).toEqual(['Descrivere il protocollo FTP']);
    expect(lesson?.data.order).toBe(3);

    const publicLesson = payload.publicLessons.find(
      (l) => l.data.path === LESSON_WITH_FRONT_MATTER.path,
    );
    expect(publicLesson?.data.titolo).toBe('FTP');
    expect(publicLesson?.data.sottotitolo).toBe('Trasferimento file');
    expect(publicLesson?.data.difficolta).toBe('intermedia');
    expect(publicLesson?.data.concettiChiave).toEqual(['Client/server']);
    expect(publicLesson?.data.obiettivi).toEqual(['Descrivere il protocollo FTP']);
    expect(publicLesson?.data.order).toBe(3);
  });

  it('a lesson with no front matter carries null titolo/difficolta — does not block import', () => {
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

    const lesson = payload.lessons.find((l) => l.data.path === LESSON_NO_POOL.path);
    expect(lesson?.data.titolo).toBeNull();
    expect(lesson?.data.difficolta).toBeNull();
  });
});

describe('buildImportPayload — programma.md metadata (optional)', () => {
  it('importMeta.programmaMeta is null when programma.md is absent', () => {
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

    expect(payload.importMeta.programmaMeta).toBeNull();
  });

  it('importMeta.programmaMeta is populated when programma.md is present', () => {
    const programmaFile: RawFile = {
      path: 'programma.md',
      content: `---
titolo: Informatica
anno_scolastico: '2025/2026'
classe: 3A
materia: Informatica
docente: Mario Rossi
---

Programma annuale di informatica.
`,
    };
    const files = buildAllFiles(programmaFile);
    const validation = validateImport('Informatica', files);
    const payload = buildImportPayload({
      validation,
      programmaTitle: 'Informatica',
      ownerUid: OWNER_UID,
      programId: PROGRAM_ID,
      importId: IMPORT_ID,
      files,
    });

    expect(payload.importMeta.programmaMeta).toEqual({
      annoScolastico: '2025/2026',
      docente: 'Mario Rossi',
      materia: 'Informatica',
      classe: '3A',
      descrizione: 'Programma annuale di informatica.',
    });
  });
});

describe('buildImportPayload — publicLessons (M3-lite student projection)', () => {
  it('produces one publicLessons entry per lesson, matching lesson count', () => {
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

    expect(payload.publicLessons).toHaveLength(payload.lessons.length);
  });

  it('shares the same id as the corresponding technical lesson entry', () => {
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

    const lessonIds = payload.lessons.map((l) => l.id).sort();
    const publicLessonIds = payload.publicLessons.map((p) => p.id).sort();
    expect(publicLessonIds).toEqual(lessonIds);
  });

  it('carries ownerUid, programId, importId, udaId and a lesson-only contentPath', () => {
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

    const publicLesson = payload.publicLessons.find(
      (p) => p.data.filename === 'lezione-001-http.md',
    );
    expect(publicLesson).toBeDefined();
    expect(publicLesson?.data.ownerUid).toBe(OWNER_UID);
    expect(publicLesson?.data.programId).toBe(PROGRAM_ID);
    expect(publicLesson?.data.importId).toBe(IMPORT_ID);
    expect(publicLesson?.data.udaId).toBe(
      payload.lessons.find((l) => l.data.filename === 'lezione-001-http.md')?.udaId,
    );
    expect(publicLesson?.data.contentPath).toMatch(/lezione-001-http\.md$/);
    expect(publicLesson?.data.contentPath).not.toMatch(/\.pool\.md$/);
  });

  it('never includes poolStatus, poolStorageRef, questionCount or any pool-derived field', () => {
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

    for (const publicLesson of payload.publicLessons) {
      expect(publicLesson.data).not.toHaveProperty('poolStatus');
      expect(publicLesson.data).not.toHaveProperty('poolStorageRef');
      expect(publicLesson.data).not.toHaveProperty('questionCount');
      expect(JSON.stringify(publicLesson.data)).not.toContain('.pool.md');
    }
  });

  it('produces a publicLessons entry even for a lesson with an invalid pool', () => {
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

    const publicLesson = payload.publicLessons.find(
      (p) => p.data.filename === 'lezione-002-https.md',
    );
    expect(publicLesson).toBeDefined();
  });
});

describe('buildQuestionPreview', () => {
  it('collapses whitespace/newlines and trims the result', () => {
    expect(buildQuestionPreview('  Spiega   il\n  protocollo   HTTP.  ')).toBe(
      'Spiega il protocollo HTTP.',
    );
  });

  it('truncates to at most 100 characters', () => {
    const long = 'A'.repeat(150);
    const preview = buildQuestionPreview(long);
    expect(preview.length).toBe(100);
    expect(preview).toBe('A'.repeat(100));
  });

  it('returns short text unchanged (aside from whitespace normalization)', () => {
    expect(buildQuestionPreview('Quale porta usa HTTP?')).toBe('Quale porta usa HTTP?');
  });
});
