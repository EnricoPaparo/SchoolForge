import { assertLessonContentSize } from '../programs/lessonContentSize.js';
import type { AiLessonGenerateResult } from './aiContentClient.js';

/**
 * AIGEN-03 — validazione **fail-closed** della risposta della callable di
 * generazione lezione, prima di proporre la bozza. Non introduce filtri HTML
 * artigianali: il gate autoritativo di rendering resta `MarkdownRenderer` +
 * DOMPurify. Qui si verifica solo che l'output sia coerente col contratto (kind,
 * body stringa non vuota, nessun front matter, dimensione entro il limite
 * canonico `assertLessonContentSize`).
 */

const FRONT_MATTER_RE = /^\uFEFF?\s*---\s*\r?\n/;

export type LessonDraftResult = { ok: true; body: string } | { ok: false; error: string };

export function validateLessonDraftResult(
  result: AiLessonGenerateResult,
  label = 'bozza generata',
): LessonDraftResult {
  if (result.kind !== 'lesson') {
    return { ok: false, error: 'La risposta generata non è una lezione.' };
  }
  const body = result.output?.body;
  if (typeof body !== 'string' || body.trim().length === 0) {
    return { ok: false, error: 'La bozza generata è vuota.' };
  }
  if (FRONT_MATTER_RE.test(body)) {
    return { ok: false, error: 'La bozza generata contiene un front matter non ammesso.' };
  }
  try {
    // Controllo canonico condiviso: mai un limite artigianale.
    assertLessonContentSize(body, label);
  } catch {
    return { ok: false, error: 'La bozza generata supera il limite di dimensione consentito.' };
  }
  return { ok: true, body };
}
