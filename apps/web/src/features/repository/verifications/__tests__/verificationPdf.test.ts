import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerificationTeacherSnapshot } from '../../../../types/firestore.js';
import type { LoadedQuestion } from '../loadSelectedQuestions.js';
import type { LoadedQuestionWithSolution } from '../loadSelectedQuestionsWithSolutions.js';

type Call = { method: string; args: unknown[] };

let calls: Call[] = [];

/**
 * Override `splitTextToSize` behavior for a single test. Set before the call
 * and reset to null in a finally block. When null the fake returns [text] (no split).
 */
let splitOverride: ((text: string, maxW: number) => string[]) | null = null;

vi.mock('jspdf', () => {
  class FakeJsPDF {
    internal = { pageSize: { getWidth: () => 210 } };

    setFontSize(...args: unknown[]) {
      calls.push({ method: 'setFontSize', args });
    }
    setFont(...args: unknown[]) {
      calls.push({ method: 'setFont', args });
    }
    setDrawColor(...args: unknown[]) {
      calls.push({ method: 'setDrawColor', args });
    }
    splitTextToSize(text: string, maxW: number) {
      calls.push({ method: 'splitTextToSize', args: [text, maxW] });
      if (splitOverride) return splitOverride(text, maxW);
      return [text];
    }
    getTextWidth(text: string) {
      return text.length * 2;
    }
    text(...args: unknown[]) {
      calls.push({ method: 'text', args });
    }
    line(...args: unknown[]) {
      calls.push({ method: 'line', args });
    }
    rect(...args: unknown[]) {
      calls.push({ method: 'rect', args });
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

const { downloadStudentPdf, downloadStudentPdfFromProjection, downloadTeacherSolutionsPdf } =
  await import('../verificationPdf.js');

const SNAPSHOT = {
  title: 'Verifica Reti',
  classId: null,
  className: null,
  programId: 'prog-1',
  importId: 'imp-1',
  questionRefs: [],
  activatedAt: null,
} as unknown as VerificationTeacherSnapshot;

const APERTA: LoadedQuestion = {
  ref: {
    questionIndexEntryId: 'qi-1',
    questionLocalId: 'q1',
    udaDir: 'uda-01',
    lessonFilename: 'lezione-001.md',
    poolStorageRef: 'pool.md',
    tipo: 'aperta',
    difficolta: 1,
    maxPoints: 2,
  },
  testo: 'Descrivi il modello OSI.',
  tipo: 'aperta',
};

const CHIUSA: LoadedQuestion = {
  ref: {
    questionIndexEntryId: 'qi-2',
    questionLocalId: 'q2',
    udaDir: 'uda-01',
    lessonFilename: 'lezione-001.md',
    poolStorageRef: 'pool.md',
    tipo: 'chiusa_singola',
    difficolta: 1,
    maxPoints: 1,
  },
  testo: 'Quale livello gestisce il routing?',
  tipo: 'chiusa_singola',
  opzioni: [
    { id: 'a', testo: 'Rete' },
    { id: 'b', testo: 'Trasporto' },
  ],
};

beforeEach(() => {
  calls = [];
  splitOverride = null;
});

describe('downloadStudentPdf — student fields', () => {
  it('draws Nome e Cognome / Data as label + line, never as underscore text', async () => {
    await downloadStudentPdf(SNAPSHOT, [APERTA], null);

    const textCalls = calls.filter((c) => c.method === 'text');

    const nomeCall = textCalls.find((c) => String(c.args[0]) === 'Nome e Cognome:');
    const dataCall = textCalls.find((c) => String(c.args[0]) === 'Data:');
    expect(nomeCall).toBeTruthy();
    expect(dataCall).toBeTruthy();

    // Neither field's label text contains underscores — the fill-in line is
    // drawn separately via doc.line(), not baked into the label string.
    expect(String(nomeCall?.args[0])).not.toMatch(/_/);
    expect(String(dataCall?.args[0])).not.toMatch(/_/);
  });

  it('draws two field lines that end at the same x coordinate', async () => {
    await downloadStudentPdf(SNAPSHOT, [APERTA], null);

    const lineCalls = calls.filter((c) => c.method === 'line');
    // First two `line` calls are the field lines (before the header/footer hRules
    // that span the full margin-to-margin width at x2 = 190 too — so instead we
    // assert on the two shortest lines, which are the field lines starting after
    // each label).
    const fieldLines = lineCalls.filter((c) => (c.args[0] as number) > 20);
    expect(fieldLines.length).toBeGreaterThanOrEqual(2);
    const endXs = new Set(fieldLines.map((c) => c.args[2]));
    expect(endXs.size).toBe(1);
  });

  it('does not draw a full-width divider between the Data field and the questions', async () => {
    await downloadStudentPdf(SNAPSHOT, [], null);

    const fullWidthLines = calls.filter(
      (c) => c.method === 'line' && c.args[0] === 20 && c.args[2] === 190,
    );

    // Only the footer rule before "Punteggio": between Data and the first
    // question there is blank vertical space, not a section divider.
    expect(fullWidthLines).toHaveLength(1);
  });

  it('never draws a value on the field lines — the teacher preview is always blank', async () => {
    await downloadStudentPdf(SNAPSHOT, [APERTA], 'Classe 3A');

    const textCalls = calls.filter((c) => c.method === 'text').map((c) => String(c.args[0]));
    expect(textCalls.some((t) => /^\d{2}\/\d{2}\/\d{4}$/.test(t))).toBe(false);
  });
});

describe('downloadStudentPdf — filename (docente preview, no student name)', () => {
  it('saves as aaaammgg-classe-titoloverifica.pdf', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 9));
    try {
      await downloadStudentPdf({ ...SNAPSHOT, title: 'Verifica Reti' }, [APERTA], 'Classe 3A');
    } finally {
      vi.useRealTimers();
    }

    const saveCall = calls.find((c) => c.method === 'save');
    expect(String(saveCall?.args[0])).toBe('20260709-Classe-3A-Verifica-Reti.pdf');
  });

  it('falls back to senza-classe when the verification has no class', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 9));
    try {
      await downloadStudentPdf({ ...SNAPSHOT, title: 'Verifica Reti' }, [APERTA], null);
    } finally {
      vi.useRealTimers();
    }

    const saveCall = calls.find((c) => c.method === 'save');
    expect(String(saveCall?.args[0])).toBe('20260709-senza-classe-Verifica-Reti.pdf');
  });
});

