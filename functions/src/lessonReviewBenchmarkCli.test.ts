import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { OpenAiTransportError, type OpenAiTransport } from './openAiGrader.js';
import { buildLessonReviewPlan, loadLessonReviewManifest } from './lessonReviewBenchmark.js';
import {
  assertNode22,
  createLessonReviewBenchmarkProvider,
  executeLessonReviewPlan,
  parseLessonReviewCliArgs,
  prepareOutputDirectory,
} from './lessonReviewBenchmarkCli.js';

const manifestPath = fileURLToPath(
  new URL(
    '../../documentazione/evidenze/lesson-review-benchmark-v1/manifest.json',
    import.meta.url,
  ),
);

describe('lesson review benchmark CLI guards', () => {
  it('requires Node 22 and rejects unknown or duplicate flags', () => {
    expect(() => assertNode22('24.1.0')).toThrow(/Node\.js 22/);
    expect(() => assertNode22('22.14.0')).not.toThrow();
    const base = [`--manifest=${manifestPath}`, '--split=tuning', '--profile=economy'];
    expect(() => parseLessonReviewCliArgs([...base, '--wat'])).toThrow(/sconosciuto/);
    expect(() => parseLessonReviewCliArgs([...base, '--split=holdout'])).toThrow(/duplicato/);
  });

  it('never retries a transient provider failure', async () => {
    let calls = 0;
    const transport: OpenAiTransport = {
      async send() {
        calls += 1;
        throw new OpenAiTransportError('rate limited', {
          transient: true,
          billingRisk: false,
          status: 429,
        });
      },
    };
    const manifest = await loadLessonReviewManifest(manifestPath);
    const request = manifest.samples[0]!.request;
    const provider = createLessonReviewBenchmarkProvider({ transport });
    await expect(provider.generate(request, 'gpt-5.6-luna')).resolves.toMatchObject({
      status: 'error',
    });
    expect(calls).toBe(1);
  });

  it('refuses a non-empty output directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lesson-review-output-'));
    await writeFile(join(directory, 'existing.json'), '{}', 'utf8');
    await expect(prepareOutputDirectory(directory)).rejects.toThrow(/non è vuota/);
  });

  it('writes a fail-closed failure record before stopping the batch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lesson-review-failure-'));
    const manifest = await loadLessonReviewManifest(manifestPath);
    const plan = buildLessonReviewPlan(manifest, { split: 'tuning', profile: 'quality' });
    let calls = 0;
    const provider = {
      async generate() {
        calls += 1;
        if (calls === 1) {
          return {
            status: 'ok' as const,
            output: { body: '## Revisionata', reviewOutcome: 'improved', issueCodes: [] },
            usage: { inputTokens: 10, outputTokens: 20 },
            metered: true,
            priorBillingRisk: false,
          };
        }
        return {
          status: 'error' as const,
          phase: 'invocation_unknown' as const,
          reason: 'max_output_tokens' as const,
        };
      },
    };
    const sleep = vi.fn(async () => undefined);
    await expect(executeLessonReviewPlan(plan, provider, directory, { sleep })).rejects.toThrow(
      /phase=invocation_unknown, reason=max_output_tokens/,
    );
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(25_000);
    const failure = JSON.parse(await readFile(join(directory, 'failure.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(failure).toMatchObject({
      id: plan.samples[1]!.id,
      status: 'error',
      phase: 'invocation_unknown',
      reason: 'max_output_tokens',
      manifestHash: plan.manifestHash,
      promptContractVersion: plan.promptContractVersion,
      model: plan.samples[1]!.model,
      priceListVersion: plan.samples[1]!.priceListVersion,
      inputHash: plan.samples[1]!.inputHash,
      partialResultCount: 1,
    });
  });
});
