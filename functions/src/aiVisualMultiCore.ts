/**
 * MULTI-VISUAL-01 — nucleo puro condiviso dal contratto multi-immagine.
 *
 * Non è una reimplementazione di VISUAL-ENRICHMENT: è il solo posto dove
 * questo pacchetto dichiara le proprie costanti (`documentazione/multi-visual-
 * roadmap.md` §5.6) e il proprio codice d'errore, per gli aspetti che il
 * contratto singolo non conosce ancora (il manifest ad array, il piano
 * coordinato, il selettore d'ancora indice+testo). Tutto ciò che VE-01/03 già
 * possiede — slug, hash, Timestamp, path Storage, testo editoriale — viene
 * importato da lì, mai duplicato: vedi `aiVisualMultiManifest.ts` e
 * `aiVisualMultiAnchor.ts`.
 *
 * Puro: nessuna rete, nessun I/O, nessuna dipendenza Firebase.
 */

// ─── Costanti (roadmap §5.6, §9) ───────────────────────────────────────────────

export const MAX_VISUALS_PER_LESSON = 3;

/** Cap grezzo di un file caricato, PRIMA della decodifica. 2 MB decimali. */
export const MAX_VISUAL_UPLOAD_INPUT_BYTES = 2_000_000;

/** Formati di input accettati per l'upload. L'output normalizzato è sempre WebP. */
export const ACCEPTED_VISUAL_UPLOAD_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Tentativi di generazione coperti dalla prenotazione di un singolo slot. */
export const VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT = 2;

/** Versione del contratto del manifest ad array (privato e pubblico). */
export const LESSON_VISUALS_CONTRACT_VERSION = 'lesson-visuals/v1' as const;

/** Versione del contratto del piano coordinato. */
export const VISUAL_PLAN_CONTRACT_VERSION = 'visual-plan/v1' as const;

/** `styleVersion` di un'immagine caricata dal docente — nessuna verifica di stile. */
export const UPLOADED_VISUAL_STYLE_VERSION = 'uploaded/v1' as const;

// ─── Errore tipizzato ───────────────────────────────────────────────────────────

/**
 * Codici propri del contratto multi-immagine. Distinto da `AiContentError` e
 * da `AiVisualError` (VE) — non ne estende l'unione perché quei due tipi
 * restano quelli del flusso singolo congelato: introdurre qui nuovi codici
 * (`visual_legacy_conflict`, `visual_promotion_anchor_stale`, …) non deve
 * toccare un solo carattere di quei moduli.
 */
export type AiVisualMultiErrorCode =
  | 'invalid_input'
  | 'corrupted_state'
  | 'visuals_malformed'
  | 'visual_legacy_malformed'
  | 'visual_legacy_conflict'
  | 'provider_invalid_output'
  | 'visual_promotion_anchor_stale';

export class AiVisualMultiError extends Error {
  readonly code: AiVisualMultiErrorCode;

  constructor(code: AiVisualMultiErrorCode, message: string) {
    super(message);
    this.name = 'AiVisualMultiError';
    this.code = code;
  }
}

// ─── Helper strutturali condivisi fra i validatori del pacchetto ──────────────

export function asRecord(
  value: unknown,
  message: string,
  code: AiVisualMultiErrorCode = 'invalid_input',
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AiVisualMultiError(code, message);
  }
  return value as Record<string, unknown>;
}

/** Chiavi esatte: nessuna proprietà extra, nessuna proprietà mancante. */
export function assertExactKeys(
  root: Record<string, unknown>,
  keys: readonly string[],
  label: string,
  code: AiVisualMultiErrorCode = 'invalid_input',
): void {
  const actual = Object.keys(root).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new AiVisualMultiError(code, `${label}: chiavi non ammesse.`);
  }
}
