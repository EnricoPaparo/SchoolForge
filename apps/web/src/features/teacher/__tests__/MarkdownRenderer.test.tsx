import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
