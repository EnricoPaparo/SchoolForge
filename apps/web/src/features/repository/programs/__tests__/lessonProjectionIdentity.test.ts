import { describe, expect, it } from 'vitest';
import {
  checkLessonBeforeProjection,
  checkProjectionMatchesLesson,
  identityFailureMessage,
} from '../lessonProjectionIdentity.js';
import type { LessonDoc, PublicLessonDoc } from '../../../../types/firestore.js';

/**
 * CONCEPT-MAP-02 (review fix) — l'helper condiviso.
 *
 * Il caso che giustifica questo modulo: due lezioni dello stesso corso, import
 * e docente superano owner/import/programId. Senza derivare l'id pubblico dal
 * `LessonDoc`, passare l'id della lezione B mentre si modifica la A scriverebbe
 * la copia privata su A e quella pubblica su B.
 */

const LESSON = {
  ownerUid: 'owner-1',
  importId: 'import-1',
  udaDir: 'uda-01-reti',
  path: 'uda-01-reti/lezione-001.md',
  filename: 'lezione-001.md',
  publicLessonId: 'import-1_lesson-a',
} as unknown as LessonDoc;

const PROJECTION = {
  ownerUid: 'owner-1',
  importId: 'import-1',
  programId: 'program-1',
  udaDir: 'uda-01-reti',
  path: 'uda-01-reti/lezione-001.md',
  filename: 'lezione-001.md',
} as unknown as PublicLessonDoc;

function gate(over: Record<string, unknown> = {}) {
  return checkLessonBeforeProjection({
    lesson: LESSON,
    lessonId: 'lesson-a',
    ownerUid: 'owner-1',
    importId: 'import-1',
    ...over,
  });
}

describe('primo cancello — id pubblico derivato dal LessonDoc', () => {
  it('deriva l’id import-scoped memorizzato', () => {
    const result = gate({ requestedPublicLessonId: 'import-1_lesson-a' });
    expect(result).toEqual({ ok: true, publicLessonId: 'import-1_lesson-a' });
  });

  it('accetta l’assenza dell’id proposto: l’id corretto si ricava comunque', () => {
    expect(gate()).toEqual({ ok: true, publicLessonId: 'import-1_lesson-a' });
    expect(gate({ requestedPublicLessonId: null })).toEqual({
      ok: true,
      publicLessonId: 'import-1_lesson-a',
    });
  });

  it('rifiuta l’id di un’altra lezione dello stesso corso e import', () => {
    // Il caso del blocker: owner, import e programma coincidono, eppure la
    // proiezione è di un'altra lezione.
    expect(gate({ requestedPublicLessonId: 'import-1_lesson-b' })).toEqual({
      ok: false,
      failure: 'public_lesson_id_mismatch',
    });
  });

  it('legacy senza publicLessonId: ricade sul lessonId nudo', () => {
    const legacy = { ...LESSON, publicLessonId: undefined } as unknown as LessonDoc;
    expect(
      checkLessonBeforeProjection({
        lesson: legacy,
        lessonId: 'lesson-a',
        requestedPublicLessonId: 'lesson-a',
        ownerUid: 'owner-1',
        importId: 'import-1',
      }),
    ).toEqual({ ok: true, publicLessonId: 'lesson-a' });
  });

  it('legacy + id import-scoped inventato: rifiutato, nessun secondo tentativo', () => {
    const legacy = { ...LESSON, publicLessonId: undefined } as unknown as LessonDoc;
    expect(
      checkLessonBeforeProjection({
        lesson: legacy,
        lessonId: 'lesson-a',
        requestedPublicLessonId: 'import-1_lesson-a',
        ownerUid: 'owner-1',
        importId: 'import-1',
      }),
    ).toEqual({ ok: false, failure: 'public_lesson_id_mismatch' });
  });

  it('rifiuta lezione assente, owner o import divergenti', () => {
    expect(gate({ lesson: null })).toEqual({ ok: false, failure: 'lesson_missing' });
    expect(gate({ ownerUid: 'altro' })).toEqual({ ok: false, failure: 'owner_mismatch' });
    expect(gate({ importId: 'import-2' })).toEqual({ ok: false, failure: 'import_mismatch' });
  });
});

describe('secondo cancello — la proiezione corrisponde alla lezione', () => {
  function check(over: Partial<Record<string, unknown>> = {}) {
    return checkProjectionMatchesLesson({
      lesson: LESSON,
      publicLesson: { ...PROJECTION, ...over } as unknown as PublicLessonDoc,
      programId: 'program-1',
      importId: 'import-1',
      ownerUid: 'owner-1',
    });
  }

  it('accetta una proiezione coerente', () => {
    expect(check()).toEqual({ ok: true });
  });

  it('rifiuta una proiezione assente', () => {
    expect(
      checkProjectionMatchesLesson({
        lesson: LESSON,
        publicLesson: null,
        programId: 'program-1',
        importId: 'import-1',
        ownerUid: 'owner-1',
      }),
    ).toEqual({ ok: false, failure: 'projection_missing' });
  });

  it('rifiuta appartenenza divergente', () => {
    expect(check({ ownerUid: 'altro' })).toEqual({
      ok: false,
      failure: 'projection_owner_mismatch',
    });
    expect(check({ importId: 'import-2' })).toEqual({
      ok: false,
      failure: 'projection_import_mismatch',
    });
    expect(check({ programId: 'program-2' })).toEqual({
      ok: false,
      failure: 'projection_program_mismatch',
    });
  });

  it.each([
    ['udaDir', { udaDir: 'uda-02-altro' }],
    ['path', { path: 'uda-01-reti/lezione-009.md' }],
    ['filename', { filename: 'lezione-009.md' }],
  ])('rifiuta una divergenza su %s', (_label, over) => {
    expect(check(over)).toEqual({ ok: false, failure: 'projection_identity_mismatch' });
  });
});

describe('messaggi', () => {
  it('ogni motivo ha un messaggio leggibile e non vuoto', () => {
    const failures = [
      'lesson_missing',
      'owner_mismatch',
      'import_mismatch',
      'public_lesson_id_mismatch',
      'projection_missing',
      'projection_owner_mismatch',
      'projection_import_mismatch',
      'projection_program_mismatch',
      'projection_identity_mismatch',
    ] as const;
    for (const failure of failures) {
      expect(identityFailureMessage(failure).length).toBeGreaterThan(0);
    }
  });
});
