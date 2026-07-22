import type { CorrectionArchiveModel } from './correctionArchiveModel.js';

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 42;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const FOOTER_LIMIT = PAGE.height - 52;
const LINE_HEIGHT = 13;
const OPTION_BOX_SIZE = 8;
const OPTION_TEXT_INDENT = 15;

const NUMBER_FORMAT = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export type CorrectionArchivePdfDoc = {
  setFont(family: string, style?: string): void;
  setFontSize(size: number): void;
  setTextColor(gray: number): void;
  splitTextToSize(text: string, maxWidth: number): string[];
  text(text: string | string[], x: number, y: number, options?: { align?: string }): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  rect(x: number, y: number, width: number, height: number): void;
  addPage(): void;
  setPage(page: number): void;
  getNumberOfPages(): number;
  output(type: 'arraybuffer'): ArrayBuffer;
};

export function formatArchivePoints(value: number): string {
  return NUMBER_FORMAT.format(value);
}

export function formatArchiveDate(value: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) return '—';
  return value.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

function ensureSpace(doc: CorrectionArchivePdfDoc, y: number, required: number): number {
  if (y + required <= FOOTER_LIMIT) return y;
  doc.addPage();
  return MARGIN;
}

/**
 * Writes every wrapped line while reserving the footer area on each page.
 * A single answer or feedback can be longer than an entire page, so checking
 * the block height once is not enough: consume only the lines that fit, add a
 * page, and continue until none remain.
 */
function writePaginatedLines(
  doc: CorrectionArchivePdfDoc,
  lines: readonly string[],
  y: number,
  x = MARGIN,
): number {
  const pending = lines.length > 0 ? lines : [''];
  let cursor = 0;
  let nextY = y;

  while (cursor < pending.length) {
    if (nextY > FOOTER_LIMIT) {
      doc.addPage();
      nextY = MARGIN;
    }

    const capacity = Math.max(1, Math.floor((FOOTER_LIMIT - nextY) / LINE_HEIGHT) + 1);
    const pageLines = pending.slice(cursor, cursor + capacity);
    doc.text(pageLines, x, nextY);
    nextY += pageLines.length * LINE_HEIGHT;
    cursor += pageLines.length;

    if (cursor < pending.length) {
      doc.addPage();
      nextY = MARGIN;
    }
  }

  return nextY;
}

function writeOptionsBlock(
  doc: CorrectionArchivePdfDoc,
  options: CorrectionArchiveModel['questions'][number]['options'],
  y: number,
): number {
  if (!options || options.length === 0) return y;
  y = ensureSpace(doc, y, LINE_HEIGHT * 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Opzioni', MARGIN, y);
  y += LINE_HEIGHT;
  doc.setFont('helvetica', 'normal');

  for (const option of options) {
    y = ensureSpace(doc, y, LINE_HEIGHT);
    const boxY = y - OPTION_BOX_SIZE + 1;
    doc.rect(MARGIN, boxY, OPTION_BOX_SIZE, OPTION_BOX_SIZE);
    if (option.selected) {
      doc.line(
        MARGIN + 1.5,
        boxY + 1.5,
        MARGIN + OPTION_BOX_SIZE - 1.5,
        boxY + OPTION_BOX_SIZE - 1.5,
      );
      doc.line(
        MARGIN + OPTION_BOX_SIZE - 1.5,
        boxY + 1.5,
        MARGIN + 1.5,
        boxY + OPTION_BOX_SIZE - 1.5,
      );
    }
    const lines = doc.splitTextToSize(option.text, CONTENT_WIDTH - OPTION_TEXT_INDENT);
    y = writePaginatedLines(doc, lines, y, MARGIN + OPTION_TEXT_INDENT) + 4;
  }

  return y + 1;
}

function writeLabelledBlock(
  doc: CorrectionArchivePdfDoc,
  label: string,
  value: string,
  y: number,
): number {
  const valueLines = doc.splitTextToSize(value, CONTENT_WIDTH);
  // Keep the label with at least the first value line. Remaining lines are
  // allowed to continue across as many pages as necessary.
  y = ensureSpace(doc, y, LINE_HEIGHT * 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(label, MARGIN, y);
  y += LINE_HEIGHT;
  doc.setFont('helvetica', 'normal');
  return writePaginatedLines(doc, valueLines, y) + 5;
}

function stampFooters(doc: CorrectionArchivePdfDoc): void {
  const total = doc.getNumberOfPages();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(110);
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    doc.text(`Pagina ${page} di ${total}`, PAGE.width - MARGIN, PAGE.height - 25, {
      align: 'right',
    });
  }
  doc.setTextColor(0);
}

/** Pure layout renderer. It never receives Firestore documents or starts a download. */
export function renderCorrectionArchivePdf(
  model: CorrectionArchiveModel,
  doc: CorrectionArchivePdfDoc,
): Uint8Array {
  let y = MARGIN;
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  y = writePaginatedLines(doc, doc.splitTextToSize(model.verificationTitle, CONTENT_WIDTH), y) + 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const status = model.correctionStatus === 'returned' ? 'Restituita' : 'Corretta';
  const headerLines = [
    `Studente: ${model.studentName}`,
    `Classe: ${model.className?.trim() || '—'}`,
    `Consegna: ${formatArchiveDate(model.submittedAt)}`,
    `Stato: ${status}`,
    `Punteggio: ${formatArchivePoints(model.totalPoints)} / ${formatArchivePoints(model.maxPoints)} punti`,
    `Percentuale: ${model.percentage === null ? '—' : `${model.percentage}%`}`,
  ];
  y = writePaginatedLines(doc, headerLines, y) + 10;
  y = ensureSpace(doc, y, 18);
  doc.line(MARGIN, y, PAGE.width - MARGIN, y);
  y += 18;

  model.questions.forEach((question, index) => {
    const questionLines = doc.splitTextToSize(question.questionText, CONTENT_WIDTH);
    // Keep the heading with the first line of the question; the rest may span
    // multiple pages without ever entering the footer area.
    y = ensureSpace(doc, y, 17 + LINE_HEIGHT);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`Domanda ${index + 1}`, MARGIN, y);
    y += 17;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    y = writePaginatedLines(doc, questionLines, y) + 8;
    if (question.options && question.correctAnswerText) {
      y = writeOptionsBlock(doc, question.options, y);
      y = writeLabelledBlock(doc, 'Soluzione corretta', question.correctAnswerText, y);
    } else {
      y = writeLabelledBlock(doc, 'Risposta dello studente', question.answerText, y);
    }
    y = ensureSpace(doc, y, LINE_HEIGHT * 2);
    doc.setFont('helvetica', 'bold');
    doc.text(
      `Valutazione: ${formatArchivePoints(question.points)} / ${formatArchivePoints(question.maxPoints)} punti`,
      MARGIN,
      y,
    );
    y += LINE_HEIGHT + 5;
    y = writeLabelledBlock(doc, 'Correzione del docente', question.teacherFeedback ?? '—', y);
    y = ensureSpace(doc, y, 18);
    doc.line(MARGIN, y, PAGE.width - MARGIN, y);
    y += 18;
  });

  if (model.generalFeedback) {
    y = writeLabelledBlock(doc, 'Feedback generale', model.generalFeedback, y);
  }

  stampFooters(doc);
  return new Uint8Array(doc.output('arraybuffer'));
}
