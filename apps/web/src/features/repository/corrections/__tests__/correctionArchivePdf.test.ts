import { describe, expect, it } from 'vitest';
import type { CorrectionArchiveModel } from '../correctionArchiveModel.js';
import {
  formatArchivePoints,
  renderCorrectionArchivePdf,
  type CorrectionArchivePdfDoc,
} from '../correctionArchivePdf.js';

class FakePdf implements CorrectionArchivePdfDoc {
  texts: string[] = [];
  textCalls: Array<{ value: string; page: number; y: number }> = [];
  pages = 1;
  currentPage = 1;
  setFont() {}
  setFontSize() {}
  setTextColor() {}
  line() {}
  splitTextToSize(text: string, maxWidth: number): string[] {
    const size = Math.max(8, Math.floor(maxWidth / 7));
    return text.split('\n').flatMap((line) => {
      if (line.length === 0) return [''];
      const chunks: string[] = [];
      for (let offset = 0; offset < line.length; offset += size) {
        chunks.push(line.slice(offset, offset + size));
      }
      return chunks;
    });
  }
  text(text: string | string[], _x: number, y: number) {
    const lines = Array.isArray(text) ? text : [text];
    this.texts.push(...lines);
    lines.forEach((value, index) => {
      this.textCalls.push({ value, page: this.currentPage, y: y + index * 13 });
    });
  }
  addPage() {
    this.pages += 1;
    this.currentPage = this.pages;
  }
  setPage(page: number) {
    this.currentPage = page;
  }
  getNumberOfPages() {
    return this.pages;
  }
  output(): ArrayBuffer {
    return new Uint8Array([37, 80, 68, 70]).buffer;
  }
}

function model(): CorrectionArchiveModel {
  return {
    verificationTitle: 'Verifica di reti',
    studentName: 'Anna Bianchi',
    className: '3A',
    submittedAt: new Date(2026, 6, 15, 9, 30),
    correctionStatus: 'returned',
    totalPoints: 2.75,
    maxPoints: 4,
    percentage: 69,
    questions: [
      {
        order: 4,
        questionText: 'Spiega il modello client-server con un testo abbastanza lungo.',
        answerText: 'Il client invia richieste e il server risponde.',
        points: 2.75,
        maxPoints: 4,
        teacherFeedback: 'Risposta corretta ma da approfondire.',
      },
    ],
    generalFeedback: 'Buona comprensione generale.',
  };
}

describe('correctionArchivePdf', () => {
  it('renders the archival sections, Italian decimals and footers without technical data', () => {
    const pdf = new FakePdf();
    const bytes = renderCorrectionArchivePdf(model(), pdf);
    const text = pdf.texts.join('\n');
    expect(bytes.byteLength).toBe(4);
    expect(text).toContain('Correzione della verifica');
    expect(text).toContain('Studente: Anna Bianchi');
    expect(text).toContain('Stato: Restituita');
    expect(text).toContain('Valutazione: 2,75 / 4 punti');
    expect(text).toContain('Risposta dello studente');
    expect(text).toContain('Correzione del docente');
    expect(text).toContain('Feedback generale');
    expect(text).toContain('Pagina 1 di 1');
    expect(text).not.toMatch(
      /SchoolForge|ownerUid|studentUid|submissionId|correctAnswer|soluzione/i,
    );
  });

  it('wraps long content and creates page breaks without clipping the footer', () => {
    const pdf = new FakePdf();
    const large = model();
    large.questions = Array.from({ length: 18 }, (_, index) => ({
      ...large.questions[0]!,
      order: index,
      answerText: `Risposta ${index} ${'molto lunga '.repeat(40)}`,
    }));
    renderCorrectionArchivePdf(large, pdf);
    expect(pdf.pages).toBeGreaterThan(1);
    expect(pdf.texts).toContain(`Pagina ${pdf.pages} di ${pdf.pages}`);
  });

  it.each([
    'verificationTitle',
    'questionText',
    'answerText',
    'teacherFeedback',
    'generalFeedback',
  ] as const)('paginates one very long %s block without losing or clipping text', (field) => {
    const pdf = new FakePdf();
    const large = model();
    const longText = `${field.toUpperCase()}-${'contenuto molto lungo '.repeat(900)}`;

    if (field === 'verificationTitle') large.verificationTitle = longText;
    else if (field === 'generalFeedback') large.generalFeedback = longText;
    else large.questions[0]![field] = longText;

    renderCorrectionArchivePdf(large, pdf);

    expect(pdf.pages).toBeGreaterThan(1);
    expect(pdf.texts.join('')).toContain(longText);
    expect(
      pdf.textCalls
        .filter((call) => !/^Pagina \d+ di \d+$/.test(call.value))
        .every((call) => call.y <= 841.89 - 52),
    ).toBe(true);
    for (let page = 1; page <= pdf.pages; page += 1) {
      expect(pdf.textCalls).toContainEqual({
        value: `Pagina ${page} di ${pdf.pages}`,
        page,
        y: 841.89 - 25,
      });
    }
  });

  it('formats quarter points with the Italian decimal comma', () => {
    expect(formatArchivePoints(0.25)).toBe('0,25');
    expect(formatArchivePoints(3)).toBe('3');
  });
});
