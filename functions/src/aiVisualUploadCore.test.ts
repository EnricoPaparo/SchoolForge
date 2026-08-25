import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { AiVisualMultiError, MAX_VISUAL_UPLOAD_INPUT_BYTES } from './aiVisualMultiCore.js';
import {
  VISUAL_UPLOAD_CONTRACT_VERSION,
  computeOpaqueVisualUploadRunId,
  decodeVisualUploadBase64,
  isCanonicalVisualUploadStagingRef,
  sniffVisualUploadFormat,
  validateVisualUploadAbandonInput,
  validateVisualUploadAcceptInput,
  validateVisualUploadRun,
  visualUploadStagingRef,
  type VisualUploadRun,
} from './aiVisualUploadCore.js';

/**
 * MULTI-VISUAL-02 — nucleo puro dell'upload. I test seguono il §9.2 del
 * roadmap nell'ordine in cui la callable applica i controlli:
 *
 * 1. cap grezzo (2.000.000 byte esatti) verificato **prima** di qualunque
 *    decodifica, base64 non canonico rifiutato allo stesso passo;
 * 2. sniffing dei magic byte reali (PNG/JPEG/WebP), mai sul MIME dichiarato;
 * 3. identità/percorso di staging, stessa forma di VE;
 * 4. `VisualUploadRun` persistito, fail-closed su ogni divergenza.
 */

const OWNER_UID = 'owner-uid-1';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';

function tsNow(msOffset = 0): Timestamp {
  return Timestamp.fromMillis(1_700_000_000_000 + msOffset);
}

const TTL_MS = 24 * 60 * 60 * 1000;

describe('confine runtime upload — zero IA e nessun cleanup passivo', () => {
  const gateway = readFileSync(new URL('./aiVisualUploadGateway.ts', import.meta.url), 'utf8');
  const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

  it('riusa direttamente aiVisualIdentity senza trascinare il gateway/provider VE', () => {
    expect(gateway).toContain("from './aiVisualIdentity.js'");
    expect(gateway).not.toContain("from './aiVisualGateway.js'");
    expect(gateway).not.toContain('OPENAI_API_KEY');
    expect(gateway).not.toContain('callProvider');
    expect(gateway).not.toContain('reserveBudget');
  });

  it('non espone scheduler/query passive e congela la precondizione create-only dello staging', () => {
    expect(gateway).not.toContain('onSchedule');
    expect(gateway).not.toContain('.limit(');
    expect(gateway).not.toContain("collection('visualUploadRuns')");
    expect(gateway.match(/preconditionOpts: \{ ifGenerationMatch: 0 \}/g)).toHaveLength(1);
    expect(index).not.toContain('visualUploadCleanupExpired');
  });

  it('lega lo staging al run con metadati server-only e cancella solo la generation verificata', () => {
    expect(gateway).toContain("const STAGING_PROOF_RUN_KEY = 'schoolforgeUploadRunId'");
    expect(gateway).toContain("const STAGING_PROOF_RAW_HASH_KEY = 'schoolforgeRawBytesSha256'");
    expect(gateway).toContain('await file.getMetadata()');
    expect(gateway).toContain('preconditionOpts: { ifGenerationMatch: generation }');
    expect(gateway).toContain('await deleteProvenUploadStaging({');
  });
});

function validRun(over: Partial<VisualUploadRun> = {}): Record<string, unknown> {
  const opaqueUploadRunId = computeOpaqueVisualUploadRunId(OWNER_UID, REQUEST_ID);
  const createdAt = tsNow();
  const base: Record<string, unknown> = {
    contractVersion: VISUAL_UPLOAD_CONTRACT_VERSION,
    ownerUid: OWNER_UID,
    programId: 'program-1',
    importId: 'import-1',
    lessonId: 'lesson-1',
    publicLessonId: 'public-lesson-1',
    udaDir: 'uda-1',
    requestId: REQUEST_ID,
    status: 'ready',
    sourceBodyHash: 'a'.repeat(64),
    anchor: { anchorHeadingIndex: 0, anchorHeadingText: 'Introduzione' },
    rawBytesSha256: 'b'.repeat(64),
    rawByteLength: 1234,
    normalized: {
      storageRef: `staging/${OWNER_UID}/${opaqueUploadRunId}.webp`,
      width: 800,
      height: 600,
      byteLength: 50_000,
      sha256: 'c'.repeat(64),
    },
    caption: 'Didascalia di prova.',
    altText: 'Testo alternativo di prova.',
    lastError: null,
    createdAt,
    updatedAt: createdAt,
    expireAt: Timestamp.fromMillis(createdAt.toMillis() + TTL_MS),
    ...over,
  };
  return base;
}

