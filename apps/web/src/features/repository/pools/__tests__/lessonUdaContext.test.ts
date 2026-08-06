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
    uda: { titolo: 'UDA 1' },
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
      uda: { titolo: 'UDA 1' },
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
    expect(build({ uda: { titolo: null } })).toBeNull();
    expect(build({ uda: { titolo: '   ' } })).toBeNull();
    expect(build({ uda: null })).toBeNull();
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

/**
 * STRUCTURE-IMPORT-03 — contesto generale dell'UDA.
 *
 * I tre campi arrivano dalla **stessa** UDA già in memoria e vivono nello stesso
 * oggetto dell'indice: nessun secondo oggetto parallelo, nessuna lettura
 * aggiuntiva. Questo file è per costruzione la prova che non ci sono letture:
 * il builder è puro e non riceve nemmeno un handle Firestore.
 */
describe('contesto generale dell’UDA', () => {
  it('trasporta descrizione, competenze e obiettivi dell’UDA in memoria', () => {
    const ctx = build({
      uda: {
        titolo: 'UDA 1',
        descrizione: '  Le reti locali e il loro funzionamento.  ',
        competenze: ['  Progettare una LAN  ', 'Configurare indirizzi'],
        obiettivi: ['Riconoscere i livelli', '  Usare il modello ISO/OSI'],
      },
    });
    expect(ctx!.descrizione).toBe('Le reti locali e il loro funzionamento.');
    expect(ctx!.competenze).toEqual(['Progettare una LAN', 'Configurare indirizzi']);
    expect(ctx!.obiettivi).toEqual(['Riconoscere i livelli', 'Usare il modello ISO/OSI']);
  });

  it('legacy: descrizione assente ⇒ null, liste assenti ⇒ vuote', () => {
    for (const uda of [
      { titolo: 'UDA 1' },
      { titolo: 'UDA 1', descrizione: null, competenze: null, obiettivi: null },
      { titolo: 'UDA 1', descrizione: '   ', competenze: [], obiettivi: [] },
    ]) {
      const ctx = build({ uda });
      expect(ctx!.descrizione).toBeNull();
      expect(ctx!.competenze).toEqual([]);
      expect(ctx!.obiettivi).toEqual([]);
    }
  });

  it('valore presente ma malformato: fail-closed, nessun valore inventato', () => {
    const malformed = [
      { titolo: 'UDA 1', descrizione: 42 as unknown as string },
      { titolo: 'UDA 1', competenze: 'una sola' as unknown as string[] },
      { titolo: 'UDA 1', competenze: [1, 2] as unknown as string[] },
      { titolo: 'UDA 1', obiettivi: { a: 1 } as unknown as string[] },
      { titolo: 'UDA 1', obiettivi: ['ok', null] as unknown as string[] },
    ];
    for (const uda of malformed) {
      expect(build({ uda })).toBeNull();
    }
  });

  it('non attinge mai dal corpo Markdown né da altre fonti', () => {
    // Il builder riceve solo l'UDA e le lezioni: non esiste un parametro da cui
    // possa derivare una descrizione dal contenuto.
    const ctx = build({ uda: { titolo: 'UDA 1' } });
    expect(ctx!.descrizione).toBeNull();
    expect(Object.keys(ctx!).sort()).toEqual([
      'competenze',
      'currentLessonPosition',
      'descrizione',
      'lessons',
      'obiettivi',
      'title',
    ]);
  });
});
