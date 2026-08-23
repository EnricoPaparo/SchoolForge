import { describe, expect, it } from 'vitest';
import {
  checkLessonForVisual,
  checkProjectionForVisual,
  describeVisualBindingFailure,
  resolveVisualPublicLessonId,
  type VisualLessonBindingFailure,
  type VisualLessonSnapshot,
  type VisualPublicLessonSnapshot,
} from './aiVisualLessonBinding.js';

/**
 * VISUAL-ENRICHMENT-03A — il cancello di identità lato server.
 *
 * Il difetto che questi test esistono per impedire è quello già corretto una
 * volta in CONCEPT-MAP-02: owner, import e corso coincidono anche fra due
 * lezioni **diverse** dello stesso docente, quindi passare l'id pubblico della
 * lezione B mentre si arricchisce la lezione A supererebbe tutti e tre i
 * controlli. L'id non si accetta: si deriva.
 */

const LESSON: VisualLessonSnapshot = {
  ownerUid: 'owner-uid',
  importId: 'imp-1',
  udaDir: 'uda-01',
  path: 'uda-01/lezione-01.md',
  filename: 'lezione-01.md',
  publicLessonId: 'imp-1_lesson-1',
  completed: false,
};

const PUBLIC: VisualPublicLessonSnapshot = {
  ownerUid: 'owner-uid',
  programId: 'prog-1',
  importId: 'imp-1',
  udaDir: 'uda-01',
  path: 'uda-01/lezione-01.md',
  filename: 'lezione-01.md',
  content: '# Lezione\n\n## La fotosintesi\n',
  completed: false,
};

const projection = (over: Partial<VisualPublicLessonSnapshot> = {}) => ({ ...PUBLIC, ...over });
const lesson = (over: Partial<VisualLessonSnapshot> = {}) => ({ ...LESSON, ...over });

describe('resolveVisualPublicLessonId', () => {
  it('usa l’id memorizzato quando c’è', () => {
    expect(resolveVisualPublicLessonId(LESSON, 'lesson-1')).toBe('imp-1_lesson-1');
  });

  /** Una lezione importata prima di HARD-02B-1 proietta sotto il lessonId nudo. */
  it('ricade sul lessonId nudo per i documenti legacy', () => {
    expect(resolveVisualPublicLessonId(lesson({ publicLessonId: undefined }), 'lesson-1')).toBe(
      'lesson-1',
    );
    expect(resolveVisualPublicLessonId(lesson({ publicLessonId: '' }), 'lesson-1')).toBe(
      'lesson-1',
    );
    expect(resolveVisualPublicLessonId(lesson({ publicLessonId: 42 }), 'lesson-1')).toBe(
      'lesson-1',
    );
  });
});

describe('checkLessonForVisual', () => {
  const base = { lessonId: 'lesson-1', ownerUid: 'owner-uid', importId: 'imp-1' };

  it('deriva id pubblico e udaDir da una lezione coerente', () => {
    expect(checkLessonForVisual({ ...base, lesson: LESSON })).toEqual({
      ok: true,
      publicLessonId: 'imp-1_lesson-1',
      udaDir: 'uda-01',
    });
  });

  it('rifiuta una lezione assente', () => {
    expect(checkLessonForVisual({ ...base, lesson: null })).toEqual({
      ok: false,
      failure: 'lesson_missing',
    });
  });

  it('rifiuta la lezione di un altro docente', () => {
    expect(checkLessonForVisual({ ...base, lesson: lesson({ ownerUid: 'altro' }) })).toEqual({
      ok: false,
      failure: 'owner_mismatch',
    });
  });

  it('rifiuta un import diverso', () => {
    expect(checkLessonForVisual({ ...base, lesson: lesson({ importId: 'imp-2' }) })).toEqual({
      ok: false,
      failure: 'import_mismatch',
    });
  });

  /**
   * `udaDir` finisce dentro un path di Storage: qui non è un metadato ma un
   * segmento, e valori come `..` sposterebbero il blob fuori dal repository del
   * docente.
   */
  it('rifiuta un udaDir mancante, vuoto o usabile come traversal', () => {
    for (const bad of [undefined, '', ' uda', 'uda ', 'a/b', '.', '..', 42, null]) {
      expect(checkLessonForVisual({ ...base, lesson: lesson({ udaDir: bad }) })).toEqual({
        ok: false,
        failure: 'uda_dir_missing',
      });
    }
  });
});

