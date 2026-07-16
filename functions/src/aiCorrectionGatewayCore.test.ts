import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AiGatewayError,
  authorizeAndValidate,
  authorizeOwnerCall,
  MockAiGrader,
  MAX_SUBMISSIONS_PER_OPERATION,
  resolveAiFeatureMode,
  validateAiCorrectionRequest,
  type AiCorrectionAuthDeps,
  type AiFeatureMode,
  type AiGraderInput,
} from './aiCorrectionGatewayCore.js';

const OWNER = 'owner-uid';
const VERIF = 'verif-1';
const REQ = 'req-abcdef01';

function subId(suffix: string): string {
  return `${VERIF}_${suffix}`;
}

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    verificationId: VERIF,
    submissionIds: [subId('s1'), subId('s2')],
    requestId: REQ,
    ...overrides,
  };
}

function deps(overrides: Partial<AiCorrectionAuthDeps> = {}): AiCorrectionAuthDeps {
  return {
    callerUid: OWNER,
    getOwnerUid: async () => OWNER,
    featureMode: 'mock' as AiFeatureMode,
    ...overrides,
  };
}

// A fetch spy shared across tests to prove no external network call is made.
let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(() => Promise.reject(new Error('network call not allowed in M5-01')));
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ── resolveAiFeatureMode ─────────────────────────────────────────────────────

describe('resolveAiFeatureMode', () => {
  it('defaults to disabled when unset', () => {
    expect(resolveAiFeatureMode({})).toBe('disabled');
    expect(resolveAiFeatureMode({ AI_CORRECTION_MODE: undefined })).toBe('disabled');
  });

  it('enables mock only for the exact string "mock"', () => {
    expect(resolveAiFeatureMode({ AI_CORRECTION_MODE: 'mock' })).toBe('mock');
  });

  it('treats any unrecognized value as disabled (no implicit fallback to a real provider)', () => {
    for (const v of [
      'MOCK',
      'real',
      'openai',
      'anthropic',
      'gemini',
      'enabled',
      'true',
      ' mock ',
    ]) {
      expect(resolveAiFeatureMode({ AI_CORRECTION_MODE: v })).toBe('disabled');
    }
  });
});

// ── authorizeOwnerCall ───────────────────────────────────────────────────────

