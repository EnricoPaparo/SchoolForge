import { describe, expect, it } from 'vitest';
import { placeLessonVisual } from '../lessonManualVisual.js';
import { parseLessonMarkdown } from '../lessonManualMarkdown.js';

/**
 * VISUAL-ENRICHMENT-04A — dove finisce la figura, e che cosa non cambia.
 *
 * La garanzia che questi test difendono più di tutte è **negativa**: una
 * lezione senza immagine deve produrre esattamente il DOM di prima. La seconda
 * è che la figura non entra mai nell'HTML — entra nell'albero React — quindi
 * nessun contenuto del docente può diventare markup passando da qui.
 */

const BODY = [
  '# Lezione',
  '',
  'Introduzione.',
  '',
  '## La fotosintesi',
  '',
  'Testo della sezione.',
  '',
  '## Conclusione',
  '',
  'Ultimo paragrafo.',
].join('\n');

describe('placeLessonVisual — ancoraggio', () => {
  it('divide il corpo subito dopo l’heading ATX', () => {
    const result = placeLessonVisual({ markdown: BODY, anchorSlug: 'la-fotosintesi' });

    expect(result.status).toBe('anchored');
    if (result.status !== 'anchored') return;
    expect(result.before).toContain('id="la-fotosintesi"');
    expect(result.before).toContain('Introduzione.');
    // Il testo della sezione sta **dopo** la figura: lo split cade sull'heading.
    expect(result.before).not.toContain('Testo della sezione.');
    expect(result.after).toContain('Testo della sezione.');
    expect(result.after).toContain('id="conclusione"');
  });

  it('ancora anche un heading Setext', () => {
    const setext = [
      'Introduzione',
      '',
      'testo',
      '',
      'La fotosintesi',
      '--------------',
      '',
      'corpo',
    ].join('\n');
    const result = placeLessonVisual({ markdown: setext, anchorSlug: 'la-fotosintesi' });

    expect(result.status).toBe('anchored');
    if (result.status !== 'anchored') return;
    expect(result.before).toContain('id="la-fotosintesi"');
    expect(result.after).toContain('corpo');
  });

  it('ancora un heading di livello 3', () => {
    const md = ['## Sezione', '', 'a', '', '### Dettaglio', '', 'b'].join('\n');
    const result = placeLessonVisual({ markdown: md, anchorSlug: 'dettaglio' });

    expect(result.status).toBe('anchored');
    if (result.status !== 'anchored') return;
    expect(result.before).toContain('id="dettaglio"');
    expect(result.after).toContain('b');
  });

  /**
   * Il caso che la divergenza fra server e renderer avrebbe rotto in silenzio:
   * il secondo duplicato è `-2`, e la figura deve finire lì e non sul primo.
   */
  it('distingue i duplicati con lo slug suffissato', () => {
    const md = ['## Reti', '', 'prima', '', '## Reti', '', 'seconda'].join('\n');
    const result = placeLessonVisual({ markdown: md, anchorSlug: 'reti-2' });

    expect(result.status).toBe('anchored');
    if (result.status !== 'anchored') return;
    expect(result.before).toContain('prima');
    expect(result.before).toContain('id="reti-2"');
    expect(result.after).toContain('seconda');
    expect(result.after).not.toContain('prima');
  });

  /** Un heading con apostrofo: `L'acqua` → `lacqua`, non `l-acqua`. */
  it('ancora un heading con apostrofo', () => {
    const md = ["## L'acqua", '', 'corpo'].join('\n');
    const result = placeLessonVisual({ markdown: md, anchorSlug: 'lacqua' });

    expect(result.status).toBe('anchored');
    if (result.status !== 'anchored') return;
    expect(result.before).toContain('id="lacqua"');
  });

  /** Un `##` dentro un blocco recintato non è un heading e non ancora niente. */
  it('ignora un heading dentro un fence', () => {
    const md = ['```', '## Falso', '```', '', '## Vero', '', 'corpo'].join('\n');

    const falso = placeLessonVisual({ markdown: md, anchorSlug: 'falso' });
    expect(falso.status).toBe('missing_anchor');

    const vero = placeLessonVisual({ markdown: md, anchorSlug: 'vero' });
    expect(vero.status).toBe('anchored');
  });
});

