import type { ModelProfile, ModelProfileResolution } from './aiCorrectionModelProfile.js';

/**
 * Offline benchmark identities frozen before the teacher runtime migration.
 * Historical consent phrases and sample validation refer to Nano/Luna, not
 * to the mutable application Economy/Quality choices. Keep both model and
 * price list pinned here; a new benchmark model requires its own consent.
 */
const BENCHMARK_MODELS: Readonly<Record<ModelProfile, ModelProfileResolution>> = {
  economy: {
    model: 'gpt-5.4-nano-2026-03-17',
    priceListVersion: 'v2-2026-07-17-hg-m5',
  },
  quality: {
    model: 'gpt-5.6-luna',
    priceListVersion: 'v6-2026-09-12-luna-standard',
  },
};

export function resolveBenchmarkContentModel(profile: ModelProfile): ModelProfileResolution {
  return { ...BENCHMARK_MODELS[profile] };
}
