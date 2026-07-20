import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRICE_LIST_VERSION,
  lookupModelPrice,
  OPENAI_BENCHMARK_CANDIDATE_MODEL,
  OPENAI_BENCHMARK_CANDIDATE_PRICE_LIST_VERSION,
  OPENAI_BENCHMARK_LUNA_MODEL,
  OPENAI_BENCHMARK_LUNA_PRICE_LIST_VERSION,
  OPENAI_PRODUCTION_MODEL,
} from './aiCorrectionCost.js';

describe('price lists — nano baseline and mini benchmark candidate (M5-QUALITY-05)', () => {
  it('prices the production nano model at $0.20/M input and $1.25/M output', () => {
    expect(lookupModelPrice(DEFAULT_PRICE_LIST_VERSION, OPENAI_PRODUCTION_MODEL)).toEqual({
      inputMicroUsdPerMillion: 200_000,
      outputMicroUsdPerMillion: 1_250_000,
    });
  });

  it('prices the mini candidate at $0.75/M input and $4.50/M output in its own version', () => {
    expect(
      lookupModelPrice(
        OPENAI_BENCHMARK_CANDIDATE_PRICE_LIST_VERSION,
        OPENAI_BENCHMARK_CANDIDATE_MODEL,
      ),
    ).toEqual({
      inputMicroUsdPerMillion: 750_000,
      outputMicroUsdPerMillion: 4_500_000,
    });
  });

  it('prices the Luna candidate at $1.00/M input and $6.00/M output in its own version', () => {
    expect(
      lookupModelPrice(OPENAI_BENCHMARK_LUNA_PRICE_LIST_VERSION, OPENAI_BENCHMARK_LUNA_MODEL),
    ).toEqual({
      inputMicroUsdPerMillion: 1_000_000,
      outputMicroUsdPerMillion: 6_000_000,
    });
  });

  it('keeps each candidate in its own price-list version (no cross-contamination)', () => {
    expect(
      lookupModelPrice(DEFAULT_PRICE_LIST_VERSION, OPENAI_BENCHMARK_CANDIDATE_MODEL),
    ).toBeNull();
    expect(lookupModelPrice(DEFAULT_PRICE_LIST_VERSION, OPENAI_BENCHMARK_LUNA_MODEL)).toBeNull();
    expect(
      lookupModelPrice(OPENAI_BENCHMARK_CANDIDATE_PRICE_LIST_VERSION, OPENAI_PRODUCTION_MODEL),
    ).toBeNull();
    expect(
      lookupModelPrice(OPENAI_BENCHMARK_LUNA_PRICE_LIST_VERSION, OPENAI_BENCHMARK_CANDIDATE_MODEL),
    ).toBeNull();
  });
});