describe('downloadStudentPdf — aperta questions', () => {
  it('draws no answer lines for aperta questions beyond the header/footer rules', async () => {
    calls = [];
    await downloadStudentPdf(SNAPSHOT, [APERTA], null);
    const lineCallsForAperta = calls.filter((c) => c.method === 'line').length;

    calls = [];
    await downloadStudentPdf(SNAPSHOT, [], null);
    const lineCallsNoQuestions = calls.filter((c) => c.method === 'line').length;

    // An aperta question contributes zero extra `line` calls compared to a PDF
    // with no questions at all — the only lines are the two student-field
    // lines and the footer rule.
    expect(lineCallsForAperta).toBe(lineCallsNoQuestions);
  });

  it('never draws a rect for an aperta question', async () => {
    await downloadStudentPdf(SNAPSHOT, [APERTA], null);
    expect(calls.some((c) => c.method === 'rect')).toBe(false);
  });
});

describe('downloadStudentPdf — closed questions', () => {
  it('draws a rect checkbox per option instead of a text glyph', async () => {
    await downloadStudentPdf(SNAPSHOT, [CHIUSA], null);

    const rectCalls = calls.filter((c) => c.method === 'rect');
    expect(rectCalls).toHaveLength(2); // one per option

    const textCalls = calls.filter((c) => c.method === 'text');
    expect(textCalls.some((c) => String(c.args[0]).includes('○'))).toBe(false);
    expect(textCalls.some((c) => String(c.args[0]) === 'Rete')).toBe(true);
    expect(textCalls.some((c) => String(c.args[0]) === 'Trasporto')).toBe(true);
  });

  it('never includes soluzione, correctAnswer or answers text anywhere in the student PDF', async () => {
    await downloadStudentPdf(SNAPSHOT, [APERTA, CHIUSA], null);
    const rendered = calls
      .filter((c) => c.method === 'text')
      .map((c) => String(c.args[0]))
      .join('\n');
    expect(rendered).not.toMatch(/soluzione/i);
    expect(rendered).not.toMatch(/corretta/i);
  });

  it('calls splitTextToSize for each option text to enable wrapping', async () => {
    await downloadStudentPdf(SNAPSHOT, [CHIUSA], null);

    const splitCalls = calls.filter((c) => c.method === 'splitTextToSize');
    const optionSplits = splitCalls.filter(
      (c) => c.args[0] === 'Rete' || c.args[0] === 'Trasporto',
    );
    expect(optionSplits).toHaveLength(2);
    // maxW should be less than the full content width (170mm) because indent + box + gap are subtracted
    expect(optionSplits[0].args[1] as number).toBeLessThan(170);
  });

  it('draws one rect per option even when option text wraps to multiple lines', async () => {
    splitOverride = (text) => {
      if (text === 'Rete') return ['Rete'];
      if (text === 'Trasporto') return ['Traspor-', 'to'];
      return [text];
    };
    try {
      await downloadStudentPdf(SNAPSHOT, [CHIUSA], null);
    } finally {
      splitOverride = null;
    }

    // Still one rect per option
    const rectCalls = calls.filter((c) => c.method === 'rect');
    expect(rectCalls).toHaveLength(2);

    // The multi-line option produces two separate text calls
    const textCalls = calls.filter((c) => c.method === 'text').map((c) => String(c.args[0]));
    expect(textCalls.filter((t) => t === 'Traspor-').length).toBe(1);
    expect(textCalls.filter((t) => t === 'to').length).toBe(1);
  });
});

