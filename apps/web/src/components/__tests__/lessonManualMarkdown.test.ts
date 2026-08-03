import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
// Importato per il suo effetto collaterale: registra l'estensione dei link
// sull'istanza globale, com'è in produzione. Senza, il confronto legacy
// verificherebbe una configurazione che l'applicazione non usa.
import '../MarkdownRenderer.js';
import {
  headingSlug,
  nextHeadingId,
  parseCalloutType,
  parseLessonMarkdown,
} from '../lessonManualMarkdown.js';

/**
 * LESSON-MANUAL-01 — parser isolato della variante «manuale».
 */

describe('isolamento del parser', () => {
  it('legacy → lesson → legacy produce lo stesso HTML', () => {
    const source = '# Titolo\n\n> [!DEFINITION]\n> Testo\n\n[link](https://esempio.it)\n';
    const before = marked.parse(source) as string;
    parseLessonMarkdown(source);
    const after = marked.parse(source) as string;

    expect(after).toBe(before);
  });

  it('la variante non registra il proprio blockquote sull’istanza globale', () => {
    parseLessonMarkdown('> [!WARNING]\n> Attenzione\n');
    const legacy = marked.parse('> [!WARNING]\n> Attenzione\n') as string;

    // Sul percorso legacy il marcatore resta testo letterale dentro un
    // blockquote ordinario: nessun callout, nessuna classe della variante.
    expect(legacy).toContain('<blockquote>');
    expect(legacy).toContain('[!WARNING]');
    expect(legacy).not.toContain('lm-callout');
  });

  it('il legacy conserva l’estensione dei link anche dopo l’uso della variante', () => {
    parseLessonMarkdown('[x](https://esempio.it)');
    const legacy = marked.parse('[x](https://esempio.it)') as string;
    expect(legacy).toContain('target="_blank"');
    expect(legacy).toContain('rel="noopener noreferrer"');
  });
});

