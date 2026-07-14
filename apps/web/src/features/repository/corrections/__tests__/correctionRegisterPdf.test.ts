import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CorrectionRegisterExportRow } from '../correctionRegisterExport.js';

// ─── jsPDF mock (we never test the library itself) ──────────────────────────

type TextCall = { text: string; x: number; y: number };

class FakeDoc {
  textCalls: TextCall[] = [];
  addPageCount = 0;
  pages = 1;
  saved: string | null = null;

  setFont() {}
  setFontSize() {}
  setTextColor() {}
  setDrawColor() {}
  setLineWidth() {}
  line() {}
  setPage() {}
  getNumberOfPages() {
    return this.pages;
  }
  addPage() {
    this.addPageCount += 1;
    this.pages += 1;
  }
  splitTextToSize(text: string, maxWidth: number): string[] {
    const maxChars = Math.max(4, Math.floor(maxWidth / 6));
    if (text.length <= maxChars) return [text];
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    // Force at least two lines for an over-long single token.
    return lines.length > 1 ? lines : [text.slice(0, maxChars), text.slice(maxChars)];
  }
  text(text: string | string[], x: number, y: number) {
    const arr = Array.isArray(text) ? text : [text];
    for (const t of arr) this.textCalls.push({ text: t, x, y });
  }
  save(filename: string) {
    this.saved = filename;
  }
}

let lastDoc: FakeDoc | null = null;
const jsPDFCtor = vi.fn(() => {
  lastDoc = new FakeDoc();
  return lastDoc;
});

vi.mock('jspdf', () => ({ jsPDF: jsPDFCtor }));

import {
  buildCorrectionRegisterPdfFilename,
  computeStatusCounts,
  downloadCorrectionRegisterPdf,
  formatDateTime,
  formatPercentage,
  formatScore,
} from '../correctionRegisterPdf.js';

beforeEach(() => {
  vi.clearAllMocks();
  lastDoc = null;
});

function row(overrides: Partial<CorrectionRegisterExportRow> = {}): CorrectionRegisterExportRow {
  return {
    studentName: 'Anna Bianchi',
    studentEmail: 'anna@example.com',
    status: 'completed',
    statusLabel: 'Corretta',
    totalPoints: 8,
    maxPoints: 10,
    percentage: 80,
    submittedAt: new Date(2026, 6, 15, 9, 30),
    deliveryCode: 'SF-1',
    ...overrides,
  };
}

const allText = () => (lastDoc?.textCalls ?? []).map((c) => c.text).join('\n');

describe('correctionRegisterPdf — pure helpers', () => {
  it('formats score, percentage and date, with — for missing values', () => {
    expect(formatScore(8, 10)).toBe('8 / 10');
    expect(formatScore(null, null)).toBe('—');
    expect(formatScore(null, 10)).toBe('— / 10');
    expect(formatPercentage(80)).toBe('80%');
    expect(formatPercentage(null)).toBe('—');
    expect(formatDateTime(new Date(2026, 6, 15, 9, 5))).toBe('15/07/2026 09:05');
    expect(formatDateTime(null)).toBe('—');
  });

  it('counts statuses', () => {
    const counts = computeStatusCounts([
      row({ status: 'not_started' }),
      row({ status: 'completed' }),
      row({ status: 'completed' }),
      row({ status: 'returned' }),
    ]);
    expect(counts.not_started).toBe(1);
    expect(counts.completed).toBe(2);
    expect(counts.returned).toBe(1);
  });

  it('builds a sanitized filename with the class segment, and omits it when absent', () => {
    const date = new Date(2026, 6, 15);
    expect(
      buildCorrectionRegisterPdfFilename({ title: 'Verifica Reti', className: '3A Inf', date }),
    ).toBe('20260715-3A-Inf-Verifica-Reti-riepilogo-correzioni.pdf');
    expect(
      buildCorrectionRegisterPdfFilename({ title: 'Verifica Reti', className: null, date }),
    ).toBe('20260715-Verifica-Reti-riepilogo-correzioni.pdf');
  });
});