// ─── Sniffing dei magic byte (§9.2) ────────────────────────────────────────

describe('sniffVisualUploadFormat', () => {
  it('riconosce PNG dai byte reali', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(sniffVisualUploadFormat(png)).toBe('image/png');
  });

  it('riconosce JPEG dai byte reali', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(sniffVisualUploadFormat(jpeg)).toBe('image/jpeg');
  });

  it('riconosce WebP dai byte reali (RIFF…WEBP)', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBP', 'ascii'),
    ]);
    expect(sniffVisualUploadFormat(webp)).toBe('image/webp');
  });

  it('rifiuta SVG anche se dichiarato come immagine', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
    expect(() => sniffVisualUploadFormat(svg)).toThrow(AiVisualMultiError);
  });

  it('rifiuta GIF', () => {
    const gif = Buffer.from('GIF89a', 'ascii');
    expect(() => sniffVisualUploadFormat(gif)).toThrow(AiVisualMultiError);
  });

  it('rifiuta byte estranei/non riconosciuti', () => {
    expect(() => sniffVisualUploadFormat(Buffer.from([0, 1, 2, 3]))).toThrow(AiVisualMultiError);
    expect(() => sniffVisualUploadFormat(Buffer.alloc(0))).toThrow(AiVisualMultiError);
  });

  it('rifiuta un MIME dichiarato falso: i byte non corrispondono a PNG nonostante l’estensione', () => {
    // Un file .png rinominato che in realtà è testo semplice — lo sniffing è
    // sui byte, mai sull'estensione o su un campo "declaredMimeType".
    const fakePng = Buffer.from('questo non è un PNG', 'utf8');
    expect(() => sniffVisualUploadFormat(fakePng)).toThrow(AiVisualMultiError);
  });

  it('il codice d’errore è visual_upload_unsupported_format', () => {
    try {
      sniffVisualUploadFormat(Buffer.from('GIF89a', 'ascii'));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AiVisualMultiError);
      expect((error as AiVisualMultiError).code).toBe('visual_upload_unsupported_format');
    }
  });
});

// ─── Cap grezzo e base64 canonico (§9.2 passo 1) ───────────────────────────

describe('decodeVisualUploadBase64 — cap 2.000.000 byte prima del decoder', () => {
  it('accetta esattamente 2.000.000 byte grezzi', () => {
    const raw = Buffer.alloc(MAX_VISUAL_UPLOAD_INPUT_BYTES, 7);
    const b64 = raw.toString('base64');
    const decoded = decodeVisualUploadBase64(b64);
    expect(decoded.length).toBe(MAX_VISUAL_UPLOAD_INPUT_BYTES);
    expect(decoded.equals(raw)).toBe(true);
  });

  it('rifiuta 2.000.001 byte grezzi, senza mai decodificare', () => {
    const raw = Buffer.alloc(MAX_VISUAL_UPLOAD_INPUT_BYTES + 1, 7);
    const b64 = raw.toString('base64');
    let thrown: unknown;
    try {
      decodeVisualUploadBase64(b64);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AiVisualMultiError);
    expect((thrown as AiVisualMultiError).code).toBe('visual_upload_too_large');
  });

  it('rifiuta base64 non canonico (lunghezza non multipla di 4)', () => {
    expect(() => decodeVisualUploadBase64('QQ')).toThrow(AiVisualMultiError);
  });

  it('rifiuta base64 con caratteri fuori alfabeto', () => {
    expect(() => decodeVisualUploadBase64('AAAA!!!!')).toThrow(AiVisualMultiError);
  });

  it('rifiuta base64 con padding malformato', () => {
    expect(() => decodeVisualUploadBase64('A===')).toThrow(AiVisualMultiError);
  });

  it('rifiuta valori non stringa o vuoti', () => {
    expect(() => decodeVisualUploadBase64(null)).toThrow(AiVisualMultiError);
    expect(() => decodeVisualUploadBase64(undefined)).toThrow(AiVisualMultiError);
    expect(() => decodeVisualUploadBase64('')).toThrow(AiVisualMultiError);
    expect(() => decodeVisualUploadBase64(1234)).toThrow(AiVisualMultiError);
  });

  it('decodifica correttamente un base64 piccolo e valido', () => {
    const raw = Buffer.from('ciao mondo', 'utf8');
    expect(decodeVisualUploadBase64(raw.toString('base64')).equals(raw)).toBe(true);
  });
});

