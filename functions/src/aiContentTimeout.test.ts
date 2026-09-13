import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { retryPolicyFromConfig } from './aiContentGateway.js';
import { computeContentLeaseTtlMs } from './aiContentEngine.js';
import type { AiRuntimeConfig } from './aiCorrectionRuntimeConfig.js';

describe('lesson generation timeout budget', () => {
  const config = {
    limits: { attemptTimeoutMs: 60_000, maxApplicationRetries: 1 },
  } as AiRuntimeConfig;
  it('allows long lessons while preserving the short policy for maps, pools and visual plans', () => {
    const lesson = retryPolicyFromConfig(config, 'lesson');
    expect(lesson.attemptTimeoutMs).toBe(180_000);
    for (const kind of ['pool', 'concept_map', 'visual_plan_proposal']) {
      expect(retryPolicyFromConfig(config, kind).attemptTimeoutMs).toBe(60_000);
    }
    expect(computeContentLeaseTtlMs(lesson)).toBeGreaterThan(360_000);
    expect(computeContentLeaseTtlMs(lesson)).toBeLessThan(420_000);
    const source = readFileSync(new URL('./aiContentGateway.ts', import.meta.url), 'utf8');
    expect(source).toContain('timeoutSeconds: 420');
    expect(source).toContain('retryPolicyFromConfig(config, validated.kind)');
    expect(source).toContain('createPorts(database, config, mode, secret, true, validated.kind)');
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
  });
});
