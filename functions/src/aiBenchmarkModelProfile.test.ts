import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveBenchmarkContentModel } from './aiBenchmarkModelProfile.js';
import { resolveModelProfile } from './aiCorrectionModelProfile.js';
import { lookupModelPrice } from './aiCorrectionCost.js';

describe('offline benchmark identity and consent', () => {
  it('keeps Nano and Luna independent of the new runtime profiles', () => {
    expect(resolveBenchmarkContentModel('economy')).toEqual({
      model: 'gpt-5.4-nano-2026-03-17',
      priceListVersion: 'v2-2026-07-17-hg-m5',
    });
    expect(resolveBenchmarkContentModel('quality')).toEqual({
      model: 'gpt-5.6-luna',
      priceListVersion: 'v6-2026-09-12-luna-standard',
    });
    expect(resolveModelProfile('economy').model).toBe('gpt-6-luna');
    expect(resolveModelProfile('quality').model).toBe('gpt-6-sol');
    for (const profile of ['economy', 'quality'] as const) {
      const { model, priceListVersion } = resolveBenchmarkContentModel(profile);
      expect(lookupModelPrice(priceListVersion, model)).not.toBeNull();
    }
  });
  it.each([
    'lessonTuneQualityBenchmark.ts',
    'lessonTuneQualityCli.ts',
    'lessonManualQualityBenchmark.ts',
    'lessonManualQualityCli.ts',
    'poolTuneBenchmark.ts',
    'poolTuneCli.ts',
    'visualQualityBenchmark.ts',
    'visualQualityCli.ts',
  ])('%s uses the frozen resolver for planning, execution and stored accounting', (file) => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(source).toContain('resolveBenchmarkContentModel(');
    expect(source).not.toContain('resolveContentModel');
  });
});