describe('downloadCorrectionRegisterPdf', () => {
  it('does not load jsPDF until the export function is actually called', async () => {
    expect(jsPDFCtor).not.toHaveBeenCalled();
    await downloadCorrectionRegisterPdf({ verificationTitle: 'V', className: null, rows: [] });
    expect(jsPDFCtor).toHaveBeenCalledTimes(1);
  });

  it('renders header with title and class, and every row in the received order', async () => {
    await downloadCorrectionRegisterPdf({
      verificationTitle: 'Verifica Reti',
      className: 'Classe 3A',
      generatedAt: new Date(2026, 6, 15, 10, 0),
      rows: [
        row({ studentName: 'Zoe Verdi' }),
        row({ studentName: 'Anna Bianchi' }),
        row({ studentName: 'Marco Neri' }),
      ],
    });
    const text = allText();
    expect(text).toContain('SchoolForge');
    expect(text).toContain('Riepilogo consegne e correzioni');
    expect(text).toContain('Verifica Reti');
    expect(text).toContain('Classe: Classe 3A');
    expect(text).toContain('Studenti: 3');
    // Order preserved (not re-sorted).
    const names = ['Zoe Verdi', 'Anna Bianchi', 'Marco Neri'];
    const positions = names.map((n) => text.indexOf(n));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(lastDoc?.saved).toBe('20260715-Classe-3A-Verifica-Reti-riepilogo-correzioni.pdf');
  });

  it('omits the class line and filename segment when there is no class', async () => {
    await downloadCorrectionRegisterPdf({
      verificationTitle: 'Verifica Reti',
      className: null,
      generatedAt: new Date(2026, 6, 15, 10, 0),
      rows: [row()],
    });
    expect(allText()).not.toContain('Classe:');
    expect(lastDoc?.saved).toBe('20260715-Verifica-Reti-riepilogo-correzioni.pdf');
  });

  it('formats score/percentage and renders — for missing values, never a technical field', async () => {
    await downloadCorrectionRegisterPdf({
      verificationTitle: 'V',
      className: null,
      rows: [
        row({ totalPoints: 8, maxPoints: 10, percentage: 80 }),
        row({
          studentName: 'Non Iniziata',
          studentEmail: null,
          status: 'not_started',
          statusLabel: 'Non iniziata',
          totalPoints: null,
          maxPoints: null,
          percentage: null,
          submittedAt: null,
          deliveryCode: null,
        }),
      ],
    });
    const text = allText();
    expect(text).toContain('8 / 10');
    expect(text).toContain('80%');
    expect(text).toContain('—');
    // No UID / submissionId / ownerUid / answers / feedback leaked.
    expect(text).not.toMatch(/ownerUid|submissionId|studentUid|_[a-z0-9-]{6,}/i);
  });

  it('wraps long titles, names and emails (splitTextToSize used)', async () => {
    const longTitle =
      'Verifica lunghissima di reti e protocolli con un titolo che deve davvero andare a capo su piu righe senza mai uscire dal foglio anche quando la larghezza del contenuto e completamente occupata dal testo continuo';
    const longEmail =
      'alessandra.maria.giovanna.delbosco.dellavalle.superlunga@istituto.example.it';
    await downloadCorrectionRegisterPdf({
      verificationTitle: longTitle,
      className: null,
      rows: [
        row({
          studentName: 'Alessandra Maria Giovanna Del Bosco Della Valle Superlunga',
          studentEmail: longEmail,
        }),
      ],
    });
    const calls = lastDoc?.textCalls ?? [];
    // Neither the long title nor the long email is emitted as a single overflowing string.
    expect(calls.some((c) => c.text === longTitle)).toBe(false);
    expect(calls.some((c) => c.text === longEmail)).toBe(false);
    // The title still appears (in fragments).
    expect(calls.some((c) => c.text.includes('Verifica'))).toBe(true);
    // The email was split: a fragment carries its tail beyond the '@'.
    expect(calls.some((c) => c.text.includes('istituto'))).toBe(true);
  });

  it('breaks to a new page for a large dataset and repeats the table header', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => row({ studentName: `Studente ${i}` }));
    await downloadCorrectionRegisterPdf({
      verificationTitle: 'V',
      className: null,
      rows,
    });
    expect(lastDoc!.addPageCount).toBeGreaterThanOrEqual(1);
    // 'Studente' table header appears once per page.
    const headerCount = (lastDoc?.textCalls ?? []).filter((c) => c.text === 'Studente').length;
    expect(headerCount).toBe(lastDoc!.pages);
    expect(headerCount).toBeGreaterThanOrEqual(2);
  });

  it('produces a valid PDF with a clear message when there are zero rows', async () => {
    await downloadCorrectionRegisterPdf({ verificationTitle: 'V', className: null, rows: [] });
    expect(allText()).toContain('Nessuna consegna disponibile.');
    expect(lastDoc?.saved).toBeTruthy();
  });
});
