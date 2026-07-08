import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

const mockGetDocs = vi.fn();
const mockCollection = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: vi.fn(),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
}));

import { listLessons, listUdas } from '../programsService.js';
import type { Firestore } from 'firebase/firestore';

const fakeDb = {} as Firestore;

beforeEach(() => {
  vi.clearAllMocks();
  mockCollection.mockReturnValue({ id: 'stub' });
});

describe('listUdas — deterministic ordering', () => {
  it('sorts UDAs alphabetically by dir regardless of Firestore return order', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        { id: 'uda-c', data: () => ({ dir: 'uda-10-finale', filename: 'uda-10-finale.md' }) },
        { id: 'uda-a', data: () => ({ dir: 'uda-01-intro', filename: 'uda-01-intro.md' }) },
        { id: 'uda-b', data: () => ({ dir: 'uda-02-reti', filename: 'uda-02-reti.md' }) },
      ],
    });

    const result = await listUdas('prog-1', 'imp-1', fakeDb);
    expect(result.map((u) => u.dir)).toEqual(['uda-01-intro', 'uda-02-reti', 'uda-10-finale']);
  });
});

describe('listUdas — legacy document normalization', () => {
  it('defaults descrizione/competenze/obiettivi when absent on the raw Firestore doc', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        { id: 'uda-legacy', data: () => ({ dir: 'uda-01-legacy', filename: 'uda-01-legacy.md' }) },
      ],
    });

    const [uda] = await listUdas('prog-1', 'imp-1', fakeDb);

    expect(uda.descrizione).toBeNull();
    expect(uda.competenze).toEqual([]);
    expect(uda.obiettivi).toEqual([]);
  });

  it('preserves descrizione/competenze/obiettivi when present on the raw Firestore doc', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: 'uda-1',
          data: () => ({
            dir: 'uda-01-reti',
            filename: 'uda-01-reti.md',
            descrizione: 'Reti informatiche di base',
            competenze: ['Competenza A'],
            obiettivi: ['Obiettivo 1'],
          }),
        },
      ],
    });

    const [uda] = await listUdas('prog-1', 'imp-1', fakeDb);

    expect(uda.descrizione).toBe('Reti informatiche di base');
    expect(uda.competenze).toEqual(['Competenza A']);
    expect(uda.obiettivi).toEqual(['Obiettivo 1']);
  });
});

describe('listLessons — deterministic ordering', () => {
  it('sorts lessons alphabetically by path so numbering decides the order', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: 'l3',
          data: () => ({ udaDir: 'uda-01-intro', path: 'uda-01-intro/lezione-003.md' }),
        },
        {
          id: 'l1',
          data: () => ({ udaDir: 'uda-01-intro', path: 'uda-01-intro/lezione-001.md' }),
        },
        {
          id: 'l2',
          data: () => ({ udaDir: 'uda-01-intro', path: 'uda-01-intro/lezione-002.md' }),
        },
      ],
    });

    const result = await listLessons('prog-1', 'imp-1', fakeDb);
    expect(result.map((l) => l.path)).toEqual([
      'uda-01-intro/lezione-001.md',
      'uda-01-intro/lezione-002.md',
      'uda-01-intro/lezione-003.md',
    ]);
  });
});
