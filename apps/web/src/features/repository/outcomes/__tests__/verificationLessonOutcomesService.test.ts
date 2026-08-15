import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mocks = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  listUdas: vi.fn(),
  listLessons: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  doc: (_db: unknown, name: string, id: string) => ({ name, id }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (source: { name: string }, ...constraints: unknown[]) => ({ source, constraints }),
  getDoc: (...args: unknown[]) => mocks.getDoc(...args),
  getDocs: (...args: unknown[]) => mocks.getDocs(...args),
}));

vi.mock('../../programs/programsService.js', () => ({
  listUdas: (...args: unknown[]) => mocks.listUdas(...args),
  listLessons: (...args: unknown[]) => mocks.listLessons(...args),
}));

import { loadVerificationLessonOutcomes } from '../verificationLessonOutcomesService.js';

function snapshot<T>(items: Array<{ id: string; data: T }>) {
  return {
    size: items.length,
    docs: items.map((item) => ({ id: item.id, data: () => item.data })),
  };
}

function verification(over: Record<string, unknown> = {}) {
  return {
    ownerUid: 'owner-1',
    status: 'closed',
    config: {
      title: 'Verifica reti',
      programId: 'program-1',
      importId: 'import-1',
      classId: 'class-1',
      questionRefs: [],
    },
    teacherSnapshot: {
      title: 'Verifica reti',
      programId: 'program-1',
      importId: 'import-1',
      classId: 'class-1',
      className: '3A',
      questionRefs: [
        {
          questionIndexEntryId: 'entry-1',
          questionLocalId: 'q1',
          udaDir: 'uda-01',
          lessonFilename: 'lezione-001.md',
          poolStorageRef: 'x',
          tipo: 'aperta',
          difficolta: 1,
          maxPoints: 1,
        },
      ],
      questions: [
        { order: 0, tipo: 'aperta', testo: 'Base', maxPoints: 1, soluzione: 'S' },
        { order: 1, tipo: 'aperta', testo: 'Variante', maxPoints: 1, soluzione: 'S' },
      ],
      differentiation: {
        version: 1,
        questions: [
          {
            baseOrder: 0,
            choices: { label: { kind: 'alternative', order: 1 } },
          },
        ],
        labels: [{ labelId: 'label', labelName: 'Percorso A' }],
        differentiatedAlternativeOrders: [1],
      },
      activatedAt: { seconds: 1, nanoseconds: 0 },
    },
    ...over,
  };
}

function correction(over: Record<string, unknown> = {}) {
  return {
    submissionId: 'ver-1_student-1',
    verificationId: 'ver-1',
    studentUid: 'student-1',
    ownerUid: 'owner-1',
    status: 'completed',
    evaluations: {
      0: { order: 0, points: 1, maxPoints: 1 },
      1: { order: 1, points: 0.5, maxPoints: 1 },
    },
    ...over,
  };
}

function submission(over: Record<string, unknown> = {}) {
  return {
    verificationId: 'ver-1',
    studentUid: 'student-1',
    ownerUid: 'owner-1',
    status: 'submitted',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => verification() });
  mocks.getDocs.mockImplementation(async (q: { source: { name: string } }) =>
    q.source.name === 'corrections'
      ? snapshot([{ id: 'ver-1_student-1', data: correction() }])
      : snapshot([{ id: 'ver-1_student-1', data: submission() }]),
  );
  mocks.listUdas.mockResolvedValue([{ dir: 'uda-01', titolo: 'Reti' }]);
  mocks.listLessons.mockResolvedValue([
    { udaDir: 'uda-01', filename: 'lezione-001.md', titolo: 'Indirizzi IP' },
  ]);
});

