/**
 * MULTI-VISUAL-01 — identità di ancoraggio indice+testo (roadmap §7.1–§7.3).
 *
 * **Nessun parser Markdown parallelo.** L'estrazione degli heading H2/H3
 * ancorabili, la loro canonicalizzazione e la numerazione dei duplicati
 * (`reti`, `reti-2`) sono già implementate e testate da VE-01/03A/04A:
 * `listAnchorableHeadings` e `resolveAnchorByIndex` in `aiVisualPromotion.ts`
 * fanno esattamente ciò che il riancoraggio a indice+testo del roadmap
 * richiede (stesso confronto esatto, stesso fail-closed su indice fuori
 * range o testo divergente). Questo modulo li **riusa** e si limita ad
 * adattare il codice d'errore al vocabolario di MULTI-VISUAL
 * (`visual_promotion_anchor_stale`, roadmap §7.2.1) invece di
 * `AiVisualError('invalid_input', …)` del flusso singolo — un'unica
 * traduzione, non una seconda implementazione.
 *
 * Puro: nessuna rete, nessun I/O, nessuna dipendenza Firebase.
 */

import { AiVisualError } from './aiVisualCore.js';
import { listAnchorableHeadings, resolveAnchorByIndex } from './aiVisualPromotion.js';
import { MAX_VISUAL_ANCHOR_HEADING_CHARS, codePointLength } from './aiContentVisualProposal.js';
import { AiVisualMultiError, asRecord, assertExactKeys } from './aiVisualMultiCore.js';
import type { LessonHeadingRef } from '@schoolforge/lesson-contract';

// ─── Selettore d'ancora (roadmap §5.2) ─────────────────────────────────────────

/**
 * Identità di un'ancora PRIMA della risoluzione server-side — mai uno slug.
 * `anchorHeadingIndex` è la posizione 0-based nell'elenco enumerato degli
 * heading H2/H3 realmente presenti; `anchorHeadingText` è il testo canonico
 * esatto a quell'indice, per confermare che il corpo non sia cambiato fra la
 * scelta e il commit.
 */
export interface VisualAnchorSelector {
  anchorHeadingIndex: number;
  anchorHeadingText: string;
}

const SELECTOR_KEYS = ['anchorHeadingIndex', 'anchorHeadingText'] as const;

export function validateVisualAnchorSelector(value: unknown): VisualAnchorSelector {
  const root = asRecord(value, 'Selettore di ancora non valido.');
  assertExactKeys(root, SELECTOR_KEYS, 'Selettore di ancora');

  const anchorHeadingIndex = root.anchorHeadingIndex;
  if (
    typeof anchorHeadingIndex !== 'number' ||
    !Number.isInteger(anchorHeadingIndex) ||
    anchorHeadingIndex < 0
  ) {
    throw new AiVisualMultiError('invalid_input', 'Indice di ancoraggio non valido.');
  }

  const anchorHeadingText = root.anchorHeadingText;
  if (
    typeof anchorHeadingText !== 'string' ||
    anchorHeadingText.length === 0 ||
    anchorHeadingText !== anchorHeadingText.trim() ||
    codePointLength(anchorHeadingText) > MAX_VISUAL_ANCHOR_HEADING_CHARS
  ) {
    throw new AiVisualMultiError('invalid_input', "Testo dell'heading di ancoraggio non valido.");
  }

  return { anchorHeadingIndex, anchorHeadingText };
}

// ─── Elenco enumerato (roadmap §7.1) ───────────────────────────────────────────

/**
 * L'elenco mostrato al modello e al docente: enumerato per indice, mai
 * deduplicato per testo. Riuso diretto dell'helper condiviso di VE — stessa
 * estrazione ATX/Setext con blocchi recintati ignorati, stessa numerazione
 * dei duplicati di `@schoolforge/lesson-contract`.
 */
export function listMultiVisualAnchorableHeadings(lessonBody: string): LessonHeadingRef[] {
  return listAnchorableHeadings(lessonBody);
}

// ─── Risoluzione alla scrittura (roadmap §7.2.1) ───────────────────────────────

export interface ResolvedVisualAnchor {
  headingSlug: string;
  headingText: string;
  placement: 'after-heading';
}

/**
 * Risolve un `VisualAnchorSelector` **per scrivere** — promozione di uno slot
 * (§8.6) o riancoraggio. Sul corpo fresco: indice valido e testo identico a
 * quell'indice, altrimenti fail-closed, zero scritture, nessun fallback in
 * coda «per sicurezza» (§7.2.1, distinto da §7.2.2 che riguarda il rendering
 * dopo una promozione già avvenuta e non è competenza di questo modulo).
 *
 * La sola differenza rispetto a `resolveAnchorByIndex` di VE è il codice
 * d'errore restituito: qui `visual_promotion_anchor_stale`, richiesto dal
 * contratto multi-immagine, al posto di `invalid_input` del riancoraggio
 * singolo. La logica di risoluzione — estrazione, canonicalizzazione, slug,
 * confronto — è la stessa istanza di codice, non una copia.
 */
export function resolveVisualAnchorForWrite(
  selector: VisualAnchorSelector,
  lessonBody: string,
): ResolvedVisualAnchor {
  try {
    const resolved = resolveAnchorByIndex({
      lessonBody,
      anchorHeadingIndex: selector.anchorHeadingIndex,
      anchorHeadingText: selector.anchorHeadingText,
    });
    return {
      headingSlug: resolved.headingSlug,
      headingText: resolved.headingText,
      placement: 'after-heading',
    };
  } catch (error) {
    if (error instanceof AiVisualError && error.code === 'invalid_input') {
      throw new AiVisualMultiError(
        'visual_promotion_anchor_stale',
        "L'ancora selezionata non corrisponde più al corpo attuale della lezione.",
      );
    }
    throw error;
  }
}
