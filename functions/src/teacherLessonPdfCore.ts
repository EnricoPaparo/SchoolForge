import type { Browser, LaunchOptions } from 'puppeteer-core';

export const MAX_LESSON_PDF_HTML_BYTES = 8 * 1024 * 1024;
export const MAX_LESSON_PDF_BYTES = 7 * 1024 * 1024;
export const LESSON_PDF_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export function validateLessonPdfInput(input: unknown): string {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).join(',') !== 'html' ||
    typeof (input as { html?: unknown }).html !== 'string'
  ) {
    throw new Error('Richiesta PDF non valida.');
  }
  const html = (input as { html: string }).html;
  if (!html.trim() || Buffer.byteLength(html, 'utf8') > MAX_LESSON_PDF_HTML_BYTES) {
    throw new Error('La lezione supera il limite di esportazione PDF.');
  }
  return html;
}

/** Only embedded raster images and fonts. No network, file access, navigation,
 * JavaScript, frames or resources from caller-controlled URLs. */
export function isEmbeddedPdfResource(url: string, resourceType: string): boolean {
  return (
    (resourceType === 'image' && /^data:image\/(?:png|jpeg|webp);base64,/i.test(url)) ||
    (resourceType === 'font' && /^data:font\/(?:ttf|woff2?);base64,/i.test(url))
  );
}

/** Injectable launch options exist solely for local QA on Windows/macOS;
 * production always uses the packaged Linux Chromium executable. */
export async function renderTeacherLessonPdfBytes(
  html: string,
  localLaunch?: LaunchOptions,
): Promise<Buffer> {
  validateLessonPdfInput({ html });
  const { default: puppeteer } = await import('puppeteer-core');
  let options = localLaunch;
  if (!options) {
    const { default: chromium } = await import('@sparticuz/chromium');
    options = {
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
      executablePath: await chromium.executablePath(),
      headless: 'shell',
    };
  }
  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({ ...options, timeout: 25_000 });
    const page = await browser.newPage();
    page.setDefaultTimeout(25_000);
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (
        !request.isNavigationRequest() &&
        isEmbeddedPdfResource(request.url(), request.resourceType())
      ) {
        void request.continue().catch(() => undefined);
      } else {
        void request.abort().catch(() => undefined);
      }
    });
    await page.emulateMediaType('screen');
    await page.setContent(
      `<!doctype html><meta http-equiv="Content-Security-Policy" content="${LESSON_PDF_CSP}">${html}`,
      { waitUntil: 'load', timeout: 25_000 },
    );
    await page.evaluate('document.fonts.ready');
    const validFonts = await page.evaluate(
      'Array.from(document.fonts).every(font => font.status !== "error")',
    );
    if (!validFonts) throw new Error('Caratteri PDF non disponibili.');
    const validImages = await page.evaluate(
      'Array.from(document.images).every(image => image.complete && image.naturalWidth > 0)',
    );
    if (!validImages)
      throw new Error('Una immagine salvata non è leggibile. Esportazione annullata.');
    const bytes = Buffer.from(
      await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        timeout: 25_000,
      }),
    );
    if (bytes.length > MAX_LESSON_PDF_BYTES)
      throw new Error('Il PDF supera il limite di esportazione.');
    return bytes;
  } finally {
    await browser?.close();
  }
}
