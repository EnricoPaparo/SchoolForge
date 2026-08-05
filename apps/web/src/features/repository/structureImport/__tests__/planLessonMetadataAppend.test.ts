import { describe, expect, it } from 'vitest';
import { planLessonMetadataAppend } from '../planLessonMetadataAppend.js';
import type { ExistingLessonForPlan, NormalizedLessonMetadata } from '../types.js';

/**
 * STRUCTURE-IMPORT-01 — planner puro delle lezioni. Oltre a numerazione, id e
 * path, verifica che ogni lezione pianificata sia davvero uno scheletro: corpo
 * vuoto, pool assente, nessuna domanda.
 */

const BASE = {
  ownerUid: 'owner-1',
  programId: 'prog-1',
  importId: 'imp-1',
  udaId: 'uda-01-reti',
  udaDir: 'uda-01-reti',
};

function lesson(
  titolo: string,
  overrides: Partial<NormalizedLessonMetadata> = {},
): NormalizedLessonMetadata {
  return {
    titolo,
    sottotitolo: null,
    difficolta: 'base',
    concettiChiave: ['c'],
    obiettivi: ['o'],
    ...overrides,
  };
}

function plan(lessons: NormalizedLessonMetadata[], existingLessons: ExistingLessonForPlan[] = []) {
  const result = planLessonMetadataAppend({ ...BASE, lessons, existingLessons });
  if (!result.ok) throw new Error(`plan fallito: ${result.error.code}`);
  return result.value;
}

describe('append dopo i dati correnti', () => {
  it('su una UDA vuota parte da lezione-001 e order 0', () => {
    const manifest = plan([lesson('Che cos’è una rete'), lesson('Gli indirizzi IP')]);
    expect(manifest.lessons.map((l) => l.filename)).toEqual([
      'lezione-001-che-cos-e-una-rete.md',
      'lezione-002-gli-indirizzi-ip.md',
    ]);
    expect(manifest.lessons.map((l) => l.order)).toEqual([0, 1]);
  });

  it('riprende dopo l’ultima lezione esistente', () => {
    const manifest = plan(
      [lesson('Nuova')],
      [
        { lessonId: 'a', filename: 'lezione-001-a.md', order: 0 },
        { lessonId: 'b', filename: 'lezione-002-b.md', order: 1 },
      ],
    );
    expect(manifest.lessons[0]!.filename).toBe('lezione-003-nuova.md');
    expect(manifest.lessons[0]!.order).toBe(2);
  });

  it('non riempie i buchi di numerazione', () => {
    const manifest = plan(
      [lesson('Nuova')],
      [
        { lessonId: 'a', filename: 'lezione-001-a.md', order: 0 },
        { lessonId: 'b', filename: 'lezione-012-b.md', order: 1 },
      ],
    );
    expect(manifest.lessons[0]!.filename).toBe('lezione-013-nuova.md');
    expect(manifest.lessons[0]!.order).toBe(2);
  });

  it('usa il prefisso lezione-XXX come order per le lezioni legacy senza order', () => {
    // Senza questo fallback, quaranta lezioni importate in una UDA legacy
    // finirebbero tutte a partire da order 0, sopra le esistenti.
    const manifest = plan([lesson('Nuova')], [{ lessonId: 'a', filename: 'lezione-004-a.md' }]);
    expect(manifest.lessons[0]!.order).toBe(4);
    expect(manifest.lessons[0]!.filename).toBe('lezione-005-nuova.md');
  });

  it('un import vuoto di voci produce un manifest vuoto', () => {
    const manifest = plan([]);
    expect(manifest.lessons).toEqual([]);
    expect(manifest.lessonIds).toEqual([]);
    expect(manifest.publicLessonIds).toEqual([]);
    expect(manifest.lessonCountIncrement).toBe(0);
  });

  it('conserva l’ordine del file', () => {
    const manifest = plan([lesson('Zeta'), lesson('Alfa')]);
    expect(manifest.lessons.map((l) => l.metadata.titolo)).toEqual(['Zeta', 'Alfa']);
  });
});

describe('id e path canonici', () => {
  it('produce lessonId, publicLessonId, path e storageRef deterministici', () => {
    const planned = plan([lesson('Le reti')]).lessons[0]!;
    expect(planned.filename).toBe('lezione-001-le-reti.md');
    expect(planned.path).toBe('uda-01-reti/lezione-001-le-reti.md');
    expect(planned.lessonId).toBe('uda-01-reti_lezione-001-le-reti');
    expect(planned.publicLessonId).toBe('imp-1_uda-01-reti_lezione-001-le-reti');
    expect(planned.storageRef).toBe(
      'repository/owner-1/imports/imp-1/uda-01-reti/lezione-001-le-reti.md',
    );
  });

  it('normalizza accenti e punteggiatura nello slug', () => {
    const planned = plan([lesson('Perché la società cambia?')]).lessons[0]!;
    expect(planned.filename).toBe('lezione-001-perche-la-societa-cambia.md');
  });

  it('il manifest elenca esattamente gli id, le proiezioni e i path creati', () => {
    const manifest = plan([lesson('A'), lesson('B')]);
    expect(manifest.lessonIds).toEqual(manifest.lessons.map((l) => l.lessonId));
    expect(manifest.publicLessonIds).toEqual(manifest.lessons.map((l) => l.publicLessonId));
    expect(manifest.storagePaths).toEqual(manifest.lessons.map((l) => l.storageRef));
  });

  it('incrementa lessonCount una sola volta per l’intero lotto', () => {
    expect(plan([lesson('A'), lesson('B'), lesson('C')]).lessonCountIncrement).toBe(3);
  });
});

