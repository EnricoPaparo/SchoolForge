import { describe, expect, it } from 'vitest';
import { resolveUdaTitle } from '../udaTitle.js';

describe('resolveUdaTitle (EXP-01)', () => {
  it('prefers the front matter titolo when present', () => {
    expect(resolveUdaTitle('uda-01-reti', 'Reti di calcolatori')).toBe('Reti di calcolatori');
  });

  it('trims a padded titolo', () => {
    expect(resolveUdaTitle('uda-01-reti', '  Reti  ')).toBe('Reti');
  });

  it('falls back to a readable label derived from the dir', () => {
    expect(resolveUdaTitle('uda-00-setup')).toBe('Setup');
    expect(resolveUdaTitle('uda-02-sicurezza-di-rete', null)).toBe('Sicurezza di rete');
    expect(resolveUdaTitle('uda-03-basi_dati', '')).toBe('Basi dati');
  });

  it('never leaves the uda-XX- prefix in the fallback', () => {
    expect(resolveUdaTitle('uda-10-http')).not.toContain('uda-');
  });

  it('returns the raw dir only when nothing readable remains', () => {
    expect(resolveUdaTitle('uda-01-')).toBe('uda-01-');
  });
});
