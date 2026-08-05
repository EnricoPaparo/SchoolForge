import { describe, expect, it } from 'vitest';
import {
  checkCommitPreconditions,
  classifyAttempt,
  mayCleanupAttempt,
  ownedStoragePaths,
} from '../attemptState.js';
import type { AttemptExpectation } from '../attemptState.js';

/**
 * STRUCTURE-IMPORT-02A — la macchina degli stati del tentativo.
 *
 * Sono le decisioni in cui un errore non produce un crash ma un dato sbagliato:
 * un commit su un lease scaduto, un cleanup che cancella i file del tentativo
 * che l'ha sostituito, un record parziale «riparato» in silenzio. Ogni caso ha
 * qui il suo test, con un clock esplicito.
 */

const EXPECTED: AttemptExpectation = {
  requestId: 'req-1',
  sourceHash: 's'.repeat(64),
  programId: 'prog-1',
  importId: 'imp-1',
  manifestHash: 'a'.repeat(64),
  kind: 'uda',
  udaId: null,
  publicLessonIds: [],
  documentIds: ['uda-01-a', 'uda-02-b'],
  storagePaths: [
    'repository/o/imports/i/uda-01-a/uda-01-a.md',
    'repository/o/imports/i/uda-02-b/uda-02-b.md',
  ],
};

const RESERVED = {
  requestId: EXPECTED.requestId,
  sourceHash: EXPECTED.sourceHash,
  programId: EXPECTED.programId,
  importId: EXPECTED.importId,
  manifestHash: EXPECTED.manifestHash,
  kind: 'uda',
  status: 'reserved',
  documentIds: [...EXPECTED.documentIds],
  storagePaths: [...EXPECTED.storagePaths],
};

describe('classificazione del tentativo', () => {
  it('nessun record: tentativo nuovo', () => {
    expect(classifyAttempt(null, EXPECTED)).toBe('none');
  });

  it('stesso tentativo, coerente e non completato: riprendibile', () => {
    expect(classifyAttempt(RESERVED, EXPECTED)).toBe('resumable');
  });

  it('stesso tentativo già committato: replay', () => {
    expect(classifyAttempt({ ...RESERVED, status: 'committed' }, EXPECTED)).toBe('committed');
  });

  it('stessa sorgente ma piano diverso: incoerente, mai un secondo import', () => {
    // Il piano prenotato non è più quello corrente: una mutazione concorrente ha
    // spostato numerazione o `order`. Fail-closed, senza riparazioni.
    expect(classifyAttempt({ ...RESERVED, manifestHash: 'b'.repeat(64) }, EXPECTED)).toBe(
      'incoherent',
    );
  });

  it('sorgente diversa: conflitto — il docente ha cambiato il file', () => {
    expect(classifyAttempt({ ...RESERVED, sourceHash: 'z'.repeat(64) }, EXPECTED)).toBe('conflict');
  });

  it('record privo di sourceHash: incoerente, mai riparato', () => {
    const legacy = { ...RESERVED } as Record<string, unknown>;
    delete legacy['sourceHash'];
    expect(classifyAttempt(legacy as never, EXPECTED)).toBe('incoherent');
  });

  it('record parziale o malformato: incoerente, non riparabile', () => {
    const cases = [
      { ...RESERVED, requestId: undefined },
      { ...RESERVED, requestId: 'altro' },
      { ...RESERVED, manifestHash: undefined },
      { ...RESERVED, manifestHash: 42 },
      { ...RESERVED, sourceHash: undefined },
      { ...RESERVED, sourceHash: 7 },
      { ...RESERVED, kind: undefined },
      { ...RESERVED, kind: 'lesson' },
      { ...RESERVED, status: undefined },
      { ...RESERVED, status: 'boh' },
      { ...RESERVED, documentIds: undefined },
      { ...RESERVED, documentIds: 'uda-01-a' },
      { ...RESERVED, storagePaths: [1, 2] },
    ];
    for (const record of cases) {
      expect(classifyAttempt(record as never, EXPECTED)).toBe('incoherent');
    }
  });

  it('path o id divergenti: incoerente, non riprendibile', () => {
    expect(classifyAttempt({ ...RESERVED, documentIds: ['uda-01-a'] }, EXPECTED)).toBe(
      'incoherent',
    );
    expect(classifyAttempt({ ...RESERVED, documentIds: ['uda-02-b', 'uda-01-a'] }, EXPECTED)).toBe(
      'incoherent',
    );
    expect(
      classifyAttempt({ ...RESERVED, storagePaths: ['repository/altro/file.md'] }, EXPECTED),
    ).toBe('incoherent');
  });

  it('l’hash è controllato prima della forma: un piano diverso è sempre un conflitto', () => {
    // Sorgente diversa *e* piano diverso resta un conflitto, non un incoerente:
    // è il retry legittimo di un file modificato.
    expect(
      classifyAttempt(
        {
          ...RESERVED,
          sourceHash: 'z'.repeat(64),
          manifestHash: 'b'.repeat(64),
          documentIds: ['x'],
          storagePaths: ['y'],
        },
        EXPECTED,
      ),
    ).toBe('conflict');
  });
});

