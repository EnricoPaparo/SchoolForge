import type {
  PublicVerificationQuestion,
  PublishedProjectionDoc,
  VerificationTeacherSnapshot,
} from '../../../types/firestore.js';
import type { LoadedQuestion } from './loadSelectedQuestions.js';
import type { LoadedQuestionWithSolution } from './loadSelectedQuestionsWithSolutions.js';
import {
  computeFieldLineLayout,
  computeOptionBoxLayouts,
  getAnswerAreaKind,
} from './verificationPdfLayout.js';
import { buildVerificationPdfFilename } from './verificationPdfNaming.js';

/**
 * Minimal, solution-free question shape the student PDF layout actually
 * needs. `PublicVerificationQuestion` (the student portal's published
 * projection) already matches this shape exactly; `LoadedQuestion` (the
 * teacher's own preview flow, sourced from Storage pool files) is mapped
 * into it below — this is what lets both callers share one drawing
 * implementation without either one depending on the other's data source.
 */
type StudentPdfQuestion = Pick<
  PublicVerificationQuestion,
  'tipo' | 'maxPoints' | 'testo' | 'opzioni'
>;

type PdfTitleDoc = {
  setFontSize: (size: number) => void;
  setFont: (fontName: string, fontStyle?: string) => void;
  getTextWidth: (text: string) => number;
  text: (text: string, x: number, y: number, options?: { align?: 'center' }) => void;
};

function writeCenteredTitleWithClass(params: {
  doc: PdfTitleDoc;
  title: string;
  className: string | null;
  y: number;
  pageWidth: number;
  contentWidth: number;
}) {
  const { doc, title, className, y, pageWidth, contentWidth } = params;
  const classLabel = className ? `Classe: ${className}` : null;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');

  if (!classLabel) {
    doc.text(title, pageWidth / 2, y, { align: 'center' });
    return;
  }

  const gap = 4;
  const titleWidth = doc.getTextWidth(title);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const classWidth = doc.getTextWidth(classLabel);
  const totalWidth = titleWidth + gap + classWidth;

  if (totalWidth > contentWidth) {
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(title, pageWidth / 2, y, { align: 'center' });
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(classLabel, pageWidth / 2, y + 5, { align: 'center' });
    return;
  }

  const startX = (pageWidth - totalWidth) / 2;
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(title, startX, y);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(classLabel, startX + titleWidth + gap, y);
}

/**
 * Draws and downloads the actual student-facing PDF layout: title, class,
 * name/date fields, questions with max points. Does NOT contain solutions,
 * correct answers, or answer markings. Shared by `downloadStudentPdf`
 * (teacher preview, sourced from Storage pool files) and
 * `downloadStudentPdfFromProjection` (real student download, sourced only
 * from the safe `publishedProjection` — never Storage/pool) so the two
 * flows can never drift into rendering different PDFs for the same
 * verification.
 *
 * `fieldPrefill`/`filenameStudentName` are only ever set by the real
 * student download — the teacher preview always renders empty fields and
 * the docente filename (no student name segment). Nothing here is ever
 * persisted to Firestore/Storage: it's drawn once, client-side, into the
 * downloaded file only.
 */
async function renderStudentPdf(
  title: string,
  questions: StudentPdfQuestion[],
  className: string | null,
  options: {
    fieldPrefill?: { nomeCognome: string; data: string } | null;
    filenameStudentName?: string | null;
    date?: Date;
  } = {},
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
  writeCenteredTitleWithClass({
    doc,
    title,
    className,
    y,
    pageWidth: pageW,
    contentWidth: contentW,
  });
  gap(className ? 11 : 10);

  // ── Student fields ────────────────────────────────────────────────────────
  // Both fields are drawn (label + a ruled line to a shared right edge), never
  // as text with underscores — this keeps the two lines perfectly aligned
  // regardless of how long each label is. `value`, when given (student
  // download only), is drawn sitting on the ruled line, like a filled-in form.
  const drawFieldLine = (label: string, value?: string | null) => {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const labelWidth = doc.getTextWidth(label);
    const layout = computeFieldLineLayout({ margin, pageWidth: pageW, y, labelWidth });
    doc.text(label, layout.labelX, layout.labelY);
    doc.line(layout.lineStartX, layout.lineY, layout.lineEndX, layout.lineY);
    if (value) {
      doc.text(value, layout.lineStartX + 1, layout.labelY);
    }
  };

  drawFieldLine('Nome e Cognome:', options.fieldPrefill?.nomeCognome);
  gap(9);
  drawFieldLine('Data:', options.fieldPrefill?.data);
  gap(9);

  // Blank vertical space between the student fields and the first question.
  // No divider line here: this area should read like a paper form, not a
  // section separator.
  gap(8);

  // ── Questions ─────────────────────────────────────────────────────────────
  let totalPts = 0;

  questions.forEach((q, i) => {
    totalPts += q.maxPoints;

    if (y > 255) newPage();

    write(`${i + 1}.  ${q.testo}  [${q.maxPoints} pt]`, 11);
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

  doc.save(
    buildVerificationPdfFilename({
      title,
      className,
      studentName: options.filenameStudentName,
      date: options.date,
    }),
  );
}

/**
 * Generates and downloads a student-facing verification PDF — the teacher's
 * own preview of what a student will see, sourced from Storage pool files
 * via `loadSelectedQuestions` (owner-only; never usable by a real student).
 * Contains: title, class, name/date fields, questions with max points.
 * Does NOT contain solutions, correct answers, or answer markings. Fields
 * are always empty and the filename never carries a student name — this is
 * a preview, not a real student's copy.
 */
export async function downloadStudentPdf(
  snapshot: VerificationTeacherSnapshot,
  questions: LoadedQuestion[],
  className: string | null,
): Promise<void> {
  await renderStudentPdf(
    snapshot.title,
    questions.map((q) => ({
      tipo: q.tipo,
      maxPoints: q.ref.maxPoints,
      testo: q.testo,
      opzioni: q.opzioni,
    })),
    className,
  );
}

/**
 * Generates and downloads the real student-facing verification PDF (M3L-D),
 * sourced only from the safe `publishedProjection` the student is actually
 * allowed to read — never Storage, never a pool file, never `questionRefs`.
 * Renders identically to `downloadStudentPdf` (same shared layout code),
 * except the "Nome e Cognome"/"Data" fields are pre-filled and the filename
 * carries the student's name — both derived only from the already-known
 * Google identity and the current date, never written to Firestore/Storage.
 *
 * `student` is optional so existing callers/tests that don't pass it still
 * get the exact teacher-preview-equivalent behavior (empty fields, no name
 * in the filename) — in practice the real StudentVerificationsView always
 * passes the signed-in user's identity.
 */
export async function downloadStudentPdfFromProjection(
  projection: Pick<PublishedProjectionDoc, 'title' | 'className' | 'questions'>,
  student?: { displayName: string | null; email: string | null } | null,
): Promise<void> {
  const studentName = student?.displayName?.trim() || student?.email?.trim() || null;
  const now = new Date();
  await renderStudentPdf(projection.title, projection.questions, projection.className, {
    fieldPrefill: studentName
      ? {
          nomeCognome: studentName,
          data: now.toLocaleDateString('it-IT', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          }),
        }
      : null,
    filenameStudentName: studentName,
    date: now,
  });
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
  writeCenteredTitleWithClass({
    doc,
    title: snapshot.title,
    className,
    y,
    pageWidth: pageW,
    contentWidth: contentW,
  });
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