describe('authorizeOwnerCall', () => {
  it('throws unauthenticated when caller uid is null', async () => {
    await expect(
      authorizeOwnerCall({ callerUid: null, getOwnerUid: async () => OWNER }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('throws not_owner when caller is not the configured owner', async () => {
    await expect(
      authorizeOwnerCall({ callerUid: 'someone-else', getOwnerUid: async () => OWNER }),
    ).rejects.toMatchObject({ code: 'not_owner' });
  });

  it('throws not_owner when no owner is configured', async () => {
    await expect(
      authorizeOwnerCall({ callerUid: OWNER, getOwnerUid: async () => null }),
    ).rejects.toMatchObject({ code: 'not_owner' });
  });

  it('returns the uid for the owner', async () => {
    await expect(
      authorizeOwnerCall({ callerUid: OWNER, getOwnerUid: async () => OWNER }),
    ).resolves.toBe(OWNER);
  });
});

// ── validateAiCorrectionRequest ──────────────────────────────────────────────

describe('validateAiCorrectionRequest', () => {
  it('accepts a well-formed request', () => {
    const r = validateAiCorrectionRequest(validRequest());
    expect(r.verificationId).toBe(VERIF);
    expect(r.submissionIds).toHaveLength(2);
    expect(r.requestId).toBe(REQ);
  });

  it.each([
    ['null payload', null],
    ['non-object', 42],
    ['missing verificationId', { submissionIds: [subId('s1')], requestId: REQ }],
    ['malformed verificationId', validRequest({ verificationId: 'has space' })],
    ['verificationId with slash', validRequest({ verificationId: 'a/b' })],
    ['missing requestId', { verificationId: VERIF, submissionIds: [subId('s1')] }],
    ['too-short requestId', validRequest({ requestId: 'short' })],
    ['submissionIds not array', validRequest({ submissionIds: 'x' })],
    ['empty submissionIds', validRequest({ submissionIds: [] })],
    ['malformed submission id', validRequest({ submissionIds: ['bad id!'] })],
    ['submission id of another verification', validRequest({ submissionIds: ['other_s1'] })],
    ['submission id equal to prefix only', validRequest({ submissionIds: [`${VERIF}_`] })],
  ])('rejects %s as invalid_input', (_label, input) => {
    expect(() => validateAiCorrectionRequest(input)).toThrowError(
      expect.objectContaining({ code: 'invalid_input' }),
    );
  });

  it('accepts the canonical payload with exactly the three allowed fields', () => {
    const r = validateAiCorrectionRequest({
      verificationId: VERIF,
      submissionIds: [subId('s1')],
      requestId: REQ,
    });
    expect(Object.keys(r).sort()).toEqual(['requestId', 'submissionIds', 'verificationId']);
  });

  it.each([
    ['extra studentAnswer', validRequest({ studentAnswer: 'la mia risposta' })],
    ['extra questionText', validRequest({ questionText: 'testo domanda' })],
    ['extra arbitrary object', validRequest({ extra: { foo: 'bar' } })],
    ['extra scalar field', validRequest({ studentEmail: 'a@b.c' })],
  ])('rejects a closed-payload violation: %s', (_label, input) => {
    expect(() => validateAiCorrectionRequest(input)).toThrowError(
      expect.objectContaining({ code: 'invalid_input' }),
    );
  });

  it('rejects duplicate submissionIds', () => {
    expect(() =>
      validateAiCorrectionRequest(validRequest({ submissionIds: [subId('s1'), subId('s1')] })),
    ).toThrowError(expect.objectContaining({ code: 'invalid_input' }));
  });

  it('rejects going over the batch limit with batch_limit_exceeded', () => {
    const many = Array.from({ length: MAX_SUBMISSIONS_PER_OPERATION + 1 }, (_, i) =>
      subId(`s${i}`),
    );
    expect(() => validateAiCorrectionRequest(validRequest({ submissionIds: many }))).toThrowError(
      expect.objectContaining({ code: 'batch_limit_exceeded' }),
    );
  });

  it('accepts exactly the batch limit', () => {
    const many = Array.from({ length: MAX_SUBMISSIONS_PER_OPERATION }, (_, i) => subId(`s${i}`));
    expect(
      validateAiCorrectionRequest(validRequest({ submissionIds: many })).submissionIds,
    ).toHaveLength(MAX_SUBMISSIONS_PER_OPERATION);
  });
});

// ── authorizeAndValidate: auth → flag → input ordering ───────────────────────

describe('authorizeAndValidate — shared preview/run gate', () => {
  it('rejects an unauthenticated caller', async () => {
    await expect(
      authorizeAndValidate(validRequest(), deps({ callerUid: null })),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a non-owner caller', async () => {
    await expect(
      authorizeAndValidate(validRequest(), deps({ callerUid: 'intruder' })),
    ).rejects.toMatchObject({ code: 'not_owner' });
  });

  it('rejects when the feature is disabled', async () => {
    await expect(
      authorizeAndValidate(validRequest(), deps({ featureMode: 'disabled' })),
    ).rejects.toMatchObject({ code: 'feature_disabled' });
  });

  it('does not reveal the flag to a non-owner (owner checked first)', async () => {
    // Non-owner + disabled flag → must surface not_owner, never feature_disabled.
    await expect(
      authorizeAndValidate(
        validRequest(),
        deps({ callerUid: 'intruder', featureMode: 'disabled' }),
      ),
    ).rejects.toMatchObject({ code: 'not_owner' });
  });

  it('rejects invalid input once authorized and enabled', async () => {
    await expect(
      authorizeAndValidate(validRequest({ submissionIds: [] }), deps()),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('returns the validated closed payload for the owner with mock enabled', async () => {
    const r = await authorizeAndValidate(validRequest(), deps());
    expect(r).toEqual({
      verificationId: VERIF,
      submissionIds: [subId('s1'), subId('s2')],
      requestId: REQ,
    });
  });
});

// ── MockAiGrader determinism + no network ────────────────────────────────────

describe('MockAiGrader', () => {
  const input: AiGraderInput = {
    requestId: REQ,
    questions: [
      { order: 0, maxPoints: 2, questionText: 'Q0', referenceSolution: 'S0', studentAnswer: 'A0' },
      { order: 1, maxPoints: 3, questionText: 'Q1', referenceSolution: 'S1', studentAnswer: 'A1' },
      { order: 2, maxPoints: 0, questionText: 'Q2', referenceSolution: 'S2', studentAnswer: '' },
    ],
  };

  it('is identified as "mock"', () => {
    expect(new MockAiGrader().id).toBe('mock');
  });

  it('produces identical output for identical input (deterministic)', async () => {
    const a = await new MockAiGrader().grade(input);
    const b = await new MockAiGrader().grade(input);
    expect(a).toEqual(b);
    expect(a.requestId).toBe(REQ);
  });

  it('produces valid quarter-step points within [0, maxPoints]', async () => {
    const out = await new MockAiGrader().grade(input);
    for (const r of out.results) {
      const max = input.questions.find((q) => q.order === r.order)!.maxPoints;
      expect(r.points).toBeGreaterThanOrEqual(0);
      expect(r.points).toBeLessThanOrEqual(max);
      expect(Math.abs(r.points * 4 - Math.round(r.points * 4))).toBeLessThan(1e-9);
    }
    // maxPoints 0 → always 0.
    expect(out.results.find((r) => r.order === 2)!.points).toBe(0);
  });

  it('never echoes the student answer in feedback', async () => {
    const out = await new MockAiGrader().grade(input);
    for (const r of out.results) {
      expect(r.feedback).not.toContain('A0');
      expect(r.feedback).not.toContain('A1');
    }
  });

  it('makes no network call', async () => {
    await new MockAiGrader().grade(input);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── no external network from the shared gate ─────────────────────────────────

describe('no external network', () => {
  it('authorizeAndValidate never calls fetch', async () => {
    await authorizeAndValidate(validRequest(), deps());
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── error shape ──────────────────────────────────────────────────────────────

describe('AiGatewayError', () => {
  it('carries a stable code and a non-empty message', () => {
    const e = new AiGatewayError('invalid_input', 'boom');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('invalid_input');
    expect(e.message).toBe('boom');
  });
});
