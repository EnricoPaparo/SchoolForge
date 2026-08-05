import { describe, expect, it, vi } from 'vitest';
import { importUdaStructure } from '../udaStructureImportRepository.js';
import type {
  UdaStructureImportContext,
  UdaStructureImportDeps,
} from '../udaStructureImportRepository.js';
import { computeManifestHash } from '../manifestHash.js';

/**
 * STRUCTURE-IMPORT-02A — il protocollo di append.
 *
 * Ogni porta è finta e registra l'ordine reale delle chiamate: quello che questi
 * test difendono non è solo l'esito, ma la **sequenza** — nessuna scrittura
 * prima che il preflight sia verde, hash prima del lease, cleanup limitato al
 * manifest del tentativo.
 */

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const VALID_FILE = utf8(`schema: schoolforge-uda-metadata/v1
udas:
  - titolo: Le reti
    descrizione: Una descrizione.
    competenze:
      - c1
    obiettivi:
      - o1
  - titolo: I protocolli
    competenze:
      - c2
    obiettivi:
      - o2
`);

const CONTEXT: UdaStructureImportContext = {
  ownerUid: 'owner-1',
  activeImportId: 'imp-1',
  existingUdas: [],
};

interface Harness {
  deps: UdaStructureImportDeps;
  calls: string[];
  uploaded: Array<{ path: string; content: string }>;
  cleanupArgs: Array<{ storagePaths: string[]; udaIds: string[]; requestId: string }>;
}

function harness(overrides: Partial<UdaStructureImportDeps> = {}): Harness {
  const calls: string[] = [];
  const uploaded: Array<{ path: string; content: string }> = [];
  const cleanupArgs: Harness['cleanupArgs'] = [];
  const track =
    <T extends unknown[], R>(name: string, fn: (...args: T) => Promise<R>) =>
    (...args: T): Promise<R> => {
      calls.push(name);
      return fn(...args);
    };

  const base: UdaStructureImportDeps = {
    loadContext: track('loadContext', async () => CONTEXT),
    hashCanonical: track('hashCanonical', (canonical) => computeManifestHash(canonical)),
    probeSourceAttempt: track('probeSourceAttempt', async () => ({ state: 'none' }) as const),
    probeAttempt: track('probeAttempt', async () => 'none' as const),
    preflight: track('preflight', async () => ({ collision: null })),
    acquireLease: track('acquireLease', async () => 'acquired' as const),
    renewLease: track('renewLease', async () => 'renewed' as const),
    uploadStorage: track('uploadStorage', async (files) => {
      uploaded.push(...files);
    }),
    commit: track('commit', async () => undefined),
    cleanup: track('cleanup', async ({ manifest, requestId }) => {
      cleanupArgs.push({
        storagePaths: manifest.storagePaths,
        udaIds: manifest.udaIds,
        requestId,
      });
      return 'done' as const;
    }),
  };

  const deps: UdaStructureImportDeps = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const name = key as keyof UdaStructureImportDeps;
    // Le sovrascritture restano tracciate come le porte predefinite.
    (deps as unknown as Record<string, unknown>)[name] = track(name, value as never);
  }
  return { deps, calls, uploaded, cleanupArgs };
}

const INPUT = {
  programId: 'prog-1',
  ownerUid: 'owner-1',
  requestId: 'req-1',
  bytes: VALID_FILE,
  filename: 'schoolforge-udas.yaml',
};

describe('append riuscito', () => {
  it('aggiunge tutte le UDA e restituisce il manifest applicato', async () => {
    const { deps } = harness();
    const result = await importUdaStructure(INPUT, deps);
    expect(result.status).toBe('committed');
    if (result.status !== 'committed') return;
    expect(result.udaCount).toBe(2);
    expect(result.titles).toEqual(['Le reti', 'I protocolli']);
    expect(result.udaIds).toEqual(['uda-01-le-reti', 'uda-02-i-protocolli']);
    expect(result.manifest.udas[0]!.doc.lessonCount).toBe(0);
  });

  it('rispetta l’ordine del protocollo: hash e preflight prima di qualunque scrittura', async () => {
    const { calls } = harness();
    await importUdaStructure(INPUT, harness().deps);
    const { deps, calls: seq } = harness();
    await importUdaStructure(INPUT, deps);
    expect(seq).toEqual([
      'loadContext',
      'hashCanonical',
      'probeSourceAttempt',
      'hashCanonical',
      'probeAttempt',
      'preflight',
      'acquireLease',
      'uploadStorage',
      'renewLease',
      'commit',
    ]);
    expect(calls).not.toContain('cleanup');
  });

  it('numerazione e order proseguono dopo le UDA esistenti', async () => {
    const { deps } = harness({
      loadContext: async () => ({
        ...CONTEXT,
        existingUdas: [{ udaId: 'uda-03-x', dir: 'uda-03-x', order: 2, titolo: 'X' }],
      }),
    });
    const result = await importUdaStructure(INPUT, deps);
    expect(result.status).toBe('committed');
    if (result.status !== 'committed') return;
    expect(result.manifest.udas.map((u) => u.dir)).toEqual([
      'uda-04-le-reti',
      'uda-05-i-protocolli',
    ]);
    expect(result.manifest.udas.map((u) => u.order)).toEqual([3, 4]);
  });

  it('carica esattamente i file del manifest, con corpo vuoto e nessun pool', async () => {
    const { deps, uploaded } = harness();
    const result = await importUdaStructure(INPUT, deps);
    expect(result.status).toBe('committed');
    if (result.status !== 'committed') return;
    expect(uploaded.map((f) => f.path)).toEqual(result.manifest.storagePaths);
    for (const file of uploaded) {
      expect(file.path).toMatch(/^repository\/owner-1\/imports\/imp-1\/uda-\d\d-/);
      expect(file.content.split('---')[2]!.trim()).toBe('');
      expect(file.content.toLowerCase()).not.toContain('pool');
    }
  });
});

