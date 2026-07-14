import type {
  CorrectionRegisterExportRow,
  CorrectionRegisterStatus,
} from './correctionRegisterExport.js';
import {
  formatDateForFilename,
  sanitizeForFilename,
} from '../verifications/verificationPdfNaming.js';

/**
 * M4-03B — printable PDF of the "Riepilogo consegne e correzioni".
 *
 * Reuses the exact same canonical `CorrectionRegisterExportRow[]` the CSV
 * export already builds from the already-loaded, already-sorted monitor rows —
 * no extra Firestore query/read/write/listener, no Storage. The rows are
 * rendered in the order received (never re-sorted here). Only non-sensitive
 * fields are printed: never a UID, submissionId, ownerUid, answer, solution,
 * feedback, attention event or any other technical datum.
 *
 * jsPDF is loaded with a dynamic `import('jspdf')` inside the download
 * function, so it never enters the entry bundle. The table layout is drawn
 * directly with small pure helpers (no jspdf-autotable, no html2canvas, no
 * canvas/HTML rendering).
 */

export type CorrectionRegisterPdfParams = {
  verificationTitle: string;
  className: string | null;
  rows: readonly CorrectionRegisterExportRow[];
  /** Injectable for tests; defaults to now. */
  generatedAt?: Date;
};

// ─── Pure formatting helpers (unit-tested without jsPDF) ────────────────────

/** `ottenuto / massimo`, or `—` when the row has no score yet. */
export function formatScore(total: number | null, max: number | null): string {
  if (total === null && max === null) return '—';
  const fmt = (v: number | null) => (v === null ? '—' : String(v));
  return `${fmt(total)} / ${fmt(max)}`;
}

export function formatPercentage(percentage: number | null): string {
  return percentage === null ? '—' : `${percentage}%`;
}

export function formatDateTime(value: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) return '—';
  const dd = String(value.getDate()).padStart(2, '0');
  const mm = String(value.getMonth() + 1).padStart(2, '0');
  const yyyy = value.getFullYear();
  const hh = String(value.getHours()).padStart(2, '0');
  const min = String(value.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

export type CorrectionRegisterStatusCounts = Record<CorrectionRegisterStatus, number>;

/** Counts per status label shown in the header summary. */
export function computeStatusCounts(
  rows: readonly CorrectionRegisterExportRow[],
): CorrectionRegisterStatusCounts {
  const counts: CorrectionRegisterStatusCounts = {
    not_started: 0,
    draft: 0,
    submitted: 0,
    in_progress: 0,
    completed: 0,
    returned: 0,
  };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/** `aaaammgg-classe-titolo-riepilogo-correzioni.pdf` (class segment omitted when absent). */
export function buildCorrectionRegisterPdfFilename(params: {
  title: string;
  className: string | null;
  date?: Date;
}): string {
  const date = formatDateForFilename(params.date ?? new Date());
  const title = sanitizeForFilename(params.title) || 'verifica';
  const className = params.className?.trim() ? `${sanitizeForFilename(params.className)}-` : '';
  return `${date}-${className}${title}-riepilogo-correzioni.pdf`;
}

// ─── PDF layout constants ───────────────────────────────────────────────────

const PAGE = { width: 841.89, height: 595.28 }; // A4 landscape, points
const MARGIN = 40;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const FOOTER_Y = PAGE.height - 24;

type Column = { key: keyof RenderRow; header: string; width: number; align: 'left' | 'right' };

// Widths sum to CONTENT_WIDTH (761.89).
const COLUMNS: Column[] = [
  { key: 'studentName', header: 'Studente', width: 150, align: 'left' },
  { key: 'studentEmail', header: 'Email', width: 190.89, align: 'left' },
  { key: 'statusLabel', header: 'Stato', width: 90, align: 'left' },
  { key: 'score', header: 'Punteggio', width: 80, align: 'right' },
  { key: 'percentage', header: 'Percentuale', width: 75, align: 'right' },
  { key: 'submittedAt', header: 'Consegnata il', width: 110, align: 'left' },
  { key: 'deliveryCode', header: 'Codice', width: 66, align: 'left' },
];

const CELL_PADDING = 4;
const LINE_HEIGHT = 12;
const ROW_V_PADDING = 4;

type RenderRow = {
  studentName: string;
  studentEmail: string;
  statusLabel: string;
  score: string;
  percentage: string;
  submittedAt: string;
  deliveryCode: string;
};

function toRenderRow(row: CorrectionRegisterExportRow): RenderRow {
  return {
    studentName: row.studentName || '—',
    studentEmail: row.studentEmail ?? '—',
    statusLabel: row.statusLabel,
    score: formatScore(row.totalPoints, row.maxPoints),
    percentage: formatPercentage(row.percentage),
    submittedAt: formatDateTime(row.submittedAt),
    deliveryCode: row.deliveryCode ?? '—',
  };
}

/** Minimal jsPDF surface this renderer relies on — keeps the code (and the test mock) honest. */
type PdfDoc = {
  setFont(family: string, style?: string): void;
  setFontSize(size: number): void;
  setTextColor(gray: number): void;
  setDrawColor(gray: number): void;
  setLineWidth(w: number): void;
  text(text: string | string[], x: number, y: number, options?: { align?: string }): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  splitTextToSize(text: string, maxWidth: number): string[];
  addPage(): void;
  setPage(n: number): void;
  getNumberOfPages(): number;
  save(filename: string): void;
};

function drawHeaderBlock(
  doc: PdfDoc,
  params: CorrectionRegisterPdfParams,
  generatedAt: Date,
): number {
  let y = MARGIN;
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('SchoolForge', MARGIN, y);
  y += 18;
  doc.setFontSize(13);
  doc.text('Riepilogo consegne e correzioni', MARGIN, y);
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const titleLines = doc.splitTextToSize(params.verificationTitle, CONTENT_WIDTH);
  doc.text(titleLines, MARGIN, y);
  y += titleLines.length * LINE_HEIGHT;

  const meta: string[] = [];
  if (params.className?.trim()) meta.push(`Classe: ${params.className.trim()}`);
  meta.push(`Generato il ${formatDateTime(generatedAt)}`);
  meta.push(`Studenti: ${params.rows.length}`);
  doc.setTextColor(80);
  doc.text(meta.join('   ·   '), MARGIN, y);
  y += LINE_HEIGHT;

  const counts = computeStatusCounts(params.rows);
  const summary = [
    `Non iniziate: ${counts.not_started}`,
    `In corso: ${counts.draft}`,
    `Consegnate: ${counts.submitted}`,
    `In correzione: ${counts.in_progress}`,
    `Corrette: ${counts.completed}`,
    `Restituite: ${counts.returned}`,
  ].join('   ·   ');
  const summaryLines = doc.splitTextToSize(summary, CONTENT_WIDTH);
  doc.text(summaryLines, MARGIN, y);
  y += summaryLines.length * LINE_HEIGHT + 6;
  doc.setTextColor(0);
  return y;
}

function drawTableHeader(doc: PdfDoc, y: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0);
  let x = MARGIN;
  for (const col of COLUMNS) {
    const tx = col.align === 'right' ? x + col.width - CELL_PADDING : x + CELL_PADDING;
    doc.text(col.header, tx, y + LINE_HEIGHT, { align: col.align });
    x += col.width;
  }
  const bottom = y + LINE_HEIGHT + ROW_V_PADDING;
  doc.setDrawColor(0);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, bottom, MARGIN + CONTENT_WIDTH, bottom);
  doc.setFont('helvetica', 'normal');
  return bottom + 2;
}

