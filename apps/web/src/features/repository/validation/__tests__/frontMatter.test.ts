import { describe, expect, it } from 'vitest';
import {
  composeMarkdownWithFrontMatter,
  replaceFrontMatter,
  serializeFrontMatter,
} from '../frontMatter.js';

describe('serializeFrontMatter', () => {
  it('omits null, empty strings and empty arrays', () => {
    expect(
      serializeFrontMatter({
        titolo: 'Reti',
        sottotitolo: '',
        descrizione: null,
        obiettivi: [],
      }),
    ).toBe('titolo: Reti');
  });

  it('serializes string arrays after trimming empty items', () => {
    expect(
      serializeFrontMatter({
        concetti_chiave: [' client ', '', 'server'],
      }),
    ).toBe(`concetti_chiave:
  - client
  - server`);
  });
});

describe('composeMarkdownWithFrontMatter', () => {
  it('creates a Markdown document with YAML front matter and body', () => {
    expect(
      composeMarkdownWithFrontMatter(
        {
          titolo: 'HTTP',
          obiettivi: ['Spiegare richiesta e risposta'],
        },
        '\n# HTTP\n\nContenuto.\n',
      ),
    ).toBe(`---
titolo: HTTP
obiettivi:
  - Spiegare richiesta e risposta
---

# HTTP

Contenuto.`);
  });

  it('returns only the body when every front matter field is empty', () => {
    expect(composeMarkdownWithFrontMatter({ titolo: null }, ' Testo ')).toBe('Testo');
  });
});

describe('replaceFrontMatter', () => {
  it('replaces an existing front matter block and preserves the body', () => {
    const original = `---
titolo: Vecchio
---

# Corpo

Testo.`;

    expect(replaceFrontMatter(original, { titolo: 'Nuovo' })).toBe(`---
titolo: Nuovo
---

# Corpo

Testo.`);
  });
});
