import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DifferentiationResolutionError,
  resolveDifferentiatedCommonOrders,
} from '../differentiationResolution.js';
import type { VerificationDifferentiationSnapshot } from '../../../../types/firestore.js';

/**
 * VDIF-04 — conformità dei passi 1–3 dell'algoritmo congelato.
 *
 * I casi vivono in un **fixture condiviso** letto anche dalla suite Functions:
 * i due runtime non possono condividere codice (nessun package comune), quindi
 * condividono almeno i casi. Se una delle due implementazioni cambia
 * comportamento, una delle due suite fallisce sullo stesso file.
 */

type Case = {
  name: string;
  commonQuestionOrders: number[];
  differentiation: VerificationDifferentiationSnapshot;
  labelId: string | null;
  expectedCommonOrders: number[];
};

type ErrorCase = Omit<Case, 'expectedCommonOrders'>;

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/differentiationConformance.json'), 'utf8'),
) as { cases: Case[]; errorCases: ErrorCase[] };

describe('resolveDifferentiatedCommonOrders — vettori di conformità condivisi', () => {
  it('il fixture non è vuoto (il test non è vacuo)', () => {
    expect(fixture.cases.length).toBeGreaterThan(5);
    expect(fixture.errorCases.length).toBeGreaterThan(0);
  });

  it.each(fixture.cases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    expect(
      resolveDifferentiatedCommonOrders(
        {
          commonQuestionOrders: entry.commonQuestionOrders,
          differentiation: entry.differentiation,
        },
        entry.labelId,
      ),
    ).toEqual(entry.expectedCommonOrders);
  });

  it.each(fixture.errorCases.map((entry) => [entry.name, entry] as const))(
    'fail-closed: %s',
    (_name, entry) => {
      expect(() =>
        resolveDifferentiatedCommonOrders(
          {
            commonQuestionOrders: entry.commonQuestionOrders,
            differentiation: entry.differentiation,
          },
          entry.labelId,
        ),
      ).toThrow(DifferentiationResolutionError);
    },
  );
});

describe('resolveDifferentiatedCommonOrders — proprietà', () => {
  const snapshot: VerificationDifferentiationSnapshot = {
    version: 1,
    labels: [{ labelId: 'L1', labelName: 'Percorso A' }],
    differentiatedAlternativeOrders: [3],
    questions: [{ baseOrder: 1, choices: { L1: { kind: 'alternative', order: 3 } } }],
  };

  it('è deterministica: la stessa domanda produce sempre la stessa risposta', () => {
    const first = resolveDifferentiatedCommonOrders(
      { commonQuestionOrders: [0, 1, 2], differentiation: snapshot },
      'L1',
    );
    for (let i = 0; i < 20; i++) {
      expect(
        resolveDifferentiatedCommonOrders(
          { commonQuestionOrders: [0, 1, 2], differentiation: snapshot },
          'L1',
        ),
      ).toEqual(first);
    }
  });

  it('non muta gli input', () => {
    const common = [0, 1, 2];
    const frozen = JSON.stringify(snapshot);
    resolveDifferentiatedCommonOrders(
      { commonQuestionOrders: common, differentiation: snapshot },
      'L1',
    );
    expect(common).toEqual([0, 1, 2]);
    expect(JSON.stringify(snapshot)).toBe(frozen);
  });

  it('rifiuta un order comune non intero invece di ignorarlo', () => {
    expect(() =>
      resolveDifferentiatedCommonOrders(
        { commonQuestionOrders: [0, 1.5], differentiation: snapshot },
        null,
      ),
    ).toThrow(DifferentiationResolutionError);
  });

  it('una chiave ereditata da Object.prototype non conta come scelta', () => {
    // `toString` esiste sul prototipo di ogni oggetto: senza `hasOwnProperty`
    // un'etichetta chiamata «toString» leggerebbe una funzione come scelta.
    expect(
      resolveDifferentiatedCommonOrders(
        { commonQuestionOrders: [0, 1, 2], differentiation: snapshot },
        'toString',
      ),
    ).toEqual([0, 1, 2]);
  });
});
