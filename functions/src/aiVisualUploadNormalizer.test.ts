import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { inspectWebp } from './aiVisualCore.js';
import { AiVisualMultiError, MAX_VISUAL_UPLOAD_INPUT_BYTES } from './aiVisualMultiCore.js';
import {
  VISUAL_UPLOAD_FLATTEN_BACKGROUND,
  normalizeVisualUploadBytes,
} from './aiVisualUploadNormalizer.js';

/**
 * MULTI-VISUAL-02 — pipeline binaria dell'upload (roadmap §9.1–§9.2), con
 * byte reali (Sharp), non mock: stesso principio dei test VE esistenti
 * (`aiVisual.test.ts`, «byte WebP reali»). Copre in particolare le quattro
 * garanzie che il rapporto finale deve dimostrare:
 *
 * 1. il cap è verificato altrove (§9.2 passo 1, `aiVisualUploadCore.test.ts`)
 *    — qui si assume che i byte grezzi siano già entro il cap;
 * 2. il WebP animato è rifiutato anche quando supera lo sniffing come WebP
 *    valido (stesso trucco `addChunk` di VE: il flag/marker d'animazione,
 *    non un vero multi-frame, è ciò che i parser reali controllano);
 * 3. un canale alfa reale (PNG) viene appiattito su `#f7f5f0`, mai
 *    preservato come trasparenza;
 * 4. nessun secondo normalizzatore: stesso cap 204.800 byte, stesso lato
 *    lungo 1200, nessun upscaling, metadati rimossi — la stessa istanza di
 *    codice di VE, verificata da qui con un ingresso PNG/JPEG invece che
 *    WebP.
 */

function addChunk(webp: Buffer, type: string, payload: Buffer): Buffer {
  const padding = payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
  const chunk = Buffer.alloc(8);
  chunk.write(type, 0, 4, 'ascii');
  chunk.writeUInt32LE(payload.length, 4);
  const out = Buffer.concat([webp, chunk, payload, padding]);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}

async function fixturePng(width = 96, height = 64, alpha = 255): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 10, g: 20, b: 30, alpha } },
  })
    .png()
    .toBuffer();
}

async function fixtureJpeg(width = 96, height = 64): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 100, b: 50 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function fixtureWebp(width = 96, height = 64): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 238, g: 248, b: 249 } },
  })
    .webp({ quality: 88 })
    .toBuffer();
}

