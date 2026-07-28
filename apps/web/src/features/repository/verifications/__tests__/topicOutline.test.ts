import { describe, expect, it } from 'vitest';
import {
  buildTopicOutline,
  readTopicOutline,
  TopicOutlineError,
  TOPIC_OUTLINE_LIMITS,
} from '../topicOutline.js';

// Ordine canonico del corso: UDA2 prima di UDA1 di proposito, così un eventuale
// riordino alfabetico si vedrebbe subito.
const UDAS = [
  { dir: 'UDA2', titolo: 'Il Web' },
  { dir: 'UDA1', titolo: 'Intelligenza artificiale' },
];

const LESSONS = [
  { udaDir: 'UDA2', filename: 'z-internet.md', titolo: 'Come funziona Internet' },
  { udaDir: 'UDA2', filename: 'a-server.md', titolo: 'Il server non è una sola macchina' },
  { udaDir: 'UDA2', filename: 'm-http.md', titolo: 'Il protocollo HTTP' },
  { udaDir: 'UDA1', filename: 'llm.md', titolo: 'Introduzione ai modelli linguistici' },
];

function ref(udaDir: string, lessonFilename: string) {
  return { udaDir, lessonFilename };
}

describe('buildTopicOutline (UI-VERIFICHE-06B)', () => {
  it('raggruppa per UDA e include solo le lezioni con almeno una domanda', () => {
    const outline = buildTopicOutline({
      questionRefs: [ref('UDA2', 'z-internet.md'), ref('UDA1', 'llm.md')],
      udas: UDAS,
      lessons: LESSONS,
    });
    expect(outline).toEqual([
      { udaTitle: 'Il Web', lessonTitles: ['Come funziona Internet'] },
      {
        udaTitle: 'Intelligenza artificiale',
        lessonTitles: ['Introduzione ai modelli linguistici'],
      },
    ]);
    // «Il protocollo HTTP» e «Il server…» non hanno domande selezionate: fuori.
    expect(JSON.stringify(outline)).not.toContain('HTTP');
    expect(JSON.stringify(outline)).not.toContain('Il server');
  });

  it('deduplica: più domande dalla stessa lezione non la ripetono, né ripetono l’UDA', () => {
    const outline = buildTopicOutline({
      questionRefs: [
        ref('UDA2', 'z-internet.md'),
        ref('UDA2', 'z-internet.md'),
        ref('UDA2', 'a-server.md'),
        ref('UDA2', 'z-internet.md'),
      ],
      udas: UDAS,
      lessons: LESSONS,
    });
    expect(outline).toHaveLength(1);
    expect(outline[0]!.lessonTitles).toEqual([
      'Come funziona Internet',
      'Il server non è una sola macchina',
    ]);
  });

  it('rispetta l’ordine canonico di UDA e lezioni, mai quello alfabetico o di selezione', () => {
    const outline = buildTopicOutline({
      // Selezione volutamente in ordine inverso rispetto al corso.
      questionRefs: [
        ref('UDA1', 'llm.md'),
        ref('UDA2', 'a-server.md'),
        ref('UDA2', 'z-internet.md'),
      ],
      udas: UDAS,
      lessons: LESSONS,
    });
    expect(outline.map((u) => u.udaTitle)).toEqual(['Il Web', 'Intelligenza artificiale']);
    // `z-internet.md` precede `a-server.md` nell'albero: l'ordine canonico vince
    // sull'ordinamento alfabetico dei filename e sull'ordine di selezione.
    expect(outline[0]!.lessonTitles).toEqual([
      'Come funziona Internet',
      'Il server non è una sola macchina',
    ]);
  });

  it('non contiene mai id, filename, testi, soluzioni o metadati tecnici', () => {
    const outline = buildTopicOutline({
      questionRefs: [ref('UDA2', 'z-internet.md')],
      udas: UDAS,
      lessons: LESSONS,
    });
    const serialized = JSON.stringify(outline);
    for (const forbidden of [
      'UDA2',
      'z-internet.md',
      'questionIndexEntryId',
      'questionLocalId',
      'poolStorageRef',
      'order',
      'difficolta',
      'maxPoints',
      'soluzione',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(Object.keys(outline[0]!)).toEqual(['udaTitle', 'lessonTitles']);
  });

  it('fail-closed su titoli mancanti o vuoti', () => {
    expect(() =>
      buildTopicOutline({
        questionRefs: [ref('UDA2', 'z-internet.md')],
        udas: [{ dir: 'UDA2', titolo: '   ' }],
        lessons: LESSONS,
      }),
    ).toThrow(TopicOutlineError);
    expect(() =>
      buildTopicOutline({
        questionRefs: [ref('UDA2', 'z-internet.md')],
        udas: UDAS,
        lessons: [{ udaDir: 'UDA2', filename: 'z-internet.md', titolo: null }],
      }),
    ).toThrow(TopicOutlineError);
  });

  it('fail-closed quando una domanda punta a una lezione non più nel corso', () => {
    expect(() =>
      buildTopicOutline({
        questionRefs: [ref('UDA2', 'sparita.md')],
        udas: UDAS,
        lessons: LESSONS,
      }),
    ).toThrow(/non fa più parte del corso/);
  });

  it('rifiuta un perimetro oltre i limiti di dimensione', () => {
    const many = Array.from({ length: TOPIC_OUTLINE_LIMITS.MAX_UDAS + 1 }, (_, index) => ({
      dir: `U${index}`,
      titolo: `UDA ${index}`,
    }));
    const manyLessons = many.map((uda) => ({
      udaDir: uda.dir,
      filename: 'l.md',
      titolo: 'Lezione',
    }));
    expect(() =>
      buildTopicOutline({
        questionRefs: many.map((uda) => ref(uda.dir, 'l.md')),
        udas: many,
        lessons: manyLessons,
      }),
    ).toThrow(/limite di \d+ UDA/);
  });

  it('rifiuta un titolo oltre la lunghezza massima', () => {
    expect(() =>
      buildTopicOutline({
        questionRefs: [ref('UDA2', 'z-internet.md')],
        udas: [{ dir: 'UDA2', titolo: 'x'.repeat(TOPIC_OUTLINE_LIMITS.MAX_TITLE_LENGTH + 1) }],
        lessons: LESSONS,
      }),
    ).toThrow(/troppo lungo/);
  });

  /**
   * VEX: il perimetro è l'unione delle lezioni di **tutte** le domande
   * selezionate — comuni e alternative. È quindi identico per ogni studente e non
   * dice nulla su quale variante sia stata assegnata.
   */
  it('VEX — è l’unione delle lezioni e non rivela la variante assegnata', () => {
    const comuni = [ref('UDA2', 'z-internet.md')];
    const alternativeA = [ref('UDA2', 'a-server.md')];
    const alternativeB = [ref('UDA2', 'm-http.md')];

    const perimetro = buildTopicOutline({
      questionRefs: [...comuni, ...alternativeA, ...alternativeB],
      udas: UDAS,
      lessons: LESSONS,
    });

    // Contiene tutte e tre le lezioni, quale che sia la variante assegnata…
    expect(perimetro[0]!.lessonTitles).toEqual([
      'Come funziona Internet',
      'Il server non è una sola macchina',
      'Il protocollo HTTP',
    ]);
    // …e nessuna informazione che permetta di distinguere le alternative.
    const serialized = JSON.stringify(perimetro);
    expect(serialized).not.toContain('alternative');
    expect(serialized).not.toContain('assigned');
    // Lo stesso input produce lo stesso identico perimetro per ogni studente.
    expect(
      buildTopicOutline({
        questionRefs: [...alternativeB, ...comuni, ...alternativeA],
        udas: UDAS,
        lessons: LESSONS,
      }),
    ).toEqual(perimetro);
  });
});

describe('readTopicOutline — lettura difensiva', () => {
  it('accetta un perimetro ben formato', () => {
    const value = [{ udaTitle: 'Il Web', lessonTitles: ['Come funziona Internet'] }];
    expect(readTopicOutline(value)).toEqual(value);
  });

  it('restituisce null (mai un errore, mai un dato parziale) su payload malformato', () => {
    for (const bad of [
      undefined,
      null,
      [],
      'stringa',
      [{ udaTitle: '', lessonTitles: ['x'] }],
      [{ udaTitle: 'Il Web', lessonTitles: [] }],
      [{ udaTitle: 'Il Web', lessonTitles: ['ok', ''] }],
      [{ udaTitle: 'Il Web', lessonTitles: ['ok', 42] }],
      [{ udaTitle: 'Il Web' }],
      [{ lessonTitles: ['ok'] }],
      [42],
    ]) {
      expect(readTopicOutline(bad)).toBeNull();
    }
  });
});
