import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LessonManualBody } from '../LessonManualBody.js';

/**
 * LESSON-MANUAL-01 — indice, ancore e vincoli di runtime.
 */

const observed: Element[] = [];
let disconnectCalls = 0;
let constructed = 0;
let lastCallback: IntersectionObserverCallback | null = null;

class FakeIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    constructed += 1;
    lastCallback = callback;
  }
  observe(target: Element) {
    observed.push(target);
  }
  disconnect() {
    disconnectCalls += 1;
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  observed.length = 0;
  disconnectCalls = 0;
  constructed = 0;
  lastCallback = null;
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SIX =
  '## Uno\n\ntesto\n\n## Due\n\ntesto\n\n### Tre\n\ntesto\n\n## Quattro\n\n## Cinque\n\n## Sei\n';

describe('soglia dell’indice', () => {
  it.each([
    ['nessun heading', 'Solo testo.'],
    ['un heading', '## Uno\n'],
    ['due heading', '## Uno\n\n## Due\n'],
  ])('%s ⇒ nessun indice e corpo centrato', (_label, markdown) => {
    const { container } = render(<LessonManualBody markdown={markdown} />);
    expect(container.querySelector('.lm-toc')).toBeNull();
    expect(container.querySelector('.lm-toc-mobile')).toBeNull();
    expect(container.querySelector('.lesson-manual--with-toc')).toBeNull();
    // Nessun osservatore aperto quando non c'è indice.
    expect(constructed).toBe(0);
  });

  it('tre o più heading ⇒ indice desktop e compatto, nell’ordine del documento', () => {
    const { container } = render(<LessonManualBody markdown={SIX} />);
    expect(container.querySelector('.lesson-manual--with-toc')).not.toBeNull();

    const desktop = container.querySelector('.lm-toc')!;
    expect(
      within(desktop as HTMLElement)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Uno', 'Due', 'Tre', 'Quattro', 'Cinque', 'Sei']);
    // Il livello è esposto per l'indentazione, non per il colore.
    const items = desktop.querySelectorAll('li');
    expect(items[2]!.getAttribute('data-level')).toBe('3');

    expect(container.querySelector('.lm-toc-mobile')).not.toBeNull();
    expect(screen.getAllByText('In questa lezione').length).toBe(2);
  });
});

describe('IntersectionObserver', () => {
  it('ne apre uno solo e osserva ogni heading una volta', () => {
    render(<LessonManualBody markdown={SIX} />);
    expect(constructed).toBe(1);
    expect(observed).toHaveLength(6);
    expect(new Set(observed).size).toBe(6);
  });

  it('lo disconnette allo smontaggio', () => {
    const view = render(<LessonManualBody markdown={SIX} />);
    expect(disconnectCalls).toBe(0);
    view.unmount();
    expect(disconnectCalls).toBe(1);
  });

  it('ricostruisce in modo pulito quando cambia la lezione', () => {
    const view = render(<LessonManualBody markdown={SIX} />);
    view.rerender(<LessonManualBody markdown={'## A\n\n## B\n\n## C\n'} />);
    // Un solo osservatore alla volta: il precedente è stato disconnesso.
    expect(constructed).toBe(2);
    expect(disconnectCalls).toBe(1);
  });

  it('non aggiorna lo stato dopo lo smontaggio', () => {
    const view = render(<LessonManualBody markdown={SIX} />);
    const callback = lastCallback!;
    view.unmount();
    expect(() =>
      callback(
        [{ isIntersecting: true, target: { id: 'uno' } } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    ).not.toThrow();
  });

  it('evidenzia sobriamente la sezione corrente', () => {
    const { container } = render(<LessonManualBody markdown={SIX} />);
    const heading = container.querySelector('h2#due')!;
    act(() => {
      lastCallback!(
        [{ isIntersecting: true, target: heading } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    const current = container.querySelectorAll('a[aria-current="true"]');
    // Una voce per indice (desktop + compatto), nessun blocco pieno.
    expect(current).toHaveLength(2);
    expect(current[0]!.textContent).toBe('Due');
  });
});

describe('navigazione dall’indice', () => {
  it('porta la sezione in vista, le sposta il focus e non tocca la cronologia', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { container } = render(<LessonManualBody markdown={SIX} />);
    const before = window.history.length;

    const link = within(container.querySelector('.lm-toc') as HTMLElement).getByRole('link', {
      name: 'Quattro',
    });
    fireEvent.click(link);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(container.querySelector('h2#quattro'));
    expect(window.history.length).toBe(before);
    // Nessun hash aggiunto all'URL.
    expect(window.location.hash).toBe('');
  });

  it('gli heading sono focalizzabili da codice ma fuori dall’ordine di tabulazione', () => {
    const { container } = render(<LessonManualBody markdown={SIX} />);
    for (const heading of container.querySelectorAll('h2, h3')) {
      expect(heading.getAttribute('tabindex')).toBe('-1');
    }
  });

  it('un id dell’autore non dirotta l’ancora della sezione', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const markdown = '<p id="due">esca</p>\n\n## Uno\n\n## Due\n\n## Tre\n';
    const { container } = render(<LessonManualBody markdown={markdown} />);

    fireEvent.click(
      within(container.querySelector('.lm-toc') as HTMLElement).getByRole('link', { name: 'Due' }),
    );

    // Il focus va sull'heading, non sul paragrafo con lo stesso id.
    expect(document.activeElement).toBe(container.querySelector('h2#due'));
  });
});

describe('contenuto', () => {
  it('rende i callout e mantiene SOLUTION richiudibile e completo', () => {
    const { container } = render(
      <LessonManualBody markdown={'> [!SOLUTION]\n> La risposta esatta\n'} />,
    );
    const details = container.querySelector('details.lm-callout--solution') as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    // Il testo è nel DOM anche da chiuso: nulla è perso.
    expect(details.textContent).toContain('La risposta esatta');
  });

  it('applica la classe della colonna di lettura', () => {
    const { container } = render(<LessonManualBody markdown={'testo'} />);
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