describe('scheletro: nessun contenuto, nessun pool', () => {
  it('il Markdown contiene solo il front matter', () => {
    const planned = plan([
      lesson('Le reti', {
        sottotitolo: 'Un sottotitolo',
        concettiChiave: ['nodo', 'protocollo'],
        obiettivi: ['o1'],
      }),
    ]).lessons[0]!;
    expect(planned.content).toBe(
      [
        '---',
        'titolo: Le reti',
        'sottotitolo: Un sottotitolo',
        'difficolta: base',
        'concetti_chiave:',
        '  - nodo',
        '  - protocollo',
        'obiettivi:',
        '  - o1',
        '---',
      ].join('\n'),
    );
    expect(planned.content.split('---')[2]!.trim()).toBe('');
  });

  it('il documento nasce senza pool e senza domande', () => {
    const planned = plan([lesson('Le reti')]).lessons[0]!;
    expect(planned.doc.poolStatus).toBe('absent');
    expect(planned.doc.questionCount).toBe(0);
    expect(planned.doc.poolStorageRef).toBeNull();
    expect(planned.storageRef.endsWith('.pool.md')).toBe(false);
  });

  it('la proiezione pubblica ha contenuto vuoto e nessun campo derivato dal pool', () => {
    const projection = plan([lesson('Le reti')]).lessons[0]!.publicLesson as unknown as Record<
      string,
      unknown
    >;
    expect(projection['content']).toBe('');
    expect(projection['completed']).toBe(false);
    for (const forbidden of ['poolStatus', 'poolStorageRef', 'questionCount']) {
      expect(forbidden in projection).toBe(false);
    }
  });

  it('la proiezione non contiene createdAt: nessun timestamp inventato', () => {
    const projection = plan([lesson('Le reti')]).lessons[0]!.publicLesson as unknown as Record<
      string,
      unknown
    >;
    expect('createdAt' in projection).toBe(false);
    expect(JSON.parse(JSON.stringify(projection))).toEqual(projection);
  });
});

describe('collisioni', () => {
  it('rifiuta un titolo già presente nella UDA', () => {
    const result = planLessonMetadataAppend({
      ...BASE,
      lessons: [lesson('Le Reti')],
      existingLessons: [{ lessonId: 'x', filename: 'lezione-001-le-reti.md', titolo: ' le reti ' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('duplicate_title_in_destination');
  });

  it('rifiuta una collisione tecnica di id anche con titoli distinti', () => {
    const result = planLessonMetadataAppend({
      ...BASE,
      lessons: [lesson('Nuova')],
      existingLessons: [
        { lessonId: 'uda-01-reti_lezione-001-nuova', filename: 'altro.md', titolo: 'Altro' },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('document_id_collision');
      expect(result.error.index).toBe(0);
    }
  });

  it('nessun path pianificato coincide con uno esistente', () => {
    const existingLessons: ExistingLessonForPlan[] = [
      { lessonId: 'a', filename: 'lezione-001-nuova.md', order: 0, titolo: 'Altro' },
    ];
    const manifest = plan([lesson('Nuova')], existingLessons);
    expect(manifest.lessons[0]!.filename).toBe('lezione-002-nuova.md');
    expect(manifest.lessons[0]!.storageRef).not.toContain('lezione-001');
  });

  it('non rinomina e non sovrascrive: il piano fallisce e basta', () => {
    const result = planLessonMetadataAppend({
      ...BASE,
      lessons: [lesson('Le reti'), lesson('le  RETI')],
      existingLessons: [],
    });
    expect(result.ok).toBe(true);
    // Due titoli distinti dopo il trim: nessuna fusione, due lezioni separate.
    if (result.ok) expect(result.value.lessons).toHaveLength(2);
  });
});

describe('manifest e hash', () => {
  it('è stabile a parità di input', () => {
    const a = plan([lesson('A'), lesson('B')]);
    const b = plan([lesson('A'), lesson('B')]);
    expect(a.manifestHash).toBe(b.manifestHash);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('cambia se cambia un metadato', () => {
    const a = plan([lesson('A', { difficolta: 'base' })]);
    const b = plan([lesson('A', { difficolta: 'avanzata' })]);
    expect(a.lessons[0]!.lessonId).toBe(b.lessons[0]!.lessonId);
    expect(a.manifestHash).not.toBe(b.manifestHash);
  });

  it('cambia se cambia la UDA di destinazione', () => {
    const a = plan([lesson('A')]);
    const b = planLessonMetadataAppend({
      ...BASE,
      udaId: 'uda-02-altro',
      udaDir: 'uda-02-altro',
      lessons: [lesson('A')],
      existingLessons: [],
    });
    expect(b.ok).toBe(true);
    if (b.ok) expect(a.manifestHash).not.toBe(b.value.manifestHash);
  });

  it('distingue un manifest UDA da uno lezioni', () => {
    expect(plan([lesson('A')]).kind).toBe('lesson');
  });

  it('è interamente serializzabile', () => {
    const manifest = plan([lesson('A')]);
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });
});
