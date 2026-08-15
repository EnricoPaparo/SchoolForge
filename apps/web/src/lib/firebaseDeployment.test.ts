import { describe, expect, it } from 'vitest';
import { resolveFirebaseFunctionsRegion } from './firebaseDeployment';

describe('resolveFirebaseFunctionsRegion', () => {
  it('preserva us-central1 come default DEV', () => {
    expect(resolveFirebaseFunctionsRegion('schoolforge-dev', undefined)).toBe('us-central1');
  });

  it('accetta soltanto le due regioni supportate negli ambienti non PROD', () => {
    expect(resolveFirebaseFunctionsRegion('demo-schoolforge', ' europe-west8 ')).toBe(
      'europe-west8',
    );
    expect(() => resolveFirebaseFunctionsRegion('schoolforge-dev', 'europe-west1')).toThrow(
      'VITE_FIREBASE_FUNCTIONS_REGION non valida',
    );
  });

  it('rende europe-west8 obbligatoria per PROD', () => {
    expect(resolveFirebaseFunctionsRegion('schoolforge-prod', 'europe-west8')).toBe(
      'europe-west8',
    );
    expect(() => resolveFirebaseFunctionsRegion('schoolforge-prod', undefined)).toThrow(
      'PROD richiede',
    );
    expect(() => resolveFirebaseFunctionsRegion('schoolforge-prod', 'us-central1')).toThrow(
      'PROD richiede',
    );
  });
});