describe('placeLessonVisual — ancora mancante', () => {
  /**
   * Il docente ha riscritto la lezione e quella sezione non c'è più. Non è un
   * errore: la figura va in fondo e la vista docente lo dice. Non si indovina
   * una sezione «vicina» — sarebbe una scelta editoriale che il renderer non ha
   * titolo per fare.
   */
  it('mette tutto il corpo prima e la figura in fondo', () => {
    const result = placeLessonVisual({ markdown: BODY, anchorSlug: 'sezione-sparita' });

    expect(result.status).toBe('missing_anchor');
    if (result.status !== 'missing_anchor') return;
    expect(result.before).toContain('Introduzione.');
    expect(result.before).toContain('Ultimo paragrafo.');
    expect(result.after).toBe('');
  });

  it('un corpo senza alcun heading porta comunque la figura in fondo', () => {
    const result = placeLessonVisual({ markdown: 'Solo testo.', anchorSlug: 'qualcosa' });
    expect(result.status).toBe('missing_anchor');
  });
});

describe('placeLessonVisual — nessun manifest', () => {
  it('senza anchorSlug produce un solo frammento', () => {
    const result = placeLessonVisual({ markdown: BODY, anchorSlug: null });
    expect(result.status).toBe('absent');
  });

  /**
   * **La regressione che conta di più.** Chi non usa la funzione non deve
   * accorgersi che esiste: l'HTML del percorso senza figura è identico byte per
   * byte a quello del renderer di sempre.
   */
  it('produce lo stesso HTML del renderer legacy', () => {
    const result = placeLessonVisual({ markdown: BODY, anchorSlug: null });
    expect(result.status).toBe('absent');
    if (result.status !== 'absent') return;
    expect(result.html).toBe(parseLessonMarkdown(BODY).html);
  });
});

describe('le due metà ricompongono il documento intero', () => {
  /**
   * Dividere non deve perdere né duplicare nulla: la concatenazione delle due
   * metà contiene esattamente ciò che il renderer intero produce.
   */
  it('nessun contenuto va perso nello split', () => {
    const whole = parseLessonMarkdown(BODY).html;
    const result = placeLessonVisual({ markdown: BODY, anchorSlug: 'la-fotosintesi' });
    if (result.status !== 'anchored') throw new Error('atteso anchored');
    expect(result.before + result.after).toBe(whole);
  });

  it('gli id degli heading non ricominciano da capo nella seconda metà', () => {
    const md = ['## Reti', '', 'a', '', '## Reti', '', 'b', '', '## Reti', '', 'c'].join('\n');
    const result = placeLessonVisual({ markdown: md, anchorSlug: 'reti' });
    if (result.status !== 'anchored') throw new Error('atteso anchored');

    expect(result.before).toContain('id="reti"');
    // La numerazione prosegue: la seconda metà non riparte da `reti`.
    expect(result.after).toContain('id="reti-2"');
    expect(result.after).toContain('id="reti-3"');
    expect(result.after).not.toContain('id="reti"');
  });

  /**
   * I riferimenti dei link sono raccolti in fase di lex e vivono sulla lista di
   * token: affettarla senza riportarli farebbe smettere di risolvere un link
   * referenziato dopo lo split.
   */
  it('i link referenziati continuano a risolversi dopo lo split', () => {
    const md = ['## Sezione', '', 'Vedi [il sito][rif].', '', '[rif]: https://example.org'].join(
      '\n',
    );
    const result = placeLessonVisual({ markdown: md, anchorSlug: 'sezione' });
    if (result.status !== 'anchored') throw new Error('atteso anchored');
    expect(result.after).toContain('href="https://example.org"');
  });
});

describe('sanificazione', () => {
  const HOSTILE = [
    '## Sezione',
    '',
    '<script>alert(1)</script>',
    '',
    '<img src=x onerror="alert(2)">',
    '',
    '[link](javascript:alert(3))',
  ].join('\n');

  /** Ogni metà passa da DOMPurify per intero, non a pezzi. */
  it('sanifica entrambe le metà', () => {
    const result = placeLessonVisual({ markdown: HOSTILE, anchorSlug: 'sezione' });
    if (result.status !== 'anchored') throw new Error('atteso anchored');

    for (const half of [result.before, result.after]) {
      expect(half).not.toContain('<script');
      expect(half).not.toContain('onerror');
      expect(half.toLowerCase()).not.toContain('javascript:');
    }
  });

  it('sanifica anche il frammento unico dei percorsi senza figura', () => {
    const result = placeLessonVisual({ markdown: HOSTILE, anchorSlug: null });
    if (result.status !== 'absent') throw new Error('atteso absent');
    expect(result.html).not.toContain('<script');
    expect(result.html).not.toContain('onerror');
  });
});
