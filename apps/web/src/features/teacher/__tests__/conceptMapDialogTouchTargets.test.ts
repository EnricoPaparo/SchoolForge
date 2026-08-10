import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CONCEPT-MAP-03 — target touch della finestra mappa concettuale.
 *
 * I pulsanti dei dialog del portale misurano 36 px. Alzarli **globalmente**
 * cambierebbe l'altezza di ogni conferma dell'applicazione, che è una decisione
 * di design di tutto il prodotto e non di questa fase. La regola è quindi
 * opt-in e confinata a questa finestra; questi test difendono proprio il
 * confinamento, non solo il valore.
 */

const dir = resolve(process.cwd(), 'src');
const css = readFileSync(resolve(dir, 'features/teacher/ConceptMapDialog.module.css'), 'utf8');
const tsx = readFileSync(resolve(dir, 'features/teacher/ConceptMapDialog.tsx'), 'utf8');
const shellCss = readFileSync(resolve(dir, 'components/DialogShell.module.css'), 'utf8');
const globalCss = readFileSync(resolve(dir, 'index.css'), 'utf8');

describe('target touch ≥ 44 px', () => {
  it('i pulsanti delle azioni arrivano a 44 px su touch o viewport stretta', () => {
    expect(css).toMatch(
      /@media\s*\(pointer:\s*coarse\),\s*\(max-width:\s*640px\)\s*\{[^}]*\.actions button\s*\{[^}]*min-height:\s*44px/s,
    );
  });

  it('la regola vale sul puntatore, non solo sulla larghezza', () => {
    // Un tablet in orizzontale è largo e si tocca comunque con un dito: legare
    // il target alla sola `max-width` lo lascerebbe a 36 px.
    const rule = /@media[^{]*\{[^}]*\.actions button\s*\{[^}]*min-height:\s*44px[^}]*\}\s*\}/s.exec(
      css,
    )?.[0];
    expect(rule).toBeTruthy();
    expect(rule).toContain('pointer: coarse');
  });

  it('non usa !important per vincere', () => {
    expect(css).not.toContain('!important');
  });
});

describe('la regola è opt-in e non tocca i dialog globali', () => {
  it('tutte le righe di azioni della finestra la adottano', () => {
    const rows = tsx.match(/className=\{`dialog-actions \$\{styles\.actions\}`\}/g) ?? [];
    // Stima, editor e le due conferme modali: se una riga restasse indietro,
    // avrebbe target diversi nella stessa finestra.
    expect(rows).toHaveLength(4);
    expect(tsx).not.toMatch(/className="dialog-actions"/);
  });

  it('la classe condivisa è affiancata, non sostituita', () => {
    // Layout, gap e wrapping restano quelli del portale: cambia solo l'altezza.
    expect(tsx).toContain('dialog-actions ${styles.actions}');
  });

  it('nessuna altra superficie usa la classe', () => {
    expect(css).toContain('.actions button');
    // La classe vive in un CSS module: è raggiungibile solo da chi importa
    // questo foglio, e l'unico importatore è la finestra stessa.
    expect(tsx).toContain("from './ConceptMapDialog.module.css'");
  });

  it('DialogShell e il foglio globale restano invariati sui target', () => {
    expect(shellCss).not.toContain('min-height: 44px');
    expect(globalCss).not.toMatch(/\.dialog-actions button\s*\{[^}]*min-height/s);
  });
});
