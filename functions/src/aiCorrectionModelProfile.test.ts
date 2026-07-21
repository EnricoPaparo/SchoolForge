import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_PROFILE,
  MODEL_PROFILE_RESOLUTIONS,
  normalizeModelProfileField,
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
import { AiGatewayError } from './aiCorrectionGatewayCore.js';

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

  describe('normalizeModelProfileField (client input)', () => {
    it('accepts the two closed values', () => {
      expect(normalizeModelProfileField('economy')).toBe('economy');
      expect(normalizeModelProfileField('quality')).toBe('quality');
    });

    it('treats an omitted field as undefined (legacy default resolved later)', () => {
      expect(normalizeModelProfileField(undefined)).toBeUndefined();
    });

    it('rejects null, unknown strings and non-strings with invalid_input', () => {
      for (const bad of [null, 'premium', 'nano', 'gpt-5.6-luna', 3, {}, []]) {
        expect(() => normalizeModelProfileField(bad)).toThrow(AiGatewayError);
        try {
          normalizeModelProfileField(bad);
        } catch (e) {
          expect((e as AiGatewayError).code).toBe('invalid_input');
        }
      }
    });
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
