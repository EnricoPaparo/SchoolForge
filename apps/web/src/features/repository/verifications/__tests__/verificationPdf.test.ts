import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerificationTeacherSnapshot } from '../../../../types/firestore.js';
import type { LoadedQuestion } from '../loadSelectedQuestions.js';
import type { LoadedQuestionWithSolution } from '../loadSelectedQuestionsWithSolutions.js';

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
    setDrawColor(...args: unknown[]) {
      calls.push({ method: 'setDrawColor', args });
    }
    splitTextToSize(text: string) {
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

const { downloadStudentPdf, downloadTeacherSolutionsPdf } = await import('../verificationPdf.js');

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
    peso: 1,
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
    peso: 1,
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
});

describe('downloadStudentPdf — aperta questions', () => {
  it('draws no answer lines for aperta questions beyond the header/footer rules', async () => {
    calls = [];
    await downloadStudentPdf(SNAPSHOT, [APERTA], null);
    const lineCallsForAperta = calls.filter((c) => c.method === 'line').length;

    calls = [];
    await downloadStudentPdf({ ...SNAPSHOT, questionRefs: [] }, [], null);
    const lineCallsNoQuestions = calls.filter((c) => c.method === 'line').length;

    // An aperta question contributes zero extra `line` calls compared to a PDF
    // with no questions at all — the only lines are the header rule, the two
    // student-field lines, and the footer rule.
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