describe('checkProjectionForVisual', () => {
  const base = {
    lesson: LESSON,
    programId: 'prog-1',
    importId: 'imp-1',
    ownerUid: 'owner-uid',
  };

  it('restituisce corpo e stato di svolgimento da una proiezione coerente', () => {
    expect(checkProjectionForVisual({ ...base, publicLesson: PUBLIC })).toEqual({
      ok: true,
      body: PUBLIC.content,
      completed: false,
    });
  });

  it('legge completed = true quando entrambi i documenti lo dicono', () => {
    expect(
      checkProjectionForVisual({
        ...base,
        lesson: lesson({ completed: true }),
        publicLesson: projection({ completed: true }),
      }),
    ).toEqual({ ok: true, body: PUBLIC.content, completed: true });
  });

  /**
   * `completed` decide se l'immagine sarà visibile allo studente: leggerlo da
   * un solo documento significherebbe fidarsi di una sincronizzazione invece di
   * verificarla.
   */
  it('rifiuta se lo stato di svolgimento diverge fra i due documenti', () => {
    expect(
      checkProjectionForVisual({
        ...base,
        lesson: lesson({ completed: true }),
        publicLesson: projection({ completed: false }),
      }),
    ).toEqual({ ok: false, failure: 'projection_identity_mismatch' });
    expect(
      checkProjectionForVisual({
        ...base,
        lesson: lesson({ completed: false }),
        publicLesson: projection({ completed: true }),
      }),
    ).toEqual({ ok: false, failure: 'projection_identity_mismatch' });
  });

  it('tratta completed assente come false su entrambi i lati', () => {
    expect(
      checkProjectionForVisual({
        ...base,
        lesson: lesson({ completed: undefined }),
        publicLesson: projection({ completed: undefined }),
      }),
    ).toEqual({ ok: true, body: PUBLIC.content, completed: false });
  });

  it('rifiuta una proiezione assente', () => {
    expect(checkProjectionForVisual({ ...base, publicLesson: null })).toEqual({
      ok: false,
      failure: 'projection_missing',
    });
  });

  it('rifiuta appartenenze diverse', () => {
    const cases: Array<[Partial<VisualPublicLessonSnapshot>, VisualLessonBindingFailure]> = [
      [{ ownerUid: 'altro' }, 'projection_owner_mismatch'],
      [{ importId: 'imp-2' }, 'projection_import_mismatch'],
      [{ programId: 'prog-2' }, 'projection_program_mismatch'],
    ];
    for (const [over, failure] of cases) {
      expect(checkProjectionForVisual({ ...base, publicLesson: projection(over) })).toEqual({
        ok: false,
        failure,
      });
    }
  });

  /** L'indirizzo giusto non basta se all'indirizzo c'è un'altra lezione. */
  it('rifiuta una proiezione che non è di questa lezione', () => {
    for (const over of [
      { udaDir: 'uda-02' },
      { path: 'uda-01/lezione-02.md' },
      { filename: 'lezione-02.md' },
    ]) {
      expect(checkProjectionForVisual({ ...base, publicLesson: projection(over) })).toEqual({
        ok: false,
        failure: 'projection_identity_mismatch',
      });
    }
  });

  /**
   * Una proiezione legacy senza `content` non è arricchibile. Non si ripara
   * nulla in automatico: l'ancora deve risolversi contro il testo davvero
   * renderizzato, e qui quel testo non c'è.
   */
  it('rifiuta una proiezione senza corpo invece di ripararla', () => {
    for (const bad of [undefined, null, '', 42, {}]) {
      expect(
        checkProjectionForVisual({ ...base, publicLesson: projection({ content: bad }) }),
      ).toEqual({ ok: false, failure: 'projection_content_missing' });
    }
  });
});

describe('describeVisualBindingFailure', () => {
  it('descrive ogni motivo di rifiuto senza cadere nel generico', () => {
    const failures: VisualLessonBindingFailure[] = [
      'lesson_missing',
      'owner_mismatch',
      'import_mismatch',
      'uda_dir_missing',
      'projection_missing',
      'projection_owner_mismatch',
      'projection_import_mismatch',
      'projection_program_mismatch',
      'projection_identity_mismatch',
      'projection_content_missing',
    ];
    for (const failure of failures) {
      const message = describeVisualBindingFailure(failure);
      expect(message.length).toBeGreaterThan(0);
      expect(message.endsWith('.')).toBe(true);
    }
  });

  /** Un messaggio non deve rivelare a un chiamante non proprietario che cosa esiste. */
  it('non espone identificatori interni', () => {
    for (const failure of ['owner_mismatch', 'projection_identity_mismatch'] as const) {
      expect(describeVisualBindingFailure(failure)).not.toMatch(/imp-1|owner-uid|prog-1/);
    }
  });
});
