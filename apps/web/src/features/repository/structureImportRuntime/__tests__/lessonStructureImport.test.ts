import { describe, expect, it } from 'vitest';
import { importLessonStructure } from '../lessonStructureImportRepository.js';
import type {
  LessonStructureImportContext,
  LessonStructureImportDeps,
} from '../lessonStructureImportRepository.js';
import { computeManifestHash } from '../manifestHash.js';
import {
  checkCommitPreconditions,
  classifyAttempt,
  classifySourceAttempt,
  mayCleanupAttempt,
} from '../attemptState.js';
import type { AttemptExpectation, AttemptRecord, LeaseRecord } from '../attemptState.js';

/**
 * STRUCTURE-IMPORT-02B — append di lezioni contro un backend finto ma fedele:
 * lease **per UDA** con scadenza reale, record del tentativo, file su Storage,
 * `LessonDoc`, proiezioni `publicLessons`, `lessonCount` e audit. Le porte
 * applicano le stesse guardie del codice Firestore (`attemptState`), così
 * recovery, race e replay vengono eseguiti davvero.
 */

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const FILE = utf8(`schema: schoolforge-lesson-metadata/v1
lessons:
  - titolo: Che cos'è una rete
    sottotitolo: Dispositivi e comunicazione
    difficolta: introduttiva
    concettiChiave:
      - nodo
    obiettivi:
      - Definire una rete
  - titolo: Indirizzi IP
    difficolta: intermedia
    concettiChiave:
      - indirizzo IP
    obiettivi:
      - Comprendere l'indirizzo IP
`);

const LEASE_TTL = 5 * 60 * 1000;

interface Backend {
  deps: LessonStructureImportDeps;
  state: {
    now: number;
    ownerUid: string;
    activeImportId: string;
    udaId: string;
    udaDir: string;
    lessons: Map<string, Record<string, unknown>>;
    publicLessons: Map<string, Record<string, unknown>>;
    storage: Map<string, string>;
    /** Lease per UDA: la chiave è l'id della UDA. */
    leases: Map<string, LeaseRecord>;
    attempts: Map<string, AttemptRecord>;
    lessonCount: number;
    audit: number;
  };
  fail: { uploadAfter?: number; commit?: boolean; cleanupStorage?: boolean };
  calls: string[];
}

