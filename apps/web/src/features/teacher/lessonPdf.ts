import type { LessonMetadata } from '../repository/validation/types.js';

/**
 * Generates a PDF for a single lesson (title, optional UDA context, Markdown
 * content) and triggers a browser download. Client-side only — nothing is
 * saved to Firestore or Storage.
 *
 * `metadata` (front matter: sottotitolo/difficolta/concetti_chiave/obiettivi)
 * is entirely optional — only the fields actually present are inserted into
 * the header; when `metadata` is omitted or every field is empty, the output
 * is identical to a lesson with no front matter at all.
 *
 * Markdown is converted with a lightweight line-based renderer (headings,
 * bullet lists, plain paragraphs) rather than a full HTML/markdown engine,
 * to keep PDF generation cheap and dependency-free. Known limit: a fenced
 * ```mermaid``` code block is not rendered as a diagram — it falls back to
 * plain wrapped text lines, same as any other paragraph. Implementing an
 * actual Mermaid renderer in the PDF is out of scope here.
 */
export async function downloadLessonPdf(
  title: string,
  markdown: string,
  udaContext?: string | null,
  metadata?: LessonMetadata | null,
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const maxWidth = pageWidth - margin * 2;
  let y = 20;

  const newPage = () => {
    doc.addPage();
    y = 20;
  };

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  const titleLines = doc.splitTextToSize(title, maxWidth) as string[];
  doc.text(titleLines, margin, y);
  y += 8 * titleLines.length;

  if (metadata?.sottotitolo) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(90);
    const wrapped = doc.splitTextToSize(metadata.sottotitolo, maxWidth) as string[];
    doc.text(wrapped, margin, y);
    doc.setTextColor(0);
    y += 6 * wrapped.length;
  }

  if (udaContext) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120);
    doc.text(udaContext, margin, y);
    doc.setTextColor(0);
    y += 6;
  }

  if (metadata?.difficolta) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(120);
    doc.text(`Difficoltà: ${metadata.difficolta}`, margin, y);
    doc.setTextColor(0);
    y += 6;
  }

  if (metadata?.concettiChiave.length) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(90);
    const wrapped = doc.splitTextToSize(
      `Concetti chiave: ${metadata.concettiChiave.join(', ')}`,
      maxWidth,
    ) as string[];
    doc.text(wrapped, margin, y);
    doc.setTextColor(0);
    y += 5 * wrapped.length;
  }

  if (metadata?.obiettivi.length) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(90);
    doc.text('Obiettivi:', margin, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    for (const obiettivo of metadata.obiettivi) {
      const wrapped = doc.splitTextToSize(`•  ${obiettivo}`, maxWidth - 5) as string[];
      doc.text(wrapped, margin + 3, y);
      y += 5 * wrapped.length;
    }
    doc.setTextColor(0);
  }

  y += 4;

  const lines = markdown.split('\n');
  for (const line of lines) {
    if (y > 270) newPage();

    if (line.startsWith('# ')) {
      doc.setFontSize(15);
      doc.setFont('helvetica', 'bold');
      const wrapped = doc.splitTextToSize(line.slice(2), maxWidth) as string[];
      doc.text(wrapped, margin, y);
      y += 8 * wrapped.length + 1;
    } else if (line.startsWith('## ')) {
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      const wrapped = doc.splitTextToSize(line.slice(3), maxWidth) as string[];
      doc.text(wrapped, margin, y);
      y += 7 * wrapped.length + 1;
    } else if (line.startsWith('### ')) {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      const wrapped = doc.splitTextToSize(line.slice(4), maxWidth) as string[];
      doc.text(wrapped, margin, y);
      y += 6 * wrapped.length + 1;
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      const wrapped = doc.splitTextToSize(`•  ${line.slice(2)}`, maxWidth - 5) as string[];
      doc.text(wrapped, margin + 3, y);
      y += 6 * wrapped.length;
    } else if (line.trim() === '') {
      y += 4;
    } else {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      const wrapped = doc.splitTextToSize(line, maxWidth) as string[];
      doc.text(wrapped, margin, y);
      y += 6 * wrapped.length + 1;
    }
  }

  const safeName = title
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  doc.save(`${safeName}.pdf`);
}
