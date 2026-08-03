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
  /*
   * Il breakpoint deve derivare dallo **spazio reale** della lezione, non dal
   * viewport: nella vista docente la sidebar del corso sottrae ~270 px, e una
   * media query comprimeva la colonna fino a ~51 caratteri a 1024 px.
   */
  it('usa una container query, non una media query sul viewport', () => {
    expect(manualBlock).toMatch(/\.lesson-manual-scope\s*\{[^}]*container-type:\s*inline-size/);
    expect(manualBlock).toMatch(/\.lesson-manual-scope\s*\{[^}]*container-name:\s*lesson/);
    expect(manualBlock).toMatch(/@container lesson \(min-width: 57rem\)/);
    // Nessuna media query sul viewport decide più la presenza dell'indice.
    expect(manualBlock).not.toMatch(/@media \(min-width:[^)]*\)[^{]*\{[\s\S]{0,400}?\.lm-toc\s*\{/);
  });

  it('la soglia è la somma reale di corpo, indice e gap', () => {
    // 42rem (corpo) + 13rem (indice) + 2rem (gap) = 57rem.
    expect(manualBlock).toMatch(/\.prose--manual\s*\{[^}]*max-width:\s*42rem/);
    expect(manualBlock).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 13rem/);
    expect(manualBlock).toMatch(/\.lesson-manual\s*\{[^}]*gap:\s*2rem/);
    expect(manualBlock).toMatch(/min-width: 57rem/);
  });

  it('sopra la soglia l’indice è laterale e sticky, e quello compatto sparisce', () => {
    const query = manualBlock.slice(manualBlock.indexOf('@container lesson (min-width: 57rem)'));
    expect(query).toMatch(/\.lesson-manual--with-toc\s*\{[^}]*grid-template-columns/);
    expect(query).toMatch(/\.lm-toc\s*\{[^}]*position:\s*sticky/);
    expect(query).toMatch(/\.lm-toc-mobile\s*\{[^}]*display:\s*none/);
  });

  it('sotto quella soglia l’indice laterale non esiste', () => {
    expect(manualBlock).toMatch(/\.lm-toc\s*\{\s*display:\s*none/);
  });

  it('l’indice compatto non è sticky', () => {
    const mobile = manualBlock.slice(
      manualBlock.indexOf('.lm-toc-mobile {'),
      manualBlock.indexOf('@container lesson'),
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

  it('l’indice compatto mantiene target comodi ma confina le liste lunghe', () => {
    expect(manualBlock).toMatch(/\.lm-toc-mobile > summary\s*\{[^}]*min-height:\s*2\.75rem/);
    expect(manualBlock).toMatch(/\.lm-toc-mobile \.lm-toc__list a\s*\{[^}]*min-height:\s*2\.75rem/);
    expect(manualBlock).toMatch(/\.lm-toc-mobile nav\s*\{[^}]*max-height:\s*min\(12rem, 36vh\)/);
    expect(manualBlock).toMatch(/\.lm-toc-mobile nav\s*\{[^}]*overflow-y:\s*auto/);
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

describe('isolamento: nessun selettore globale', () => {
  /**
   * Il blocco della variante non deve poter toccare Markdown legacy, anteprima
   * editor, anteprima IA, pool, correzioni o qualunque altra lista/tabella del
   * portale. Ogni regola è agganciata alla radice della variante.
   */
  it('nessuna regola colpisce ol/table/pre/details/summary fuori dal renderer', () => {
    // Si rimuovono i commenti, poi si raccoglie ogni prelude di regola: il
    // testo fra una graffa e la successiva `{`. `[^{}]*` non attraversa mai
    // una graffa, quindi i corpi delle regole non finiscono nell'elenco.
    // `manualBlock` parte dal marcatore, quindi dentro il commento di
    // intestazione: si riparte dal `/*` che lo apre per poterlo rimuovere.
    const withoutComments = css
      .slice(css.lastIndexOf('/*', css.indexOf('LESSON-MANUAL-01')))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const preludes = Array.from(withoutComments.matchAll(/([^{}]*)\{/g), (m) => m[1] ?? '');
    const bare = preludes
      .map((prelude) => prelude.trim())
      .filter((prelude) => !prelude.startsWith('@'))
      .flatMap((group) => group.split(','))
      .map((sel) => sel.trim())
      .filter(Boolean)
      .filter((sel) => !/^\.(prose--manual|lesson-manual|lesson-manual-scope|lm-)/.test(sel));

    expect(bare).toEqual([]);
  });

  it('gli elementi generici compaiono solo come discendenti della variante', () => {
    for (const tag of [
      'ol',
      'ul',
      'li',
      'table',
      'th',
      'td',
      'pre',
      'code',
      'blockquote',
      'summary',
      'details',
      'h1',
      'h2',
      'h3',
    ]) {
      const loose = new RegExp(`(^|[},])\\s*${tag}[\\s.:,{]`, 'm');
      expect(manualBlock).not.toMatch(loose);
    }
  });

  it('non ridefinisce classi condivise del portale', () => {
    for (const shared of ['.btn-', '.card', '.dialog', '.state-', '.text-error', '.badge']) {
      expect(manualBlock).not.toContain(`${shared}`);
    }
  });
});

describe('liste ordinate: resa neutra per impostazione predefinita', () => {
  /*
   * Il trattamento «procedura» con cerchi e filo verticale rendeva male le
   * classifiche e gli elenchi puramente enumerativi, che il Markdown non
   * permette di distinguere. Senza una sintassi dedicata — fuori scope — la
   * resa predefinita resta sobria.
   */
  it('nessun contatore, cerchio o filo verticale', () => {
    expect(manualBlock).not.toMatch(/counter-reset/);
    expect(manualBlock).not.toMatch(/counter-increment/);
    expect(manualBlock).not.toMatch(/content:\s*counter/);
  });

  it('la numerazione resta quella nativa, solo evidenziata', () => {
    expect(manualBlock).toMatch(/\.prose--manual ol\s*\{[^}]*list-style:\s*decimal/);
    expect(manualBlock).toMatch(/\.prose--manual ol > li::marker\s*\{[^}]*color/);
  });
});
