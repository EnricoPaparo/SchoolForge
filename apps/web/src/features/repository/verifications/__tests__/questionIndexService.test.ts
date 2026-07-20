import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

const mockGetDocs = vi.fn();
const mockCollection = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
}));

import { listQuestionIndex } from '../questionIndexService.js';
import type { Firestore } from 'firebase/firestore';

const fakeDb = {} as Firestore;

function doc(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      ownerUid: 'owner-uid',
      importId: 'imp-1',
      udaDir: 'uda-01-reti',
      lessonPath: 'uda-01-reti/lezione-001.md',
      lessonFilename: 'lezione-001.md',
      poolStorageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001.pool.md',
      questionLocalId: 'q1',
      tipo: 'aperta',
      difficolta: 1,
      maxPoints: 1,
      questionPreview: 'Descrivi il protocollo HTTP.',
      ...overrides,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCollection.mockReturnValue({ id: 'questionIndex' });
});

describe('listQuestionIndex', () => {
  it('exposes questionPreview alongside the existing metadata fields', async () => {
    mockGetDocs.mockResolvedValue({ docs: [doc('qi-1')] });

    const result = await listQuestionIndex('prog-1', 'imp-1', fakeDb);
    expect(result[0].questionPreview).toBe('Descrivi il protocollo HTTP.');
  });

  it('defaults questionPreview to an empty string when absent (legacy entry, pre-preview import)', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [doc('qi-legacy', { questionPreview: undefined })],
    });

    const result = await listQuestionIndex('prog-1', 'imp-1', fakeDb);
    expect(result[0].questionPreview).toBe('');
  });

  it('never exposes the full question text, answers, correctAnswer or solution', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        doc('qi-1', {
          // Simulate a Firestore doc that (incorrectly) also carried sensitive
          // fields — listQuestionIndex must still whitelist only safe fields.
          testo: 'Testo completo della domanda che non deve mai uscire da qui.',
          soluzione: 'La soluzione segreta',
          correctAnswer: 'a',
          answers: ['a', 'b'],
        }),
      ],
    });

    const result = await listQuestionIndex('prog-1', 'imp-1', fakeDb);
    expect(result[0]).not.toHaveProperty('testo');
    expect(result[0]).not.toHaveProperty('soluzione');
    expect(result[0]).not.toHaveProperty('correctAnswer');
    expect(result[0]).not.toHaveProperty('answers');
  });

  it('POOL-SIMPLE-02 — accepts a coherent V2 entry (difficoltà 5, maxPoints 5)', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [doc('qi-5', { difficolta: 5, maxPoints: 5 })],
    });
    const result = await listQuestionIndex('prog-1', 'imp-1', fakeDb);
    expect(result[0]).toMatchObject({ difficolta: 5, maxPoints: 5 });
  });

  it('POOL-SIMPLE-02 fail-closed — rejects an incoherent entry so the picker never shows it', async () => {
    const invalidCases: Array<Record<string, unknown>> = [
      { difficolta: 0, maxPoints: 0 },
      { difficolta: 6, maxPoints: 6 },
      { difficolta: 2.5, maxPoints: 2.5 },
      { difficolta: 3, maxPoints: 4 }, // maxPoints !== difficolta
      { tipo: 'sconosciuto', difficolta: 3, maxPoints: 3 },
    ];
    for (const overrides of invalidCases) {
      mockGetDocs.mockResolvedValue({ docs: [doc('qi-bad', overrides)] });
      await expect(listQuestionIndex('prog-1', 'imp-1', fakeDb)).rejects.toThrow(
        /questionIndex non valida/,
      );
    }
  });

  it('sorts entries deterministically by UDA, then lesson, then questionLocalId', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        doc('qi-c', {
          udaDir: 'uda-02-sicurezza',
          lessonFilename: 'lezione-001.md',
          questionLocalId: 'q1',
        }),
        doc('qi-a', {
          udaDir: 'uda-01-reti',
          lessonFilename: 'lezione-002.md',
          questionLocalId: 'q1',
        }),
        doc('qi-b', {
          udaDir: 'uda-01-reti',
          lessonFilename: 'lezione-001.md',
          questionLocalId: 'q2',
        }),
        doc('qi-d', {
          udaDir: 'uda-01-reti',
          lessonFilename: 'lezione-001.md',
          questionLocalId: 'q1',
        }),
      ],
    });

    const result = await listQuestionIndex('prog-1', 'imp-1', fakeDb);
    expect(result.map((e) => e.id)).toEqual(['qi-d', 'qi-b', 'qi-a', 'qi-c']);
  });
});
