import { describe, expect, it } from 'vitest';
import { resolveSchoolForgeFunctionRegion } from './deploymentRegion.js';

describe('resolveSchoolForgeFunctionRegion', () => {
  it('preserva il default storico DEV', () => {
    expect(resolveSchoolForgeFunctionRegion(undefined)).toBe('us-central1');
    expect(resolveSchoolForgeFunctionRegion('   ')).toBe('us-central1');
  });

  it.each(['us-central1', 'europe-west8'] as const)('accetta la regione %s', (region) => {
    expect(resolveSchoolForgeFunctionRegion(` ${region} `)).toBe(region);
  });

  it('rifiuta ogni regione non prevista', () => {
    expect(() => resolveSchoolForgeFunctionRegion('europe-west1')).toThrow(
      'SCHOOLFORGE_FUNCTION_REGION non valida',
    );
  });
});
