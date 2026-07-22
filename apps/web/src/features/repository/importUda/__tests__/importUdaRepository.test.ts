import { describe, expect, it, vi } from 'vitest';
import { importUda, type UdaImportDeps, type UdaImportInput } from '../importUdaRepository.js';
import type { RawFile } from '../../validation/types.js';

const UDA_MD = `---
titolo: "Reti"
competenze:
  - "c"
obiettivi:
  - "o"
---
# Reti`;
const LESSON_MD = '# Lezione';
const POOL_MD = `---
schema: schoolforge-pool/v2
questions:
  - id: q-001
    tipo: aperta
    difficolta: 2
    testo: Spiega HTTP.
    soluzione: ok
---`;

function validFiles(): RawFile[] {
  return [
    { path: 'uda-03-reti/uda-03-reti.md', content: UDA_MD },
    { path: 'uda-03-reti/lezione-001-http.md', content: LESSON_MD },
    { path: 'uda-03-reti/lezione-001-http.pool.md', content: POOL_MD },
  ];
}

const input = (files = validFiles()): UdaImportInput => ({
  programId: 'prog-1',
  ownerUid: 'owner-1',
  requestId: 'req-1',
  files,
});

/** Fake deps recording the call order and letting each step be overridden. */
function makeDeps(over: Partial<UdaImportDeps> = {}): { deps: UdaImportDeps; calls: string[] } {
  const calls: string[] = [];
  const base: UdaImportDeps = {
    loadContext: async () => ({
      ownerUid: 'owner-1',
      activeImportId: 'imp-1',
      existingUdaOrders: [0, 1],
    }),
    findCommittedAttempt: async () => 'none' as const,
    preflight: async () => ({ collision: null }),
    acquireLease: async () => 'acquired' as const,
    uploadStorage: async () => undefined,
    stageDocs: async () => undefined,
    commit: async () => undefined,
    cleanup: async () => 'done' as const,
  };
  const merged = { ...base, ...over } as Record<string, (...a: never[]) => Promise<unknown>>;
  // Wrap every FINAL method (including overrides) so call order is always recorded.
  const deps = Object.fromEntries(
    Object.entries(merged).map(([name, fn]) => [
      name,
      async (...a: never[]) => {
        calls.push(name);
        return fn(...a);
      },
    ]),
  ) as unknown as UdaImportDeps;
  return { deps, calls };
}

describe('importUda — happy path', () => {
  it('commits in the contract order and returns counts + cost', async () => {
    const { deps, calls } = makeDeps();
    const res = await importUda(input(), deps);

    expect(res.status).toBe('committed');
    if (res.status === 'committed') {
      expect(res.udaId).toBe('uda-03-reti');
      expect(res.lessonCount).toBe(1);
      expect(res.questionCount).toBe(1);
      expect(res.cost.storageUploads).toBe(3);
      expect(res.cleanupPending).toBe(false);
    }
    expect(calls).toEqual([
      'loadContext',
      'findCommittedAttempt',
      'preflight',
      'acquireLease',
      'uploadStorage',
      'stageDocs',
      'commit',
    ]);
  });
});

describe('importUda — pre-write guards', () => {
  it('validation_failed never touches deps beyond nothing (blocks before loadContext)', async () => {
    const { deps, calls } = makeDeps();
    const res = await importUda(
      input([{ path: 'uda-03-reti/uda-03-reti.md', content: UDA_MD }]),
      deps,
    );
    expect(res.status).toBe('validation_failed');
    expect(calls).toEqual([]);
  });

  it('no_active_import stops after loadContext', async () => {
    const { deps, calls } = makeDeps({ loadContext: async () => null });
    const res = await importUda(input(), deps);
    expect(res).toMatchObject({ status: 'not_applied', reason: 'no_active_import' });
    expect(calls).toEqual(['loadContext']);
  });

  it('collision blocks before any lease/upload/write', async () => {
    const upload = vi.fn();
    const { deps, calls } = makeDeps({
      preflight: async () => ({ collision: { kind: 'uda', id: 'uda-03-reti' } }),
      acquireLease: async () => {
        throw new Error('must not reserve on collision');
      },
      uploadStorage: upload,
    });
    const res = await importUda(input(), deps);
    expect(res).toMatchObject({ status: 'not_applied', reason: 'collision' });
    expect(calls).toEqual(['loadContext', 'findCommittedAttempt', 'preflight']);
    expect(upload).not.toHaveBeenCalled();
  });

  it('busy lease returns not_applied without upload', async () => {
    const { deps, calls } = makeDeps({ acquireLease: async () => 'busy' });
    const res = await importUda(input(), deps);
    expect(res).toMatchObject({ status: 'not_applied', reason: 'busy' });
    expect(calls).not.toContain('uploadStorage');
  });

  it('idempotent replay returns committed without re-uploading', async () => {
    const { deps, calls } = makeDeps({ findCommittedAttempt: async () => 'committed' });
    const res = await importUda(input(), deps);
    expect(res.status).toBe('committed');
    expect(calls).toEqual(['loadContext', 'findCommittedAttempt']);
  });

  it('conflicting attempt (same request, different hash) is not_applied', async () => {
    const { deps } = makeDeps({ findCommittedAttempt: async () => 'conflict' });
    const res = await importUda(input(), deps);
    expect(res).toMatchObject({ status: 'not_applied', reason: 'conflict' });
  });
});

describe('importUda — pre-commit failures clean up the attempt', () => {
  it('upload failure cleans up and reports not_applied', async () => {
    const cleanup = vi.fn(async () => 'done' as const);
    const { deps } = makeDeps({
      uploadStorage: async () => {
        throw new Error('sgw down');
      },
      cleanup,
    });
    const res = await importUda(input(), deps);
    expect(res).toMatchObject({ status: 'not_applied', reason: 'upload_failed' });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('stage failure cleans up', async () => {
    const cleanup = vi.fn(async () => 'done' as const);
    const { deps } = makeDeps({
      stageDocs: async () => {
        throw new Error('chunk failed');
      },
      cleanup,
    });
    const res = await importUda(input(), deps);
    expect(res).toMatchObject({ status: 'not_applied', reason: 'stage_failed' });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('commit failure cleans up', async () => {
    const cleanup = vi.fn(async () => 'done' as const);
    const { deps } = makeDeps({
      commit: async () => {
        throw new Error('tx failed');
      },
      cleanup,
    });
    const res = await importUda(input(), deps);
    expect(res).toMatchObject({ status: 'not_applied', reason: 'commit_failed' });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('incomplete cleanup surfaces cleanup_pending', async () => {
    const { deps } = makeDeps({
      uploadStorage: async () => {
        throw new Error('sgw down');
      },
      cleanup: async () => 'pending',
    });
    const res = await importUda(input(), deps);
    expect(res.status).toBe('cleanup_pending');
  });
});
