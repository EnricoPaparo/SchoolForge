import OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  describeTransportFailure,
  PROVIDER_BILLING_FAILURE_CODES,
} from './openAiTransportDiagnostics.js';
import { DEFAULT_OPENAI_RETRY_POLICY, OpenAiSdkTransport } from './openAiGrader.js';
import { runStructuredCall } from './openAiStructuredRunner.js';

afterEach(() => vi.restoreAllMocks());

describe('sanitized OpenAI transport diagnostics', () => {
  it.each([
    [{ status: 429, code: 'insufficient_quota' }, 'insufficient_quota'],
    [{ status: 429, code: 'rate_limit_exceeded' }, 'rate_limit_exceeded'],
    [{ status: 429 }, 'http_429'],
    [{ status: 401 }, 'authentication'],
    [{ status: 403 }, 'permission'],
    [{ status: 404 }, 'not_found'],
    [{ status: 400 }, 'invalid_request'],
    [{ status: 503 }, 'server_error'],
    [{ name: 'APIConnectionTimeoutError' }, 'timeout'],
    [{ name: 'APIConnectionError' }, 'connection'],
    [{ name: 'APIUserAbortError' }, 'aborted'],
    [null, 'other'],
  ])('classifies %j as %s', (error, category) => {
    expect(describeTransportFailure(error).category).toBe(category);
  });

  it('never copies raw errors, unknown codes, headers, keys or request identifiers', () => {
    const diagnostic = describeTransportFailure({
      status: 429,
      code: 'raw-private-code',
      message: 'private prompt / sk-private',
      headers: { Authorization: 'private-token' },
      requestID: 'private-request-id',
    });
    expect(diagnostic).toEqual({ category: 'http_429', httpStatus: 429 });
    expect(describeTransportFailure({ status: NaN })).toEqual({
      category: 'other',
      httpStatus: null,
    });
  });

  it('recognizes real SDK error subclasses even when their name is Error', () => {
    expect(describeTransportFailure(new OpenAI.APIConnectionTimeoutError()).category).toBe(
      'timeout',
    );
    expect(
      describeTransportFailure(new OpenAI.APIConnectionError({ message: 'private' })).category,
    ).toBe('connection');
    expect(describeTransportFailure(new OpenAI.APIUserAbortError()).category).toBe('aborted');
  });

  it('recognizes legacy insufficient_quota types without exposing an unknown raw code', () => {
    expect(
      describeTransportFailure({ status: 429, type: 'insufficient_quota', code: 'private-code' }),
    ).toEqual({ category: 'insufficient_quota', httpStatus: 429 });
  });

  it.each([
    ...PROVIDER_BILLING_FAILURE_CODES.map((code) => [code, 1] as const),
    ['rate_limit_exceeded', 2],
    ['slow_down', 2],
  ])('logs safe diagnostics for %s with %i attempts', async (code, expectedAttempts) => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const create = vi.fn(async () => {
      throw OpenAI.APIError.generate(
        429,
        { error: { code, message: 'private-provider-message' } },
        undefined,
        new Headers({ 'x-request-id': 'private-request-id' }),
      );
    });
    const outcome = await runStructuredCall(
      new OpenAiSdkTransport({ responses: { create } }),
      {
        model: 'test-model',
        input: [],
        max_output_tokens: 10,
        store: false,
        text: { format: { type: 'json_schema', name: 'test', strict: true, schema: {} } },
      },
      { policy: DEFAULT_OPENAI_RETRY_POLICY, sleep: async () => {}, random: () => 0 },
    );
    expect(outcome.status).toBe('pre_invocation');
    expect(create).toHaveBeenCalledTimes(expectedAttempts);
    expect(log).toHaveBeenCalledWith('openai_transport_failure', {
      category: code,
      httpStatus: 429,
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|prompt|headers/);
  });
});
