import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { Tokens } from 'marked';

marked.use({
  renderer: {
    link({ href, title, text }: Tokens.Link): string {
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

export function MarkdownRenderer({ markdown }: { markdown: string }) {
  const rawHtml = marked.parse(markdown) as string;
  const safeHtml = DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target', 'rel'] });

  return <div className="prose" dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
