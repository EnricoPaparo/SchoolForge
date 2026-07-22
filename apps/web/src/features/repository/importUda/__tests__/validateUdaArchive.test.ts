import { describe, expect, it } from 'vitest';
import { validateUdaArchive } from '../validateUdaArchive.js';
import { buildUdaImportPayload, nextUdaOrder } from '../buildUdaImportPayload.js';
import { computeManifestHash } from '../manifestHash.js';
import type { RawFile } from '../../validation/types.js';

const UDA_MD = `---
titolo: "Reti"
competenze:
  - "Comprendere le reti"
obiettivi:
  - "Configurare una rete"
---

# Reti

Introduzione.`;

const LESSON_MD = `---
titolo: "Client server"
---

# Client server

Corpo.`;

const POOL_MD = `---
schema: schoolforge-pool/v2
questions:
  - id: q-001
    tipo: aperta
    difficolta: 2
    testo: Spiega HTTP.
    soluzione: HTTP è un protocollo applicativo.
---`;

function minimal(): RawFile[] {
  return [
    { path: 'uda-03-reti/uda-03-reti.md', content: UDA_MD },
    { path: 'uda-03-reti/lezione-001-client-server.md', content: LESSON_MD },
  ];
}

describe('validateUdaArchive — valid archives', () => {
  it('accepts a minimal one-UDA one-lesson archive', () => {
    const res = validateUdaArchive(minimal());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.archive.udaDir).toBe('uda-03-reti');
      expect(res.archive.lessonCount).toBe(1);
      expect(res.archive.poolCount).toBe(0);
      expect(res.archive.questionCount).toBe(0);
      expect(res.archive.udaTitle).toBe('Reti');
    }
  });

  it('accepts multiple lessons with pools plus a pool-less lesson', () => {
    const files: RawFile[] = [
      { path: 'uda-03-reti/uda-03-reti.md', content: UDA_MD },
      { path: 'uda-03-reti/lezione-001-http.md', content: LESSON_MD },
      { path: 'uda-03-reti/lezione-001-http.pool.md', content: POOL_MD },
      { path: 'uda-03-reti/lezione-002-tcp.md', content: LESSON_MD },
      { path: 'uda-03-reti/lezione-002-tcp.pool.md', content: POOL_MD },
      { path: 'uda-03-reti/lezione-003-ripasso.md', content: LESSON_MD },
    ];
    const res = validateUdaArchive(files);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.archive.lessonCount).toBe(3);
      expect(res.archive.poolCount).toBe(2);
      expect(res.archive.questionCount).toBe(2);
    }
  });
});

