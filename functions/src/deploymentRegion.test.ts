import { describe, expect, it } from 'vitest';
import {
  resolveSchoolForgeFunctionRegion,
  resolveSchoolForgeTaskRegion,
} from './deploymentRegion.js';

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

  it('deriva europe-west8 dal project ID durante l’analisi Firebase PROD', () => {
    expect(resolveSchoolForgeFunctionRegion(undefined, 'schoolforge-prod')).toBe('europe-west8');
    expect(resolveSchoolForgeFunctionRegion('europe-west8', 'schoolforge-prod')).toBe(
      'europe-west8',
    );
    expect(() => resolveSchoolForgeFunctionRegion('us-central1', 'schoolforge-prod')).toThrow(
      'schoolforge-prod richiede',
    );
  });
});

describe('resolveSchoolForgeTaskRegion', () => {
  it('preserva il default storico DEV', () => {
    expect(resolveSchoolForgeTaskRegion(undefined)).toBe('us-central1');
    expect(resolveSchoolForgeTaskRegion('   ')).toBe('us-central1');
  });

  it.each(['us-central1', 'europe-west3'] as const)('accetta la regione %s', (region) => {
    expect(resolveSchoolForgeTaskRegion(` ${region} `)).toBe(region);
  });

  it('rifiuta regioni senza Cloud Tasks', () => {
    expect(() => resolveSchoolForgeTaskRegion('europe-west8')).toThrow(
      'SCHOOLFORGE_TASK_REGION non valida',
    );
  });

  it('deriva europe-west3 dal project ID durante l’analisi Firebase PROD', () => {
    expect(resolveSchoolForgeTaskRegion(undefined, 'schoolforge-prod')).toBe('europe-west3');
    expect(resolveSchoolForgeTaskRegion('europe-west3', 'schoolforge-prod')).toBe('europe-west3');
    expect(() => resolveSchoolForgeTaskRegion('us-central1', 'schoolforge-prod')).toThrow(
      'schoolforge-prod richiede',
    );
  });
});
