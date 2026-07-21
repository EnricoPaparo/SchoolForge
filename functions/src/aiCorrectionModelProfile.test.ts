import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_PROFILE,
  MODEL_PROFILE_RESOLUTIONS,
  parseModelProfileField,
  profileForModel,
  resolveModelProfile,
} from './aiCorrectionModelProfile.js';
import {
  DEFAULT_PRICE_LIST_VERSION,
  OPENAI_PRODUCTION_MODEL,
  OPENAI_RUNTIME_LUNA_MODEL,
  OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
  lookupModelPrice,
} from './aiCorrectionCost.js';

describe('TWU-02 — closed model profiles', () => {
  it('economy resolves to nano model + nano price list', () => {
    expect(MODEL_PROFILE_RESOLUTIONS.economy).toEqual({
      model: OPENAI_PRODUCTION_MODEL,
      priceListVersion: DEFAULT_PRICE_LIST_VERSION,
    });
    expect(resolveModelProfile('economy')).toEqual({
      model: OPENAI_PRODUCTION_MODEL,
      priceListVersion: DEFAULT_PRICE_LIST_VERSION,
    });
  });

  it('quality resolves to Luna model + Luna price list', () => {
    expect(resolveModelProfile('quality')).toEqual({
      model: OPENAI_RUNTIME_LUNA_MODEL,
      priceListVersion: OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
    });
  });

  it('every profile resolves to a coupled, priced model (no dangling price list)', () => {
    for (const profile of ['economy', 'quality'] as const) {
      const { model, priceListVersion } = resolveModelProfile(profile);
      expect(lookupModelPrice(priceListVersion, model)).not.toBeNull();
    }
  });

  it('the default profile is quality (DEV runtime = Luna)', () => {
    expect(DEFAULT_MODEL_PROFILE).toBe('quality');
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
      expect(profileForModel(OPENAI_PRODUCTION_MODEL)).toBe('economy');
      expect(profileForModel(OPENAI_RUNTIME_LUNA_MODEL)).toBe('quality');
    });
    it('returns null for an unmapped model (no silent fallback)', () => {
      expect(profileForModel('some-other-model')).toBeNull();
    });
  });
});