describe('sicurezza: la sanificazione è l’ultimo passaggio', () => {
  it('rimuove gli script', () => {
    const { html } = parseLessonMarkdown('<script>alert(1)</script>\n\nTesto');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('rimuove gli handler inline', () => {
    const { html } = parseLessonMarkdown('<div onclick="alert(1)">x</div>');
    expect(html).not.toContain('onclick');
    const img = parseLessonMarkdown('<img src="x" onerror="alert(1)" />');
    expect(img.html).not.toContain('onerror');
  });

  it('neutralizza gli URL javascript:', () => {
    const { html } = parseLessonMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:alert');
  });

  it('sanifica anche il markup generato per i callout', () => {
    const { html } = parseLessonMarkdown('> [!IMPORTANT]\n> <script>alert(1)</script> testo\n');
    expect(html).toContain('lm-callout--important');
    expect(html).not.toContain('<script');
  });

  it('i link della variante restano sicuri', () => {
    const { html } = parseLessonMarkdown('[x](https://esempio.it)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe('callout', () => {
  it('riconosce i cinque tipi e nessun altro', () => {
    for (const [marker, cls] of [
      ['DEFINITION', 'definition'],
      ['EXAMPLE', 'example'],
      ['IMPORTANT', 'important'],
      ['WARNING', 'warning'],
      ['SOLUTION', 'solution'],
    ] as const) {
      const { html } = parseLessonMarkdown(`> [!${marker}]\n> Corpo\n`);
      expect(html).toContain(`lm-callout--${cls}`);
      expect(html).toContain('Corpo');
    }
  });

  it('un marcatore sconosciuto non è interpretato', () => {
    const { html } = parseLessonMarkdown('> [!TIP]\n> Suggerimento\n');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('[!TIP]');
    expect(html).not.toContain('lm-callout');
  });

  it('un blockquote ordinario resta un blockquote', () => {
    const { html } = parseLessonMarkdown('> Citazione semplice\n');
    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('lm-callout');
  });

  it('un callout malformato non lancia e resta leggibile', () => {
    for (const source of ['> [!]\n> x\n', '> [!DEFINITION\n> x\n', '> [!DEFINITION]\n']) {
      expect(() => parseLessonMarkdown(source)).not.toThrow();
      const { html } = parseLessonMarkdown(source);
      expect(html.length).toBeGreaterThan(0);
    }
  });

  it('SOLUTION usa details/summary ed è chiuso all’inizio', () => {
    const { html } = parseLessonMarkdown('> [!SOLUTION]\n> La risposta\n');
    expect(html).toContain('<details');
    expect(html).toContain('<summary>');
    expect(html).not.toContain('<details open');
    // Il contenuto è comunque nel DOM: nessun testo perso.
    expect(html).toContain('La risposta');
  });

  it('le icone sono decorative e non emoji', () => {
    const { html } = parseLessonMarkdown('> [!WARNING]\n> x\n');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/Attenzione/);
  });

  it('parseCalloutType è insensibile alle maiuscole ma chiuso ai tipi noti', () => {
    expect(parseCalloutType('[!definition]\ntesto')).toBe('DEFINITION');
    expect(parseCalloutType('[!NOTE]\ntesto')).toBeNull();
    expect(parseCalloutType('testo normale')).toBeNull();
  });
});

describe('slug e heading', () => {
  it('slug semplice', () => {
    expect(headingSlug('Introduzione al Web')).toBe('introduzione-al-web');
  });

  it('accenti normalizzati stabilmente', () => {
    expect(headingSlug('Perché')).toBe('perche');
    expect(headingSlug('PERCHÉ')).toBe(headingSlug('perche'));
    expect(headingSlug('Città e società')).toBe('citta-e-societa');
  });

  it('slug vuoto ricade su un valore deterministico', () => {
    expect(headingSlug('###')).toBe('sezione');
    expect(headingSlug('   ')).toBe('sezione');
  });

  it('duplicati distinti da un suffisso progressivo', () => {
    const seen = new Map<string, number>();
    expect(nextHeadingId('derivate', seen)).toBe('derivate');
    expect(nextHeadingId('derivate', seen)).toBe('derivate-2');
    expect(nextHeadingId('derivate', seen)).toBe('derivate-3');
  });

  it('assegna gli id nel documento, con duplicati risolti', () => {
    const { html, headings } = parseLessonMarkdown('## Uno\n\n### Perché\n\n## Uno\n');
    expect(headings.map((h) => h.id)).toEqual(['uno', 'perche', 'uno-2']);
    expect(html).toContain('<h2 id="uno" tabindex="-1">');
    expect(html).toContain('<h3 id="perche" tabindex="-1">');
    expect(html).toContain('<h2 id="uno-2" tabindex="-1">');
  });

  it('ignora la formattazione inline nel testo dell’heading', () => {
    const { headings } = parseLessonMarkdown('## Il **protocollo** `HTTP`\n');
    expect(headings[0]!.id).toBe('il-protocollo-http');
  });

  it('non deriva mai l’id della sezione da un id presente nel sorgente', () => {
    const { html, headings } = parseLessonMarkdown('## <span id="iniettato">Titolo</span>\n');
    // Lo slug nasce dal solo testo: l'id dell'autore non diventa l'ancora.
    expect(headings[0]!.id).toBe('titolo');
    expect(html).toContain('<h2 id="titolo" tabindex="-1">');
    // L'id dell'autore può sopravvivere alla sanificazione — è legittimo — ma
    // non è un heading, e la navigazione lo ignora (vedi `findHeading`).
    expect(html).not.toContain('<h2 id="iniettato"');
  });

  it('un H1 legacy nel corpo non è bloccato e non entra nell’indice', () => {
    const { html, headings } = parseLessonMarkdown('# Titolo legacy\n\n## Sezione\n');
    expect(html).toContain('<h1>Titolo legacy</h1>');
    expect(headings.map((h) => h.level)).toEqual([2]);
  });
});

describe('ordine degli heading', () => {
  it('l’ordine è quello del documento', () => {
    const { headings } = parseLessonMarkdown('## A\n\n### B\n\n## C\n');
    expect(headings.map((h) => h.text)).toEqual(['A', 'B', 'C']);
    expect(headings.map((h) => h.level)).toEqual([2, 3, 2]);
  });
});

describe('formule e diagrammi restano contenuto ordinario', () => {
  it('un blocco mermaid resta un code block leggibile', () => {
    const { html } = parseLessonMarkdown('```mermaid\ngraph TD; A-->B;\n```\n');
    expect(html).toContain('<pre>');
    expect(html).toContain('graph TD');
    expect(html).not.toContain('<svg class="mermaid');
  });

  it('una formula resta testo Markdown normale', () => {
    const { html } = parseLessonMarkdown('$$E = mc^2$$\n');
    expect(html).toContain('E = mc^2');
    expect(html).not.toContain('katex');
  });
});
