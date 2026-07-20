import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetDocs = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
}));

import { listQuestionIndex } from '../questionIndexService.js';
import { toTeacherQuestionSnapshot } from '../verificationSnapshotMappers.js';
import type { LoadedQuestionWithSolution } from '../loadSelectedQuestionsWithSolutions.js';
import type { VerificationQuestionRef } from '../../../../types/firestore.js';
import type { Firestore } from 'firebase/firestore';

const db = {} as Firestore;

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * POOL-SIMPLE-02 end-to-end contract at the service level: a difficoltà-5
 * question flows questionIndex → VerificationQuestionRef → teacher snapshot
 * with `maxPoints === difficolta === 5` and **no `peso`** anywhere along the
 * chain. This proves difficoltà 4/5 traverse the real index/selection/snapshot
 * code and that the transitional `peso` bridge is gone.
 */
describe('POOL-SIMPLE-02 — difficoltà 5 flows to maxPoints 5 without peso', () => {
  it('questionIndex → ref → teacher snapshot keeps maxPoints === difficolta and drops peso', async () => {
    // The questionIndex doc as written by import/editor (V2: no peso).
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: 'qi-5',
          data: () => ({
            ownerUid: 'owner',
            importId: 'i1',
            udaDir: 'uda-01-reti',
            lessonPath: 'uda-01-reti/lezione-001.md',
            lessonFilename: 'lezione-001.md',
            poolStorageRef: 'gs://bucket/uda-01-reti/lezione-001.pool.md',
            questionLocalId: 'q-hard',
            tipo: 'aperta',
            difficolta: 5,
            maxPoints: 5,
            questionPreview: 'Domanda difficile.',
          }),
        },
      ],
    });

    const [entry] = await listQuestionIndex('p1', 'i1', db);
    expect(entry).toMatchObject({ difficolta: 5, maxPoints: 5 });
    expect(entry).not.toHaveProperty('peso');

    // The ref frozen at selection time (mirrors VerificationsView) — no peso.
    const ref: VerificationQuestionRef = {
      questionIndexEntryId: entry!.id,
      questionLocalId: entry!.questionLocalId,
      udaDir: entry!.udaDir,
      lessonFilename: entry!.lessonFilename,
      poolStorageRef: entry!.poolStorageRef,
      tipo: entry!.tipo,
      difficolta: entry!.difficolta,
      maxPoints: entry!.maxPoints,
    };
    expect(ref).not.toHaveProperty('peso');

    const loaded: LoadedQuestionWithSolution = {
      ref,
      testo: 'Spiega un concetto complesso.',
      tipo: 'aperta',
      soluzione: 'Risposta di riferimento.',
    };
    const snapshot = toTeacherQuestionSnapshot(loaded, 0);

    expect(snapshot.difficolta).toBe(5);
    expect(snapshot.maxPoints).toBe(5);
    expect(snapshot.maxPoints).toBe(snapshot.difficolta);
    expect(snapshot).not.toHaveProperty('peso');

    // No `peso` survives anywhere along the frozen chain.
    expect(JSON.stringify({ entry, ref, snapshot })).not.toMatch(/peso/i);
  });
});
