import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { Tokens } from 'marked';

// Use marked.use() API (v18+) to customize link rendering
marked.use({
  renderer: {
    link({ href, title, text }: Tokens.Link): string {
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

interface MarkdownRendererProps {
  markdown: string;
}

export function MarkdownRenderer({ markdown }: MarkdownRendererProps) {
  const rawHtml = marked.parse(markdown) as string;
  const safeHtml = DOMPurify.sanitize(rawHtml, {
    ADD_ATTR: ['target', 'rel'],
  });

  return <div dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
