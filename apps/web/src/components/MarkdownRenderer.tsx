import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { Tokens } from 'marked';
import { LessonManualBody } from './LessonManualBody.js';

marked.use({
  renderer: {
    link({ href, title, text }: Tokens.Link): string {
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

/**
 * LESSON-MANUAL-01 — la variante `lesson` è **opt-in** e isolata: senza
 * `variant` il comportamento resta esattamente quello di prima, e nessuna
 * estensione della variante viene registrata su questa istanza globale di
 * `marked` (vedi `lessonManualMarkdown.ts`).
 */
export type MarkdownRendererVariant = 'lesson';

export function MarkdownRenderer({
  markdown,
  variant,
}: {
  markdown: string;
  variant?: MarkdownRendererVariant;
}) {
  if (variant === 'lesson') return <LessonManualBody markdown={markdown} />;

  const rawHtml = marked.parse(markdown) as string;
  const safeHtml = DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target', 'rel'] });

  return <div className="prose" dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
