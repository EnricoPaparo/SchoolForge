import type { ReactNode } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { Tokens } from 'marked';
import { LessonManualBody, type LessonVisualRender } from './LessonManualBody.js';

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
  visual,
  onMissingAnchor,
}: {
  markdown: string;
  variant?: MarkdownRendererVariant;
  /** VE-04A — solo per `variant="lesson"`; assente ⇒ resa identica a prima. */
  visual?: LessonVisualRender | null;
  onMissingAnchor?: ReactNode;
}) {
  if (variant === 'lesson') {
    return (
      <LessonManualBody markdown={markdown} visual={visual} onMissingAnchor={onMissingAnchor} />
    );
  }

  const rawHtml = marked.parse(markdown) as string;
  const safeHtml = DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target', 'rel'] });

  return <div className="prose" dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
