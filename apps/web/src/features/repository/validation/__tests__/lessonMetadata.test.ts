import { describe, expect, it } from 'vitest';
import { EMPTY_LESSON_METADATA, parseLessonMetadata } from '../lessonMetadata.js';

describe('parseLessonMetadata — front matter absent', () => {
  it('returns empty metadata and the original content as body when there is no front matter block', () => {
    const content = '# Titolo della lezione\n\nTesto della lezione.';
    const { metadata, body } = parseLessonMetadata(content);
    expect(metadata).toEqual(EMPTY_LESSON_METADATA);
    expect(body).toBe(content);
  });
});

describe('parseLessonMetadata — valid front matter', () => {
  it('parses all supported fields', () => {
    const content = `---
titolo: "Storia della AI"
sottotitolo: "Dalle origini a oggi"
difficolta: "base"
concetti_chiave:
  - "IA simbolica"
  - "Machine learning"
obiettivi:
  - "Conoscere le tappe principali"
  - "Distinguere IA simbolica e ML"
---

# Storia della AI

Testo della lezione.`;

    const { metadata, body } = parseLessonMetadata(content);
    expect(metadata.titolo).toBe('Storia della AI');
    expect(metadata.sottotitolo).toBe('Dalle origini a oggi');
    expect(metadata.difficolta).toBe('base');
    expect(metadata.concettiChiave).toEqual(['IA simbolica', 'Machine learning']);
    expect(metadata.obiettivi).toEqual([
      'Conoscere le tappe principali',
      'Distinguere IA simbolica e ML',
    ]);
    // The leading "# Storia della AI" exactly matches titolo — stripped to
    // avoid showing the same title twice.
    expect(body).toBe('Testo della lezione.');
  });

  it('supports a partial front matter — only some fields present', () => {
    const content = `---
titolo: "Reti"
---

Testo.`;
    const { metadata, body } = parseLessonMetadata(content);
    expect(metadata.titolo).toBe('Reti');
    expect(metadata.sottotitolo).toBeNull();
    expect(metadata.difficolta).toBeNull();
    expect(metadata.concettiChiave).toEqual([]);
    expect(metadata.obiettivi).toEqual([]);
    expect(body).toBe('Testo.');
  });

  it('does not strip the body heading when it differs from titolo', () => {
    const content = `---
titolo: "Reti"
---

# Un titolo diverso

Testo.`;
    const { body } = parseLessonMetadata(content);
    expect(body).toBe('# Un titolo diverso\n\nTesto.');
  });

  it('treats "---\\n---" as no front matter at all (no closing delimiter for an empty block) — same fallback as absent front matter', () => {
    const content = `---
---

Testo.`;
    const { metadata, body } = parseLessonMetadata(content);
    expect(metadata).toEqual(EMPTY_LESSON_METADATA);
    expect(body).toBe(content);
  });
});

describe('parseLessonMetadata — invalid front matter', () => {
  it('falls back to empty metadata and the un-stripped body on malformed YAML', () => {
    const content = `---
titolo: "unterminated string
sottotitolo: ok
---

Testo.`;
    const { metadata, body } = parseLessonMetadata(content);
    expect(metadata).toEqual(EMPTY_LESSON_METADATA);
    expect(body).toBe('Testo.');
  });

  it('never throws, even for wildly malformed YAML', () => {
    const content = `---
: : :
---
Testo.`;
    expect(() => parseLessonMetadata(content)).not.toThrow();
  });
});
