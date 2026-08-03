import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * LESSON-MANUAL-01 — contratto CSS statico. Verifica le proprietà che, se
 * regredissero, riporterebbero la lezione al problema di partenza o
 * infrangerebbero il vincolo di reversibilità.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');

/** Il blocco della variante, isolato dal resto del foglio. */
const manualBlock = css.slice(css.indexOf('LESSON-MANUAL-01'));

describe('reversibilità', () => {
  it('la variante è interamente additiva e vive in coda al foglio', () => {
    expect(css.indexOf('LESSON-MANUAL-01')).toBeGreaterThan(0);
    // Ogni selettore del blocco è agganciato alla variante.
    const selectors = manualBlock.match(/^\.[a-z][^{,]*/gm) ?? [];
    expect(selectors.length).toBeGreaterThan(10);
    for (const selector of selectors) {
      expect(selector).toMatch(/^\.(prose--manual|lesson-manual|lm-)/);
    }
  });

  it('non modifica `.prose` legacy', () => {
    // Nel blocco della variante nessuna regola parte da `.prose ` o `.prose{`.
    expect(manualBlock).not.toMatch(/^\.prose[\s{]/m);
    // E `.prose` conserva la propria dichiarazione originale.
    expect(css).toMatch(/\.prose\s*\{[^}]*max-width:\s*100%/);
  });
});

describe('colonna di lettura', () => {
  it('il corpo della variante è limitato a una misura editoriale', () => {
    expect(manualBlock).toMatch(/\.prose--manual\s*\{[^}]*max-width:\s*42rem/);
  });

  it('senza indice il corpo è centrato', () => {
    expect(manualBlock).toMatch(
      /lesson-manual:not\(\.lesson-manual--with-toc\)[^{]*\{[^}]*margin-inline:\s*auto/,
    );
  });
});

describe('indice', () => {
  it('la colonna laterale compare solo da 60rem ed è sticky', () => {
    const media = manualBlock.slice(manualBlock.indexOf('@media (min-width: 60rem)'));
    expect(media).toMatch(/\.lesson-manual--with-toc\s*\{[^}]*grid-template-columns/);
    expect(media).toMatch(/\.lm-toc\s*\{[^}]*position:\s*sticky/);
    expect(media).toMatch(/\.lm-toc-mobile\s*\{[^}]*display:\s*none/);
  });

  it('sotto quella soglia l’indice laterale non esiste', () => {
    expect(manualBlock).toMatch(/\.lm-toc\s*\{\s*display:\s*none/);
  });

  it('l’indice compatto non è sticky', () => {
    const mobile = manualBlock.slice(
      manualBlock.indexOf('.lm-toc-mobile {'),
      manualBlock.indexOf('@media (min-width: 60rem)'),
    );
    expect(mobile).not.toContain('position: sticky');
  });

  it('la sezione corrente è evidenziata solo con colore e peso', () => {
    const rule = manualBlock.slice(manualBlock.indexOf(".lm-toc__list a[aria-current='true']"));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toMatch(/color:/);
    expect(body).toMatch(/font-weight:/);
    expect(body).not.toMatch(/background/);
  });
});

describe('tabelle e codice: overflow confinato', () => {
  it('la tabella scorre dentro sé stessa', () => {
    const rule = manualBlock.slice(manualBlock.indexOf('.prose--manual table {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toMatch(/overflow-x:\s*auto/);
    expect(body).toMatch(/max-width:\s*100%/);
  });

  it('nessuna zebratura', () => {
    expect(manualBlock).not.toMatch(/nth-child\(even\)/);
  });
});

describe('accessibilità e movimento', () => {
  it('gli heading mostrano il focus solo con :focus-visible', () => {
    expect(manualBlock).toMatch(/\.prose--manual h2:focus,[\s\S]{0,60}\{\s*outline:\s*none/);
    expect(manualBlock).toMatch(/h2:focus-visible,[\s\S]{0,80}\{\s*outline:\s*2px/);
  });

  it('i controlli dell’indice compatto hanno un target comodo', () => {
    expect(manualBlock).toMatch(/\.lm-toc-mobile > summary\s*\{[^}]*min-height:\s*2\.75rem/);
    expect(manualBlock).toMatch(/\.lm-toc-mobile \.lm-toc__list a\s*\{[^}]*min-height:\s*2\.75rem/);
  });

  it('rispetta prefers-reduced-motion', () => {
    expect(manualBlock).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('nessuna animazione continua', () => {
    // L'unica `animation` ammessa è la disattivazione sotto reduced-motion.
    const animations = manualBlock.match(/animation:[^;]+;/g) ?? [];
    expect(animations.every((rule) => /none/.test(rule))).toBe(true);
    expect(manualBlock).not.toMatch(/@keyframes/);
  });
});

describe('callout', () => {
  it('i cinque tipi hanno un accento distinto', () => {
    for (const type of ['definition', 'example', 'important', 'warning', 'solution']) {
      expect(manualBlock).toMatch(new RegExp(`\\.lm-callout--${type}\\s*\\{[^}]*--lm-accent`));
    }
  });

  it('la fascia laterale è sottile e il fondo appena distinto', () => {
    const rule = manualBlock.slice(manualBlock.indexOf('.lm-callout {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toMatch(/border-left:\s*3px/);
    expect(body).toMatch(/background:\s*var\(--color-surface\)/);
  });

  it('nessun gradiente nei contenuti', () => {
    expect(manualBlock).not.toMatch(/gradient/);
  });
});
