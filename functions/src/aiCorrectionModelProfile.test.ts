import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_PROFILE,
  ACTIVE_AI_RUNTIME_POLICY,
  GPT56_ROLLBACK_MODEL_PROFILE_RESOLUTIONS,
  GPT6_MODEL_PROFILE_RESOLUTIONS,
  MODEL_PROFILE_RESOLUTIONS,
  parseModelProfileField,
  profileForModel,
  resolveModelProfile,
} from './aiCorrectionModelProfile.js';
import {
  OPENAI_RUNTIME_GPT6_LUNA_MODEL,
  OPENAI_RUNTIME_GPT6_SOL_MODEL,
  OPENAI_RUNTIME_GPT61_SOL_MODEL,
  OPENAI_RUNTIME_LUNA_MODEL,
  OPENAI_RUNTIME_SOL_MODEL,
  lookupModelPrice,
} from './aiCorrectionCost.js';

describe('TWU-02 — closed model profiles', () => {
  it('economy resolves to GPT-6 Luna with its cache-aware list', () => {
    expect(MODEL_PROFILE_RESOLUTIONS.economy).toEqual({
      model: 'gpt-6-luna',
      priceListVersion: 'v10-2026-09-26-gpt6-luna-standard',
    });
    expect(resolveModelProfile('economy')).toEqual({
      model: 'gpt-6-luna',
      priceListVersion: 'v10-2026-09-26-gpt6-luna-standard',
    });
  });

  it('quality resolves to GPT-6.1 Sol with its cache-aware list', () => {
    expect(resolveModelProfile('quality')).toEqual({
      model: 'gpt-6.1-sol',
      priceListVersion: 'v12-2026-09-29-gpt61-sol-standard',
    });
  });

  it('keeps the active GPT-6 mapping separate from the rollback mapping', () => {
    expect(ACTIVE_AI_RUNTIME_POLICY).toBe('gpt6');
    expect(MODEL_PROFILE_RESOLUTIONS).toBe(GPT6_MODEL_PROFILE_RESOLUTIONS);
    expect(MODEL_PROFILE_RESOLUTIONS).not.toBe(GPT56_ROLLBACK_MODEL_PROFILE_RESOLUTIONS);
  });

  it('keeps GPT-5.6 Luna/Sol as explicit cache-aware rollback pairs', () => {
    expect(GPT56_ROLLBACK_MODEL_PROFILE_RESOLUTIONS).toEqual({
      economy: {
        model: 'gpt-5.6-luna',
        priceListVersion: 'v8-2026-09-26-luna-cache-standard',
      },
      quality: {
        model: 'gpt-5.6-sol',
        priceListVersion: 'v9-2026-09-26-sol-cache-standard',
      },
    });
    for (const resolution of Object.values(GPT56_ROLLBACK_MODEL_PROFILE_RESOLUTIONS)) {
      expect(lookupModelPrice(resolution.priceListVersion, resolution.model)).not.toBeNull();
    }
  });

  it('every profile resolves to a coupled, priced model (no dangling price list)', () => {
    for (const profile of ['economy', 'quality'] as const) {
      const { model, priceListVersion } = resolveModelProfile(profile);
      expect(lookupModelPrice(priceListVersion, model)).not.toBeNull();
    }
  });

  it('the default profile is economy', () => {
    expect(DEFAULT_MODEL_PROFILE).toBe('economy');
  });

  describe('parseModelProfileField (pure, result-based)', () => {
    it('accepts the two closed values', () => {
      expect(parseModelProfileField('economy')).toEqual({ ok: true, profile: 'economy' });
      expect(parseModelProfileField('quality')).toEqual({ ok: true, profile: 'quality' });
    });

    it('treats an omitted field as ok with an undefined profile (legacy default later)', () => {
      expect(parseModelProfileField(undefined)).toEqual({ ok: true, profile: undefined });
    });

    it('rejects null, unknown strings and non-strings with { ok: false } (no throw)', () => {
      for (const bad of [null, '', 'premium', 'nano', 'gpt-5.6-luna', 3, {}, []]) {
        expect(parseModelProfileField(bad)).toEqual({ ok: false });
      }
    });
  });

  it('is a pure module: it does NOT import aiCorrectionGatewayCore (no import cycle)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, './aiCorrectionModelProfile.ts'), 'utf8');
    // Only import statements matter (the doc comment may name the module in prose).
    expect(source).not.toMatch(/from\s+['"][^'"]*aiCorrectionGatewayCore/);
    expect(source).not.toMatch(/import\([^)]*aiCorrectionGatewayCore/);
  });

  describe('profileForModel (legacy default derivation)', () => {
    it('maps a known model back to its profile', () => {
      expect(profileForModel(OPENAI_RUNTIME_LUNA_MODEL)).toBe('economy');
      expect(profileForModel(OPENAI_RUNTIME_SOL_MODEL)).toBe('quality');
      expect(profileForModel(OPENAI_RUNTIME_GPT6_LUNA_MODEL)).toBe('economy');
      expect(profileForModel(OPENAI_RUNTIME_GPT6_SOL_MODEL)).toBe('quality');
      expect(profileForModel(OPENAI_RUNTIME_GPT61_SOL_MODEL)).toBe('quality');
    });
    it('returns null for an unmapped model (no silent fallback)', () => {
      expect(profileForModel('some-other-model')).toBeNull();
    });
  });
});
