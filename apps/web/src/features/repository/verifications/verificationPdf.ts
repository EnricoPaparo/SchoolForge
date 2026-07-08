import type { VerificationTeacherSnapshot } from '../../../types/firestore.js';
import type { LoadedQuestion } from './loadSelectedQuestions.js';
import type { LoadedQuestionWithSolution } from './loadSelectedQuestionsWithSolutions.js';
import {
  computeFieldLineLayout,
  computeOptionBoxLayouts,
  getAnswerAreaKind,
} from './verificationPdfLayout.js';

/**
 * Generates and downloads a student-facing verification PDF.
 * Contains: title, class, name/date fields, questions with max points.
 * Does NOT contain solutions, correct answers, or answer markings.
 */
export async function downloadStudentPdf(
  snapshot: VerificationTeacherSnapshot,
  questions: LoadedQuestion[],
  className: string | null,
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const margin = 20;
  const pageW = 210;
  const contentW = pageW - margin * 2;
  let y = margin;

  const newPage = () => {
    doc.addPage();
    y = margin;
  };

  const write = (str: string, size: number, bold = false, centered = false) => {
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const lines = doc.splitTextToSize(str, contentW) as string[];
    for (const line of lines) {
      if (y > 272) newPage();
      doc.text(line, centered ? pageW / 2 : margin, y, centered ? { align: 'center' } : undefined);
      y += size * 0.38;
    }
  };

  const gap = (mm: number) => {
    y += mm;
  };

  const hRule = (color = 100) => {
    doc.setDrawColor(color);
    doc.line(margin, y, pageW - margin, y);
    doc.setDrawColor(0);
  };

  // ── Header ────────────────────────────────────────────────────────────────
  write(snapshot.title, 16, true, true);
  gap(3);
  if (className) {
    write(`Classe: ${className}`, 11, false, true);
    gap(2);
  }
  gap(5);
  hRule();
  gap(7);

  // ── Student fields ────────────────────────────────────────────────────────
  // Both fields are drawn (label + a ruled line to a shared right edge), never
  // as text with underscores — this keeps the two lines perfectly aligned
  // regardless of how long each label is.
  const drawFieldLine = (label: string) => {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const labelWidth = doc.getTextWidth(label);
    const layout = computeFieldLineLayout({ margin, pageWidth: pageW, y, labelWidth });
    doc.text(label, layout.labelX, layout.labelY);
    doc.line(layout.lineStartX, layout.lineY, layout.lineEndX, layout.lineY);
  };

  drawFieldLine('Nome e Cognome:');
  gap(9);
  drawFieldLine('Data:');
  gap(10);
  hRule();
  gap(9);

  // ── Questions ─────────────────────────────────────────────────────────────
  let totalPts = 0;

  questions.forEach((q, i) => {
    totalPts += q.ref.maxPoints;

    if (y > 255) newPage();

    write(`${i + 1}.  ${q.testo}  [${q.ref.maxPoints} pt]`, 11);
    gap(3);

    if (getAnswerAreaKind(q.tipo) === 'options') {
      const opts = q.opzioni ?? [];
      const rowHeightMm = 6;
      if (y + opts.length * rowHeightMm > 272) newPage();

      const boxLayouts = computeOptionBoxLayouts({
        count: opts.length,
        margin,
        startY: y + rowHeightMm,
        rowHeightMm,
      });

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      opts.forEach((opt, idx) => {
        const box = boxLayouts[idx];
        doc.rect(box.boxX, box.boxY, box.boxSize, box.boxSize);
        doc.text(opt.testo, box.textX, box.boxY + box.boxSize - 0.3);
      });
      gap(opts.length * rowHeightMm + 2);
    }
    // aperta: no answer lines or reserved space — the student writes on a separate sheet.
    gap(9);
  });

  // ── Score field ───────────────────────────────────────────────────────────
  if (y > 258) newPage();
  hRule();
  gap(8);
  write(`Punteggio: ________ / ${totalPts}`, 11, true);

  const safeName = snapshot.title
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  doc.save(`${safeName}_studente.pdf`);
}

/**
 * Generates and downloads the teacher-only solutions PDF: same questions as
 * the student PDF, but with a "COPIA DOCENTE — SOLUZIONI" header, the
 * textual answer for open questions, and the correct option(s) highlighted
 * for closed questions. Never saved to Firestore/Storage — generated
 * entirely client-side from data already loaded for this download.
 */
export async function downloadTeacherSolutionsPdf(
  snapshot: VerificationTeacherSnapshot,
  questions: LoadedQuestionWithSolution[],
  className: string | null,
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const margin = 20;
  const pageW = 210;
  const contentW = pageW - margin * 2;
  let y = margin;

  const newPage = () => {
    doc.addPage();
    y = margin;
  };

  const write = (str: string, size: number, bold = false, centered = false) => {
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const lines = doc.splitTextToSize(str, contentW) as string[];
    for (const line of lines) {
      if (y > 272) newPage();
      doc.text(line, centered ? pageW / 2 : margin, y, centered ? { align: 'center' } : undefined);
      y += size * 0.38;
    }
  };

  const gap = (mm: number) => {
    y += mm;
  };

  const hRule = (color = 100) => {
    doc.setDrawColor(color);
    doc.line(margin, y, pageW - margin, y);
    doc.setDrawColor(0);
  };

  // ── Header ────────────────────────────────────────────────────────────────
  write('COPIA DOCENTE — SOLUZIONI', 12, true, true);
  gap(5);
  write(snapshot.title, 16, true, true);
  gap(3);
  if (className) {
    write(`Classe: ${className}`, 11, false, true);
    gap(2);
  }
  gap(5);
  hRule();
  gap(9);

  // ── Questions + solutions ────────────────────────────────────────────────
  let totalPts = 0;

  questions.forEach((q, i) => {
    totalPts += q.ref.maxPoints;

    if (y > 255) newPage();

    write(`${i + 1}.  ${q.testo}  [${q.ref.maxPoints} pt]`, 11);
    gap(3);

    if (getAnswerAreaKind(q.tipo) === 'options') {
      const opts = q.opzioni ?? [];
      const correctIds = new Set(Array.isArray(q.soluzione) ? q.soluzione : [q.soluzione]);
      opts.forEach((opt) => {
        const isCorrect = correctIds.has(opt.id);
        const label = isCorrect ? `- ${opt.testo}  (corretta)` : `- ${opt.testo}`;
        write(label, 10, isCorrect);
        gap(1);
      });
    } else {
      const testualeSoluzione = Array.isArray(q.soluzione) ? q.soluzione.join(', ') : q.soluzione;
      write(`Soluzione: ${testualeSoluzione}`, 10, true);
    }
    gap(8);
  });

  // ── Score field ───────────────────────────────────────────────────────────
  if (y > 258) newPage();
  hRule();
  gap(8);
  write(`Punteggio totale: ${totalPts} pt`, 11, true);

  const safeName = snapshot.title
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  doc.save(`${safeName}_soluzioni_docente.pdf`);
}
