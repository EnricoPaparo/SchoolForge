import type { LessonItem, ProgramItem, UdaItem } from '../repository/programs/programsService.js';

/**
 * Generates a Markdown document of completed lessons, grouped by UDA.
 */
export function generateMarkdown(
  program: ProgramItem,
  udas: UdaItem[],
  lessons: LessonItem[],
): string {
  const completed = lessons.filter((l) => l.completed === true);

  const lines: string[] = [];
  lines.push(`# Programma svolto — ${program.title}`);
  lines.push('');

  if (completed.length === 0) {
    lines.push('_Nessuna lezione segnata come svolta._');
    return lines.join('\n');
  }

  // Group by udaDir
  const byUda = new Map<string, LessonItem[]>();
  for (const lesson of completed) {
    const group = byUda.get(lesson.udaDir) ?? [];
    group.push(lesson);
    byUda.set(lesson.udaDir, group);
  }

  // Use the UDA list order if possible, then any remaining dirs
  const udaDirs = udas.map((u) => u.dir);
  const allDirs = [...new Set([...udaDirs, ...byUda.keys()])];

  for (const dir of allDirs) {
    const groupLessons = byUda.get(dir);
    if (!groupLessons || groupLessons.length === 0) continue;

    lines.push(`## ${dir}`);
    lines.push('');
    for (const lesson of groupLessons) {
      const date =
        lesson.completedAt != null
          ? new Date((lesson.completedAt as { seconds: number }).seconds * 1000).toLocaleDateString(
              'it-IT',
            )
          : null;
      const dateStr = date ? ` (${date})` : '';
      lines.push(`- ${lesson.filename}${dateStr}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Triggers a browser download of Markdown content as a .md file.
 */
export function downloadMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Generates a PDF from Markdown content using jsPDF and triggers a browser download.
 */
export async function downloadPdf(content: string, title: string): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const maxWidth = pageWidth - margin * 2;
  let y = 20;

  const lines = content.split('\n');
  for (const line of lines) {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }

    if (line.startsWith('# ')) {
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      const text = line.slice(2);
      const wrapped = doc.splitTextToSize(text, maxWidth) as string[];
      doc.text(wrapped, margin, y);
      y += 8 * wrapped.length;
    } else if (line.startsWith('## ')) {
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      const text = line.slice(3);
      const wrapped = doc.splitTextToSize(text, maxWidth) as string[];
      doc.text(wrapped, margin, y);
      y += 7 * wrapped.length;
    } else if (line.startsWith('- ')) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      const text = line.slice(2);
      const wrapped = doc.splitTextToSize(`• ${text}`, maxWidth - 5) as string[];
      doc.text(wrapped, margin + 3, y);
      y += 6 * wrapped.length;
    } else if (line.trim() === '' || line.startsWith('_')) {
      // blank line or italic placeholder — just add small spacing
      y += 4;
    } else {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      const wrapped = doc.splitTextToSize(line, maxWidth) as string[];
      doc.text(wrapped, margin, y);
      y += 6 * wrapped.length;
    }
  }

  doc.save(`${title}.pdf`);
}
