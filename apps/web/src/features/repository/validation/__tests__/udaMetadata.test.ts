import { describe, expect, it } from 'vitest';
import { EMPTY_UDA_METADATA, parseUdaMetadata } from '../udaMetadata.js';

describe('parseUdaMetadata — front matter absent', () => {
  it('falls back to the body first paragraph for descrizione, empty competenze/obiettivi', () => {
    const content = '# Reti\n\nUna introduzione alle reti.';
    const { metadata, body } = parseUdaMetadata(content);
    expect(metadata).toEqual({
      descrizione: 'Una introduzione alle reti.',
      competenze: [],
      obiettivi: [],
    });
    expect(body).toBe(content);
  });

  it('EMPTY_UDA_METADATA matches an entirely empty document', () => {
    const { metadata } = parseUdaMetadata('');
    expect(metadata).toEqual(EMPTY_UDA_METADATA);
  });
});

describe('parseUdaMetadata — front matter with an explicit descrizione key (RE-01+)', () => {
  it('prefers the front matter descrizione over the body first paragraph', () => {
    const content = `---
titolo: "Reti"
descrizione: "Descrizione curata dal docente"
competenze:
  - "Comprendere il modello OSI"
obiettivi:
  - "Distinguere client e server"
---

Questo paragrafo non deve essere usato come descrizione.`;

    const { metadata, body } = parseUdaMetadata(content);
    expect(metadata.descrizione).toBe('Descrizione curata dal docente');
    expect(metadata.competenze).toEqual(['Comprendere il modello OSI']);
    expect(metadata.obiettivi).toEqual(['Distinguere client e server']);
    expect(body).toBe('Questo paragrafo non deve essere usato come descrizione.');
  });
});

describe('parseUdaMetadata — legacy front matter without descrizione', () => {
  it('falls back to the body first paragraph when the key is absent', () => {
    const content = `---
titolo: "Reti"
competenze:
  - "Comprendere il modello OSI"
obiettivi:
  - "Distinguere client e server"
---

Prima frase del corpo, usata come descrizione.`;

    const { metadata } = parseUdaMetadata(content);
    expect(metadata.descrizione).toBe('Prima frase del corpo, usata come descrizione.');
  });
});

describe('parseUdaMetadata — invalid front matter', () => {
  it('never throws and falls back to empty competenze/obiettivi on malformed YAML', () => {
    const content = `---
titolo: "unterminated
---

Corpo.`;
    expect(() => parseUdaMetadata(content)).not.toThrow();
    const { metadata } = parseUdaMetadata(content);
    expect(metadata.competenze).toEqual([]);
    expect(metadata.obiettivi).toEqual([]);
  });
});