describe('validazione locale: nessuna operazione Firebase', () => {
  it('un file non valido non tocca nessuna porta', async () => {
    const { deps, calls } = harness();
    const result = await importUdaStructure({ ...INPUT, bytes: utf8('schema: altro\n') }, deps);
    expect(result.status).toBe('validation_failed');
    expect(calls).toEqual([]);
  });

  it('UTF-8 non valido è rifiutato prima di tutto', async () => {
    const { deps, calls } = harness();
    const result = await importUdaStructure(
      { ...INPUT, bytes: new Uint8Array([0xc3, 0x28]) },
      deps,
    );
    expect(result.status).toBe('validation_failed');
    if (result.status === 'validation_failed') {
      expect(result.error.code).toBe('invalid_encoding');
    }
    expect(calls).toEqual([]);
  });

  it('un titolo già presente nella destinazione blocca dopo la lettura, prima delle scritture', async () => {
    const { deps, calls } = harness({
      loadContext: async () => ({
        ...CONTEXT,
        existingUdas: [{ udaId: 'x', dir: 'uda-01-x', order: 0, titolo: '  LE RETI ' }],
      }),
    });
    const result = await importUdaStructure(INPUT, deps);
    expect(result.status).toBe('validation_failed');
    if (result.status === 'validation_failed') {
      expect(result.error.code).toBe('duplicate_title_in_destination');
    }
    // Il planner arriva dopo l'identità di sorgente e la sua sonda: nessuna
    // scrittura, ma la sonda è già stata interrogata.
    expect(calls).toEqual(['loadContext', 'hashCanonical', 'probeSourceAttempt']);
  });

  it('senza import attivo non scrive nulla', async () => {
    const { deps, calls } = harness({ loadContext: async () => null });
    const result = await importUdaStructure(INPUT, deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('no_active_import');
    expect(calls).toEqual(['loadContext']);
  });
});

describe('hash indisponibile', () => {
  it('fallisce chiuso prima di lease, upload e commit', async () => {
    const { deps, calls } = harness({
      hashCanonical: async () => {
        throw new Error('Web Crypto non disponibile.');
      },
    });
    const result = await importUdaStructure(INPUT, deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('hash_unavailable');
    expect(calls).toEqual(['loadContext', 'hashCanonical']);
  });
});

describe('idempotenza', () => {
  it('stesso requestId e stesso hash: replay senza riscrivere nulla', async () => {
    const { deps, calls } = harness({
      probeSourceAttempt: async () =>
        ({
          state: 'committed',
          documentIds: ['uda-01-le-reti', 'uda-02-i-protocolli'],
          publicLessonIds: [],
        }) as const,
    });
    const result = await importUdaStructure(INPUT, deps);
    expect(result.status).toBe('committed_replay');
    if (result.status === 'committed_replay') {
      expect(result.udaCount).toBe(2);
      expect(result.requiresReload).toBe(true);
    }
    expect(calls).not.toContain('acquireLease');
    expect(calls).not.toContain('uploadStorage');
    expect(calls).not.toContain('commit');
  });

  it('stesso requestId e hash diverso: fail-closed, zero scritture', async () => {
    const { deps, calls } = harness({
      probeSourceAttempt: async () => ({ state: 'conflict' }) as const,
    });
    const result = await importUdaStructure(INPUT, deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('conflict');
    expect(calls).not.toContain('acquireLease');
    expect(calls).not.toContain('commit');
  });

  it('l’hash passato alle porte è lo stesso ovunque, e vale 64 esadecimali', async () => {
    const seen: string[] = [];
    const { deps } = harness({
      probeAttempt: async ({ manifestHash }: { manifestHash: string }) => {
        seen.push(manifestHash);
        return 'none' as const;
      },
      acquireLease: async ({ manifestHash }: { manifestHash: string }) => {
        seen.push(manifestHash);
        return 'acquired' as const;
      },
      commit: async ({ manifestHash }: { manifestHash: string }) => {
        seen.push(manifestHash);
      },
    });
    await importUdaStructure(INPUT, deps);
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('collisioni e concorrenza', () => {
  it('una collisione blocca tutto: nessun lease, nessun upload, nessun commit', async () => {
    const { deps, calls } = harness({
      preflight: async () => ({ collision: { kind: 'uda' as const, id: 'uda-01-le-reti' } }),
    });
    const result = await importUdaStructure(INPUT, deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('collision');
    expect(calls).toEqual([
      'loadContext',
      'hashCanonical',
      'probeSourceAttempt',
      'hashCanonical',
      'probeAttempt',
      'preflight',
    ]);
  });

  it('una collisione Storage blocca allo stesso modo', async () => {
    const { deps, calls } = harness({
      preflight: async () => ({ collision: { kind: 'storage' as const, id: 'repository/x' } }),
    });
    const result = await importUdaStructure(INPUT, deps);
    expect(result.status).toBe('not_applied');
    expect(calls).not.toContain('uploadStorage');
  });

  it('il messaggio di collisione non espone id, path o UID', async () => {
    const { deps } = harness({
      preflight: async () => ({
        collision: { kind: 'storage' as const, id: 'repository/owner-1/imports/imp-1/uda-01-x.md' },
      }),
    });
    const result = await importUdaStructure(INPUT, deps);
    if (result.status !== 'not_applied') throw new Error('atteso not_applied');
    expect(result.message).not.toContain('repository/');
    expect(result.message).not.toContain('owner-1');
  });

  it('un lease già preso ferma il tentativo senza cleanup del lease altrui', async () => {
    const { deps, calls } = harness({ acquireLease: async () => 'busy' as const });
    const result = await importUdaStructure(INPUT, deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('busy');
    expect(calls).not.toContain('cleanup');
    expect(calls).not.toContain('uploadStorage');
  });
});

describe('errori dopo il lease: cleanup limitato al manifest', () => {
  it('errore di upload: cleanup dei soli path del tentativo', async () => {
    const { deps, cleanupArgs } = harness({
      uploadStorage: async () => {
        throw new Error('rete');
      },
    });
    const result = await importUdaStructure(INPUT, deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('upload_failed');
    expect(cleanupArgs).toHaveLength(1);
    expect(cleanupArgs[0]!.requestId).toBe('req-1');
    expect(cleanupArgs[0]!.storagePaths).toEqual([
      'repository/owner-1/imports/imp-1/uda-01-le-reti/uda-01-le-reti.md',
      'repository/owner-1/imports/imp-1/uda-02-i-protocolli/uda-02-i-protocolli.md',
    ]);
    expect(cleanupArgs[0]!.udaIds).toEqual(['uda-01-le-reti', 'uda-02-i-protocolli']);
  });

  it('errore di commit: cleanup e corso invariato', async () => {
    const { deps, cleanupArgs, calls } = harness({
      commit: async () => {
        throw new Error('transaction');
      },
    });
    const result = await importUdaStructure(INPUT, deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') {
      expect(result.reason).toBe('commit_failed');
      expect(result.message).toContain('invariato');
    }
    expect(cleanupArgs).toHaveLength(1);
    expect(calls.filter((c) => c === 'cleanup')).toHaveLength(1);
  });

  it('cleanup incompleto: stato dedicato e recuperabile, non un successo', async () => {
    const { deps } = harness({
      commit: async () => {
        throw new Error('transaction');
      },
      cleanup: async () => 'pending' as const,
    });
    const result = await importUdaStructure(INPUT, deps);
    expect(result.status).toBe('cleanup_pending');
  });

  it('il retry riusa lo stesso requestId e non duplica nulla', async () => {
    // Primo tentativo: commit fallito, cleanup eseguito.
    const first = harness({
      commit: async () => {
        throw new Error('transaction');
      },
    });
    await importUdaStructure(INPUT, first.deps);
    // Secondo tentativo con lo stesso requestId: nessun attempt committed, il
    // protocollo riparte da capo e committa una sola volta.
    const commit = vi.fn(async () => undefined);
    const second = harness({ commit });
    const result = await importUdaStructure(INPUT, second.deps);
    expect(result.status).toBe('committed');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(second.cleanupArgs).toHaveLength(0);
  });
});

describe('ciò che l’import non fa mai', () => {
  it('non pianifica lezioni, proiezioni pubbliche o pool', async () => {
    const { deps } = harness();
    const result = await importUdaStructure(INPUT, deps);
    if (result.status !== 'committed') throw new Error('atteso committed');
    const serialized = JSON.stringify(result.manifest);
    expect(serialized).not.toContain('publicLesson');
    expect(serialized).not.toContain('poolStatus');
    expect(serialized).not.toContain('lezione-');
    expect(result.manifest.kind).toBe('uda');
  });

  it('nessuna UDA esistente compare fra i documenti scritti', async () => {
    const { deps } = harness({
      loadContext: async () => ({
        ...CONTEXT,
        existingUdas: [
          { udaId: 'uda-01-esistente', dir: 'uda-01-esistente', order: 0, titolo: 'E' },
        ],
      }),
    });
    const result = await importUdaStructure(INPUT, deps);
    if (result.status !== 'committed') throw new Error('atteso committed');
    expect(result.manifest.udaIds).not.toContain('uda-01-esistente');
    expect(result.manifest.storagePaths.every((p) => !p.includes('uda-01-esistente'))).toBe(true);
  });
});
