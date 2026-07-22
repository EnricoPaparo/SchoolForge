import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from '../MarkdownRenderer.js';

afterEach(cleanup);

function renderMd(markdown: string) {
  const { container } = render(<MarkdownRenderer markdown={markdown} />);
  return container;
}

describe('MarkdownRenderer — basic rendering', () => {
  it('renders a heading', () => {
    const c = renderMd('# Hello World');
    const h1 = c.querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1?.textContent).toContain('Hello World');
  });

  it('renders a paragraph', () => {
    const c = renderMd('This is a paragraph.');
    const p = c.querySelector('p');
    expect(p).not.toBeNull();
    expect(p?.textContent).toContain('This is a paragraph.');
  });

  it('renders an unordered list', () => {
    const c = renderMd(`- item one\n- item two`);
    const items = c.querySelectorAll('li');
    expect(items.length).toBe(2);
  });

  it('renders inline code', () => {
    const c = renderMd('Use `console.log()` here.');
    const code = c.querySelector('code');
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain('console.log()');
  });

  it('renders a fenced code block', () => {
    const c = renderMd('```\nconst x = 1;\n```');
    const pre = c.querySelector('pre');
    expect(pre).not.toBeNull();
  });
});

describe('MarkdownRenderer — XSS protection', () => {
  it('does not render script tags', () => {
    const c = renderMd('<script>alert(1)</script>');
    const scripts = c.querySelectorAll('script');
    expect(scripts.length).toBe(0);
    expect(c.innerHTML).not.toContain('<script>');
  });

  it('strips onerror attribute from images', () => {
    const c = renderMd('<img src="x" onerror="alert(1)">');
    const img = c.querySelector('img');
    // Either the img is removed or the onerror is stripped
    if (img) {
      expect(img.getAttribute('onerror')).toBeNull();
    }
  });

  it('strips onclick attribute', () => {
    const c = renderMd('<button onclick="alert(1)">click</button>');
    const btn = c.querySelector('button');
    if (btn) {
      expect(btn.getAttribute('onclick')).toBeNull();
    }
  });

  it('strips javascript: href links', () => {
    const c = renderMd('<a href="javascript:alert(1)">click</a>');
    const a = c.querySelector('a');
    if (a) {
      const href = a.getAttribute('href');
      if (href !== null) {
        expect(href).not.toContain('javascript:');
      }
    }
    // Either the link is removed or the href is stripped — both are acceptable
  });
});

describe('MarkdownRenderer — links', () => {
  it('renders links with target _blank and rel noopener noreferrer', () => {
    const c = renderMd('[example](https://example.com)');
    const link = c.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('MarkdownRenderer — lesson reading variant', () => {
  it('keeps the default renderer compact and without lesson navigation', () => {
    const c = renderMd('## Uno\n\nTesto.\n\n## Due\n\nAltro.');
    expect(c.querySelector('.prose--lesson')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Indice della lezione' })).toBeNull();
  });

  it('builds an accessible h2/h3 table of contents only with two useful headings', () => {
    const { container } = render(
      <MarkdownRenderer
        variant="lesson"
        markdown={'# Titolo\n\n## Prima sezione\n\nTesto.\n\n### Dettaglio\n\nAltro.'}
      />,
    );
    const navigation = screen.getByRole('navigation', { name: 'Indice della lezione' });
    const links = navigation.querySelectorAll('a');
    expect(links).toHaveLength(2);
    expect(links[0]?.textContent).toBe('Prima sezione');
    expect(links[1]?.textContent).toBe('Dettaglio');
    expect(links[1]?.closest('li')?.getAttribute('data-level')).toBe('3');
    expect(container.querySelector('h1')?.id).toBe('');
    expect(container.querySelector('h2')?.id).toBe(links[0]?.getAttribute('href')?.slice(1));
  });

  it('omits the table of contents when fewer than two h2/h3 headings exist', () => {
    render(<MarkdownRenderer variant="lesson" markdown={'## Unica sezione\n\nTesto.'} />);
    expect(screen.queryByRole('navigation', { name: 'Indice della lezione' })).toBeNull();
  });

  it('creates deterministic safe unique ids for duplicate and international headings', () => {
    const markdown = '## Perché l’IA?\n\nA.\n\n## Perché l’IA?\n\nB.\n\n### 網路 e simboli!\n\nC.';
    const first = render(<MarkdownRenderer variant="lesson" markdown={markdown} />);
    const firstIds = [...first.container.querySelectorAll('h2, h3')].map((node) => node.id);
    first.unmount();
    const second = render(<MarkdownRenderer variant="lesson" markdown={markdown} />);
    const secondIds = [...second.container.querySelectorAll('h2, h3')].map((node) => node.id);
    expect(firstIds).toEqual(secondIds);
    expect(new Set(firstIds).size).toBe(3);
    expect(firstIds[0]).toMatch(/-perche-lia$/);
    expect(firstIds[1]).toMatch(/-perche-lia-2$/);
    expect(firstIds[2]).toMatch(/-e-simboli$/);
    for (const id of firstIds) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('preserves semantic Markdown and XSS/link protections in lesson mode', () => {
    const { container } = render(
      <MarkdownRenderer
        variant="lesson"
        markdown={
          '> Nota\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```\n\n![alt](x.png)\n\n[link](https://example.com)\n\n<script>alert(1)</script>'
        }
      />,
    );
    expect(container.querySelector('blockquote')).not.toBeNull();
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('pre code')).not.toBeNull();
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('alt');
    expect(container.querySelector('script')).toBeNull();
    const link = container.querySelector('a[href="https://example.com"]');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('rebuilds the table of contents when the selected lesson changes', () => {
    const view = render(
      <MarkdownRenderer variant="lesson" markdown={'## Alfa\n\nA.\n\n## Beta\n\nB.'} />,
    );
    expect(screen.getByRole('link', { name: 'Alfa' })).toBeTruthy();
    view.rerender(
      <MarkdownRenderer variant="lesson" markdown={'## Gamma\n\nC.\n\n## Delta\n\nD.'} />,
    );
    expect(screen.queryByRole('link', { name: 'Alfa' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Gamma' })).toBeTruthy();
  });

  it('removes its scroll listener when the lesson renderer unmounts', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const view = render(
      <MarkdownRenderer variant="lesson" markdown={'## Alfa\n\nA.\n\n## Beta\n\nB.'} />,
    );
    const scrollRegistration = add.mock.calls.find(([type]) => type === 'scroll');
    expect(scrollRegistration).toBeTruthy();
    view.unmount();
    expect(
      remove.mock.calls.some(
        ([type, listener]) => type === 'scroll' && listener === scrollRegistration?.[1],
      ),
    ).toBe(true);
    add.mockRestore();
    remove.mockRestore();
  });
});