describe('loadVerificationLessonOutcomes (ESITI-01)', () => {
  it.each([
    ['identificativo vuoto', { verificationId: ' ', ownerUid: 'owner-1' }, /Identificativo/],
    ['docente vuoto', { verificationId: 'ver-1', ownerUid: ' ' }, /Docente/],
  ])('rifiuta %s prima di qualunque lettura', async (_name, input, message) => {
    await expect(loadVerificationLessonOutcomes({ ...input, db: {} as never })).rejects.toThrow(
      message,
    );
    expect(mocks.getDoc).not.toHaveBeenCalled();
    expect(mocks.getDocs).not.toHaveBeenCalled();
    expect(mocks.listUdas).not.toHaveBeenCalled();
  });

  it('rilegge la verifica chiusa e carica una volta correzioni, consegne e albero', async () => {
    const report = await loadVerificationLessonOutcomes({
      verificationId: 'ver-1',
      ownerUid: 'owner-1',
      db: {} as never,
    });
    expect(mocks.getDoc).toHaveBeenCalledTimes(1);
    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    expect(mocks.listUdas).toHaveBeenCalledWith('program-1', 'import-1', {});
    expect(mocks.listLessons).toHaveBeenCalledWith('program-1', 'import-1', {});
    expect(report).toMatchObject({ finalizedCorrections: 1, submittedCount: 1 });
    expect(report.udas[0]!.lessons[0]).toMatchObject({
      lessonTitle: 'Indirizzi IP',
      masteryPercentage: 75,
      questionCount: 2,
      evaluationCount: 2,
    });
  });

  it('attribuisce una variante differenziata alla stessa lezione della base senza esporre etichette', async () => {
    const report = await loadVerificationLessonOutcomes({
      verificationId: 'ver-1',
      ownerUid: 'owner-1',
      db: {} as never,
    });
    expect(JSON.stringify(report)).not.toContain('label');
    expect(JSON.stringify(report)).not.toContain('student-1');
    expect(report.udas[0]!.lessons[0]!.questionCount).toBe(2);
  });

  it.each([
    ['riaperta', { status: 'active' }, /solo a verifica chiusa/],
    ['altro owner', { ownerUid: 'owner-2' }, /non disponibile/],
    ['senza snapshot', { teacherSnapshot: null }, /snapshot necessario/],
  ])('si ferma dopo una sola lettura se la verifica è %s', async (_name, over, message) => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => verification(over) });
    await expect(
      loadVerificationLessonOutcomes({
        verificationId: 'ver-1',
        ownerUid: 'owner-1',
        db: {} as never,
      }),
    ).rejects.toThrow(message);
    expect(mocks.getDocs).not.toHaveBeenCalled();
    expect(mocks.listUdas).not.toHaveBeenCalled();
  });

  it('rifiuta una correzione estranea senza mostrare risultati parziali', async () => {
    mocks.getDocs.mockImplementation(async (q: { source: { name: string } }) =>
      q.source.name === 'corrections'
        ? snapshot([{ id: 'foreign', data: correction({ ownerUid: 'owner-2' }) }])
        : snapshot([{ id: 'ver-1_student-1', data: submission() }]),
    );
    await expect(
      loadVerificationLessonOutcomes({
        verificationId: 'ver-1',
        ownerUid: 'owner-1',
        db: {} as never,
      }),
    ).rejects.toThrow(/non appartiene/);
  });

  it('rifiuta un albero didattico che non permette più di identificare la lezione', async () => {
    mocks.listLessons.mockResolvedValue([]);
    await expect(
      loadVerificationLessonOutcomes({
        verificationId: 'ver-1',
        ownerUid: 'owner-1',
        db: {} as never,
      }),
    ).rejects.toThrow(/perimetro didattico/);
  });

  it('è strutturalmente di sola lettura: niente listener, polling o write API', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'src/features/repository/outcomes/verificationLessonOutcomesService.ts',
      ),
      'utf8',
    );
    for (const forbidden of [
      'onSnapshot',
      'setDoc',
      'updateDoc',
      'deleteDoc',
      'writeBatch',
      'runTransaction',
      'setInterval',
      'setTimeout',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