/**
 * Draws all rows with wrapping + page breaks, repeating the table header on
 * each new page. Pure layout math against the injected `PdfDoc`.
 */
function drawRows(doc: PdfDoc, rows: readonly RenderRow[], startY: number): void {
  let y = startY;
  const wrapped = rows.map((row) => {
    const cells = COLUMNS.map((col) =>
      doc.splitTextToSize(String(row[col.key]), col.width - CELL_PADDING * 2),
    );
    const height = Math.max(...cells.map((lines) => lines.length)) * LINE_HEIGHT + ROW_V_PADDING;
    return { cells, height };
  });

  doc.setFontSize(9);
  for (const { cells, height } of wrapped) {
    if (y + height > PAGE.height - MARGIN) {
      doc.addPage();
      y = drawTableHeader(doc, MARGIN);
    }
    let x = MARGIN;
    cells.forEach((lines, i) => {
      const col = COLUMNS[i]!;
      const tx = col.align === 'right' ? x + col.width - CELL_PADDING : x + CELL_PADDING;
      doc.text(lines, tx, y + LINE_HEIGHT, { align: col.align });
      x += col.width;
    });
    doc.setDrawColor(210);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, y + height, MARGIN + CONTENT_WIDTH, y + height);
    y += height;
  }
}

function stampFooters(doc: PdfDoc): void {
  const total = doc.getNumberOfPages();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120);
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    doc.text(`Pagina ${i} di ${total}`, PAGE.width - MARGIN, FOOTER_Y, { align: 'right' });
  }
  doc.setTextColor(0);
}

/**
 * Builds and downloads the PDF. jsPDF is imported dynamically here so it is
 * never in the entry bundle and is only fetched on the actual export click.
 */
export async function downloadCorrectionRegisterPdf(
  params: CorrectionRegisterPdfParams,
): Promise<void> {
  const generatedAt = params.generatedAt ?? new Date();
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
  }) as unknown as PdfDoc;

  let y = drawHeaderBlock(doc, params, generatedAt);

  if (params.rows.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(80);
    doc.text('Nessuna consegna disponibile.', MARGIN, y + LINE_HEIGHT);
    doc.setTextColor(0);
  } else {
    y = drawTableHeader(doc, y);
    drawRows(doc, params.rows.map(toRenderRow), y);
  }

  stampFooters(doc);
  doc.save(
    buildCorrectionRegisterPdfFilename({
      title: params.verificationTitle,
      className: params.className,
      date: generatedAt,
    }),
  );
}
