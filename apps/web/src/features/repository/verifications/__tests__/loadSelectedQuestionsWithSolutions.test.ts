import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadSelectedQuestionsWithSolutions } from '../loadSelectedQuestionsWithSolutions.js';
import type { VerificationQuestionRef } from '../../../../types/firestore.js';

const mockReadTexts = vi.fn();
vi.mock('../../gateway/repositoryGatewayClient.js', () => ({
  readTexts: (...args: unknown[]) => mockReadTexts(...args),
}));

const POOL_YAML = `---
schema: schoolforge-pool/v1
questions:
  - id: q-001
    tipo: aperta
    difficolta: 2
    peso: 3
    testo: Spiega HTTP.
    soluzione: HTTP è un protocollo applicativo.
  - id: q-002
    tipo: chiusa_singola
    difficolta: 1
    peso: 1
    testo: Porta HTTP?
    opzioni:
      - id: a
        testo: "80"
      - id: b
        testo: "443"
    soluzione: [a]
  - id: q-003
    tipo: chiusa_multipla
    difficolta: 2
    peso: 2
    testo: Protocolli di trasporto?
    opzioni:
      - id: x
        testo: TCP
      - id: "y"
        testo: UDP
      - id: z
        testo: HTTP
    soluzione: [x, "y"]
---`;

const makeRef = (overrides: Partial<VerificationQuestionRef> = {}): VerificationQuestionRef => ({
  questionIndexEntryId: 'qi-1',
  questionLocalId: 'q-001',
  udaDir: 'UDA1',
  lessonFilename: 'lezione1.md',
  poolStorageRef: 'repository/uid/imports/imp-1/UDA1/lezione1.pool.md',
  tipo: 'aperta',
  difficolta: 2,
  peso: 3,
  maxPoints: 6,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockReadTexts.mockImplementation(async (paths: string[]) =>
    paths.map((path) => ({ ok: true, path, content: POOL_YAML })),
  );
});

