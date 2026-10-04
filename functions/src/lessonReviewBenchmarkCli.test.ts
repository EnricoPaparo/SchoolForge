import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OpenAiTransportError, type OpenAiTransport } from './openAiGrader.js';
import { loadLessonReviewManifest } from './lessonReviewBenchmark.js';
import {
  assertNode22,
  createLessonReviewBenchmarkProvider,
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
});
