import { describe, expect, it } from 'vitest';
import {
  assignLessonHeadingSlugs,
  canonicalLessonHeadingText,
  lessonHeadingSlug,
  nextLessonHeadingSlug,
} from './headingSlug.js';

/**
 * L'identità degli heading, in un solo posto.
 *
 * Questi test **sono** il contratto: il renderer web e le Functions chiamano
 * queste funzioni, non una propria copia. Fino a VE-04A esistevano due
 * implementazioni tenute insieme da una tabella, ed erano comunque divergenti —
 * la tabella era stata scritta guardandone una sola.
 */

const canonical = canonicalLessonHeadingText;
const slug = (text: string) => lessonHeadingSlug(canonicalLessonHeadingText(text));

describe('canonicalLessonHeadingText — via la sintassi, resta il contenuto', () => {
  it('rimuove l’enfasi Markdown', () => {
    expect(canonical('**Reti**')).toBe('Reti');
    expect(canonical('*Reti*')).toBe('Reti');
    expect(canonical('_Reti_')).toBe('Reti');
    expect(canonical('***Reti***')).toBe('Reti');
  });

  it('rimuove il codice inline', () => {
    expect(canonical('`Reti`')).toBe('Reti');
    expect(canonical('Il tag `<br>` in HTML')).toBe('Il tag in HTML');
  });

  /** Il testo del link resta, l'URL no: nella pagina si legge il testo. */
  it('risolve i link inline e referenziati lasciando il solo testo', () => {
    expect(canonical('[Reti](https://esempio.it)')).toBe('Reti');
    expect(canonical('[Reti][rif]')).toBe('Reti');
    expect(canonical('Vedi [le reti](https://esempio.it/a?b=1) locali')).toBe(
      'Vedi le reti locali',
    );
  });

  it('rimuove l’HTML inline lasciando uno spazio', () => {
    expect(canonical('Reti<br>locali')).toBe('Reti locali');
    expect(canonical('<em>Reti</em>')).toBe('Reti');
  });

  it('collassa gli spazi e taglia i bordi', () => {
    expect(canonical('  Reti   locali  ')).toBe('Reti locali');
  });

  it('lascia intatto un testo già canonico', () => {
    expect(canonical('Le reti locali')).toBe('Le reti locali');
  });

  /** Tutte le forme di «Reti» devono convergere sullo stesso identificatore. */
  it('le forme sintattiche diverse dello stesso titolo convergono', () => {
    const forms = ['Reti', '**Reti**', '*Reti*', '`Reti`', '[Reti](https://x.it)', '<b>Reti</b>'];
    const slugs = new Set(forms.map(slug));
    expect(slugs).toEqual(new Set(['reti']));
  });
});

describe('lessonHeadingSlug', () => {
  const cases: Array<[string, string]> = [
    ['La fotosintesi', 'la-fotosintesi'],
    ["L'acqua", 'lacqua'],
    ['L’energia', 'lenergia'],
    ['Perché è così?', 'perche-e-cosi'],
    ['Città e società', 'citta-e-societa'],
    ['1. Introduzione', '1-introduzione'],
    ['A—B', 'a-b'],
    ['CAPS LOCK', 'caps-lock'],
    ['---', 'sezione'],
    ['\u{1F331} solo emoji', 'solo-emoji'],
  ];

  for (const [text, expected] of cases) {
    it(`«${text}» → «${expected}»`, () => {
      expect(slug(text)).toBe(expected);
    });
  }

  /**
   * In italiano l'apostrofo **unisce** due parole: trasformarlo in separatore
   * produrrebbe `l-acqua`, che non è come si legge il titolo.
   */
  it('elimina gli apostrofi invece di trasformarli in separatori', () => {
    expect(slug("L'acqua")).toBe('lacqua');
    expect(slug('L’acqua')).toBe('lacqua');
    expect(slug("Dall'alto")).toBe('dallalto');
  });

  it('un heading senza caratteri utili riceve il fallback, mai un id vuoto', () => {
    for (const text of ['---', '***', '   ', '\u{1F331}', '###']) {
      expect(slug(text)).toBe('sezione');
    }
  });

  it('è idempotente su uno slug già normalizzato', () => {
    expect(lessonHeadingSlug('la-fotosintesi')).toBe('la-fotosintesi');
  });
});

describe('numerazione dei duplicati', () => {
  it('la prima occorrenza non porta suffisso, poi -2 e -3', () => {
    const occ = new Map<string, number>();
    expect(nextLessonHeadingSlug('reti', occ)).toBe('reti');
    expect(nextLessonHeadingSlug('reti', occ)).toBe('reti-2');
    expect(nextLessonHeadingSlug('reti', occ)).toBe('reti-3');
  });

  /**
   * Il contatore è sullo **slug**, non sul testo: due titoli diversi che
   * producono lo stesso slug collidono davvero nel DOM, e contare per testo
   * lascerebbe due elementi con lo stesso `id`.
   */
  it('due testi diversi che collidono sullo slug vengono numerati', () => {
    const refs = assignLessonHeadingSlugs([
      { text: 'Reti locali', level: 2 },
      { text: 'Reti, locali!', level: 2 },
    ]);
    expect(refs.map((r) => r.slug)).toEqual(['reti-locali', 'reti-locali-2']);
  });

  it('assegna indice, testo, slug e livello nell’ordine del documento', () => {
    const refs = assignLessonHeadingSlugs([
      { text: 'Reti', level: 2 },
      { text: 'Dettaglio', level: 3 },
      { text: 'Reti', level: 2 },
    ]);
    expect(refs).toEqual([
      { index: 0, text: 'Reti', slug: 'reti', level: 2 },
      { index: 1, text: 'Dettaglio', slug: 'dettaglio', level: 3 },
      { index: 2, text: 'Reti', slug: 'reti-2', level: 2 },
    ]);
  });

  it('gli heading senza testo utile collidono sul fallback e vengono numerati', () => {
    const refs = assignLessonHeadingSlugs([
      { text: canonical('---'), level: 2 },
      { text: canonical('***'), level: 2 },
    ]);
    expect(refs.map((r) => r.slug)).toEqual(['sezione', 'sezione-2']);
  });
});
