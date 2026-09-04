import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LessonManualBody, type LessonVisualRender } from '../LessonManualBody.js';
import * as markdownModule from '../lessonManualMarkdown.js';
import * as visualModule from '../lessonManualVisual.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const figure = (anchorSlug: string, caption = anchorSlug): LessonVisualRender => ({
  anchorSlug,
  caption,
  headingText: anchorSlug,
  altText: caption,
  width: 800,
  height: 600,
  dataUri: null,
  status: 'loading',
});

describe('lesson body parse work', () => {
  it('uses only legacy parsing without figures and reuses it across rerenders', () => {
    const parse = vi.spyOn(markdownModule, 'parseLessonMarkdown');
    const place = vi.spyOn(visualModule, 'placeLessonVisuals');
    const view = render(<LessonManualBody markdown="## Uno\n\nCorpo" />);
    view.rerender(<LessonManualBody markdown="## Uno\n\nCorpo" visuals={[]} />);
    expect(parse).toHaveBeenCalledOnce();
    expect(place).not.toHaveBeenCalled();
  });

  it('parses only once with a figure and never for changed bytes, caption or status', () => {
    const parse = vi.spyOn(markdownModule, 'parseLessonMarkdown');
    const single = vi.spyOn(visualModule, 'placeLessonVisual');
    const multi = vi.spyOn(visualModule, 'placeLessonVisuals');
    const markdown = '## Uno\n\nCorpo\n\n## Due\n\nFine';
    const view = render(<LessonManualBody markdown={markdown} visual={figure('uno')} />);
    const before = [...view.container.querySelectorAll('.prose')].map((node) => node.innerHTML);
    view.rerender(
      <LessonManualBody
        markdown={markdown}
        visual={{
          ...figure('uno', 'Nuova didascalia'),
          status: 'ready',
          dataUri: 'data:image/png;base64,aGVsbG8=',
        }}
      />,
    );
    expect(view.container.textContent).toContain('Nuova didascalia');
    expect(view.container.querySelector('img')?.getAttribute('src')).toContain('base64');
    expect([...view.container.querySelectorAll('.prose')].map((node) => node.innerHTML)).toEqual(
      before,
    );
    expect(parse).not.toHaveBeenCalled();
    expect(single).not.toHaveBeenCalled();
    expect(multi).toHaveBeenCalledOnce();
    view.rerender(<LessonManualBody markdown={markdown} visual={figure('due')} />);
    expect(multi).toHaveBeenCalledTimes(2);
    view.rerender(
      <LessonManualBody markdown={`${markdown}\n\nNuovo testo`} visual={figure('due')} />,
    );
    expect(multi).toHaveBeenCalledTimes(3);
  });

  it('preserves deduplication, duplicate secondary anchors, missing notices and sanitized order', () => {
    const multi = vi.spyOn(visualModule, 'placeLessonVisuals');
    const markdown =
      '## Uno\n\n[link][ref]\n\n## Due\n\n<script>alert(1)</script>\n\n[ref]: https://example.test';
    const visuals = [
      figure('due', 'Seconda'),
      figure('uno', 'Duplicato principale'),
      figure('due', 'Terza'),
      figure('missing', 'Mancante'),
    ];
    const view = render(
      <LessonManualBody
        markdown={markdown}
        visual={figure('uno', 'Prima')}
        visuals={visuals}
        onMissingAnchor={<span>Ancora da correggere</span>}
      />,
    );
    expect(
      [...view.container.querySelectorAll('figcaption')].map((node) => node.textContent),
    ).toEqual(['Prima', 'Seconda', 'Terza', 'Mancante']);
    expect(view.container.querySelector('script')).toBeNull();
    expect(view.container.querySelector('a')?.getAttribute('href')).toBe('https://example.test');
    expect(view.container.textContent).toContain('Ancora da correggere');
    view.rerender(
      <LessonManualBody
        markdown={markdown}
        visual={figure('uno', 'Prima aggiornata')}
        visuals={visuals.map((item) => ({ ...item, status: 'unavailable' }))}
      />,
    );
    expect(multi).toHaveBeenCalledOnce();
    expect(view.container.textContent).not.toContain('Ancora da correggere');
    view.rerender(
      <LessonManualBody markdown={markdown} visuals={[figure('due'), figure('uno')]} />,
    );
    expect(multi).toHaveBeenCalledTimes(2);
    view.rerender(
      <LessonManualBody markdown={markdown} visuals={[figure('uno'), figure('due')]} />,
    );
    expect(multi).toHaveBeenCalledTimes(3);
  });
});

describe('LESSON-MANUAL — corpo editoriale senza indice', () => {
  it('non mostra “In questa lezione” anche con molti heading', () => {
    const markdown =
      '## Uno\n\ntesto\n\n## Due\n\ntesto\n\n### Tre\n\ntesto\n\n## Quattro\n\n## Cinque\n';
    const { container } = render(<LessonManualBody markdown={markdown} />);

    expect(container.querySelector('.lm-toc')).toBeNull();
    expect(container.querySelector('.lm-toc-mobile')).toBeNull();
    expect(container.textContent).not.toContain('In questa lezione');
    expect(container.querySelectorAll('h2, h3')).toHaveLength(5);
  });

  it('rende i callout e mantiene SOLUTION richiudibile e completo', () => {
    const { container } = render(
      <LessonManualBody markdown={'> [!SOLUTION]\n> La risposta esatta\n'} />,
    );
    const details = container.querySelector('details.lm-callout--solution') as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('La risposta esatta');
  });

  it('mantiene la colonna di lettura del manuale', () => {
    const { container } = render(<LessonManualBody markdown="testo" />);
    expect(container.querySelector('.prose.prose--manual')).not.toBeNull();
  });

  it('non esegue HTML proveniente dal contenuto', () => {
    const { container } = render(
      <LessonManualBody markdown={'<script>window.__x = 1;</script>\n\ntesto'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
  });
});
