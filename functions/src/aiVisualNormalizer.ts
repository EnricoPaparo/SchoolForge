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

  const scale = Math.min(
    1,
    AI_VISUAL_MAX_LONG_EDGE / Math.max(sourceInspection.width, sourceInspection.height),
  );
  const expectedWidth = Math.max(1, Math.round(sourceInspection.width * scale));
  const expectedHeight = Math.max(1, Math.round(sourceInspection.height * scale));
  let bestUnderHardCap: NormalizedVisual | null = null;

  for (let index = 0; index < AI_VISUAL_WEBP_QUALITY_ATTEMPTS.length; index += 1) {
    const quality = AI_VISUAL_WEBP_QUALITY_ATTEMPTS[index];
    if (quality === undefined) continue;
    let output: Buffer;
    try {
      output = await sharp(input, {
        animated: false,
        failOn: 'warning',
        limitInputPixels: AI_VISUAL_MAX_INPUT_PIXELS,
      })
        .resize({
          width: expectedWidth,
          height: expectedHeight,
          fit: 'fill',
          withoutEnlargement: true,
        })
        .webp({ quality, effort: 4, smartSubsample: true })
        .toBuffer();
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