function backend(): Backend {
  const state: Backend['state'] = {
    now: 1_000_000,
    ownerUid: 'owner-1',
    activeImportId: 'imp-1',
    udaId: 'uda-01-reti',
    udaDir: 'uda-01-reti',
    lessons: new Map(),
    publicLessons: new Map(),
    storage: new Map(),
    leases: new Map(),
    attempts: new Map(),
    lessonCount: 0,
    audit: 0,
  };
  const fail: Backend['fail'] = {};
  const calls: string[] = [];

  const expectationOf = (
    requestId: string,
    manifestHash: string,
    manifest: {
      udaId: string;
      lessonIds: string[];
      publicLessonIds: string[];
      storagePaths: string[];
    },
  ): AttemptExpectation => ({
    requestId,
    sourceHash: state.attempts.get(requestId)?.sourceHash as string,
    programId: 'prog-1',
    importId: state.activeImportId,
    manifestHash,
    kind: 'lesson',
    udaId: manifest.udaId,
    documentIds: manifest.lessonIds,
    publicLessonIds: manifest.publicLessonIds,
    storagePaths: manifest.storagePaths,
  });

  const deps: LessonStructureImportDeps = {
    async loadContext({ udaId }): Promise<LessonStructureImportContext | null> {
      calls.push('loadContext');
      if (udaId !== state.udaId) return null;
      return {
        ownerUid: state.ownerUid,
        activeImportId: state.activeImportId,
        udaId: state.udaId,
        udaDir: state.udaDir,
        udaTitle: 'Le reti',
        existingLessons: [...state.lessons.entries()].map(([id, data]) => ({
          lessonId: id,
          filename: data['filename'] as string,
          order: data['order'] as number,
          titolo: (data['titolo'] as string) ?? null,
        })),
      };
    },

    hashCanonical: (canonical) => computeManifestHash(canonical),

    async probeSourceAttempt({ requestId, sourceHash }) {
      calls.push('probeSourceAttempt');
      return classifySourceAttempt(state.attempts.get(requestId) ?? null, {
        requestId,
        sourceHash,
        kind: 'lesson',
        programId: 'prog-1',
        importId: state.activeImportId,
        udaId: state.udaId,
      });
    },

    async probeAttempt({ requestId, manifestHash, manifest }) {
      calls.push('probeAttempt');
      return classifyAttempt(
        state.attempts.get(requestId) ?? null,
        expectationOf(requestId, manifestHash, manifest),
      );
    },

    async preflight({ manifest, ownedStoragePaths }) {
      calls.push('preflight');
      for (const id of manifest.lessonIds) {
        if (state.lessons.has(id)) return { collision: { kind: 'lesson' as const, id } };
      }
      for (const id of manifest.publicLessonIds) {
        if (state.publicLessons.has(id)) {
          return { collision: { kind: 'publicLesson' as const, id } };
        }
      }
      const owned = new Set(ownedStoragePaths);
      for (const path of manifest.storagePaths) {
        if (!owned.has(path) && state.storage.has(path)) {
          return { collision: { kind: 'storage' as const, id: path } };
        }
      }
      return { collision: null };
    },

    async acquireLease({ udaId, requestId, manifestHash, sourceHash, manifest }) {
      calls.push('acquireLease');
      const lease = state.leases.get(udaId);
      if (
        lease &&
        lease.requestId !== requestId &&
        typeof lease.expiresAt === 'number' &&
        lease.expiresAt > state.now
      ) {
        return 'busy';
      }
      state.leases.set(udaId, { requestId, manifestHash, expiresAt: state.now + LEASE_TTL });
      state.attempts.set(requestId, {
        requestId,
        sourceHash,
        programId: 'prog-1',
        importId: state.activeImportId,
        manifestHash,
        kind: 'lesson',
        udaId,
        documentIds: [...manifest.lessonIds],
        publicLessonIds: [...manifest.publicLessonIds],
        storagePaths: [...manifest.storagePaths],
        status: 'reserved',
      });
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

    async renewLease({ udaId, requestId, manifestHash }) {
      calls.push('renewLease');
      const lease = state.leases.get(udaId);
      if (!lease || lease.requestId !== requestId || lease.manifestHash !== manifestHash) {
        return 'lost';
      }
      state.leases.set(udaId, { requestId, manifestHash, expiresAt: state.now + LEASE_TTL });
      return 'renewed';
    },

    async commit({ manifest, requestId, manifestHash }) {
      calls.push('commit');
      if (fail.commit) throw new Error('transazione fallita');
      const failure = checkCommitPreconditions({
        lease: state.leases.get(manifest.udaId) ?? null,
        attempt: state.attempts.get(requestId) ?? null,
        expected: expectationOf(requestId, manifestHash, manifest),
        now: state.now,
      });
      if (failure) throw new Error(failure);
      if (
        manifest.lessons.some(
          (lesson) =>
            state.lessons.has(lesson.lessonId) || state.publicLessons.has(lesson.publicLessonId),
        )
      ) {
        throw new Error('lesson_collision');
      }

      for (const planned of manifest.lessons) {
        state.lessons.set(planned.lessonId, { ...planned.doc, sourceRequestId: requestId });
        state.publicLessons.set(planned.publicLessonId, { ...planned.publicLesson });
      }
      state.lessonCount += manifest.lessonCountIncrement;
      state.leases.delete(manifest.udaId);
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
      if (state.leases.get(manifest.udaId)?.requestId === requestId) {
        state.leases.delete(manifest.udaId);
      }
      state.attempts.delete(requestId);
      return 'done';
    },
  };

  return { deps, state, fail, calls };
}

const INPUT = {
  programId: 'prog-1',
  udaId: 'uda-01-reti',
  ownerUid: 'owner-1',
  requestId: 'req-1',
  bytes: FILE,
  filename: 'schoolforge-lezioni.yaml',
};

describe('append nella UDA corretta', () => {
  it('aggiunge le lezioni e restituisce il manifest applicato', async () => {
    const b = backend();
    const result = await importLessonStructure(INPUT, b.deps);
    expect(result.status).toBe('committed');
    if (result.status !== 'committed') return;
    expect(result.lessonCount).toBe(2);
    expect(result.titles).toEqual(["Che cos'è una rete", 'Indirizzi IP']);
    expect(result.manifest.udaId).toBe('uda-01-reti');
    expect(b.state.lessons.size).toBe(2);
    expect(b.state.publicLessons.size).toBe(2);
    expect(b.state.lessonCount).toBe(2);
    expect(b.state.audit).toBe(1);
  });

  it('rispetta l’ordine del protocollo condiviso', async () => {
    const b = backend();
    await importLessonStructure(INPUT, b.deps);
    expect(b.calls).toEqual([
      'loadContext',
      'probeSourceAttempt',
      'probeAttempt',
      'preflight',
      'acquireLease',
      'uploadStorage',
      'renewLease',
      'commit',
    ]);
  });

  it('numerazione e order proseguono dopo le lezioni esistenti', async () => {
    const b = backend();
    b.state.lessons.set('vecchia', {
      filename: 'lezione-004-a.md',
      order: 3,
      titolo: 'Vecchia',
    });
    const result = await importLessonStructure(INPUT, b.deps);
    expect(result.status).toBe('committed');
    if (result.status !== 'committed') return;
    expect(result.manifest.lessons.map((l) => l.filename)).toEqual([
      'lezione-005-che-cos-e-una-rete.md',
      'lezione-006-indirizzi-ip.md',
    ]);
    expect(result.manifest.lessons.map((l) => l.order)).toEqual([4, 5]);
  });

  it('una UDA inesistente o non più coerente ferma tutto', async () => {
    const b = backend();
    const result = await importLessonStructure({ ...INPUT, udaId: 'uda-99-altra' }, b.deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('no_destination');
    expect(b.calls).toEqual(['loadContext']);
  });

  it('un owner contraffatto non produce alcun effetto', async () => {
    const b = backend();
    const result = await importLessonStructure({ ...INPUT, ownerUid: 'altro' }, b.deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('owner_mismatch');
    expect(b.calls).toEqual(['loadContext']);
    expect(b.state.lessons.size).toBe(0);
    expect(b.state.leases.size).toBe(0);
  });

  it('un titolo già presente nella UDA blocca prima di ogni scrittura', async () => {
    const b = backend();
    b.state.lessons.set('x', {
      filename: 'lezione-001-x.md',
      order: 0,
      titolo: "  che cos'È UNA RETE ",
    });
    const result = await importLessonStructure(INPUT, b.deps);
    expect(result.status).toBe('validation_failed');
    if (result.status === 'validation_failed') {
      expect(result.error.code).toBe('duplicate_title_in_destination');
    }
    expect(b.calls).toEqual(['loadContext', 'probeSourceAttempt']);
  });

  it('UTF-8 non valido è rifiutato prima di qualunque lettura', async () => {
    const b = backend();
    const result = await importLessonStructure(
      { ...INPUT, bytes: new Uint8Array([0xc3, 0x28]) },
      b.deps,
    );
    expect(result.status).toBe('validation_failed');
    expect(b.calls).toEqual([]);
  });
});

describe('documenti prodotti: scheletri, mai contenuto', () => {
  it('corpo vuoto, pool assente, nessuna soluzione nella proiezione', async () => {
    const b = backend();
    const result = await importLessonStructure(INPUT, b.deps);
    if (result.status !== 'committed') throw new Error('atteso committed');

    for (const planned of result.manifest.lessons) {
      expect(planned.content.split('---')[2]!.trim()).toBe('');
      expect(planned.doc.poolStatus).toBe('absent');
      expect(planned.doc.questionCount).toBe(0);
      expect(planned.doc.poolStorageRef).toBeNull();
      expect(planned.publicLesson.content).toBe('');
      const projection = planned.publicLesson as unknown as Record<string, unknown>;
      for (const forbidden of ['poolStatus', 'poolStorageRef', 'questionCount', 'soluzione']) {
        expect(forbidden in projection).toBe(false);
      }
    }
    const serialized = JSON.stringify(result.manifest);
    expect(serialized.toLowerCase()).not.toContain('pool.md');
    expect(result.manifest.kind).toBe('lesson');
  });

  it('carica esattamente i file del manifest, dentro la UDA di destinazione', async () => {
    const b = backend();
    const result = await importLessonStructure(INPUT, b.deps);
    if (result.status !== 'committed') throw new Error('atteso committed');
    expect([...b.state.storage.keys()]).toEqual(result.manifest.storagePaths);
    for (const path of b.state.storage.keys()) {
      expect(path.startsWith('repository/owner-1/imports/imp-1/uda-01-reti/')).toBe(true);
    }
  });

  it('incrementa lessonCount una sola volta per l’intero lotto', async () => {
    const b = backend();
    await importLessonStructure(INPUT, b.deps);
    expect(b.state.lessonCount).toBe(2);
  });
});

describe('collisioni', () => {
  it('un lessonId già in elenco blocca già in fase di piano', async () => {
    const b = backend();
    b.state.lessons.set('uda-01-reti_lezione-001-che-cos-e-una-rete', { filename: 'altro.md' });
    const result = await importLessonStructure(INPUT, b.deps);
    expect(result.status).toBe('validation_failed');
    if (result.status === 'validation_failed') {
      expect(result.error.code).toBe('document_id_collision');
    }
    expect(b.state.leases.size).toBe(0);
    expect(b.state.storage.size).toBe(0);
  });

  it('un lessonId orfano, invisibile alla lettura, è fermato dal preflight', async () => {
    // Un documento tecnico rimasto senza `udaDir` coerente non compare nella
    // query della UDA, quindi il planner non lo vede: è esattamente il caso per
    // cui il preflight esiste.
    const b = backend();
    const deps: LessonStructureImportDeps = {
      ...b.deps,
      preflight: async () => ({
        collision: { kind: 'lesson', id: 'uda-01-reti_lezione-001-che-cos-e-una-rete' },
      }),
    };
    const result = await importLessonStructure(INPUT, deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('collision');
    expect(b.state.leases.size).toBe(0);
    expect(b.state.storage.size).toBe(0);
  });

  it('una proiezione publicLessons già esistente blocca tutto', async () => {
    const b = backend();
    b.state.publicLessons.set('imp-1_uda-01-reti_lezione-001-che-cos-e-una-rete', {});
    const result = await importLessonStructure(INPUT, b.deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('collision');
  });

  it('un file preesistente non appartenente al tentativo è una collisione', async () => {
    const b = backend();
    b.state.storage.set(
      'repository/owner-1/imports/imp-1/uda-01-reti/lezione-001-che-cos-e-una-rete.md',
      'contenuto altrui',
    );
    const result = await importLessonStructure(INPUT, b.deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('collision');
    expect(
      b.state.storage.get(
        'repository/owner-1/imports/imp-1/uda-01-reti/lezione-001-che-cos-e-una-rete.md',
      ),
    ).toBe('contenuto altrui');
  });

  it('il messaggio di collisione non espone id, path o UID', async () => {
    const b = backend();
    b.state.publicLessons.set('imp-1_uda-01-reti_lezione-001-che-cos-e-una-rete', {});
    const result = await importLessonStructure(INPUT, b.deps);
    if (result.status !== 'not_applied') throw new Error('atteso not_applied');
    expect(result.message).not.toContain('repository/');
    expect(result.message).not.toContain('owner-1');
    expect(result.message).not.toContain('uda-01-reti_');
  });
});

describe('lease per UDA', () => {
  it('una lease viva sulla stessa UDA blocca', async () => {
    const b = backend();
    b.state.leases.set('uda-01-reti', {
      requestId: 'altro',
      manifestHash: 'z'.repeat(64),
      expiresAt: b.state.now + LEASE_TTL,
    });
    const result = await importLessonStructure(INPUT, b.deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('busy');
  });

  it('una lease su un’altra UDA non blocca: la granularità è per UDA', async () => {
    const b = backend();
    b.state.leases.set('uda-02-altra', {
      requestId: 'altro',
      manifestHash: 'z'.repeat(64),
      expiresAt: b.state.now + LEASE_TTL,
    });
    const result = await importLessonStructure(INPUT, b.deps);
    expect(result.status).toBe('committed');
  });

  it('race: lease scaduta e presa da altri, il commit non avviene', async () => {
    const b = backend();
    const deps: LessonStructureImportDeps = {
      ...b.deps,
      async renewLease(params) {
        b.state.now += LEASE_TTL + 1;
        b.state.leases.set('uda-01-reti', {
          requestId: 'altro',
          manifestHash: 'z'.repeat(64),
          expiresAt: b.state.now + LEASE_TTL,
        });
        return b.deps.renewLease(params);
      },
    };
    const result = await importLessonStructure(INPUT, deps);
    // Nel frattempo B ha aggiunto una lezione con stesso numero e stesso order.
    b.state.lessons.set('altra', { filename: 'lezione-001-altra.md', order: 0 });
    expect(result.status === 'not_applied' || result.status === 'cleanup_pending').toBe(true);
    if (result.status === 'not_applied') expect(result.reason).toBe('lease_lost');
    expect(b.state.publicLessons.size).toBe(0);
    expect(b.state.lessonCount).toBe(0);
    expect(b.state.audit).toBe(0);
  });

  it('anche saltando il rinnovo, il commit rifiuta una lease scaduta', async () => {
    const b = backend();
    const deps: LessonStructureImportDeps = {
      ...b.deps,
      async renewLease() {
        b.state.now += LEASE_TTL * 2;
        return 'renewed';
      },
    };
    const result = await importLessonStructure(INPUT, deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('commit_failed');
    expect(b.state.lessons.size).toBe(0);
    expect(b.state.publicLessons.size).toBe(0);
    expect(b.state.lessonCount).toBe(0);
  });
});

describe('identità del tentativo', () => {
  it('un tentativo di import UDA non è mai un replay di un import lezioni', async () => {
    const b = backend();
    // Record ben formato ma di tipo `uda`.
    // Record ben formato — `sourceHash` incluso — ma di tipo `uda`: la sonda di
    // sorgente lo rifiuta proprio perché il kind fa parte dell'identità.
    const sourceHash = await computeManifestHash('qualunque sorgente');
    b.state.attempts.set('req-1', {
      requestId: 'req-1',
      sourceHash,
      programId: 'prog-1',
      importId: 'imp-1',
      manifestHash: 'a'.repeat(64),
      kind: 'uda',
      documentIds: ['uda-01-reti'],
      storagePaths: [],
      status: 'committed',
    });
    const result = await importLessonStructure(INPUT, b.deps);
    expect(result.status).toBe('not_applied');
    // Sorgente diversa ⇒ conflitto; se coincidesse, sarebbe il kind a farlo.
    if (result.status === 'not_applied') expect(result.reason).toBe('conflict');
    expect(b.state.lessons.size).toBe(0);
  });

  it('un tentativo riferito a un’altra UDA non è questo tentativo', async () => {
    const b = backend();
    const first = await importLessonStructure(INPUT, b.deps);
    if (first.status !== 'committed') throw new Error('atteso committed');
    // Stesso requestId e stesso hash, ma il record dice un'altra UDA.
    b.state.attempts.set('req-1', {
      ...(b.state.attempts.get('req-1') as AttemptRecord),
      udaId: 'uda-02-altra',
      status: 'reserved',
    });
    b.state.lessons.clear();
    b.state.publicLessons.clear();
    const second = await importLessonStructure(INPUT, b.deps);
    expect(second.status).toBe('not_applied');
    // Stessa sorgente ma altro bersaglio: non è questo tentativo.
    if (second.status === 'not_applied') expect(second.reason).toBe('conflict');
  });

  it('un record malformato blocca senza essere sovrascritto', async () => {
    const b = backend();
    b.state.attempts.set('req-1', { requestId: 'req-1', status: 'reserved' });
    const result = await importLessonStructure(INPUT, b.deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('incoherent_attempt');
    expect(b.state.attempts.get('req-1')).toEqual({ requestId: 'req-1', status: 'reserved' });
  });
});

describe('replay dopo una risposta persa', () => {
  it('il retry è riconosciuto senza planner, preflight, lease, upload o commit', async () => {
    const b = backend();
    expect((await importLessonStructure(INPUT, b.deps)).status).toBe('committed');

    b.calls.length = 0;
    const replay = await importLessonStructure(INPUT, b.deps);

    expect(replay.status).toBe('committed_replay');
    if (replay.status === 'committed_replay') {
      expect(replay.lessonCount).toBe(2);
      expect(replay.requiresReload).toBe(true);
      expect(replay.lessonIds).toHaveLength(2);
    }
    expect(b.calls).toEqual(['loadContext', 'probeSourceAttempt']);
    expect(b.state.lessons.size).toBe(2);
    expect(b.state.publicLessons.size).toBe(2);
    expect(b.state.lessonCount).toBe(2);
    expect(b.state.audit).toBe(1);
    expect(b.state.storage.size).toBe(2);
  });

  it('stesso requestId con file modificato: conflitto, mai un secondo import', async () => {
    const b = backend();
    await importLessonStructure(INPUT, b.deps);
    const altro = utf8(`schema: schoolforge-lesson-metadata/v1
lessons:
  - titolo: Tutt'altra lezione
    difficolta: base
    concettiChiave:
      - c
    obiettivi:
      - o
`);
    const result = await importLessonStructure({ ...INPUT, bytes: altro }, b.deps);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toBe('conflict');
    expect(b.state.lessons.size).toBe(2);
    expect(b.state.publicLessons.size).toBe(2);
    expect(b.state.audit).toBe(1);
  });

  it('stessa sorgente ma piano divergente dopo una mutazione concorrente: fail-closed', async () => {
    const b = backend();
    b.fail.commit = true;
    b.fail.cleanupStorage = true;
    expect((await importLessonStructure(INPUT, b.deps)).status).toBe('cleanup_pending');
    delete b.fail.commit;
    delete b.fail.cleanupStorage;

    // Un'altra lezione è comparsa: numerazione e `order` si spostano.
    b.state.lessons.set('altra', {
      filename: 'lezione-001-altra.md',
      order: 0,
      titolo: 'Altra',
    });

    const retry = await importLessonStructure(INPUT, b.deps);
    expect(retry.status).toBe('not_applied');
    if (retry.status === 'not_applied') expect(retry.reason).toBe('incoherent_attempt');
    expect(b.state.lessons.size).toBe(1);
    expect(b.state.publicLessons.size).toBe(0);
    expect(b.state.lessonCount).toBe(0);
    expect(b.state.audit).toBe(0);
  });
});

describe('recovery', () => {
  it('upload parziale + cleanup fallito + retry riuscito', async () => {
    const b = backend();
    b.fail.uploadAfter = 1;
    b.fail.cleanupStorage = true;
    const first = await importLessonStructure(INPUT, b.deps);
    expect(first.status).toBe('cleanup_pending');
    expect(b.state.storage.size).toBe(1);
    expect(b.state.lessons.size).toBe(0);

    delete b.fail.uploadAfter;
    delete b.fail.cleanupStorage;
    const second = await importLessonStructure(INPUT, b.deps);
    expect(second.status).toBe('committed');
    expect(b.state.lessons.size).toBe(2);
    expect(b.state.publicLessons.size).toBe(2);
    expect(b.state.storage.size).toBe(2);
    expect(b.state.lessonCount).toBe(2);
    expect(b.state.audit).toBe(1);
    expect(b.state.leases.size).toBe(0);
  });

  it('commit fallito + cleanup fallito + retry riuscito', async () => {
    const b = backend();
    b.fail.commit = true;
    b.fail.cleanupStorage = true;
    expect((await importLessonStructure(INPUT, b.deps)).status).toBe('cleanup_pending');
    delete b.fail.commit;
    delete b.fail.cleanupStorage;
    const second = await importLessonStructure(INPUT, b.deps);
    expect(second.status).toBe('committed');
    expect(b.state.lessons.size).toBe(2);
    expect(b.state.lessonCount).toBe(2);
    expect(b.state.audit).toBe(1);
  });

  it('replay reale: commit riuscito, esito perso, nessuna duplicazione', async () => {
    const b = backend();
    const deps: LessonStructureImportDeps = {
      ...b.deps,
      // Contesto «vecchio»: non vede ancora le lezioni appena committate.
      loadContext: async () => ({
        ownerUid: b.state.ownerUid,
        activeImportId: b.state.activeImportId,
        udaId: b.state.udaId,
        udaDir: b.state.udaDir,
        udaTitle: 'Le reti',
        existingLessons: [],
      }),
    };
    await importLessonStructure(INPUT, deps);
    const before = {
      lessons: b.state.lessons.size,
      projections: b.state.publicLessons.size,
      count: b.state.lessonCount,
      audit: b.state.audit,
      files: b.state.storage.size,
    };
    const replay = await importLessonStructure(INPUT, deps);
    expect(replay.status).toBe('committed_replay');
    expect(b.state.lessons.size).toBe(before.lessons);
    expect(b.state.publicLessons.size).toBe(before.projections);
    expect(b.state.lessonCount).toBe(before.count);
    expect(b.state.audit).toBe(before.audit);
    expect(b.state.storage.size).toBe(before.files);
    expect(b.calls.filter((c) => c === 'commit')).toHaveLength(1);
  });

  it('un cleanup vecchio non tocca il tentativo che lo ha sostituito', async () => {
    const b = backend();
    b.state.attempts.set('req-1', {
      requestId: 'req-1',
      sourceHash: 'd'.repeat(64),
      programId: 'prog-1',
      importId: 'imp-1',
      manifestHash: 'c'.repeat(64),
      kind: 'lesson',
      udaId: 'uda-01-reti',
      documentIds: ['altra'],
      publicLessonIds: ['altra-pub'],
      storagePaths: ['repository/owner-1/imports/imp-1/uda-01-reti/lezione-009-altra.md'],
      status: 'reserved',
    });
    b.state.storage.set(
      'repository/owner-1/imports/imp-1/uda-01-reti/lezione-009-altra.md',
      'contenuto',
    );
    b.state.leases.set('uda-01-reti', {
      requestId: 'req-1',
      manifestHash: 'c'.repeat(64),
      expiresAt: 9e15,
    });

    const outcome = await b.deps.cleanup({
      programId: 'prog-1',
      activeImportId: 'imp-1',
      requestId: 'req-1',
      manifestHash: 'a'.repeat(64),
      sourceHash: 'q'.repeat(64),
      manifest: {
        kind: 'lesson',
        ownerUid: 'owner-1',
        programId: 'prog-1',
        importId: 'imp-1',
        udaId: 'uda-01-reti',
        udaDir: 'uda-01-reti',
        lessons: [],
        lessonIds: ['x'],
        publicLessonIds: ['y'],
        storagePaths: ['repository/owner-1/imports/imp-1/uda-01-reti/lezione-001-x.md'],
        lessonCountIncrement: 0,
        manifestCanonical: 'x',
      },
    });

    expect(outcome).toBe('done');
    expect(b.state.attempts.has('req-1')).toBe(true);
    expect(b.state.storage.size).toBe(1);
    expect(b.state.leases.size).toBe(1);
  });
});
