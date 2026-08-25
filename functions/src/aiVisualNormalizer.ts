import sharp from 'sharp';
import { MAX_VISUAL_BYTES } from './aiContentVisualProposal.js';
import {
  AI_VISUAL_MAX_INPUT_PIXELS,
  AI_VISUAL_MAX_LONG_EDGE,
  AI_VISUAL_TARGET_BYTES,
  AI_VISUAL_WEBP_QUALITY_ATTEMPTS,
  AiVisualError,
  MAX_PROVIDER_VISUAL_BYTES,
  inspectWebp,
  sha256Hex,
} from './aiVisualCore.js';

export interface NormalizedVisual {
  bytes: Buffer;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  mimeType: 'image/webp';
  webpQuality: number;
  normalizationAttempts: number;
}

function rethrowKnown(error: unknown): never {
  if (error instanceof AiVisualError) throw error;
  throw new AiVisualError('visual_corrupted', 'Il file immagine non può essere normalizzato.');
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface NormalizeVisualBytesToWebpParams {
  input: Buffer;
  sourceWidth: number;
  sourceHeight: number;
  /**
   * MULTI-VISUAL-02 — colore opaco su cui appiattire un eventuale canale
   * alfa (roadmap §9.2, `#f7f5f0`). `undefined` lascia il comportamento di
   * VE **invariato**: il provider IA garantisce già `background=opaque`
   * (`AI_VISUAL_BACKGROUND`), quindi VE non ha mai avuto bisogno di una
   * compositing esplicita e non deve iniziare a chiamare `.flatten()` ora.
   */
  flattenBackground?: RgbColor;
  /** Applica l'orientamento EXIF prima del resize; usato solo dagli upload. */
  autoOrient?: boolean;
}

/**
 * Nucleo condiviso della normalizzazione: resize al lato lungo ≤1200 senza
 * upscaling, compositing opzionale, conversione WebP a qualità decrescente
 * fino al cap canonico, hash sui byte finali (roadmap §9.1, «cambia solo il
 * passo 0»).
 *
 * Estratto da `normalizeVisualWebp` (MULTI-VISUAL-02): la sola differenza fra
 * il percorso VE e il percorso upload è **come si arriva** a
 * `sourceWidth`/`sourceHeight` (VE le ricava sempre da un WebP via
 * `inspectWebp`; l'upload le ricava da PNG/JPEG/WebP, §9.2) e se serve
 * appiattire un canale alfa — mai il ciclo resize/encode/cap/hash stesso, che
 * resta questa unica istanza di codice.
 */
async function normalizeVisualBytesToWebp(
  params: NormalizeVisualBytesToWebpParams,
): Promise<NormalizedVisual> {
  const { input, sourceWidth, sourceHeight, flattenBackground, autoOrient = false } = params;
  const scale = Math.min(1, AI_VISUAL_MAX_LONG_EDGE / Math.max(sourceWidth, sourceHeight));
  const expectedWidth = Math.max(1, Math.round(sourceWidth * scale));
  const expectedHeight = Math.max(1, Math.round(sourceHeight * scale));
  let bestUnderHardCap: NormalizedVisual | null = null;

  for (let index = 0; index < AI_VISUAL_WEBP_QUALITY_ATTEMPTS.length; index += 1) {
    const quality = AI_VISUAL_WEBP_QUALITY_ATTEMPTS[index];
    if (quality === undefined) continue;
    let output: Buffer;
    try {
      let pipeline = sharp(input, {
        animated: false,
        failOn: 'warning',
        limitInputPixels: AI_VISUAL_MAX_INPUT_PIXELS,
      });
      if (autoOrient) {
        pipeline = pipeline.autoOrient();
      }
      pipeline = pipeline.resize({
        width: expectedWidth,
        height: expectedHeight,
        fit: 'fill',
        withoutEnlargement: true,
      });
      if (flattenBackground) {
        pipeline = pipeline.flatten({ background: flattenBackground });
      }
      output = await pipeline.webp({ quality, effort: 4, smartSubsample: true }).toBuffer();
    } catch (error) {
      rethrowKnown(error);
    }

    let inspection;
    try {
      inspection = inspectWebp(output);
    } catch (error) {
      rethrowKnown(error);
    }
    if (
      inspection.animated ||
      inspection.hasMetadata ||
      inspection.width !== expectedWidth ||
      inspection.height !== expectedHeight ||
      inspection.width > AI_VISUAL_MAX_LONG_EDGE ||
      inspection.height > AI_VISUAL_MAX_LONG_EDGE
    ) {
      throw new AiVisualError('visual_corrupted', 'Il WebP normalizzato non è canonico.');
    }

    if (output.length <= MAX_VISUAL_BYTES) {
      const candidate: NormalizedVisual = {
        bytes: output,
        width: inspection.width,
        height: inspection.height,
        byteLength: output.length,
        sha256: sha256Hex(output),
        mimeType: 'image/webp',
        webpQuality: quality,
        normalizationAttempts: index + 1,
      };
      bestUnderHardCap ??= candidate;
      if (output.length <= AI_VISUAL_TARGET_BYTES) return candidate;
    }
  }

  if (bestUnderHardCap) return bestUnderHardCap;
  throw new AiVisualError('visual_too_large', 'Il WebP normalizzato supera il limite massimo.');
}

export async function normalizeVisualWebp(raw: Uint8Array): Promise<NormalizedVisual> {
  const input = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  if (input.length === 0) {
    throw new AiVisualError('visual_corrupted', 'Il file immagine è vuoto.');
  }
  if (input.length > MAX_PROVIDER_VISUAL_BYTES) {
    throw new AiVisualError('visual_too_large', 'Il file immagine supera il limite di ingresso.');
  }

  let sourceInspection;
  try {
    sourceInspection = inspectWebp(input);
  } catch (error) {
    rethrowKnown(error);
  }
  if (sourceInspection.animated) {
    throw new AiVisualError('visual_corrupted', 'Le immagini animate non sono ammesse.');
  }
  if (
    sourceInspection.width * sourceInspection.height > AI_VISUAL_MAX_INPUT_PIXELS ||
    sourceInspection.width > 16_384 ||
    sourceInspection.height > 16_384
  ) {
    throw new AiVisualError('visual_too_large', 'Le dimensioni immagine superano il limite.');
  }

  return normalizeVisualBytesToWebp({
    input,
    sourceWidth: sourceInspection.width,
    sourceHeight: sourceInspection.height,
  });
}

/**
 * MULTI-VISUAL-02 — porta usata **solo** da `aiVisualUploadNormalizer.ts`.
 * Non esportata più in là: il passo 0 dell'upload (sniffing formato, cap
 * grezzo, rifiuto WebP animato, sonda dimensioni PNG/JPEG/WebP) resta
 * incapsulato in quel modulo, così questo file continua a dichiarare **un
 * solo** punto d'ingresso pubblico per VE (`normalizeVisualWebp`) e un solo
 * punto d'ingresso pubblico per l'upload, mai un normalizzatore parallelo.
 */
export { normalizeVisualBytesToWebp as normalizeVisualBytesToWebpForUpload };
