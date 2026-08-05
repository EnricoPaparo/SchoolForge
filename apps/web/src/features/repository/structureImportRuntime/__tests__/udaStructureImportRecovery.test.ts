import { describe, expect, it } from 'vitest';
import { importUdaStructure } from '../udaStructureImportRepository.js';
import type {
  UdaStructureImportContext,
  UdaStructureImportDeps,
} from '../udaStructureImportRepository.js';
import { computeManifestHash } from '../manifestHash.js';
import { checkCommitPreconditions, classifyAttempt, mayCleanupAttempt } from '../attemptState.js';
import type { AttemptExpectation, AttemptRecord, LeaseRecord } from '../attemptState.js';

/**
 * STRUCTURE-IMPORT-02A — recovery e concorrenza, contro un backend finto ma
 * **fedele**: lease con scadenza reale, record del tentativo, insieme dei file
 * su Storage, documenti UDA, contatore e audit. Le porte finte applicano le
 * stesse guardie del codice Firestore (`attemptState`), così una sequenza come
 * «upload parziale → cleanup fallito → retry» viene eseguita davvero e non
 * simulata a parole.
 */

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const FILE = utf8(`schema: schoolforge-uda-metadata/v1
udas:
  - titolo: Le reti
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

const LEASE_TTL = 5 * 60 * 1000;

interface Backend {
  deps: UdaStructureImportDeps;
  /** Mutable world state, inspected by the assertions. */
  state: {
    now: number;
    ownerUid: string;
    activeImportId: string;
    udas: Map<string, Record<string, unknown>>;
    storage: Map<string, string>;
    lease: LeaseRecord | null;
    attempts: Map<string, AttemptRecord>;
    udaCount: number;
    audit: number;
  };
  /** Failure injection for a single call. */
  fail: {
    uploadAfter?: number;
    commit?: boolean;
    cleanupStorage?: boolean;
  };
  calls: string[];
}

function backend(): Backend {
  const state: Backend['state'] = {
    now: 1_000_000,
    ownerUid: 'owner-1',
    activeImportId: 'imp-1',
    udas: new Map(),
    storage: new Map(),
    lease: null,
    attempts: new Map(),
    udaCount: 0,
    audit: 0,
  };
  const fail: Backend['fail'] = {};
  const calls: string[] = [];

  const expectationOf = (
    requestId: string,
    manifestHash: string,
    manifest: { udaIds: string[]; storagePaths: string[] },
  ): AttemptExpectation => ({
    requestId,
    manifestHash,
    kind: 'uda' as const,
    udaId: null,
    documentIds: manifest.udaIds,
    publicLessonIds: [],
    storagePaths: manifest.storagePaths,
  });

  const deps: UdaStructureImportDeps = {
    async loadContext(): Promise<UdaStructureImportContext | null> {
      calls.push('loadContext');
      return {
        ownerUid: state.ownerUid,
        activeImportId: state.activeImportId,
        existingUdas: [...state.udas.entries()].map(([id, data]) => ({
          udaId: id,
          dir: data['dir'] as string,
          order: data['order'] as number,
          titolo: (data['titolo'] as string) ?? null,
        })),
      };
    },

    hashManifest: (canonical) => computeManifestHash(canonical),

    async probeAttempt({ requestId, manifestHash, manifest }) {
      calls.push('probeAttempt');
      return classifyAttempt(
        state.attempts.get(requestId) ?? null,
        expectationOf(requestId, manifestHash, manifest),
      );
    },

    async preflight({ manifest, ownedStoragePaths }) {
      calls.push('preflight');
      for (const id of manifest.udaIds) {
        if (state.udas.has(id)) return { collision: { kind: 'uda' as const, id } };
      }
      const owned = new Set(ownedStoragePaths);
      for (const path of manifest.storagePaths) {
        if (!owned.has(path) && state.storage.has(path)) {
          return { collision: { kind: 'storage' as const, id: path } };
        }
      }
      return { collision: null };
    },

    async acquireLease({ requestId, manifestHash }) {
      calls.push('acquireLease');
      const lease = state.lease;
      if (
        lease &&
        lease.requestId !== requestId &&
        typeof lease.expiresAt === 'number' &&
        lease.expiresAt > state.now
      ) {
        return 'busy';
      }
      state.lease = { requestId, manifestHash, expiresAt: state.now + LEASE_TTL };
      const existing = state.attempts.get(requestId);
      // `merge: true` semantics — a resume keeps the same record.
      state.attempts.set(requestId, { ...(existing ?? {}), status: 'reserved' });
      return 'acquired';
    },

    async uploadStorage(files) {
      calls.push('uploadStorage');
      for (const [index, file] of files.entries()) {
        if (fail.uploadAfter !== undefined && index >= fail.uploadAfter) {
          throw new Error('rete interrotta');
        }
        state.storage.set(file.path, file.content);
      }
    },

    async renewLease({ requestId, manifestHash }) {
      calls.push('renewLease');
      const lease = state.lease;
      if (!lease || lease.requestId !== requestId || lease.manifestHash !== manifestHash) {
        return 'lost';
      }
      state.lease = { requestId, manifestHash, expiresAt: state.now + LEASE_TTL };
      return 'renewed';
    },

    async commit({ manifest, requestId, manifestHash }) {
      calls.push('commit');
      if (fail.commit) throw new Error('transazione fallita');
      const failure = checkCommitPreconditions({
        lease: state.lease,
        attempt: state.attempts.get(requestId) ?? null,
        expected: expectationOf(requestId, manifestHash, manifest),
        now: state.now,
      });
      if (failure) throw new Error(failure);
      if (manifest.udas.some((uda) => state.udas.has(uda.udaId))) throw new Error('uda_collision');

      for (const planned of manifest.udas) {
        state.udas.set(planned.udaId, { ...planned.doc, sourceRequestId: requestId });
      }
      state.udaCount += manifest.udas.length;
      state.lease = null;
      state.attempts.set(requestId, {
        ...(state.attempts.get(requestId) ?? {}),
        status: 'committed',
      });
      state.audit += 1;
    },

    async cleanup({ manifest, requestId, manifestHash }) {
      calls.push('cleanup');
      const expected = expectationOf(requestId, manifestHash, manifest);
      if (!mayCleanupAttempt(state.attempts.get(requestId) ?? null, expected)) return 'done';
      if (fail.cleanupStorage) return 'pending';
      for (const path of manifest.storagePaths) state.storage.delete(path);
      if (state.lease?.requestId === requestId) state.lease = null;
      state.attempts.delete(requestId);
      return 'done';
    },
  };

  // The lease/attempt writes must carry the manifest data the guards check.
  const wrapped: UdaStructureImportDeps = {
    ...deps,
    async acquireLease(params) {
      const outcome = await deps.acquireLease(params);
      if (outcome === 'acquired') {
        state.attempts.set(params.requestId, {
          requestId: params.requestId,
          manifestHash: params.manifestHash,
          kind: 'uda',
          status: 'reserved',
          documentIds: [...params.manifest.udaIds],
          storagePaths: [...params.manifest.storagePaths],
        });
      }
      return outcome;
    },
  };

  return { deps: wrapped, state, fail, calls };
}

const INPUT = {
  programId: 'prog-1',
  ownerUid: 'owner-1',
  requestId: 'req-1',
  bytes: FILE,
  filename: 'schoolforge-udas.yaml',
};

describe('recovery dopo cleanup_pending', () => {
  it('upload parziale + cleanup fallito + retry: il retry completa davvero', async () => {
    const b = backend();
    b.fail.uploadAfter = 1; // il primo file passa, il secondo no
    b.fail.cleanupStorage = true;

    const first = await importUdaStructure(INPUT, b.deps);
    expect(first.status).toBe('cleanup_pending');
    expect(b.state.storage.size).toBe(1);
    expect(b.state.udas.size).toBe(0);
    expect(b.state.attempts.has('req-1')).toBe(true);

    // Retry con lo stesso requestId e lo stesso file.
    delete b.fail.uploadAfter;
    delete b.fail.cleanupStorage;
    b.calls.length = 0;
    const second = await importUdaStructure(INPUT, b.deps);

    expect(second.status).toBe('committed');
    // Il file già caricato non è stato scambiato per una collisione estranea.
    expect(b.calls).toContain('preflight');
    expect(b.state.udas.size).toBe(2);
    expect(b.state.storage.size).toBe(2);
    expect(b.state.udaCount).toBe(2);
    expect(b.state.audit).toBe(1);
    expect(b.state.lease).toBeNull();
  });

  it('tutti i file caricati + commit fallito + cleanup fallito + retry riuscito', async () => {
    const b = backend();
    b.fail.commit = true;
    b.fail.cleanupStorage = true;

    const first = await importUdaStructure(INPUT, b.deps);
    expect(first.status).toBe('cleanup_pending');
    expect(b.state.storage.size).toBe(2);
    expect(b.state.udas.size).toBe(0);

    delete b.fail.commit;
    delete b.fail.cleanupStorage;
    const second = await importUdaStructure(INPUT, b.deps);
    expect(second.status).toBe('committed');
    expect(b.state.udas.size).toBe(2);
    expect(b.state.udaCount).toBe(2);
    expect(b.state.audit).toBe(1);
  });

  it('un retry dopo un commit riuscito non duplica UDA, conteggi, audit o file', async () => {
    const b = backend();
    await importUdaStructure(INPUT, b.deps);
    const afterFirst = {
      udas: b.state.udas.size,
      count: b.state.udaCount,
      audit: b.state.audit,
      files: b.state.storage.size,
    };

    // Stesso requestId e stesso file, ma le UDA ora esistono davvero: il piano
    // si ferma sui titoli già presenti, prima ancora della sonda del tentativo.
    // È fail-closed e non duplica nulla; il prezzo è un messaggio che parla di
    // titoli anziché di «già importato» (limite noto, documentato in roadmap).
    const replay = await importUdaStructure(INPUT, b.deps);
    expect(replay.status).toBe('validation_failed');
    if (replay.status === 'validation_failed') {
      expect(replay.error.code).toBe('duplicate_title_in_destination');
    }
    expect(b.state.udas.size).toBe(afterFirst.udas);
    expect(b.state.udaCount).toBe(afterFirst.count);
    expect(b.state.audit).toBe(afterFirst.audit);
    expect(b.state.storage.size).toBe(afterFirst.files);
  });

  it('il replay vero — commit riuscito ma esito perso — non riscrive nulla', async () => {
    // Il caso in cui la sonda serve davvero: il commit è avvenuto, la risposta
    // si è persa, e il retry parte prima che l'albero locale lo sappia. Qui le
    // UDA committate sono ancora invisibili alla lettura del contesto.
    const b = backend();
    const deps: UdaStructureImportDeps = {
      ...b.deps,
      // Contesto «vecchio»: non vede ancora le UDA appena committate.
      loadContext: async () => ({
        ownerUid: b.state.ownerUid,
        activeImportId: b.state.activeImportId,
        existingUdas: [],
      }),
    };
    await importUdaStructure(INPUT, deps);
    const before = { udas: b.state.udas.size, audit: b.state.audit, count: b.state.udaCount };

    const replay = await importUdaStructure(INPUT, deps);
    expect(replay.status).toBe('committed');
    expect(b.state.udas.size).toBe(before.udas);
    expect(b.state.audit).toBe(before.audit);
    expect(b.state.udaCount).toBe(before.count);
    // Nessuna seconda prenotazione né secondo upload.
    expect(b.calls.filter((c) => c === 'acquireLease')).toHaveLength(1);
    expect(b.calls.filter((c) => c === 'commit')).toHaveLength(1);
  });

  it('un record riprendibile con path divergenti fallisce chiuso e non viene riparato', async () => {
    const b = backend();
    b.state.attempts.set('req-1', {
      requestId: 'req-1',
      manifestHash: 'non-verrà-usato',
      kind: 'uda',
      status: 'reserved',
      documentIds: ['uda-99-altro'],
      storagePaths: ['repository/owner-1/imports/imp-1/uda-99-altro/uda-99-altro.md'],
    });
    const result = await importUdaStructure(INPUT, b.deps);
    // Hash diverso ⇒ conflitto; il record resta intatto.
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('conflict');
    expect(b.state.attempts.get('req-1')!['documentIds']).toEqual(['uda-99-altro']);
    expect(b.state.udas.size).toBe(0);
  });

  it('un record malformato blocca senza essere sovrascritto', async () => {
    const b = backend();
    b.state.attempts.set('req-1', { requestId: 'req-1', status: 'reserved' });
    const result = await importUdaStructure(INPUT, b.deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('incoherent_attempt');
    expect(b.state.attempts.get('req-1')).toEqual({ requestId: 'req-1', status: 'reserved' });
    expect(b.state.udas.size).toBe(0);
  });

  it('un file preesistente non appartenente al tentativo resta una collisione', async () => {
    const b = backend();
    b.state.storage.set(
      'repository/owner-1/imports/imp-1/uda-01-le-reti/uda-01-le-reti.md',
      'contenuto di qualcun altro',
    );
    const result = await importUdaStructure(INPUT, b.deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('collision');
    expect(
      b.state.storage.get('repository/owner-1/imports/imp-1/uda-01-le-reti/uda-01-le-reti.md'),
    ).toBe('contenuto di qualcun altro');
    expect(b.state.udas.size).toBe(0);
  });

  it('un cleanup vecchio non tocca il tentativo che lo ha sostituito', async () => {
    const b = backend();
    // Un tentativo diverso ha preso il posto: stesso requestId, altro piano.
    b.state.attempts.set('req-1', {
      requestId: 'req-1',
      manifestHash: 'c'.repeat(64),
      kind: 'uda',
      status: 'reserved',
      documentIds: ['uda-07-altro'],
      storagePaths: ['repository/owner-1/imports/imp-1/uda-07-altro/uda-07-altro.md'],
    });
    b.state.storage.set('repository/owner-1/imports/imp-1/uda-07-altro/uda-07-altro.md', 'x');
    b.state.lease = { requestId: 'req-1', manifestHash: 'c'.repeat(64), expiresAt: 9e15 };

    const outcome = await b.deps.cleanup({
      programId: 'prog-1',
      activeImportId: 'imp-1',
      requestId: 'req-1',
      manifestHash: 'a'.repeat(64),
      manifest: {
        kind: 'uda',
        ownerUid: 'owner-1',
        programId: 'prog-1',
        importId: 'imp-1',
        udas: [],
        udaIds: ['uda-01-le-reti'],
        storagePaths: ['repository/owner-1/imports/imp-1/uda-01-le-reti/uda-01-le-reti.md'],
        manifestCanonical: 'x',
      },
    });

    expect(outcome).toBe('done');
    expect(b.state.attempts.has('req-1')).toBe(true);
    expect(b.state.storage.size).toBe(1);
    expect(b.state.lease).not.toBeNull();
  });

  it('un tentativo committato non viene mai ripulito', async () => {
    const b = backend();
    await importUdaStructure(INPUT, b.deps);
    const files = b.state.storage.size;
    const outcome = await b.deps.cleanup({
      programId: 'prog-1',
      activeImportId: 'imp-1',
      requestId: 'req-1',
      manifestHash: 'a'.repeat(64),
      manifest: {
        kind: 'uda',
        ownerUid: 'owner-1',
        programId: 'prog-1',
        importId: 'imp-1',
        udas: [],
        udaIds: [],
        storagePaths: [...b.state.storage.keys()],
        manifestCanonical: 'x',
      },
    });
    expect(outcome).toBe('done');
    expect(b.state.storage.size).toBe(files);
    expect(b.state.udas.size).toBe(2);
  });
});

describe('race: lease scaduta durante un tentativo lento', () => {
  it('A pianifica, la sua lease scade, B aggiunge un’UDA, A non può committare', async () => {
    const b = backend();

    // 1–2. A prenota e carica, poi la sua lease scade: il rinnovo prima del
    // commit è l'unica difesa, e qui viene neutralizzato come lo sarebbe da una
    // presa di possesso concorrente.
    let renewals = 0;
    const deps: UdaStructureImportDeps = {
      ...b.deps,
      async renewLease(params) {
        renewals += 1;
        // La lease è scaduta e nel frattempo è stata presa da un altro attore.
        b.state.now += LEASE_TTL + 1;
        b.state.lease = {
          requestId: 'req-altro',
          manifestHash: 'z'.repeat(64),
          expiresAt: b.state.now + LEASE_TTL,
        };
        return b.deps.renewLease(params);
      },
    };

    // 3. Nel frattempo B ha aggiunto un'UDA con id diverso ma stesso numero e
    // stesso `order` che A aveva pianificato.
    const result = await importUdaStructure(INPUT, deps).then(async (first) => {
      b.state.udas.set('uda-01-altra', { dir: 'uda-01-altra', order: 0, titolo: 'Altra' });
      return first;
    });

    // 4–5. A fallisce con zero UdaDoc scritte.
    expect(renewals).toBe(1);
    expect(result.status === 'not_applied' || result.status === 'cleanup_pending').toBe(true);
    if (result.status === 'not_applied') expect(result.reason).toBe('lease_lost');
    expect([...b.state.udas.keys()]).toEqual(['uda-01-altra']);
    expect(b.state.udaCount).toBe(0);
    expect(b.state.audit).toBe(0);
  });

  it('anche saltando il rinnovo, il commit rifiuta una lease scaduta', async () => {
    const b = backend();
    const deps: UdaStructureImportDeps = {
      ...b.deps,
      // Rinnovo «riuscito» ma il tempo avanza comunque oltre la scadenza: è il
      // commit a dover dire di no.
      async renewLease() {
        b.state.now += LEASE_TTL * 2;
        return 'renewed';
      },
    };
    const result = await importUdaStructure(INPUT, deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('commit_failed');
    expect(b.state.udas.size).toBe(0);
    expect(b.state.udaCount).toBe(0);
    expect(b.state.audit).toBe(0);
  });

  it('una lease di un altro tentativo blocca la prenotazione', async () => {
    const b = backend();
    b.state.lease = {
      requestId: 'req-altro',
      manifestHash: 'z'.repeat(64),
      expiresAt: b.state.now + LEASE_TTL,
    };
    const result = await importUdaStructure(INPUT, b.deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('busy');
    expect(b.state.udas.size).toBe(0);
  });
});

describe('owner autorevole', () => {
  it('un owner contraffatto dal client non produce alcun effetto', async () => {
    const b = backend();
    const result = await importUdaStructure({ ...INPUT, ownerUid: 'altro-utente' }, b.deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('owner_mismatch');
    // Nessun hash, nessun preflight, nessuna scrittura: si ferma subito dopo la
    // lettura autorevole.
    expect(b.calls).toEqual(['loadContext']);
    expect(b.state.udas.size).toBe(0);
    expect(b.state.storage.size).toBe(0);
    expect(b.state.lease).toBeNull();
    expect(b.state.attempts.size).toBe(0);
  });

  it('i path e l’audit derivano dall’owner del programma, non dall’input', async () => {
    const b = backend();
    b.state.ownerUid = 'owner-reale';
    const result = await importUdaStructure({ ...INPUT, ownerUid: 'owner-reale' }, b.deps);
    expect(result.status).toBe('committed');
    if (result.status !== 'committed') return;
    expect(result.manifest.ownerUid).toBe('owner-reale');
    for (const path of result.manifest.storagePaths) {
      expect(path.startsWith('repository/owner-reale/')).toBe(true);
    }
  });
});
