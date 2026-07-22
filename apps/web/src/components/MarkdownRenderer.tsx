import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Tokens } from 'marked';

marked.use({
  renderer: {
    link({ href, title, text }: Tokens.Link): string {
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

type MarkdownRendererVariant = 'default' | 'lesson';

interface LessonHeading {
  id: string;
  level: 2 | 3;
  text: string;
}

interface LessonDocument {
  html: string;
  headings: LessonHeading[];
  key: string;
}

interface ReadingProgress {
  visible: boolean;
  value: number;
}

function contentHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function headingSlug(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('it')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'sezione';
}

function buildLessonDocument(html: string, markdown: string): LessonDocument {
  const key = contentHash(markdown);
  if (typeof document === 'undefined') return { html, headings: [], key };

  const template = document.createElement('template');
  template.innerHTML = html;
  const occurrences = new Map<string, number>();
  const headings: LessonHeading[] = [];

  template.content.querySelectorAll('h2, h3').forEach((heading) => {
    const text = heading.textContent?.trim();
    if (!text) return;
    const base = headingSlug(text);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    const suffix = occurrence === 1 ? '' : `-${occurrence}`;
    const id = `lezione-${key}-${base}${suffix}`;
    heading.id = id;
    headings.push({ id, level: heading.tagName === 'H2' ? 2 : 3, text });
  });

  return { html: template.innerHTML, headings, key };
}

function scrollParent(element: HTMLElement): Window | HTMLElement {
  let current = element.parentElement;
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (/(auto|scroll)/.test(overflowY) && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return window;
}

function LessonReadingProgress({ markdown }: { markdown: string }) {
  const articleRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState<ReadingProgress>({ visible: false, value: 0 });

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const target = scrollParent(article);
    let frame: number | null = null;

    const update = () => {
      frame = null;
      const articleRect = article.getBoundingClientRect();
      const viewportTop =
        target === window ? 0 : (target as HTMLElement).getBoundingClientRect().top;
      const viewportHeight =
        target === window ? window.innerHeight : (target as HTMLElement).clientHeight;
      const travel = articleRect.height - viewportHeight;
      if (travel <= 48) {
        setProgress((current) =>
          current.visible || current.value !== 0 ? { visible: false, value: 0 } : current,
        );
        return;
      }
      const value = Math.min(1, Math.max(0, (viewportTop - articleRect.top) / travel));
      setProgress((current) =>
        current.visible && Math.abs(current.value - value) < 0.001
          ? current
          : { visible: true, value },
      );
    };

    const schedule = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(update);
    };

    target.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule());
    resizeObserver?.observe(article);
    schedule();

    return () => {
      target.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      resizeObserver?.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [markdown]);

  return (
    <div ref={articleRef} className="lesson-reading-frame">
      <div
        className={`lesson-reading-progress${progress.visible ? ' is-visible' : ''}`}
        aria-hidden="true"
      >
        <span style={{ transform: `scaleX(${progress.value})` }} />
      </div>
      <LessonMarkdown markdown={markdown} />
    </div>
  );
}

const LessonMarkdown = memo(function LessonMarkdown({ markdown }: { markdown: string }) {
  const rawHtml = marked.parse(markdown) as string;
  const safeHtml = DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target', 'rel'] });
  const lessonDocument = useMemo(
    () => buildLessonDocument(safeHtml, markdown),
    [markdown, safeHtml],
  );

  return (
    <div className="lesson-reading">
      {lessonDocument.headings.length >= 2 && (
        <details className="lesson-toc" open>
          <summary>In questa lezione</summary>
          <nav aria-label="Indice della lezione">
            <ul>
              {lessonDocument.headings.map((heading) => (
                <li key={heading.id} data-level={heading.level}>
                  <a href={`#${heading.id}`}>{heading.text}</a>
                </li>
              ))}
            </ul>
          </nav>
        </details>
      )}
      <div
        key={lessonDocument.key}
        className="prose prose--lesson"
        dangerouslySetInnerHTML={{ __html: lessonDocument.html }}
      />
    </div>
  );
});

export function MarkdownRenderer({
  markdown,
  variant = 'default',
}: {
  markdown: string;
  variant?: MarkdownRendererVariant;
}) {
  if (variant === 'lesson') return <LessonReadingProgress markdown={markdown} />;

  const rawHtml = marked.parse(markdown) as string;
  const safeHtml = DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target', 'rel'] });

  return <div className="prose" dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
