import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LessonManualBody } from '../LessonManualBody.js';

afterEach(cleanup);

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
