import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LessonManualBody } from '../../../../components/LessonManualBody.js';
import { LessonVisualAnchorNotice } from '../../../teacher/LessonVisualAnchorNotice.js';
import { LessonVisualReanchorDialog } from '../../../teacher/LessonVisualReanchorDialog.js';
import figureStyles from '../../../../components/LessonVisualFigure.module.css';
import dialogStyles from '../../../teacher/LessonVisualReanchorDialog.module.css';
import shellStyles from '../../../../components/DialogShell.module.css';

/**
 * VE-04A — genera l'harness dello smoke responsive.
 *
 * Non simula: prende il **markup reale** prodotto dai componenti e il **CSS
 * reale** dei loro moduli, e li scrive in una pagina statica che Chromium
 * misura a 1440, 1024, 390 e 320 px. Le classi dei CSS module in test non sono
 * hashate, quindi il markup e il foglio di stile combaciano.
 */

const root = resolve(process.cwd(), 'src');
const OUT = process.env.VISUAL_SMOKE_OUT;

const LONG_CAPTION =
  'Schema della fotosintesi clorofilliana con evidenziati i reagenti, i prodotti e il ruolo della luce solare nella conversione dell’anidride carbonica in glucosio';

const BODY = [
  '# La fotosintesi',
  '',
  'Testo introduttivo della lezione, abbastanza lungo da mandare a capo su schermi stretti.',
  '',
  '## La fotosintesi',
  '',
  'Corpo della sezione ancorata.',
  '',
  '## Conclusione',
  '',
  'Ultimo paragrafo.',
].join('\n');

/**
 * WebP **reale 1024×768**, generato una volta e inlinato.
 *
 * Le dimensioni intrinseche contano: dopo il caricamento il browser usa il
 * rapporto d'aspetto vero dell'immagine, non quello degli attributi. Un
 * placeholder quadrato avrebbe fatto fallire la misura del rapporto pur con un
 * componente corretto — e in produzione il server garantisce che intrinseco e
 * dichiarato coincidano (`inspectWebp` verifica le dimensioni contro il
 * manifest prima di scriverlo).
 */
const TINY_WEBP =
  'data:image/webp;base64,UklGRhIGAABXRUJQVlA4IAYGAABQqgCdASoABAADPrVaqlCnJSOioAgA4BaJaW7hd2EfgsAAtLZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99udUqle+80eS+/+3vvNHkvv/t77zR5L7/7e+80eS+/+3vvNHkvv/t7FYYB77ZOQ99snIe+2TkPfbJyHvtk5D32ych78Bja8XJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtWAA/v/GtvvAL+Zjea3MYTNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNZrNOhFTpDFABSO5pQIIeSrp2Bs9yBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

describe('harness dello smoke responsive', () => {
  it('produce markup e CSS reali dei componenti VE-04A', () => {
    const lesson = render(
      <LessonManualBody
        markdown={BODY}
        visual={{
          anchorSlug: 'la-fotosintesi',
          headingText: 'La fotosintesi',
          altText: 'Diagramma della fotosintesi',
          caption: LONG_CAPTION,
          width: 1024,
          height: 768,
          dataUri: TINY_WEBP,
        }}
      />,
    ).container.innerHTML;

    const notice = render(
      <LessonVisualAnchorNotice
        headingText="Una sezione con un titolo piuttosto lungo che deve andare a capo"
        onReanchor={() => {}}
      />,
    ).container.innerHTML;

    const { baseElement } = render(
      <LessonVisualReanchorDialog
        headings={[
          { text: 'La fotosintesi', level: 2 },
          {
            text: 'Un titolo di sezione molto lungo che deve mandare a capo senza uscire dal dialog',
            level: 2,
          },
          { text: 'Dettaglio', level: 3 },
        ]}
        currentHeadingText="La fotosintesi"
        onCancel={() => {}}
        onConfirm={async () => {}}
      />,
    );
    const dialog = baseElement.querySelector('[role="dialog"]')?.outerHTML ?? '';

    // Il markup deve contenere davvero i tre pezzi da misurare.
    expect(lesson).toContain('<figure');
    expect(notice).toContain('Riancora');
    expect(dialog).toContain('radiogroup');

    if (!OUT) return;

    const css = (path: string) => readFileSync(resolve(root, path), 'utf8');

    /**
     * I CSS module in test hanno nomi **hashati** (`_figure_3bfc37`): scrivere
     * il foglio grezzo produrrebbe selettori che non agganciano nulla, e lo
     * smoke misurerebbe un markup senza stile — segnalando problemi che non
     * esistono. Le classi vengono quindi riscritte con gli stessi nomi che il
     * markup usa davvero, presi dall'oggetto importato.
     */
    function scopedCss(path: string, map: Record<string, string>): string {
      return css(path).replace(/\.([a-zA-Z][\w-]*)/g, (match, name: string) =>
        map[name] ? `.${map[name]}` : match,
      );
    }
    writeFileSync(
      OUT,
      `<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css('index.css')}</style>
<style>${scopedCss('components/LessonVisualFigure.module.css', figureStyles)}</style>
<style>${scopedCss('features/teacher/LessonVisualReanchorDialog.module.css', dialogStyles)}</style>
<style>${scopedCss('components/DialogShell.module.css', shellStyles)}</style>
<style>
  body { margin: 0; }
  /* min-width 0 è del contenitore dell'harness, non dei componenti: senza,
     una colonna flex non si restringe e produrrebbe un falso overflow. */
  .harness-column { max-width: 60rem; margin: 0 auto; padding: 1rem; min-width: 0; }
</style>
</head><body>
<div class="harness-column" id="lesson">${lesson}</div>
<div class="harness-column" id="notice">${notice}</div>
<div id="dialog">${dialog}</div>
</body></html>`,
    );
  });
});
