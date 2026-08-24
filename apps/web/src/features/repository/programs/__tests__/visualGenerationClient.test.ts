import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';

const { mockGetDoc } = vi.hoisted(() => ({ mockGetDoc: vi.fn() }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ path: 'lesson' })),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));

import {
  describeVisualWorkflowError,
  readAuthoritativePrivateVisual,
  visualErrorDisposition,
  type WebAiVisualErrorCode,
} from '../visualGenerationClient.js';

const ASSET = '11111111-2222-4333-8444-555555555555';

function manifest(over: Record<string, unknown> = {}) {
  return {
    assetId: ASSET,
    anchor: { headingSlug: 'reti', headingText: 'Reti', placement: 'after-heading' },
    caption: 'Schema',
    altText: 'Schema di rete',
    width: 800,
    height: 600,
    storageRef: `repository/owner/i1/uda-01/visuals/${ASSET}.webp`,
    byteLength: 100,
    sha256: 'a'.repeat(64),
    mimeType: 'image/webp',
    styleVersion: 'schoolforge-sketch/v1',
    sourceBodyHash: 'b'.repeat(64),
    approvedAt: { toMillis: () => 1_700_000_000_000 },
    ...over,
  };
}

function snap(visual: unknown, exists = true) {
  return {
    exists: () => exists,
    data: () => ({ ownerUid: 'owner', udaDir: 'uda-01', visual }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readAuthoritativePrivateVisual', () => {
  const input = { db: {} as Firestore, programId: 'p1', importId: 'i1', lessonId: 'l1' };

  it('restituisce null se il campo è assente e il manifest se è valido', async () => {
    mockGetDoc.mockResolvedValueOnce(snap(undefined)).mockResolvedValueOnce(snap(manifest()));
    await expect(readAuthoritativePrivateVisual(input)).resolves.toBeNull();
    await expect(readAuthoritativePrivateVisual(input)).resolves.toMatchObject({ assetId: ASSET });
  });

  it.each([
    ['extra-key', manifest({ extra: true })],
    ['assetId', manifest({ assetId: 'bad' })],
    ['path', manifest({ storageRef: `repository/other/i1/uda-01/visuals/${ASSET}.webp` })],
    ['hash', manifest({ sha256: 'bad' })],
    ['dimensioni', manifest({ width: 1_201 })],
    [
      'anchor',
      manifest({ anchor: { headingSlug: 'BAD', headingText: 'Reti', placement: 'after-heading' } }),
    ],
  ])('rifiuta fail-closed un manifest malformato: %s', async (_label, visual) => {
    mockGetDoc.mockResolvedValueOnce(snap(visual));
    await expect(readAuthoritativePrivateVisual(input)).rejects.toThrow(/non è leggibile/);
  });
});

describe('codici errore visuali reali', () => {
  const cases: Array<[WebAiVisualErrorCode, RegExp]> = [
    ['unauthenticated', /Sessione/],
    ['not_owner', /proprietario/],
    ['feature_disabled', /disattivata/],
    ['invalid_input', /cambiati/],
    ['running', /corso/],
    ['run_conflict', /dati diversi/],
    ['corrupted_state', /sicurezza/],
    ['uncertain_state', /stato non è certo/],
    ['operation_budget_exceeded', /limite per operazione/],
    ['budget_exceeded', /mensile/],
    ['daily_budget_exceeded', /giornaliero/],
    ['budget_unavailable', /non disponibile/],
    ['provider_config_invalid', /configurato/],
    ['provider_unavailable', /non ha completato/],
    ['provider_invalid_response', /risposta non valida/],
    ['provider_billed_unusable', /fatturata/],
    ['visual_invalid_format', /formato/],
    ['visual_corrupted', /corrotta/],
    ['visual_too_large', /dimensione/],
    ['staging_failed', /staging/],
    ['internal', /interno/],
  ];

  it.each(cases)('%s ha un messaggio italiano sanificato', (code, message) => {
    expect(describeVisualWorkflowError({ details: { code } })).toMatch(message);
  });

  it('distingue retry same-id, terminale, incerto e bloccato', () => {
    expect(visualErrorDisposition(new Error('response lost'))).toBe('retry_same');
    expect(visualErrorDisposition({ details: { code: 'running' } })).toBe('retry_same');
    expect(visualErrorDisposition({ details: { code: 'provider_billed_unusable' } })).toBe(
      'terminal',
    );
    expect(visualErrorDisposition({ details: { code: 'uncertain_state' } })).toBe('uncertain');
    expect(visualErrorDisposition({ details: { code: 'budget_exceeded' } })).toBe('blocked');
  });
});
