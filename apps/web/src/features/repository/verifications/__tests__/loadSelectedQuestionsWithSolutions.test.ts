import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadSelectedQuestionsWithSolutions } from '../loadSelectedQuestionsWithSolutions.js';
import type { VerificationQuestionRef } from '../../../../types/firestore.js';

const mockGetBytes = vi.fn();
vi.mock('firebase/storage', () => ({
  getBytes: (...args: unknown[]) => mockGetBytes(...args),
  ref: (_storage: unknown, path: string) => ({ path }),
}));

const encoder = new TextEncoder();

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
  mockGetBytes.mockResolvedValue(encoder.encode(POOL_YAML));
});

describe('loadSelectedQuestionsWithSolutions', () => {
  it('returns error when questionRefs is empty', async () => {
    const result = await loadSelectedQuestionsWithSolutions([], {} as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/nessuna domanda/i);
  });

  it('returns error when pool file is not found in Storage', async () => {
    mockGetBytes.mockRejectedValue(new Error('storage/object-not-found'));
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
    expect(mockGetBytes).toHaveBeenCalledTimes(1);
  });
});
