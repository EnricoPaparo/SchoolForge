import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { LessonManualBody, type LessonVisualRender } from '../../components/LessonManualBody.js';
import type { LessonItem } from '../repository/programs/programsService.js';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import type { Functions } from 'firebase/functions';
import { fetchLessonContent, fetchPublicLessonContent } from './lessonContent.js';
import { parseLessonMetadata } from '../repository/validation/lessonMetadata.js';
import { createTeacherMultiVisualReader } from '../repository/programs/multiVisualReadClients.js';
import { createTeacherVisualReader } from '../repository/programs/visualReadClients.js';
import { resolveLessonTitle } from '../repository/programs/lessonTitle.js';
import { resolvePublicLessonId } from '../repository/programs/publicLessonId.js';
import { httpsCallable } from 'firebase/functions';

const exportFonts = [
  ['LessonPdfSans', '400', 'normal', 'DejaVuSans.ttf'],
  ['LessonPdfSans', '700', 'normal', 'DejaVuSans-Bold.ttf'],
  ['LessonPdfSans', '400', 'italic', 'DejaVuSans-Oblique.ttf'],
  ['LessonPdfSans', '700', 'italic', 'DejaVuSans-BoldOblique.ttf'],
  ['LessonPdfMono', '400', 'normal', 'DejaVuSansMono.ttf'],
];
let fontCssPromise: Promise<string> | undefined;
async function loadExportFontCss(): Promise<string> {
  return (fontCssPromise ??= Promise.all(
    exportFonts.map(async ([family, weight, style, file]) => {
      const response = await fetch(`/fonts/lesson-pdf/${file}`);
      if (!response.ok) throw new Error('Caratteri PDF non disponibili. Riprova.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      }
      return `@font-face{font-family:${family};font-weight:${weight};font-style:${style};src:url(data:font/ttf;base64,${btoa(binary)}) format('truetype');}`;
    }),
  )
    .then((css) => css.join('\n'))
    .catch((error) => {
      fontCssPromise = undefined;
      throw error;
    }));
}
export interface LessonPdfContent {
  title: string;
  markdown: string;
  visuals: LessonVisualRender[];
}

export function pdfFileName(title: string): string {
  const safe = title
    .normalize('NFC')
    .replace(/[<>:"/\\|?*]/g, '_')
    .split('')
    .map((char) => (char.charCodeAt(0) < 32 ? '_' : char))
    .join('')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120);
  return !safe || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)
    ? `lezione-${safe || 'senza-titolo'}`
    : safe;
}

export async function loadSavedLessonPdf(params: {
  lesson: LessonItem;
  programId: string;
  importId: string;
  ownerUid: string;
  db: Firestore;
  storage: FirebaseStorage;
  functions: Functions;
}): Promise<LessonPdfContent> {
  const { lesson, programId, importId, ownerUid, db, storage, functions } = params;
  const projected = await fetchPublicLessonContent(
    { lessonId: resolvePublicLessonId(lesson, lesson.id), programId, importId, ownerUid },
    db,
  );
  const markdown =
    projected ?? parseLessonMetadata(await fetchLessonContent(lesson.storageRef, storage)).body;
  const manifests = lesson.visuals?.items?.length
    ? lesson.visuals.items
    : lesson.visual
      ? [lesson.visual]
      : [];
  const request = { programId, importId, lessonId: lesson.id };
  const bytes = lesson.visuals?.items?.length
    ? await createTeacherMultiVisualReader(functions)({
        ...request,
        manifests: lesson.visuals.items,
      })
    : lesson.visual
      ? [await createTeacherVisualReader(functions)({ ...request, manifest: lesson.visual })]
      : [];
  const visuals = manifests.map((manifest) => {
    const image = bytes.find((item) => item?.assetId === manifest.assetId);
    if (!image)
      throw new Error(
        `Immagine salvata non disponibile: ${manifest.altText}. Esportazione annullata.`,
      );
    return {
      anchorSlug: manifest.anchor.headingSlug,
      headingText: manifest.anchor.headingText,
      altText: manifest.altText,
      caption: manifest.caption,
      width: manifest.width,
      height: manifest.height,
      dataUri: image.dataUri,
      status: 'ready' as const,
    };
  });
  return { title: resolveLessonTitle(lesson.filename, lesson.titolo).title, markdown, visuals };
}

/** Exact sanitized lesson DOM plus the application's loaded stylesheets.
 * Self-contained fonts/images let Chromium print without any network access. */
export async function buildLessonPdfDocument(content: LessonPdfContent): Promise<string> {
  if (content.visuals.some((item) => item.status !== 'ready' || !item.dataUri)) {
    throw new Error('Immagini incomplete. Esportazione annullata.');
  }
  const fontCss = await loadExportFontCss();
  const host = document.createElement('div');
  host.className = 'lesson-pdf-export';
  const root = createRoot(host);
  try {
    flushSync(() =>
      root.render(
        <>
          <h1>{content.title}</h1>
          <LessonManualBody markdown={content.markdown} visuals={content.visuals} />
        </>,
      ),
    );
    host.querySelectorAll('details').forEach((details) => {
      details.open = true;
    });
    host.querySelectorAll('img').forEach((img) => {
      img.loading = 'eager';
      // The screen reserves an aspect-ratio frame while bytes load; printing
      // already has the bytes, so let the capped image determine the height.
      img.style.height = 'auto';
      if (img.parentElement?.style.aspectRatio) img.parentElement.style.aspectRatio = 'auto';
    });
    const css = Array.from(document.styleSheets, (sheet) =>
      Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n'),
    ).join('\n');
    return `<!doctype html><html lang="it"><head><meta charset="utf-8"><style>${css}\n${fontCss}\n@page{size:A4;margin:12mm;background:#090d14}html,body{height:auto;background:#090d14;color:#e7ebf2}body{margin:0}*{print-color-adjust:exact;-webkit-print-color-adjust:exact}.lesson-pdf-export{width:100%}.lesson-pdf-export img{max-height:240mm;object-fit:contain}.lesson-pdf-export figure{break-inside:avoid}.lesson-pdf-export pre,.lesson-pdf-export table,.lesson-pdf-export tr{break-inside:auto}.lesson-pdf-export thead{display:table-row-group}</style></head><body>${host.outerHTML}</body></html>`;
  } finally {
    root.unmount();
  }
}

export async function renderLessonPdf(content: LessonPdfContent): Promise<Blob> {
  const html = await buildLessonPdfDocument(content);
  const { functions } = await import('../../lib/firebase.js');
  const render = httpsCallable<{ html: string }, { base64: string }>(
    functions,
    'renderTeacherLessonPdf',
    { timeout: 120_000 },
  );
  const { data } = await render({ html });
  if (typeof data?.base64 !== 'string' || !data.base64.startsWith('JVBERi0'))
    throw new Error('Risposta PDF non valida.');
  const binary = atob(data.base64);
  return new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], {
    type: 'application/pdf',
  });
}
export function downloadLessonBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Assemble fully before initiating the only download: failures never yield a partial ZIP. */
export async function buildLessonPdfZip<T>(
  lessons: readonly T[],
  load: (lesson: T) => Promise<LessonPdfContent>,
  render = renderLessonPdf,
): Promise<Blob> {
  if (!lessons.length) throw new Error('Questa UDA non contiene lezioni salvate.');
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (let index = 0; index < lessons.length; index++) {
    const content = await load(lessons[index]!);
    const blob = await render(content);
    zip.file(
      `${String(index + 1).padStart(Math.max(2, String(lessons.length).length), '0')}-${pdfFileName(content.title)}.pdf`,
      new Uint8Array(await blob.arrayBuffer()),
    );
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
