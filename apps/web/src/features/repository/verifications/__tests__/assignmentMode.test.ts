import { describe, expect, it } from 'vitest';
import {
  deriveAssignmentMode,
  normalizeAssignmentMode,
  UNKNOWN_ASSIGNMENT_MODE_MESSAGE,
} from '../assignmentMode.js';
import {
  canonicalAssignmentsInput,
  computeAssignmentsFingerprint,
} from '../assignmentsFingerprint.js';

describe('deriveAssignmentMode — regola congelata all’attivazione', () => {
  it('server_resolved con VEX', () => {
    expect(
      deriveAssignmentMode({ distributionMode: 'equivalent_variants', hasDifferentiation: false }),
    ).toBe('server_resolved');
  });

  it('server_resolved con differenziazione', () => {
    expect(
      deriveAssignmentMode({ distributionMode: 'same_questions', hasDifferentiation: true }),
    ).toBe('server_resolved');
  });

  it('server_resolved con entrambe', () => {
    expect(
      deriveAssignmentMode({ distributionMode: 'equivalent_variants', hasDifferentiation: true }),
    ).toBe('server_resolved');
  });

  it('same_questions solo quando non c’è nessuno dei due', () => {
    expect(
      deriveAssignmentMode({ distributionMode: 'same_questions', hasDifferentiation: false }),
    ).toBe('same_questions');
    expect(deriveAssignmentMode({ distributionMode: undefined, hasDifferentiation: false })).toBe(
      'same_questions',
    );
  });
});

describe('normalizeAssignmentMode — compatibilità legacy in un solo punto', () => {
  it('un valore presente e valido vince su qualunque derivazione', () => {
    expect(normalizeAssignmentMode('same_questions', 'equivalent_variants')).toBe('same_questions');
    expect(normalizeAssignmentMode('server_resolved', 'same_questions')).toBe('server_resolved');
  });

  it('proiezione legacy senza il campo: deriva da distributionMode', () => {
    expect(normalizeAssignmentMode(undefined, 'equivalent_variants')).toBe('server_resolved');
    expect(normalizeAssignmentMode(undefined, 'same_questions')).toBe('same_questions');
    // Proiezione ancora più vecchia: nemmeno `distributionMode`.
    expect(normalizeAssignmentMode(undefined, undefined)).toBe('same_questions');
  });

  it.each([null, '', 'boh', 42, {}, []])(
    'fail-closed su un valore presente ma sconosciuto: %s',
    (value) => {
      expect(() => normalizeAssignmentMode(value, 'same_questions')).toThrow(
        UNKNOWN_ASSIGNMENT_MODE_MESSAGE,
      );
    },
  );
});

describe('impronta delle assegnazioni (G20)', () => {
  it('serializza le coppie ordinate per studentUid, con separatori non ambigui', () => {
    // I separatori sono costruiti con `fromCharCode` invece che scritti: un
    // carattere di controllo letterale in un sorgente e' invisibile a chi legge
    // il diff, ed e' esattamente il posto in cui deve essere visibile.
    const PAIR = String.fromCharCode(0);
    const RECORD = String.fromCharCode(30);
    expect(canonicalAssignmentsInput({ b: 'L2', a: 'L1' })).toBe(`a${PAIR}L1${RECORD}b${PAIR}L2`);
  });
  it('l’ordine di inserimento non cambia l’impronta', async () => {
    const first = await computeAssignmentsFingerprint({ a: 'L1', b: 'L2' });
    const second = await computeAssignmentsFingerprint({ b: 'L2', a: 'L1' });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('una sola assegnazione cambiata cambia l’impronta', async () => {
    const before = await computeAssignmentsFingerprint({ a: 'L1', b: 'L2' });
    const after = await computeAssignmentsFingerprint({ a: 'L1', b: 'L3' });
    expect(after).not.toBe(before);
  });

  it('uno studente aggiunto o rimosso cambia l’impronta', async () => {
    const base = await computeAssignmentsFingerprint({ a: 'L1' });
    expect(await computeAssignmentsFingerprint({ a: 'L1', b: 'L1' })).not.toBe(base);
    expect(await computeAssignmentsFingerprint({})).not.toBe(base);
  });

  it('i separatori impediscono la collisione fra coppie diverse', async () => {
    // Senza separatori distinti, {'a': 'bc'} e {'ab': 'c'} concatenerebbero
    // entrambe in «abc».
    expect(await computeAssignmentsFingerprint({ a: 'bc' })).not.toBe(
      await computeAssignmentsFingerprint({ ab: 'c' }),
    );
  });

  it('la mappa vuota ha comunque un’impronta stabile', async () => {
    expect(await computeAssignmentsFingerprint({})).toBe(await computeAssignmentsFingerprint({}));
  });
});