describe('precondizioni del commit', () => {
  const lease = {
    requestId: EXPECTED.requestId,
    manifestHash: EXPECTED.manifestHash,
    expiresAt: 10_000,
  };

  it('lease valida e tentativo coerente: si procede', () => {
    expect(
      checkCommitPreconditions({ lease, attempt: RESERVED, expected: EXPECTED, now: 9_000 }),
    ).toBeNull();
  });

  it('lease assente: nessun commit', () => {
    for (const value of [null, undefined]) {
      expect(
        checkCommitPreconditions({
          lease: value,
          attempt: RESERVED,
          expected: EXPECTED,
          now: 9_000,
        }),
      ).toBe('lease_missing');
    }
  });

  it('lease scaduta: nessun commit, nemmeno di un istante', () => {
    expect(
      checkCommitPreconditions({ lease, attempt: RESERVED, expected: EXPECTED, now: 10_000 }),
    ).toBe('lease_expired');
    expect(
      checkCommitPreconditions({ lease, attempt: RESERVED, expected: EXPECTED, now: 10_001 }),
    ).toBe('lease_expired');
  });

  it('lease malformata: nessun commit', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...lease, expiresAt: undefined }, 'lease_malformed'],
      [{ ...lease, expiresAt: 'domani' }, 'lease_malformed'],
      [{ ...lease, expiresAt: Number.NaN }, 'lease_malformed'],
      [{ ...lease, requestId: undefined }, 'lease_malformed'],
      [{ ...lease, manifestHash: undefined }, 'lease_malformed'],
      [{}, 'lease_malformed'],
    ];
    for (const [value, reason] of cases) {
      expect(
        checkCommitPreconditions({ lease: value, attempt: RESERVED, expected: EXPECTED, now: 1 }),
      ).toBe(reason);
    }
  });

  it('lease di un altro tentativo o di un altro piano: nessun commit', () => {
    expect(
      checkCommitPreconditions({
        lease: { ...lease, requestId: 'req-2' },
        attempt: RESERVED,
        expected: EXPECTED,
        now: 9_000,
      }),
    ).toBe('lease_other_request');
    expect(
      checkCommitPreconditions({
        lease: { ...lease, manifestHash: 'b'.repeat(64) },
        attempt: RESERVED,
        expected: EXPECTED,
        now: 9_000,
      }),
    ).toBe('lease_other_manifest');
  });

  it('record del tentativo assente, incoerente o già committato: nessun commit', () => {
    expect(checkCommitPreconditions({ lease, attempt: null, expected: EXPECTED, now: 9_000 })).toBe(
      'attempt_missing',
    );
    expect(
      checkCommitPreconditions({
        lease,
        attempt: { ...RESERVED, kind: 'lesson' },
        expected: EXPECTED,
        now: 9_000,
      }),
    ).toBe('attempt_incoherent');
    expect(
      checkCommitPreconditions({
        lease,
        attempt: { ...RESERVED, storagePaths: ['altro'] },
        expected: EXPECTED,
        now: 9_000,
      }),
    ).toBe('attempt_incoherent');
    expect(
      checkCommitPreconditions({
        lease,
        attempt: { ...RESERVED, status: 'committed' },
        expected: EXPECTED,
        now: 9_000,
      }),
    ).toBe('attempt_committed');
  });
});

describe('guardia del cleanup', () => {
  it('cancella solo con un record che dimostra la proprietà', () => {
    expect(mayCleanupAttempt(RESERVED, EXPECTED)).toBe(true);
  });

  it('non tocca nulla se il record è assente, committato, sostituito o malformato', () => {
    expect(mayCleanupAttempt(null, EXPECTED)).toBe(false);
    expect(mayCleanupAttempt({ ...RESERVED, status: 'committed' }, EXPECTED)).toBe(false);
    expect(mayCleanupAttempt({ ...RESERVED, manifestHash: 'b'.repeat(64) }, EXPECTED)).toBe(false);
    expect(mayCleanupAttempt({ ...RESERVED, sourceHash: 'z'.repeat(64) }, EXPECTED)).toBe(false);
    expect(mayCleanupAttempt({ ...RESERVED, storagePaths: ['altro'] }, EXPECTED)).toBe(false);
    expect(mayCleanupAttempt({ ...RESERVED, kind: 'lesson' }, EXPECTED)).toBe(false);
  });
});

describe('path di proprietà del tentativo', () => {
  it('solo un tentativo riprendibile possiede i propri path', () => {
    expect(ownedStoragePaths('resumable', EXPECTED)).toEqual(EXPECTED.storagePaths);
    for (const other of ['none', 'committed', 'conflict', 'incoherent'] as const) {
      expect(ownedStoragePaths(other, EXPECTED)).toEqual([]);
    }
  });
});