// ─── downloadStudentPdfFromProjection (M3L-D, real student download) ────────

const PROJECTION = {
  title: 'Verifica Reti',
  className: 'Classe 3A',
  questions: [
    { order: 0, tipo: 'aperta' as const, maxPoints: 2, testo: 'Descrivi il modello OSI.' },
    {
      order: 1,
      tipo: 'chiusa_singola' as const,
      maxPoints: 1,
      testo: 'Quale livello gestisce il routing?',
      opzioni: [
        { id: 'a', testo: 'Rete' },
        { id: 'b', testo: 'Trasporto' },
      ],
    },
  ],
};

describe('downloadStudentPdfFromProjection', () => {
  it('renders the same student fields (Nome e Cognome / Data) as downloadStudentPdf', async () => {
    await downloadStudentPdfFromProjection(PROJECTION);

    const textCalls = calls.filter((c) => c.method === 'text');
    expect(textCalls.some((c) => String(c.args[0]) === 'Nome e Cognome:')).toBe(true);
    expect(textCalls.some((c) => String(c.args[0]) === 'Data:')).toBe(true);
  });

  it('renders the title and class from the projection, never a poolStorageRef or questionRefs field', async () => {
    await downloadStudentPdfFromProjection(PROJECTION);

    const rendered = calls
      .filter((c) => c.method === 'text')
      .map((c) => String(c.args[0]))
      .join('\n');
    expect(rendered).toContain('Verifica Reti');
    expect(rendered).toContain('Classe: Classe 3A');
    expect(rendered).not.toContain('poolStorageRef');
  });

  it('renders a checkbox rect per option, matching downloadStudentPdf for an equivalent question', async () => {
    await downloadStudentPdfFromProjection(PROJECTION);

    const rectCalls = calls.filter((c) => c.method === 'rect');
    expect(rectCalls).toHaveLength(2);
  });

  it('never includes soluzione, correctAnswer or answers text anywhere', async () => {
    await downloadStudentPdfFromProjection(PROJECTION);

    const rendered = calls
      .filter((c) => c.method === 'text')
      .map((c) => String(c.args[0]))
      .join('\n');
    expect(rendered).not.toMatch(/soluzione/i);
    expect(rendered).not.toMatch(/corretta/i);
  });

  it('saves the PDF as aaaammgg-classe-titoloverifica-Nome-Cognome.pdf when a student identity is given', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 9));
    try {
      await downloadStudentPdfFromProjection(PROJECTION, {
        displayName: 'Mario Rossi',
        email: null,
      });
    } finally {
      vi.useRealTimers();
    }

    const saveCall = calls.find((c) => c.method === 'save');
    expect(String(saveCall?.args[0])).toBe('20260709-Classe-3A-Verifica-Reti-Mario-Rossi.pdf');
  });

  it('falls back to email when displayName is absent, for both filename and prefill', async () => {
    await downloadStudentPdfFromProjection(PROJECTION, {
      displayName: null,
      email: 'mario.rossi@gmail.com',
    });

    const saveCall = calls.find((c) => c.method === 'save');
    expect(String(saveCall?.args[0])).toContain('mario.rossi@gmail.com');

    const textCalls = calls.filter((c) => c.method === 'text');
    expect(textCalls.some((c) => String(c.args[0]) === 'mario.rossi@gmail.com')).toBe(true);
  });

  it('saves a plain aaaammgg-classe-titoloverifica.pdf (no name segment) when no student identity is given', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 9));
    try {
      await downloadStudentPdfFromProjection(PROJECTION);
    } finally {
      vi.useRealTimers();
    }

    const saveCall = calls.find((c) => c.method === 'save');
    expect(String(saveCall?.args[0])).toBe('20260709-Classe-3A-Verifica-Reti.pdf');
  });

  it('pre-fills Nome e Cognome with displayName, drawn on the field line', async () => {
    await downloadStudentPdfFromProjection(PROJECTION, {
      displayName: 'Mario Rossi',
      email: 'mario.rossi@gmail.com',
    });

    const textCalls = calls.filter((c) => c.method === 'text');
    expect(textCalls.some((c) => String(c.args[0]) === 'Mario Rossi')).toBe(true);
    // email must not appear when displayName is present
    expect(textCalls.some((c) => String(c.args[0]) === 'mario.rossi@gmail.com')).toBe(false);
  });

  it("pre-fills Data with today's date in it-IT format (dd/mm/yyyy)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 9));
    try {
      await downloadStudentPdfFromProjection(PROJECTION, {
        displayName: 'Mario Rossi',
        email: null,
      });
    } finally {
      vi.useRealTimers();
    }

    const textCalls = calls.filter((c) => c.method === 'text');
    expect(textCalls.some((c) => String(c.args[0]) === '09/07/2026')).toBe(true);
  });

  it('never pre-fills fields or a student name when no identity is passed (teacher-preview-equivalent)', async () => {
    await downloadStudentPdfFromProjection(PROJECTION);

    const textCalls = calls.filter((c) => c.method === 'text').map((c) => String(c.args[0]));
    // Only the labels are drawn — no filled-in name or date value anywhere.
    expect(textCalls).toContain('Nome e Cognome:');
    expect(textCalls).toContain('Data:');
    expect(textCalls.some((t) => /^\d{2}\/\d{2}\/\d{4}$/.test(t))).toBe(false);
  });

  it('handles a verification with no class (className: null) the same way as downloadStudentPdf', async () => {
    await downloadStudentPdfFromProjection({ ...PROJECTION, className: null });

    const rendered = calls
      .filter((c) => c.method === 'text')
      .map((c) => String(c.args[0]))
      .join('\n');
    expect(rendered).not.toContain('Classe:');
  });
});