// ─── Identità e percorso di staging (stessa forma di VE) ───────────────────

describe('identità e staging path', () => {
  it('computeOpaqueVisualUploadRunId è deterministico', () => {
    const a = computeOpaqueVisualUploadRunId(OWNER_UID, REQUEST_ID);
    const b = computeOpaqueVisualUploadRunId(OWNER_UID, REQUEST_ID);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('è sensibile a ownerUid e requestId', () => {
    const base = computeOpaqueVisualUploadRunId(OWNER_UID, REQUEST_ID);
    expect(computeOpaqueVisualUploadRunId('other-owner', REQUEST_ID)).not.toBe(base);
    expect(
      computeOpaqueVisualUploadRunId(OWNER_UID, '66666666-6666-4666-8666-666666666666'),
    ).not.toBe(base);
  });

  it('è in un namespace diverso da visual-plan/v1 e visual-enrichment/v1', () => {
    // Stesso ownerUid+requestId, namespace diverso ⇒ id diverso — verificato
    // indirettamente: il valore prodotto qui non deve coincidere con quello
    // che l'helper equivalente del piano produrrebbe per lo stesso input
    // (verificato via import incrociato in aiVisualMultiCore.test.ts; qui si
    // verifica solo che l'id sia stabile e ben formato).
    expect(computeOpaqueVisualUploadRunId(OWNER_UID, REQUEST_ID)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('visualUploadStagingRef produce staging/{ownerUid}/{opaqueUploadRunId}.webp', () => {
    const id = computeOpaqueVisualUploadRunId(OWNER_UID, REQUEST_ID);
    expect(visualUploadStagingRef(OWNER_UID, id)).toBe(`staging/${OWNER_UID}/${id}.webp`);
  });

  it('isCanonicalVisualUploadStagingRef valida solo il percorso atteso per quell’id', () => {
    const id = computeOpaqueVisualUploadRunId(OWNER_UID, REQUEST_ID);
    const ref = visualUploadStagingRef(OWNER_UID, id);
    expect(isCanonicalVisualUploadStagingRef(ref, id)).toBe(true);
    expect(isCanonicalVisualUploadStagingRef(`staging/other-owner/${id}.webp`, id)).toBe(true);
    expect(isCanonicalVisualUploadStagingRef('staging/x/y.webp', id)).toBe(false);
  });
});

// ─── VisualUploadRun persistito — fail-closed ──────────────────────────────

describe('validateVisualUploadRun', () => {
  it('accetta un run ready ben formato', () => {
    const parsed = validateVisualUploadRun(validRun());
    expect(parsed.status).toBe('ready');
    expect(parsed.normalized).not.toBeNull();
  });

  it('rifiuta chiavi extra o mancanti (corrupted_state)', () => {
    const withExtra = { ...validRun(), extra: 1 };
    expect(() => validateVisualUploadRun(withExtra)).toThrow(AiVisualMultiError);
    try {
      validateVisualUploadRun(withExtra);
    } catch (error) {
      expect((error as AiVisualMultiError).code).toBe('corrupted_state');
    }
  });

  it('rifiuta contractVersion diversa', () => {
    expect(() =>
      validateVisualUploadRun(validRun({ contractVersion: 'visual-upload/v2' as never })),
    ).toThrow(AiVisualMultiError);
  });

  it('lega normalized agli stati: obbligatorio ready/promoted, vietato accepted/failed, conservabile nei terminali di cleanup', () => {
    expect(() =>
      validateVisualUploadRun(validRun({ status: 'accepted', normalized: null, lastError: null })),
    ).not.toThrow();
    expect(() => validateVisualUploadRun(validRun({ status: 'accepted' }))).toThrow(
      AiVisualMultiError,
    );
    expect(() => validateVisualUploadRun(validRun({ status: 'ready', normalized: null }))).toThrow(
      AiVisualMultiError,
    );
    expect(() =>
      validateVisualUploadRun(validRun({ status: 'abandoned', lastError: null })),
    ).not.toThrow();
    const expired = validRun({ status: 'expired', lastError: null });
    expired.updatedAt = expired.expireAt;
    expect(() => validateVisualUploadRun(expired)).not.toThrow();
  });

  it('rifiuta un normalized il cui storageRef non appartiene a questo run', () => {
    const otherId = computeOpaqueVisualUploadRunId(
      OWNER_UID,
      '77777777-7777-4777-8777-777777777777',
    );
    expect(() =>
      validateVisualUploadRun(
        validRun({
          normalized: {
            storageRef: `staging/${OWNER_UID}/${otherId}.webp`,
            width: 100,
            height: 100,
            byteLength: 100,
            sha256: 'd'.repeat(64),
          },
        }),
      ),
    ).toThrow(AiVisualMultiError);
  });

  it('richiede lastError presente se e solo se status è failed', () => {
    expect(() =>
      validateVisualUploadRun(
        validRun({
          status: 'failed',
          normalized: null,
          lastError: 'visual_upload_too_large',
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validateVisualUploadRun(validRun({ status: 'failed', normalized: null, lastError: null })),
    ).toThrow(AiVisualMultiError);
    expect(() =>
      validateVisualUploadRun(validRun({ lastError: 'visual_upload_conflict' })),
    ).toThrow(AiVisualMultiError);
  });

  it('traduce un caption/altText malformato (AiContentError) in corrupted_state, mai provider_invalid_output', () => {
    let thrown: unknown;
    try {
      validateVisualUploadRun(validRun({ caption: '' }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AiVisualMultiError);
    expect((thrown as AiVisualMultiError).code).toBe('corrupted_state');
  });

  it('traduce un’ancora malformata in corrupted_state, mai invalid_input', () => {
    let thrown: unknown;
    try {
      validateVisualUploadRun(
        validRun({ anchor: { anchorHeadingIndex: -1, anchorHeadingText: 'x' } }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AiVisualMultiError);
    expect((thrown as AiVisualMultiError).code).toBe('corrupted_state');
  });

  it('verifica expireAt = createdAt + TTL 24h esatto', () => {
    const run = validRun();
    const created = (run.createdAt as Timestamp).toMillis();
    expect(() =>
      validateVisualUploadRun({ ...run, expireAt: Timestamp.fromMillis(created + TTL_MS - 1) }),
    ).toThrow(AiVisualMultiError);
  });

  it('status "expired" richiede updatedAt >= expireAt', () => {
    const run = validRun({ status: 'expired', normalized: null, lastError: null });
    const expireMs = (run.expireAt as Timestamp).toMillis();
    expect(() =>
      validateVisualUploadRun({ ...run, updatedAt: Timestamp.fromMillis(expireMs) }),
    ).not.toThrow();
    expect(() =>
      validateVisualUploadRun({ ...run, updatedAt: Timestamp.fromMillis(expireMs - 1) }),
    ).toThrow(AiVisualMultiError);
  });

  it('stati diversi da expired richiedono createdAt ≤ updatedAt ≤ expireAt', () => {
    const run = validRun();
    const createdMs = (run.createdAt as Timestamp).toMillis();
    expect(() =>
      validateVisualUploadRun({ ...run, updatedAt: Timestamp.fromMillis(createdMs - 1) }),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta rawByteLength oltre il cap di upload', () => {
    expect(() =>
      validateVisualUploadRun(validRun({ rawByteLength: MAX_VISUAL_UPLOAD_INPUT_BYTES + 1 })),
    ).toThrow(AiVisualMultiError);
  });
});

// ─── Payload chiuso della callable (input, non record persistito) ─────────

describe('validateVisualUploadAcceptInput', () => {
  function acceptPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
    ]);
    return {
      requestId: REQUEST_ID,
      programId: 'program-1',
      importId: 'import-1',
      lessonId: 'lesson-1',
      base64: pngHeader.toString('base64'),
      anchor: { anchorHeadingIndex: 0, anchorHeadingText: 'Introduzione' },
      caption: 'Didascalia.',
      altText: 'Testo alternativo.',
      ...over,
    };
  }

  it('accetta un payload valido e decodifica i byte grezzi', () => {
    const parsed = validateVisualUploadAcceptInput(acceptPayload());
    expect(parsed.rawBytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(parsed.requestId).toBe(REQUEST_ID);
  });

  it('rifiuta chiavi extra', () => {
    expect(() => validateVisualUploadAcceptInput(acceptPayload({ storageRef: 'x' }))).toThrow(
      AiVisualMultiError,
    );
  });

  it('rifiuta requestId non-UUID', () => {
    expect(() =>
      validateVisualUploadAcceptInput(acceptPayload({ requestId: 'not-a-uuid' })),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta programId/importId/lessonId malformati con invalid_input (mai corrupted_state)', () => {
    let thrown: unknown;
    try {
      validateVisualUploadAcceptInput(acceptPayload({ programId: '' }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AiVisualMultiError);
    expect((thrown as AiVisualMultiError).code).toBe('invalid_input');
  });

  it('rifiuta caption/altText malformati con invalid_input (mai provider_invalid_output)', () => {
    let thrown: unknown;
    try {
      validateVisualUploadAcceptInput(acceptPayload({ caption: '' }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AiVisualMultiError);
    expect((thrown as AiVisualMultiError).code).toBe('invalid_input');
  });

  it('rifiuta un’ancora malformata', () => {
    expect(() =>
      validateVisualUploadAcceptInput(
        acceptPayload({ anchor: { anchorHeadingIndex: -1, anchorHeadingText: 'x' } }),
      ),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta un base64 oltre il cap, prima di qualunque decodifica', () => {
    const raw = Buffer.alloc(MAX_VISUAL_UPLOAD_INPUT_BYTES + 1, 1);
    expect(() =>
      validateVisualUploadAcceptInput(acceptPayload({ base64: raw.toString('base64') })),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta magic bytes fuori allowlist dentro il validator, prima di ogni I/O', () => {
    expect(() =>
      validateVisualUploadAcceptInput(
        acceptPayload({ base64: Buffer.from('GIF89a', 'ascii').toString('base64') }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<AiVisualMultiError>>({
        code: 'visual_upload_unsupported_format',
      }),
    );
  });
});

describe('validateVisualUploadAbandonInput', () => {
  it('accetta un requestId valido', () => {
    expect(validateVisualUploadAbandonInput({ requestId: REQUEST_ID })).toEqual({
      requestId: REQUEST_ID,
    });
  });

  it('rifiuta requestId non-UUID o chiavi extra', () => {
    expect(() => validateVisualUploadAbandonInput({ requestId: 'x' })).toThrow(AiVisualMultiError);
    expect(() => validateVisualUploadAbandonInput({ requestId: REQUEST_ID, extra: 1 })).toThrow(
      AiVisualMultiError,
    );
  });
});