describe('validateUdaArchive — blocking conditions', () => {
  it('blocks an orphan pool', () => {
    const files: RawFile[] = [
      ...minimal(),
      { path: 'uda-03-reti/lezione-002-nolesson.pool.md', content: POOL_MD },
    ];
    const res = validateUdaArchive(files);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('orphan_pool');
  });

  it('blocks a non-v2 pool', () => {
    const v1: RawFile = {
      path: 'uda-03-reti/lezione-001-client-server.pool.md',
      content: `---\nschema: schoolforge-pool/v1\nquestions: []\n---`,
    };
    const res = validateUdaArchive([...minimal(), v1]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('invalid_pool');
  });

  it('blocks more than one UDA folder', () => {
    const files: RawFile[] = [
      ...minimal(),
      { path: 'uda-04-sicurezza/uda-04-sicurezza.md', content: UDA_MD },
      { path: 'uda-04-sicurezza/lezione-001-x.md', content: LESSON_MD },
    ];
    const res = validateUdaArchive(files);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('multiple_udas');
  });

  it('blocks a UDA with zero lessons', () => {
    const res = validateUdaArchive([{ path: 'uda-03-reti/uda-03-reti.md', content: UDA_MD }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('no_lessons');
  });

  it('blocks an unexpected root file (programma.md)', () => {
    const res = validateUdaArchive([...minimal(), { path: 'programma.md', content: '# x' }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('unexpected_file');
  });

  it('blocks a nested subfolder inside the UDA', () => {
    const res = validateUdaArchive([
      ...minimal(),
      { path: 'uda-03-reti/sub/lezione-002-x.md', content: LESSON_MD },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('unexpected_file');
  });

  it('blocks duplicate lesson numbers', () => {
    const res = validateUdaArchive([
      ...minimal(),
      { path: 'uda-03-reti/lezione-001-altro.md', content: LESSON_MD },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('duplicate_lesson_number');
  });

  it('blocks invalid UDA metadata (missing competenze)', () => {
    const badUda: RawFile = {
      path: 'uda-03-reti/uda-03-reti.md',
      content: `---\ntitolo: "Reti"\nobiettivi:\n  - "x"\n---\n`,
    };
    const res = validateUdaArchive([
      badUda,
      { path: 'uda-03-reti/lezione-001-client-server.md', content: LESSON_MD },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('invalid_uda_metadata');
  });

  it('blocks malformed lesson front matter (no silent degrade)', () => {
    const badLesson: RawFile = {
      path: 'uda-03-reti/lezione-001-client-server.md',
      content: `---\ntitolo: [unclosed\n---\n\nCorpo.`,
    };
    const res = validateUdaArchive([
      { path: 'uda-03-reti/uda-03-reti.md', content: UDA_MD },
      badLesson,
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('invalid_lesson_metadata');
  });

  it('blocks more than 40 lessons', () => {
    const files: RawFile[] = [{ path: 'uda-03-reti/uda-03-reti.md', content: UDA_MD }];
    for (let i = 1; i <= 41; i++) {
      files.push({
        path: `uda-03-reti/lezione-${String(i).padStart(3, '0')}-l.md`,
        content: LESSON_MD,
      });
    }
    const res = validateUdaArchive(files);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('too_many_lessons');
  });

  it('blocks more than 500 total questions', () => {
    const bigPool = (n: number): string => {
      const qs = Array.from(
        { length: n },
        (_, i) =>
          `  - id: q-${i}\n    tipo: aperta\n    difficolta: 1\n    testo: Domanda ${i}\n    soluzione: ok`,
      ).join('\n');
      return `---\nschema: schoolforge-pool/v2\nquestions:\n${qs}\n---`;
    };
    const files: RawFile[] = [{ path: 'uda-03-reti/uda-03-reti.md', content: UDA_MD }];
    // 3 lessons × 200 questions = 600 > 500.
    for (let i = 1; i <= 3; i++) {
      const base = `uda-03-reti/lezione-${String(i).padStart(3, '0')}-l`;
      files.push({ path: `${base}.md`, content: LESSON_MD });
      files.push({ path: `${base}.pool.md`, content: bigPool(200) });
    }
    const res = validateUdaArchive(files);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('too_many_questions');
  });
});

describe('buildUdaImportPayload — pure payload', () => {
  const ctx = {
    ownerUid: 'owner-1',
    programId: 'prog-1',
    activeImportId: 'imp-1',
    existingUdaOrders: [0, 1],
  };

  it('appends after max existing order and scopes ids/paths to the active import', () => {
    const files: RawFile[] = [
      { path: 'uda-03-reti/uda-03-reti.md', content: UDA_MD },
      { path: 'uda-03-reti/lezione-001-http.md', content: LESSON_MD },
      { path: 'uda-03-reti/lezione-001-http.pool.md', content: POOL_MD },
    ];
    const res = validateUdaArchive(files);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const payload = buildUdaImportPayload({ archive: res.archive, files, ...ctx });

    expect(payload.uda.data.order).toBe(2);
    expect(payload.uda.id).toBe('uda-03-reti');
    expect(payload.uda.data.competenze).toEqual(['Comprendere le reti']);
    expect(payload.lessons).toHaveLength(1);
    expect(payload.lessons[0]?.data.order).toBe(0);
    expect(payload.lessons[0]?.data.importId).toBe('imp-1');
    expect(payload.lessons[0]?.data.publicLessonId).toBe(payload.publicLessons[0]?.id);
    expect(payload.questionIndex).toHaveLength(1);
    // storagePaths = uda + lesson + pool, all under the active import.
    expect(payload.storagePaths.map((s) => s.path)).toEqual([
      'repository/owner-1/imports/imp-1/uda-03-reti/uda-03-reti.md',
      'repository/owner-1/imports/imp-1/uda-03-reti/lezione-001-http.pool.md',
      'repository/owner-1/imports/imp-1/uda-03-reti/lezione-001-http.md',
    ]);
    // Public projection never carries pool-derived fields.
    expect(payload.publicLessons[0]?.data).not.toHaveProperty('poolStorageRef');
    expect(payload.publicLessons[0]?.data).not.toHaveProperty('questionCount');
  });

  it('nextUdaOrder returns 0 for an empty import and max+1 otherwise', () => {
    expect(nextUdaOrder([])).toBe(0);
    expect(nextUdaOrder([0, 3, 1])).toBe(4);
  });

  it('produces a stable manifest hash for the same input and a different one on change', () => {
    const files = minimal();
    const res = validateUdaArchive(files);
    if (!res.ok) throw new Error('expected valid');
    const a = buildUdaImportPayload({ archive: res.archive, files, ...ctx });
    const b = buildUdaImportPayload({ archive: res.archive, files, ...ctx });
    expect(a.manifest.manifestHash).toBe(b.manifest.manifestHash);

    const changed = computeManifestHash({
      activeImportId: 'imp-1',
      udaId: a.manifest.udaId,
      storagePaths: a.storagePaths.map((s) => ({ path: s.path, content: `${s.content} edited` })),
      lessonIds: a.manifest.lessonIds,
      questionIndexIds: a.manifest.questionIndexIds,
      publicLessonIds: a.manifest.publicLessonIds,
      newUdaOrder: a.manifest.newUdaOrder,
    });
    expect(changed).not.toBe(a.manifest.manifestHash);
  });
});
