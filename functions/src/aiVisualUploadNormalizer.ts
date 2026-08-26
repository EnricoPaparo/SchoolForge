/**
 * MULTI-VISUAL-02 — normalizzazione dell'upload (roadmap §9.1–§9.2): stessa
 * pipeline Sharp di VE, un solo passo 0 diverso.
 *
 * **Nessun secondo normalizzatore.** Il ciclo resize/compose/strip/encode/
 * cap/hash è `normalizeVisualBytesToWebpForUpload`
 * (`aiVisualNormalizer.ts`) — la stessa istanza di codice usata da
 * `normalizeVisualWebp` per VE, estratta in MULTI-VISUAL-02 e mai
 * duplicata. Questo modulo aggiunge **solo** ciò che VE non aveva bisogno di
 * fare: sniffare il formato reale (PNG/JPEG/WebP), sondare le dimensioni di
 * un sorgente non-WebP e appiattire un eventuale canale alfa su `#f7f5f0`
 * (VE riceve sempre `background=opaque` dal provider, quindi non compone
 * mai).
 */

import sharp from 'sharp';
import {
  normalizeVisualBytesToWebpForUpload,
  type NormalizedVisual,
} from './aiVisualNormalizer.js';
import { AI_VISUAL_MAX_INPUT_PIXELS, AiVisualError, inspectWebp } from './aiVisualCore.js';
import { AiVisualMultiError, MAX_VISUAL_UPLOAD_INPUT_BYTES } from './aiVisualMultiCore.js';
import { sniffVisualUploadFormat, type VisualUploadFormat } from './aiVisualUploadCore.js';

/** Sfondo chiaro dello stile a schizzo (roadmap §9.2): `#f7f5f0`. */
export const VISUAL_UPLOAD_FLATTEN_BACKGROUND = { r: 0xf7, g: 0xf5, b: 0xf0 } as const;

const MAX_UPLOAD_SOURCE_DIMENSION = 16_384;

function assertSourceDimensionsWithinCap(width: number, height: number): void {
  if (
    width * height > AI_VISUAL_MAX_INPUT_PIXELS ||
    width > MAX_UPLOAD_SOURCE_DIMENSION ||
    height > MAX_UPLOAD_SOURCE_DIMENSION
  ) {
    throw new AiVisualMultiError(
      'visual_upload_unsupported_format',
      'Le dimensioni immagine superano il limite.',
    );
  }
}

/**
 * Dimensioni del sorgente, prima del resize. Per WebP riusa `inspectWebp`
 * (stesso parser di contenitore di VE, nessuna seconda lettura degli header);
 * per PNG/JPEG usa la sola lettura di intestazione di Sharp (`metadata()`,
 * nessuna decodifica dei pixel) — equivalente per ruolo a `inspectWebp` per
 * gli altri due formati dell'allowlist.
 */
async function probeUploadSourceDimensions(
  input: Buffer,
  format: VisualUploadFormat,
): Promise<{ width: number; height: number }> {
  if (format === 'image/webp') {
    let inspection;
    try {
      inspection = inspectWebp(input);
    } catch (error) {
      if (error instanceof AiVisualError) {
        throw new AiVisualMultiError(
          'visual_upload_unsupported_format',
          'Il file WebP non è valido.',
        );
      }
      throw error;
    }
    if (inspection.animated) {
      throw new AiVisualMultiError(
        'visual_upload_unsupported_format',
        'I WebP animati non sono ammessi.',
      );
    }
  }

  let metadata;
  try {
    metadata = await sharp(input, {
      failOn: 'warning',
      limitInputPixels: AI_VISUAL_MAX_INPUT_PIXELS,
    }).metadata();
  } catch {
    throw new AiVisualMultiError(
      'visual_upload_unsupported_format',
      'Il file immagine non può essere letto.',
    );
  }
  if (!metadata.width || !metadata.height) {
    throw new AiVisualMultiError(
      'visual_upload_unsupported_format',
      'Dimensioni immagine non determinabili.',
    );
  }
  // Un GIF o un PNG/JPEG multi-frame (mascherato dietro un'estensione errata,
  // ma qui rilevato dai byte reali via `sharp`) espone più di un fotogramma:
  // stessa disciplina di rifiuto dell'animazione di VE, generalizzata al
  // sniffing per byte invece che al solo VP8X di WebP.
  if ((metadata.pages ?? 1) > 1) {
    throw new AiVisualMultiError(
      'visual_upload_unsupported_format',
      'Le immagini animate o multi-fotogramma non sono ammesse.',
    );
  }
  return {
    width: metadata.autoOrient.width,
    height: metadata.autoOrient.height,
  };
}

/**
 * Punto d'ingresso dell'upload (roadmap §9.2 passo 0 → §9.1 pipeline
 * condivisa). Presuppone che il chiamante abbia già verificato il cap
 * grezzo **prima della decodifica base64** (`decodeVisualUploadBase64`,
 * `aiVisualUploadCore.ts`): qui `rawBytes` sono già byte, non base64.
 */
export async function normalizeVisualUploadBytes(rawBytes: Buffer): Promise<NormalizedVisual> {
  if (rawBytes.length === 0) {
    throw new AiVisualMultiError('invalid_input', 'Il file immagine è vuoto.');
  }
  if (rawBytes.length > MAX_VISUAL_UPLOAD_INPUT_BYTES) {
    // Difesa in profondità: il chiamante ha già rifiutato questo caso prima
    // di decodificare il base64 (§9.2 passo 1); qui non deve mai accadere.
    throw new AiVisualMultiError(
      'visual_upload_too_large',
      `Il file supera il limite di ${MAX_VISUAL_UPLOAD_INPUT_BYTES} byte.`,
    );
  }

  const format = sniffVisualUploadFormat(rawBytes);
  const { width, height } = await probeUploadSourceDimensions(rawBytes, format);
  assertSourceDimensionsWithinCap(width, height);

  try {
    return await normalizeVisualBytesToWebpForUpload({
      input: rawBytes,
      sourceWidth: width,
      sourceHeight: height,
      flattenBackground: VISUAL_UPLOAD_FLATTEN_BACKGROUND,
      autoOrient: true,
    });
  } catch (error) {
    if (error instanceof AiVisualError) {
      // Traduzione nel vocabolario dell'upload: un WebP corrotto o troppo
      // grande dopo la normalizzazione è un formato non utilizzabile per
      // l'upload, non un errore di un provider IA (§9, mai lo stesso
      // vocabolario di VE — vedi `aiVisualMultiCore.ts`).
      const code =
        error.code === 'visual_too_large'
          ? 'visual_upload_too_large'
          : 'visual_upload_unsupported_format';
      throw new AiVisualMultiError(code, error.message);
    }
    throw error;
  }
}
