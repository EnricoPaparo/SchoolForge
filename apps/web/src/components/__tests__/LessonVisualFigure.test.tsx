import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LessonVisualFigure } from '../LessonVisualFigure.js';
import { LessonManualBody, type LessonVisualRender } from '../LessonManualBody.js';
import { MarkdownRenderer } from '../MarkdownRenderer.js';

/**
 * VE-04A — la figura nel DOM reale.
 *
 * Il punto che questi test difendono: `caption` e `altText` sono **testo**, non
 * markup. Non c'è alcun percorso in cui un contenuto scritto dal docente possa
 * diventare HTML passando dalla figura — ed è il motivo per cui la figura è un
 * componente React e non un frammento iniettato nel corpo.
 */

const DATA_URI = 'data:image/webp;base64,UklGRg==';

const VISUAL: LessonVisualRender = {
  anchorSlug: 'la-fotosintesi',
  headingText: 'La fotosintesi',
  altText: 'Diagramma con foglia, luce e anidride carbonica',
  caption: 'Schema della fotosintesi',
  width: 1024,
  height: 768,
  dataUri: DATA_URI,
};

const BODY = ['# Lezione', '', 'intro', '', '## La fotosintesi', '', 'corpo'].join('\n');

describe('LessonVisualFigure — struttura e attributi', () => {
  it('produce figure > img + figcaption con gli attributi obbligatori', () => {
    const { container } = render(
      <LessonVisualFigure
        src={DATA_URI}
        altText="Testo alternativo sostanziale"
        caption="Didascalia"
        width={1024}
        height={768}
      />,
    );

    const figure = container.querySelector('figure');
    expect(figure).not.toBeNull();
    const img = figure!.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe('Testo alternativo sostanziale');
    expect(img.getAttribute('width')).toBe('1024');
    expect(img.getAttribute('height')).toBe('768');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(figure!.querySelector('figcaption')!.textContent).toBe('Didascalia');
  });

  /** Niente lightbox, zoom o carosello: nessun handler di apertura. */
  it('non è interattiva', () => {
    const { container } = render(
      <LessonVisualFigure src={DATA_URI} altText="a" caption="c" width={10} height={10} />,
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('caption e alt con markup restano testo letterale', () => {
    const hostile = '<img src=x onerror="alert(1)"> **grassetto**';
    const { container } = render(
      <LessonVisualFigure
        src={DATA_URI}
        altText={hostile}
        caption={hostile}
        width={10}
        height={10}
      />,
    );

    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('figcaption')!.textContent).toBe(hostile);
    expect(container.querySelector('figcaption')!.innerHTML).not.toContain('<img');
  });
});

describe('LessonManualBody — la figura entra nel corpo', () => {
  it('inserisce la figura dopo l’heading ancorato', () => {
    const { container } = render(<LessonManualBody markdown={BODY} visual={VISUAL} />);

    const heading = container.querySelector('#la-fotosintesi');
    const figure = container.querySelector('figure');
    expect(heading).not.toBeNull();
    expect(figure).not.toBeNull();
    // La figura viene dopo l'heading nel documento.
    expect(
      heading!.compareDocumentPosition(figure!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  /**
   * Senza manifest il DOM deve essere **identico** a quello di prima: è la
   * regressione che riguarda la quasi totalità delle lezioni.
   */
  it('senza visual produce lo stesso DOM di prima', () => {
    const withoutProp = render(<LessonManualBody markdown={BODY} />).container.innerHTML;
    const withNull = render(<LessonManualBody markdown={BODY} visual={null} />).container.innerHTML;
    const viaRenderer = render(<MarkdownRenderer markdown={BODY} variant="lesson" />).container
      .innerHTML;

    expect(withNull).toBe(withoutProp);
    expect(viaRenderer).toBe(withoutProp);
    expect(withoutProp).not.toContain('<figure');
  });

  /**
   * Byte non ancora disponibili: si legge la lezione com'era, non uno spazio
   * vuoto o un'immagine rotta.
   */
  it('con manifest ma senza byte resta il percorso legacy', () => {
    const { container } = render(
      <LessonManualBody markdown={BODY} visual={{ ...VISUAL, dataUri: null }} />,
    );
    expect(container.querySelector('figure')).toBeNull();
    expect(container.querySelector('#la-fotosintesi')).not.toBeNull();
  });

  it('ancora mancante: figura in fondo e avviso mostrato', () => {
    const { container } = render(
      <LessonManualBody
        markdown={BODY}
        visual={{ ...VISUAL, anchorSlug: 'sparita' }}
        onMissingAnchor={<p role="status">avviso docente</p>}
      />,
    );

    expect(container.querySelector('[role="status"]')!.textContent).toBe('avviso docente');
    const figure = container.querySelector('figure')!;
    const body = container.querySelector('.lesson-manual__body')!;
    // La figura è l'ultimo blocco del corpo.
    expect(body.lastElementChild).toBe(figure);
  });

  /** Lo studente non riceve avvisi tecnici: vede solo la figura in fondo. */
  it('senza onMissingAnchor non compare alcun avviso', () => {
    const { container } = render(
      <LessonManualBody markdown={BODY} visual={{ ...VISUAL, anchorSlug: 'sparita' }} />,
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('figure')).not.toBeNull();
  });

  it('l’avviso non compare quando l’ancora si risolve', () => {
    const { container } = render(
      <LessonManualBody
        markdown={BODY}
        visual={VISUAL}
        onMissingAnchor={<p role="status">avviso docente</p>}
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});

describe('MarkdownRenderer — la variante legacy non cambia', () => {
  it('senza variant la figura non è nemmeno considerata', () => {
    const { container } = render(<MarkdownRenderer markdown={BODY} visual={VISUAL} />);
    expect(container.querySelector('figure')).toBeNull();
    expect(container.querySelector('.prose--manual')).toBeNull();
  });
});
