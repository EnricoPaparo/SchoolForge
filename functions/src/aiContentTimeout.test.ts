import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { retryPolicyFromConfig } from './aiContentGateway.js';
import { computeContentLeaseTtlMs } from './aiContentEngine.js';
import type { AiRuntimeConfig } from './aiCorrectionRuntimeConfig.js';

describe('lesson generation timeout budget', () => {
  const config = {
    limits: { attemptTimeoutMs: 60_000, maxApplicationRetries: 1 },
  } as AiRuntimeConfig;
  it('allows long lessons and pools while preserving the short policy for maps and visual plans', () => {
    const lesson = retryPolicyFromConfig(config, 'lesson');
    expect(lesson.attemptTimeoutMs).toBe(180_000);
    const review = retryPolicyFromConfig(config, 'lesson_review');
    expect(review).toEqual(lesson);
    expect(computeContentLeaseTtlMs(review)).toBe(398_000);
    expect(computeContentLeaseTtlMs(review)).toBeLessThan(420_000);
    const pool = retryPolicyFromConfig(config, 'pool');
    expect(pool.attemptTimeoutMs).toBe(180_000);
    expect(pool.maxRetries).toBe(1);
    // Two 185s hard-abort windows, up to 8s Retry-After and 20s finalization.
    expect(computeContentLeaseTtlMs(pool)).toBe(398_000);
    expect(computeContentLeaseTtlMs(pool)).toBeGreaterThan(360_000);
    expect(computeContentLeaseTtlMs(pool)).toBeLessThan(420_000);
    for (const kind of ['concept_map', 'visual_plan_proposal']) {
      expect(retryPolicyFromConfig(config, kind).attemptTimeoutMs).toBe(60_000);
    }
    expect(computeContentLeaseTtlMs(lesson)).toBeGreaterThan(360_000);
    expect(computeContentLeaseTtlMs(lesson)).toBeLessThan(420_000);
    const source = readFileSync(new URL('./aiContentGateway.ts', import.meta.url), 'utf8');
    expect(source).toContain('timeoutSeconds: 420');
    expect(source).toContain('retryPolicyFromConfig(config, validated.kind)');
    expect(source).toContain('createPorts(database, config, mode, secret, true, validated.kind)');
    const visualPlanGateway = readFileSync(
      new URL('./aiVisualPlanGateway.ts', import.meta.url),
      'utf8',
    );
    expect(visualPlanGateway).toContain('timeoutSeconds: 300');
  });
  it('honors the optional lesson timeout and disabled retries', () => {
    const policy = retryPolicyFromConfig(
      {
        ...config,
        limits: { ...config.limits, lessonAttemptTimeoutMs: 90_000, maxApplicationRetries: 0 },
      },
      'lesson',
    );
    expect(policy.attemptTimeoutMs).toBe(90_000);
    expect(policy.maxRetries).toBe(0);
    expect(
      retryPolicyFromConfig(
        {
          ...config,
          limits: { ...config.limits, lessonAttemptTimeoutMs: 90_000, maxApplicationRetries: 0 },
        },
        'lesson_review',
      ),
    ).toEqual(policy);
  });
  it('honors a restricted pool timeout independently of the lesson timeout', () => {
    const configured = {
      ...config,
      limits: {
        ...config.limits,
        poolAttemptTimeoutMs: 90_000,
        lessonAttemptTimeoutMs: 120_000,
        maxApplicationRetries: 0,
      },
    };
    expect(retryPolicyFromConfig(configured, 'pool').attemptTimeoutMs).toBe(90_000);
    expect(retryPolicyFromConfig(configured, 'pool').maxRetries).toBe(0);
    expect(retryPolicyFromConfig(configured, 'lesson').attemptTimeoutMs).toBe(120_000);
  });
});

import { createContentProvider } from './aiContentProvider.js';
import { validateAiContentRequest } from './aiContentCore.js';
it('accepts a lesson review taking 130 seconds with the dedicated transport policy instead of aborting at the old 65-second window', async () => {
  vi.useFakeTimers();
  try {
    const request = validateAiContentRequest({
      kind: 'lesson_review',
      requestId: '11111111-2222-4333-8444-555555555555',
      modelProfile: 'economy',
      depth: 'complete',
      titolo: 'Cicli',
      sottotitolo: null,
      difficolta: 'Base',
      concettiChiave: ['while'],
      obiettivi: ['Comprendere il ciclo'],
      udaTitle: 'Programmazione',
      udaContext: {
        title: 'Programmazione',
        descrizione: '',
        competenze: [],
        obiettivi: [],
        currentLessonPosition: 1,
        lessons: [{ position: 1, titolo: 'Cicli', sottotitolo: null }],
      },
      candidateBody: 'Il ciclo ripete il corpo mentre la condizione è vera.',
    });
    const send = vi.fn(
      (_request, options) =>
        new Promise<{ outputText: string; usage: { inputTokens: number; outputTokens: number } }>(
          (resolve, reject) => {
            expect(options.timeoutMs).toBe(180000);
            const timer = setTimeout(
              () =>
                resolve({
                  outputText: JSON.stringify({
                    body: 'Corpo revisionato.',
                    reviewOutcome: 'unchanged',
                    issueCodes: [],
                  }),
                  usage: { inputTokens: 100, outputTokens: 100 },
                }),
              130000,
            );
            options.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new Error('aborted'));
              },
              { once: true },
            );
          },
        ),
    );
    const policy = retryPolicyFromConfig(
      { limits: { maxApplicationRetries: 0, attemptTimeoutMs: 60000 } } as AiRuntimeConfig,
      'lesson_review',
    );
    const provider = createContentProvider({
      mode: 'openai',
      transport: { send },
      runnerDeps: { policy },
    });
    const result = provider.generate(request, 'gpt-6.1-sol');
    await vi.advanceTimersByTimeAsync(130000);
    expect(await result).toMatchObject({ status: 'ok', priorBillingRisk: false });
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
