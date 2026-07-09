import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LessonMetadata } from '../../repository/validation/types.js';

type Call = { method: string; args: unknown[] };

let calls: Call[] = [];

vi.mock('jspdf', () => {
  class FakeJsPDF {
    internal = { pageSize: { getWidth: () => 210 } };

    setFontSize(...args: unknown[]) {
      calls.push({ method: 'setFontSize', args });
    }
    setFont(...args: unknown[]) {
      calls.push({ method: 'setFont', args });
    }
    setTextColor(...args: unknown[]) {
      calls.push({ method: 'setTextColor', args });
    }
    splitTextToSize(text: string) {
      return [text];
    }
    text(...args: unknown[]) {
      calls.push({ method: 'text', args });
    }
    addPage() {
      calls.push({ method: 'addPage', args: [] });
    }
    save(...args: unknown[]) {
      calls.push({ method: 'save', args });
    }
  }

  return { jsPDF: FakeJsPDF };
});

const { downloadLessonPdf } = await import('../lessonPdf.js');

const EMPTY_METADATA: LessonMetadata = {
  titolo: null,
  sottotitolo: null,
  difficolta: null,
  concettiChiave: [],
  obiettivi: [],
};

function textCallStrings(): string[] {
  return calls
    .filter((c) => c.method === 'text')
    .map((c) => c.args[0])
    .flatMap((arg) => (Array.isArray(arg) ? arg : [arg]))
    .filter((v): v is string => typeof v === 'string');
}

beforeEach(() => {
  calls = [];
});

describe('downloadLessonPdf — no front matter (fallback, unchanged behavior)', () => {
  it('renders only the title, uda context and body — no metadata omitted from output', async () => {
    await downloadLessonPdf('Lezione 001', '# Titolo\nCorpo della lezione.', 'Corso - UDA 1');
    const texts = textCallStrings();
    expect(texts).toContain('Lezione 001');
    expect(texts).toContain('Corso - UDA 1');
    expect(texts).toContain('Titolo');
    expect(texts).toContain('Corpo della lezione.');
    expect(texts.some((t) => t.startsWith('Difficoltà:'))).toBe(false);
    expect(texts.some((t) => t.startsWith('Concetti chiave:'))).toBe(false);
    expect(texts).not.toContain('Obiettivi:');
  });

  it('produces the same output when metadata is explicitly empty', async () => {
    await downloadLessonPdf('Lezione 001', 'Corpo.', null, EMPTY_METADATA);
    const texts = textCallStrings();
    expect(texts).toEqual(['Lezione 001', 'Corpo.']);
  });
});

describe('downloadLessonPdf — with front matter metadata', () => {
  it('inserts only the metadata fields that are present', async () => {
    const metadata: LessonMetadata = {
      titolo: 'Lezione 001',
      sottotitolo: 'Un sottotitolo',
      difficolta: null,
      concettiChiave: [],
      obiettivi: ['Obiettivo 1', 'Obiettivo 2'],
    };
    await downloadLessonPdf('Lezione 001', 'Corpo.', null, metadata);
    const texts = textCallStrings();
    expect(texts).toContain('Un sottotitolo');
    expect(texts).toContain('Obiettivi:');
    expect(texts).toContain('•  Obiettivo 1');
    expect(texts).toContain('•  Obiettivo 2');
    // Not present in this fixture — must not appear at all.
    expect(texts.some((t) => t.startsWith('Difficoltà:'))).toBe(false);
    expect(texts.some((t) => t.startsWith('Concetti chiave:'))).toBe(false);
  });

  it('inserts difficolta and concetti_chiave when present', async () => {
    const metadata: LessonMetadata = {
      titolo: 'Lezione 001',
      sottotitolo: null,
      difficolta: 'base',
      concettiChiave: ['IA', 'Storia'],
      obiettivi: [],
    };
    await downloadLessonPdf('Lezione 001', 'Corpo.', null, metadata);
    const texts = textCallStrings();
    expect(texts).toContain('Difficoltà: base');
    expect(texts).toContain('Concetti chiave: IA, Storia');
  });
});