const APERTA_WITH_SOLUTION: LoadedQuestionWithSolution = {
  ref: APERTA.ref,
  testo: APERTA.testo,
  tipo: 'aperta',
  soluzione: 'Il modello OSI ha 7 livelli.',
};

const CHIUSA_WITH_SOLUTION: LoadedQuestionWithSolution = {
  ref: CHIUSA.ref,
  testo: CHIUSA.testo,
  tipo: 'chiusa_singola',
  opzioni: CHIUSA.opzioni,
  soluzione: ['a'],
};

describe('downloadTeacherSolutionsPdf', () => {
  it('includes the "COPIA DOCENTE — SOLUZIONI" header', async () => {
    await downloadTeacherSolutionsPdf(SNAPSHOT, [APERTA_WITH_SOLUTION], null);
    const textCalls = calls.filter((c) => c.method === 'text');
    expect(textCalls.some((c) => String(c.args[0]) === 'COPIA DOCENTE — SOLUZIONI')).toBe(true);
  });

  it('shows the title and classe when present', async () => {
    await downloadTeacherSolutionsPdf(SNAPSHOT, [APERTA_WITH_SOLUTION], 'Classe 3A');
    const textCalls = calls.filter((c) => c.method === 'text');
    expect(textCalls.some((c) => String(c.args[0]) === 'Verifica Reti')).toBe(true);
    expect(textCalls.some((c) => String(c.args[0]) === 'Classe: Classe 3A')).toBe(true);
  });

  it('places classe on the same line as the verification title when it fits', async () => {
    await downloadStudentPdf(SNAPSHOT, [APERTA], 'Classe 3A');
    const textCalls = calls.filter((c) => c.method === 'text');
    const titleCall = textCalls.find((c) => String(c.args[0]) === 'Verifica Reti');
    const classCall = textCalls.find((c) => String(c.args[0]) === 'Classe: Classe 3A');

    expect(titleCall).toBeTruthy();
    expect(classCall).toBeTruthy();
    expect(classCall?.args[2]).toBe(titleCall?.args[2]);
  });

  it('shows the textual solution for aperta questions', async () => {
    await downloadTeacherSolutionsPdf(SNAPSHOT, [APERTA_WITH_SOLUTION], null);
    const textCalls = calls.filter((c) => c.method === 'text');
    expect(textCalls.some((c) => String(c.args[0]).includes('Il modello OSI ha 7 livelli.'))).toBe(
      true,
    );
  });

  it('highlights the correct option and does not mark the incorrect one', async () => {
    await downloadTeacherSolutionsPdf(SNAPSHOT, [CHIUSA_WITH_SOLUTION], null);
    const textCalls = calls.filter((c) => c.method === 'text').map((c) => String(c.args[0]));
    expect(textCalls.some((t) => t.includes('Rete') && t.includes('(corretta)'))).toBe(true);
    expect(textCalls.some((t) => t.includes('Trasporto') && t.includes('(corretta)'))).toBe(false);
  });

  it('highlights every correct option for chiusa_multipla', async () => {
    const multipla: LoadedQuestionWithSolution = {
      ref: { ...CHIUSA.ref, tipo: 'chiusa_multipla' },
      testo: 'Quali livelli sono di trasporto?',
      tipo: 'chiusa_multipla',
      opzioni: [
        { id: 'a', testo: 'Rete' },
        { id: 'b', testo: 'Trasporto' },
        { id: 'c', testo: 'Applicazione' },
      ],
      soluzione: ['b', 'c'],
    };
    await downloadTeacherSolutionsPdf(SNAPSHOT, [multipla], null);
    const textCalls = calls.filter((c) => c.method === 'text').map((c) => String(c.args[0]));
    expect(textCalls.some((t) => t.includes('Trasporto') && t.includes('(corretta)'))).toBe(true);
    expect(textCalls.some((t) => t.includes('Applicazione') && t.includes('(corretta)'))).toBe(
      true,
    );
    expect(textCalls.some((t) => t.includes('Rete') && t.includes('(corretta)'))).toBe(false);
  });

  it('uses the <titolo>_soluzioni_docente.pdf filename', async () => {
    await downloadTeacherSolutionsPdf(SNAPSHOT, [APERTA_WITH_SOLUTION], null);
    const saveCall = calls.find((c) => c.method === 'save');
    expect(saveCall?.args[0]).toBe('Verifica_Reti_soluzioni_docente.pdf');
  });
});
