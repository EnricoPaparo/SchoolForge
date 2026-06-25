import type { VerificationTeacherSnapshot } from '../../../types/firestore.js';
import type { LoadedQuestion } from './loadSelectedQuestions.js';

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
  write('Nome e Cognome: _________________________________________', 11);
  gap(7);
  write('Data: ____________________', 11);
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

    if (q.tipo === 'chiusa_singola' || q.tipo === 'chiusa_multipla') {
      for (const opt of q.opzioni ?? []) {
        write(`      ○  ${opt.testo}`, 10);
        gap(1);
      }
    } else {
      // aperta: ruled answer lines
      for (let l = 0; l < 3; l++) {
        gap(7);
        if (y < 272) {
          doc.setDrawColor(190);
          doc.line(margin, y, pageW - margin, y);
          doc.setDrawColor(0);
        }
      }
    }
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
