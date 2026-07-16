import { describe, expect, it, vi } from 'vitest';
import { MockAiGrader, resolveAiFeatureMode } from './aiCorrectionGatewayCore.js';
import { createConfiguredAiGrader } from './aiCorrectionProvider.js';
import type { OpenAiTransport } from './openAiGrader.js';

describe('AI provider configuration', () => {
  it('defaults to disabled and keeps mock unchanged', () => {
    expect(resolveAiFeatureMode({})).toBe('disabled');
    expect(createConfiguredAiGrader({ mode: 'mock' })).toBeInstanceOf(MockAiGrader);
  });

  it.each([
    { model: undefined, apiKey: 'secret' },
    { model: '', apiKey: 'secret' },
    { model: 'gpt-5-nano', apiKey: undefined },
    { model: 'gpt-5-nano', apiKey: '' },
  ])('fails closed before creating a transport for incomplete OpenAI config', (config) => {
    const createOpenAiTransport = vi.fn();
    expect(() =>
      createConfiguredAiGrader(
        { mode: 'openai', openAiModel: config.model, openAiApiKey: config.apiKey },
        { createOpenAiTransport },
      ),
    ).toThrow();
    expect(createOpenAiTransport).not.toHaveBeenCalled();
  });

  it('creates OpenAiGrader only for explicit, valid configuration', () => {
    const transport = { send: vi.fn() } as unknown as OpenAiTransport;
    const createOpenAiTransport = vi.fn(() => transport);
    const grader = createConfiguredAiGrader(
      { mode: 'openai', openAiModel: 'gpt-5-nano', openAiApiKey: 'test-only-secret' },
      { createOpenAiTransport },
    );
    expect(grader.id).toBe('openai');
    expect(grader.model).toBe('gpt-5-nano');
    expect(createOpenAiTransport).toHaveBeenCalledWith('test-only-secret');
  });
});
