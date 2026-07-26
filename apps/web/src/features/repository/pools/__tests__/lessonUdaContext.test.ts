import { describe, expect, it } from 'vitest';
import { buildLessonUdaContext, type UdaOutlineSourceLesson } from '../lessonUdaContext.js';

/**
 * AIGEN-CONTEXT-01 — l'indice UDA nasce dall'albero **già in memoria**: queste
 * prove sono pure (nessun mock Firestore) proprio perché il builder non legge
 * nulla. L'ordine di input è quello canonico del workspace.
 */
const TREE: UdaOutlineSourceLesson[] = [
  { id: 'l1', udaDir: 'uda-01', titolo: 'Introduzione', sottotitolo: null },
  { id: 'l2', udaDir: 'uda-01', titolo: 'Le reti', sottotitolo: '  Trasporto  ' },
  { id: 'l3', udaDir: 'uda-01', titolo: 'Il routing', sottotitolo: '' },
  // Lezione di un'altra UDA: non deve mai comparire nell'indice.
  { id: 'l9', udaDir: 'uda-02', titolo: 'Altra UDA', sottotitolo: null },
];

function build(over: Partial<Parameters<typeof buildLessonUdaContext>[0]> = {}) {
  return buildLessonUdaContext({
    lessons: TREE,
    udaDir: 'uda-01',
    udaTitle: 'UDA 1',
    currentLessonId: 'l2',
    ...over,
  });
}

describe('buildLessonUdaContext', () => {
  it('builds a deterministic 1-based outline limited to the current UDA', () => {
    const ctx = build();
    expect(ctx).not.toBeNull();
    expect(ctx!.title).toBe('UDA 1');
    expect(ctx!.lessons).toEqual([
      { position: 1, titolo: 'Introduzione', sottotitolo: null },
      { position: 2, titolo: 'Le reti', sottotitolo: 'Trasporto' },
      { position: 3, titolo: 'Il routing', sottotitolo: null },
    ]);
    // Nessuna lezione di un'altra UDA.
    expect(ctx!.lessons.some((l) => l.titolo === 'Altra UDA')).toBe(false);
  });

  it('marks the current lesson position, exactly once', () => {
    expect(build({ currentLessonId: 'l1' })!.currentLessonPosition).toBe(1);
    expect(build({ currentLessonId: 'l2' })!.currentLessonPosition).toBe(2);
    expect(build({ currentLessonId: 'l3' })!.currentLessonPosition).toBe(3);
    const ctx = build();
    const atCurrent = ctx!.lessons.filter((l) => l.position === ctx!.currentLessonPosition);
    expect(atCurrent).toHaveLength(1);
  });

  it('preserves the canonical input order (no re-sorting of its own)', () => {
    const reordered: UdaOutlineSourceLesson[] = [
      { id: 'l3', udaDir: 'uda-01', titolo: 'Il routing', sottotitolo: null },
      { id: 'l1', udaDir: 'uda-01', titolo: 'Introduzione', sottotitolo: null },
      { id: 'l2', udaDir: 'uda-01', titolo: 'Le reti', sottotitolo: null },
    ];
    const ctx = buildLessonUdaContext({
      lessons: reordered,
      udaDir: 'uda-01',
      udaTitle: 'UDA 1',
      currentLessonId: 'l1',
    });
    expect(ctx!.lessons.map((l) => l.titolo)).toEqual(['Il routing', 'Introduzione', 'Le reti']);
    expect(ctx!.currentLessonPosition).toBe(2);
  });

  it('is deterministic for the same input', () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it('never leaks technical identifiers', () => {
    const serialized = JSON.stringify(build());
    for (const forbidden of [
      'id',
      'udaDir',
      'l1',
      'l2',
      'l3',
      'uda-01',
      'filename',
      'storageRef',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    for (const item of build()!.lessons) {
      expect(Object.keys(item).sort()).toEqual(['position', 'sottotitolo', 'titolo']);
    }
  });

  it('fails closed instead of inventing an outline', () => {
    // UDA senza titolo.
    expect(build({ udaTitle: null })).toBeNull();
    expect(build({ udaTitle: '   ' })).toBeNull();
    // Nessuna lezione nella UDA.
    expect(build({ udaDir: 'uda-99' })).toBeNull();
    expect(build({ lessons: [] })).toBeNull();
    // Lezione corrente non presente nell'indice.
    expect(build({ currentLessonId: 'sconosciuta' })).toBeNull();
    // Una lezione senza titolo renderebbe l'indice ambiguo.
    expect(
      build({
        lessons: [
          { id: 'l1', udaDir: 'uda-01', titolo: '  ', sottotitolo: null },
          { id: 'l2', udaDir: 'uda-01', titolo: 'Le reti', sottotitolo: null },
        ],
      }),
    ).toBeNull();
  });
});
