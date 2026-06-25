import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadSelectedQuestions } from '../loadSelectedQuestions.js';
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

describe('loadSelectedQuestions', () => {
  it('returns error when questionRefs is empty', async () => {
    const result = await loadSelectedQuestions([], {} as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/nessuna domanda/i);
  });

  it('returns error when pool file is not found in Storage', async () => {
    mockGetBytes.mockRejectedValue(new Error('storage/object-not-found'));
    const result = await loadSelectedQuestions([makeRef()], {} as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/pool non trovato/i);
  });

  it('returns error when questionLocalId is not in pool', async () => {
    const result = await loadSelectedQuestions(
      [makeRef({ questionLocalId: 'q-999' })],
      {} as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/domanda non trovata/i);
  });

  it('loads an aperta question with testo and no opzioni', async () => {
    const result = await loadSelectedQuestions([makeRef()], {} as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const q = result.questions[0];
    expect(q.testo).toBe('Spiega HTTP.');
    expect(q.tipo).toBe('aperta');
    expect(q.opzioni).toBeUndefined();
  });

  it('loads a chiusa_singola question with opzioni', async () => {
    const result = await loadSelectedQuestions(
      [makeRef({ questionLocalId: 'q-002', tipo: 'chiusa_singola', maxPoints: 1 })],
      {} as never,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const q = result.questions[0];
    expect(q.tipo).toBe('chiusa_singola');
    expect(q.opzioni).toHaveLength(2);
    expect(q.opzioni?.[0]).toEqual({ id: 'a', testo: '80' });
  });

  it('LoadedQuestion never includes soluzione, correctAnswer or answers', async () => {
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
    const result = await loadSelectedQuestions(refs, {} as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const q of result.questions) {
      expect(q).not.toHaveProperty('soluzione');
      expect(q).not.toHaveProperty('correctAnswer');
      expect(q).not.toHaveProperty('answers');
      if (q.opzioni) {
        for (const opt of q.opzioni) {
          expect(opt).not.toHaveProperty('soluzione');
          expect(opt).not.toHaveProperty('correct');
        }
      }
    }
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
      makeRef({
        questionIndexEntryId: 'qi-2',
        questionLocalId: 'q-002',
        tipo: 'chiusa_singola',
        maxPoints: 1,
      }),
    ];
    const result = await loadSelectedQuestions(refs, {} as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questions[0].ref.questionIndexEntryId).toBe('qi-3');
    expect(result.questions[1].ref.questionIndexEntryId).toBe('qi-1');
    expect(result.questions[2].ref.questionIndexEntryId).toBe('qi-2');
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
    await loadSelectedQuestions(refs, {} as never);
    expect(mockGetBytes).toHaveBeenCalledTimes(1);
  });
});