describe('loadSelectedQuestionsWithSolutions', () => {
  it('returns error when questionRefs is empty', async () => {
    const result = await loadSelectedQuestionsWithSolutions([], {} as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/nessuna domanda/i);
  });

  it('returns error when the gateway reports a missing pool', async () => {
    mockReadTexts.mockImplementation(async (paths: string[]) =>
      paths.map((path) => ({
        ok: false,
        path,
        error: { code: 'file_not_found', message: 'File non trovato.' },
      })),
    );
    const result = await loadSelectedQuestionsWithSolutions([makeRef()], {} as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/pool non trovato/i);
  });

  it('returns error when questionLocalId is not in pool', async () => {
    const result = await loadSelectedQuestionsWithSolutions(
      [makeRef({ questionLocalId: 'q-999' })],
      {} as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/domanda non trovata/i);
  });

  it('loads the textual solution for an aperta question', async () => {
    const result = await loadSelectedQuestionsWithSolutions([makeRef()], {} as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const q = result.questions[0];
    expect(q.testo).toBe('Spiega HTTP.');
    expect(q.tipo).toBe('aperta');
    expect(q.soluzione).toBe('HTTP è un protocollo applicativo.');
    expect(q.opzioni).toBeUndefined();
  });

  it('loads the correct option id array for a chiusa_singola question', async () => {
    const result = await loadSelectedQuestionsWithSolutions(
      [makeRef({ questionLocalId: 'q-002', tipo: 'chiusa_singola', maxPoints: 1 })],
      {} as never,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const q = result.questions[0];
    expect(q.tipo).toBe('chiusa_singola');
    expect(q.opzioni).toHaveLength(2);
    expect(q.soluzione).toEqual(['a']);
  });

  it('loads all correct option ids for a chiusa_multipla question', async () => {
    const result = await loadSelectedQuestionsWithSolutions(
      [makeRef({ questionLocalId: 'q-003', tipo: 'chiusa_multipla', maxPoints: 4 })],
      {} as never,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const q = result.questions[0];
    expect(q.tipo).toBe('chiusa_multipla');
    expect(q.soluzione).toEqual(['x', 'y']);
  });

  it('preserves original questionRefs ordering across multiple refs', async () => {
    const refs = [
      makeRef({
        questionIndexEntryId: 'qi-3',
        questionLocalId: 'q-003',
        tipo: 'chiusa_multipla',
        maxPoints: 4,
      }),
      makeRef({ questionIndexEntryId: 'qi-1', questionLocalId: 'q-001' }),
    ];
    const result = await loadSelectedQuestionsWithSolutions(refs, {} as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questions[0].ref.questionIndexEntryId).toBe('qi-3');
    expect(result.questions[1].ref.questionIndexEntryId).toBe('qi-1');
  });

  it('fetches each unique pool file only once', async () => {
    const refs = [
      makeRef({ questionIndexEntryId: 'qi-1', questionLocalId: 'q-001' }),
      makeRef({
        questionIndexEntryId: 'qi-2',
        questionLocalId: 'q-002',
        tipo: 'chiusa_singola',
        maxPoints: 1,
      }),
    ];
    await loadSelectedQuestionsWithSolutions(refs, {} as never);
    expect(mockReadTexts).toHaveBeenCalledTimes(1);
  });

  it('reads multiple distinct pools in one gateway batch', async () => {
    const refs = Array.from({ length: 10 }, (_, i) =>
      makeRef({
        questionIndexEntryId: `qi-${i}`,
        questionLocalId: 'q-001',
        poolStorageRef: `repository/uid/imports/imp-1/UDA1/pool-${i}.pool.md`,
      }),
    );

    const result = await loadSelectedQuestionsWithSolutions(refs, {} as never);

    expect(result.ok).toBe(true);
    expect(mockReadTexts).toHaveBeenCalledTimes(1);
    expect(mockReadTexts.mock.calls[0]?.[0]).toHaveLength(10);
  });

  it('never reads the same pool twice even when many refs share it, under concurrency', async () => {
    const refs = [
      makeRef({ questionIndexEntryId: 'qi-1', questionLocalId: 'q-001' }),
      makeRef({
        questionIndexEntryId: 'qi-2',
        questionLocalId: 'q-002',
        tipo: 'chiusa_singola',
        maxPoints: 1,
      }),
      makeRef({
        questionIndexEntryId: 'qi-3',
        questionLocalId: 'q-003',
        tipo: 'chiusa_multipla',
        maxPoints: 4,
      }),
    ];
    const result = await loadSelectedQuestionsWithSolutions(refs, {} as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questions).toHaveLength(3);
    expect(mockReadTexts).toHaveBeenCalledTimes(1);
  });

  it('returns a failed result (never a partial success) when one of several pools is missing', async () => {
    mockReadTexts.mockImplementation(async (paths: string[]) =>
      paths.map((path) =>
        path.includes('missing')
          ? {
              ok: false,
              path,
              error: { code: 'file_not_found', message: 'File non trovato.' },
            }
          : { ok: true, path, content: POOL_YAML },
      ),
    );

    const refs = [
      makeRef({
        questionIndexEntryId: 'qi-1',
        questionLocalId: 'q-001',
        poolStorageRef: 'repository/uid/imports/imp-1/UDA1/ok.pool.md',
      }),
      makeRef({
        questionIndexEntryId: 'qi-2',
        questionLocalId: 'q-001',
        poolStorageRef: 'repository/uid/imports/imp-1/UDA1/missing.pool.md',
      }),
    ];

    const result = await loadSelectedQuestionsWithSolutions(refs, {} as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/pool non trovato/i);
  });

  it('never performs a write and uses only the read gateway', async () => {
    await loadSelectedQuestionsWithSolutions([makeRef()], {} as never);
    expect(mockReadTexts).toHaveBeenCalledOnce();
  });
});
