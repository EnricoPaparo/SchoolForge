import { describe, expect, it } from 'vitest';
import { headingSlug, nextHeadingId, parseLessonMarkdown } from '../lessonManualMarkdown.js';

/**
 * VE-04A — **la metà web della tabella condivisa**.
 *
 * Il gemello vive in `functions/src/aiVisualPromotion.test.ts`. Le due
 * implementazioni dello slug non possono essere unificate in un import — il web
 * e Functions non condividono un modulo — quindi l'unica difesa possibile è che
 * la stessa tabella sia verificata da entrambe le parti. Fino a VE-04A esisteva
 * solo la metà lato Functions, e infatti le due erano divergenti su apostrofi e
 * duplicati senza che nulla lo segnalasse.
 *
 * Se qualcuno tocca uno dei due algoritmi, uno dei due test fallisce.
 */
const SHARED_HEADING_SLUG_CASES: Array<[string, string]> = [
  ['La fotosintesi', 'la-fotosintesi'],
  ["L'acqua", 'lacqua'],
  ['L’energia', 'lenergia'],
  ['Perché è così?', 'perche-e-cosi'],
  ['Città e società', 'citta-e-societa'],
  ['  Spazi   multipli  ', 'spazi-multipli'],
  ['1. Introduzione', '1-introduzione'],
  ['A—B', 'a-b'],
  ['CAPS LOCK', 'caps-lock'],
  ['---', 'sezione'],
  ['\u{1F331} solo emoji', 'solo-emoji'],
];

describe('headingSlug — tabella condivisa con il server', () => {
  for (const [text, expected] of SHARED_HEADING_SLUG_CASES) {
    it(`«${text}» → «${expected}»`, () => {
      expect(headingSlug(text)).toBe(expected);
    });
  }
});

describe('numerazione dei duplicati — stessa del server', () => {
  it('la prima occorrenza non porta suffisso, le successive partono da -2', () => {
    const occurrences = new Map<string, number>();
    expect(nextHeadingId('reti', occurrences)).toBe('reti');
    expect(nextHeadingId('reti', occurrences)).toBe('reti-2');
    expect(nextHeadingId('reti', occurrences)).toBe('reti-3');
  });
});

describe('gli id nel DOM coincidono con lo slug del server', () => {
  /**
   * La prova che conta davvero: non che le due funzioni restituiscano la stessa
   * stringa in astratto, ma che l'`id` realmente emesso nell'HTML sia quello
   * che il server userebbe come ancora.
   */
  it('emette gli id attesi per apostrofi, duplicati e livelli', () => {
    const markdown = [
      '# Titolo di primo livello',
      '',
      "## L'acqua",
      '',
      'testo',
      '',
      '## Reti',
      '',
      'testo',
      '',
      '## Reti',
      '',
      'testo',
      '',
      '### Dettaglio',
      '',
      'testo',
    ].join('\n');

    const { html, headings } = parseLessonMarkdown(markdown);

    expect(headings.map((h) => h.id)).toEqual(['lacqua', 'reti', 'reti-2', 'dettaglio']);
    expect(html).toContain('id="lacqua"');
    expect(html).toContain('id="reti"');
    expect(html).toContain('id="reti-2"');
    expect(html).toContain('id="dettaglio"');
    // Il livello 1 non riceve id: il server infatti non lo considera ancorabile.
    expect(html).not.toContain('id="titolo-di-primo-livello"');
  });
});