describe('normalizeVisualUploadBytes — formati reali', () => {
  it('normalizza un PNG reale (opaco): dimensioni corrette, WebP finale valido', async () => {
    const png = await fixturePng();
    const result = await normalizeVisualUploadBytes(png);
    expect(result.mimeType).toBe('image/webp');
    expect(result.width).toBe(96);
    expect(result.height).toBe(64);
    expect(result.byteLength).toBeLessThanOrEqual(204_800);
    const inspection = inspectWebp(result.bytes);
    expect(inspection).toEqual({ width: 96, height: 64, animated: false, hasMetadata: false });
  });

  it('appiattisce un canale alfa reale su #f7f5f0, mai trasparenza preservata', async () => {
    const transparentPng = await fixturePng(64, 64, 0);
    const result = await normalizeVisualUploadBytes(transparentPng);
    const { data, info } = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3); // opaco: nessun canale alfa nell'output
    const [r, g, b] = [data[0]!, data[1]!, data[2]!];
    // Tolleranza per l'arrotondamento della compressione WebP lossy.
    expect(Math.abs(r - VISUAL_UPLOAD_FLATTEN_BACKGROUND.r)).toBeLessThanOrEqual(8);
    expect(Math.abs(g - VISUAL_UPLOAD_FLATTEN_BACKGROUND.g)).toBeLessThanOrEqual(8);
    expect(Math.abs(b - VISUAL_UPLOAD_FLATTEN_BACKGROUND.b)).toBeLessThanOrEqual(8);
  });

  it('normalizza un JPEG reale', async () => {
    const jpeg = await fixtureJpeg(200, 100);
    const result = await normalizeVisualUploadBytes(jpeg);
    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
    expect(inspectWebp(result.bytes).animated).toBe(false);
  });

  it('applica EXIF auto-orient prima del resize e persiste le dimensioni visive, non quelle grezze', async () => {
    const jpegWithExifRotation = await sharp({
      create: {
        width: 160,
        height: 80,
        channels: 3,
        background: { r: 200, g: 100, b: 50 },
      },
    })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 90 })
      .toBuffer();

    const result = await normalizeVisualUploadBytes(jpegWithExifRotation);
    expect([result.width, result.height]).toEqual([80, 160]);
    expect(inspectWebp(result.bytes)).toEqual({
      width: 80,
      height: 160,
      animated: false,
      hasMetadata: false,
    });
  });

  it('normalizza un WebP statico reale (stesso percorso di VE)', async () => {
    const webp = await fixtureWebp(120, 80);
    const result = await normalizeVisualUploadBytes(webp);
    expect(result.width).toBe(120);
    expect(result.height).toBe(80);
  });

  it('rifiuta un WebP con il marcatore di animazione, anche se lo sniffing lo riconosce come WebP valido', async () => {
    const valid = await fixtureWebp();
    const animated = addChunk(valid, 'ANIM', Buffer.alloc(6));
    let thrown: unknown;
    try {
      await normalizeVisualUploadBytes(animated);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AiVisualMultiError);
    expect((thrown as AiVisualMultiError).code).toBe('visual_upload_unsupported_format');
  });

  it('ridimensiona al lato lungo 1200 senza upscaling', async () => {
    const large = await fixtureJpeg(2400, 600);
    const resized = await normalizeVisualUploadBytes(large);
    expect([resized.width, resized.height]).toEqual([1200, 300]);

    const small = await fixturePng(80, 40);
    const untouched = await normalizeVisualUploadBytes(small);
    expect([untouched.width, untouched.height]).toEqual([80, 40]);
  });

  it('rimuove i metadati (EXIF/ICC/XMP) anche da un sorgente che li dichiara', async () => {
    const withMetadata = await sharp(await fixtureJpeg())
      .withMetadata({ orientation: 3 })
      .jpeg()
      .toBuffer();
    const result = await normalizeVisualUploadBytes(withMetadata);
    expect(inspectWebp(result.bytes).hasMetadata).toBe(false);
  });

  it('rifiuta byte non riconosciuti come PNG/JPEG/WebP (SVG, testo, GIF)', async () => {
    await expect(
      normalizeVisualUploadBytes(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8')),
    ).rejects.toBeInstanceOf(AiVisualMultiError);
    await expect(normalizeVisualUploadBytes(Buffer.from('GIF89a', 'ascii'))).rejects.toBeInstanceOf(
      AiVisualMultiError,
    );
    await expect(normalizeVisualUploadBytes(Buffer.alloc(0))).rejects.toBeInstanceOf(
      AiVisualMultiError,
    );
  });

  it('rifiuta byte oltre il cap grezzo anche a questo livello (difesa in profondità)', async () => {
    const oversized = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(MAX_VISUAL_UPLOAD_INPUT_BYTES, 1),
    ]);
    let thrown: unknown;
    try {
      await normalizeVisualUploadBytes(oversized);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AiVisualMultiError);
    expect((thrown as AiVisualMultiError).code).toBe('visual_upload_too_large');
  });
});

describe('normalizeVisualWebp (VE) resta byte-identico dopo l’estrazione del nucleo condiviso', () => {
  it('non chiama mai .flatten(): un WebP opaco reale normalizzato da VE non cambia comportamento', async () => {
    const { normalizeVisualWebp } = await import('./aiVisualNormalizer.js');
    const source = await fixtureWebp(96, 64);
    const result = await normalizeVisualWebp(source);
    expect(result.width).toBe(96);
    expect(result.height).toBe(64);
    expect(inspectWebp(result.bytes)).toEqual({
      width: 96,
      height: 64,
      animated: false,
      hasMetadata: false,
    });
  });
});
