import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DifferentiationLabelsModule from '../../differentiation/differentiationLabelsService.js';

vi.mock('../../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

/**
 * VDIF-04 — attivazione reale di una verifica differenziata.
 *
 * La transazione è simulata con lo stesso store in memoria degli altri service
 * VDIF, che riproduce le due proprietà da cui dipendono le garanzie: le letture
 * di un tentativo vedono lo stesso istante, e il commit applica **tutte** le
 * scritture o nessuna. Ciò che questi test difendono non è il testo dei
 * messaggi, ma che nessuna scrittura sopravviva a un fallimento.
 */

type Store = Map<string, Record<string, unknown>>;
const store: Store = new Map();
let committed = false;
let attempts = 0;

const mockDoc = vi.fn((first: unknown, ...segments: string[]) => {
  if (typeof first === 'object' && first !== null && '__collection' in first) {
    return { path: `${(first as { __collection: string }).__collection}/auto-1` };
  }
  return { path: segments.join('/') };
});
const mockCollection = vi.fn((_db: unknown, ...segments: string[]) => ({
  path: segments.join('/'),
  __collection: segments.join('/'),
}));
const mockSetDoc = vi.fn(async () => undefined);
const mockGetDoc = vi.fn(async (ref: { path: string }) => {
  const data = store.get(ref.path);
  return { exists: () => data !== undefined, data: () => data };
});

const writes: { type: string; path: string; data?: unknown }[] = [];

const mockRunTransaction = vi.fn(
  async (_db: unknown, updateFn: (t: unknown) => Promise<unknown>) => {
    attempts += 1;
    const pending: { type: 'set' | 'update' | 'delete'; path: string; data?: unknown }[] = [];
    const snapshot = new Map(store);
    const transaction = {
      get: async (ref: { path: string }) => {
        const data = snapshot.get(ref.path);
        return { exists: () => data !== undefined, data: () => data };
      },
      set: (ref: { path: string }, data: unknown) => {
        pending.push({ type: 'set', path: ref.path, data });
      },
      update: (ref: { path: string }, data: unknown) => {
        pending.push({ type: 'update', path: ref.path, data });
      },
      delete: (ref: { path: string }) => pending.push({ type: 'delete', path: ref.path }),
    };
    const result = await updateFn(transaction);
    for (const write of pending) {
      writes.push(write);
      if (write.type === 'delete') store.delete(write.path);
      else if (write.type === 'set') store.set(write.path, write.data as Record<string, unknown>);
      else
        store.set(write.path, {
          ...(store.get(write.path) ?? {}),
          ...(write.data as Record<string, unknown>),
        });
    }
    committed = true;
    return result;
  },
);

vi.mock('firebase/firestore', () => ({
  collection: (db: unknown, ...segments: string[]) => mockCollection(db, ...segments),
  doc: (first: unknown, ...segments: string[]) => mockDoc(first, ...segments),
  getDoc: (ref: { path: string }) => mockGetDoc(ref),
  getDocs: vi.fn(async () => ({ docs: [], empty: true })),
  query: vi.fn((...args: unknown[]) => ({ args })),
  where: vi.fn((...args: unknown[]) => ({ where: args })),
  limit: (n: number) => ({ limit: n }),
  setDoc: (...args: unknown[]) => mockSetDoc(...(args as [])),
  runTransaction: (db: unknown, fn: (t: unknown) => Promise<unknown>) => mockRunTransaction(db, fn),
  writeBatch: vi.fn(() => ({ set: vi.fn(), delete: vi.fn(), commit: vi.fn() })),
  serverTimestamp: () => ({ __serverTimestamp: true }),
}));

const mockLoadQuestions = vi.fn();
vi.mock('../loadSelectedQuestionsWithSolutions.js', () => ({
  loadSelectedQuestionsWithSolutions: (...args: unknown[]) => mockLoadQuestions(...args),
}));

const mockListUdas = vi.fn();
const mockListLessons = vi.fn();
vi.mock('../../programs/programsService.js', () => ({
  listUdas: (...args: unknown[]) => mockListUdas(...args),
  listLessons: (...args: unknown[]) => mockListLessons(...args),
}));

const mockListLabels = vi.fn();
// `parseDifferentiationLabel` resta quello vero: è il parser fail-closed che la
// transazione usa per validare il contatore, e sostituirlo renderebbe il test
// cieco proprio sul controllo che interessa.
vi.mock('../../differentiation/differentiationLabelsService.js', async () => {
  const actual = await vi.importActual<typeof DifferentiationLabelsModule>(
    '../../differentiation/differentiationLabelsService.js',
  );
  return {
    ...actual,
    listDifferentiationLabels: (...args: unknown[]) => mockListLabels(...args),
  };
});

const mockListAssignments = vi.fn();
vi.mock('../../studentLabelAssignments/studentLabelAssignmentsService.js', () => ({
  listStudentLabelAssignments: (...args: unknown[]) => mockListAssignments(...args),
}));

const mockListStudents = vi.fn();
vi.mock('../../students/studentsService.js', () => ({
  listStudents: (...args: unknown[]) => mockListStudents(...args),
}));

const mockListQuestionIndex = vi.fn();
vi.mock('../questionIndexService.js', () => ({
  listQuestionIndex: (...args: unknown[]) => mockListQuestionIndex(...args),
}));

import {
  activateVerification,
  commitVerificationActivation,
  prepareVerificationActivation,
} from '../verificationsService.js';
import type { Firestore } from 'firebase/firestore';
import type { VerificationQuestionRef } from '../../../../types/firestore.js';

const db = {} as Firestore;
const OWNER = 'owner-uid';

function ref(id: string, over: Partial<VerificationQuestionRef> = {}): VerificationQuestionRef {
  return {
    questionIndexEntryId: id,
    questionLocalId: id.toUpperCase(),
    udaDir: 'uda-1',
    lessonFilename: 'lezione-1.md',
    poolStorageRef: 'pool/uda-1/lezione-1.pool.md',
    tipo: 'aperta',
    difficolta: 2,
    maxPoints: 2,
    ...over,
  };
}

const INDEX = ['q1', 'q2', 'q3'].map((id) => ({
  id,
  udaDir: 'uda-1',
  lessonFilename: 'lezione-1.md',
  poolStorageRef: 'pool/uda-1/lezione-1.pool.md',
  questionLocalId: id.toUpperCase(),
  tipo: 'aperta' as const,
  difficolta: 2 as const,
  maxPoints: 2,
  questionPreview: '',
}));

const DIFFERENTIATION = {
  version: 1 as const,
  questions: [
    {
      baseQuestionIndexEntryId: 'q1',
      choices: { L1: { kind: 'alternative' as const, questionIndexEntryId: 'q3' } },
    },
  ],
};

function seedDraft(over: Record<string, unknown> = {}) {
  store.set('verifications/ver-1', {
    ownerUid: OWNER,
    status: 'draft',
    onlineEnabled: false,
    studentPdfEnabled: false,
    config: {
      title: 'Verifica',
      classId: 'cls-1',
      programId: 'prog-1',
      importId: 'imp-1',
      verificationDate: '2026-09-01',
      questionRefs: [ref('q1'), ref('q2')],
      differentiation: DIFFERENTIATION,
    },
    ...over,
  });
}

function seedLabel(draftUsageCount = 1) {
  store.set('differentiationLabels/L1', {
    labelId: 'L1',
    ownerUid: OWNER,
    name: 'Percorso A',
    nameKey: 'percorso a',
    assignedCount: 1,
    draftUsageCount,
    createdAt: { seconds: 1, nanoseconds: 0, toMillis: () => 1000 },
    updatedAt: { seconds: 1, nanoseconds: 0, toMillis: () => 1000 },
  });
}

function verificationDoc() {
  return store.get('verifications/ver-1')!;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  writes.length = 0;
  committed = false;
  attempts = 0;
  mockLoadQuestions.mockImplementation(async (refs: VerificationQuestionRef[]) => ({
    ok: true,
    questions: refs.map((item) => ({
      ref: item,
      testo: `Testo ${item.questionLocalId}`,
      tipo: item.tipo,
      soluzione: 'ok',
    })),
  }));
  mockListUdas.mockResolvedValue([{ dir: 'uda-1', titolo: 'UDA 1' }]);
  mockListLessons.mockResolvedValue([
    { udaDir: 'uda-1', filename: 'lezione-1.md', titolo: 'Lezione 1' },
  ]);
  mockListLabels.mockResolvedValue([
    {
      labelId: 'L1',
      ownerUid: OWNER,
      name: 'Percorso A',
      nameKey: 'percorso a',
      assignedCount: 1,
      draftUsageCount: 1,
    },
  ]);
  mockListAssignments.mockResolvedValue([{ studentUid: 's1', ownerUid: OWNER, labelId: 'L1' }]);
  mockListStudents.mockResolvedValue([
    { id: 's1', ownerUid: OWNER },
    { id: 's2', ownerUid: OWNER },
  ]);
  mockListQuestionIndex.mockResolvedValue(INDEX);
});

describe('prepareVerificationActivation — preflight', () => {
  it('legge le domande selezionate e le alternative in UNA sola chiamata Storage', async () => {
    seedDraft();
    seedLabel();
    await prepareVerificationActivation('ver-1', null, OWNER, db);

    expect(mockLoadQuestions).toHaveBeenCalledTimes(1);
    const refs = mockLoadQuestions.mock.calls[0]![0] as VerificationQuestionRef[];
    expect(refs.map((item) => item.questionIndexEntryId)).toEqual(['q1', 'q2', 'q3']);
  });

  it('una verifica senza varianti non legge etichette, assegnazioni, studenti né indice', async () => {
    seedDraft({
      config: {
        title: 'Verifica',
        classId: 'cls-1',
        programId: 'prog-1',
        importId: 'imp-1',
        questionRefs: [ref('q1')],
      },
    });
    const plan = await prepareVerificationActivation('ver-1', null, OWNER, db);

    expect(mockListLabels).not.toHaveBeenCalled();
    expect(mockListAssignments).not.toHaveBeenCalled();
    expect(mockListStudents).not.toHaveBeenCalled();
    expect(mockListQuestionIndex).not.toHaveBeenCalled();
    expect(plan.assignmentMode).toBe('same_questions');
    expect(plan.differentiation).toBeNull();
    expect(plan.summary).toBeNull();
  });

  it('deriva assignmentMode = server_resolved in presenza di differenziazione', async () => {
    seedDraft();
    seedLabel();
    const plan = await prepareVerificationActivation('ver-1', null, OWNER, db);
    expect(plan.assignmentMode).toBe('server_resolved');
  });

  it('il riepilogo è derivato dagli stessi dati che verranno congelati', async () => {
    seedDraft();
    seedLabel();
    const plan = await prepareVerificationActivation('ver-1', null, OWNER, db);
    expect(plan.summary?.differentiatedStudents).toBe(1);
    expect(plan.summary?.unlabelledStudents).toBe(1);
    expect(plan.summary?.rows.map((row) => row.labelName)).toEqual([
      'Nessuna etichetta',
      'Percorso A',
    ]);
  });
});

describe('commitVerificationActivation — snapshot e proiezione', () => {
  it('congela differentiation e labelAssignments dentro teacherSnapshot', async () => {
    seedDraft();
    seedLabel();
    await activateVerification('ver-1', null, OWNER, db);

    const snapshot = verificationDoc().teacherSnapshot as Record<string, unknown>;
    expect(snapshot.differentiation).toEqual({
      version: 1,
      questions: [{ baseOrder: 0, choices: { L1: { kind: 'alternative', order: 2 } } }],
      labels: [{ labelId: 'L1', labelName: 'Percorso A' }],
      differentiatedAlternativeOrders: [2],
    });
    expect(snapshot.labelAssignments).toEqual({ version: 1, byStudentUid: { s1: 'L1' } });
  });

  it('questions[] contiene l’unione: selezionate più alternative, con soluzione', () => {
    return (async () => {
      seedDraft();
      seedLabel();
      await activateVerification('ver-1', null, OWNER, db);
      const snapshot = verificationDoc().teacherSnapshot as Record<string, unknown>;
      const questions = snapshot.questions as { order: number; soluzione: string }[];
      expect(questions.map((q) => q.order)).toEqual([0, 1, 2]);
      for (const q of questions) expect(q.soluzione).toBe('ok');
    })();
  });

  it('commonQuestionOrders è congelato anche in same_questions', async () => {
    seedDraft();
    seedLabel();
    await activateVerification('ver-1', null, OWNER, db);
    const snapshot = verificationDoc().teacherSnapshot as Record<string, unknown>;
    expect(snapshot.commonQuestionOrders).toEqual([0, 1]);
    expect(snapshot.equivalentGroups).toEqual([]);
    expect(snapshot.distributionMode).toBe('same_questions');
  });

  it('la proiezione non contiene la base differenziata né alcuna alternativa', async () => {
    seedDraft();
    seedLabel();
    await activateVerification('ver-1', null, OWNER, db);
    const projection = store.get('verifications/ver-1/publishedProjection/data')!;
    const questions = projection.questions as { order: number }[];
    expect(questions.map((q) => q.order)).toEqual([1]);
    expect(projection.assignmentMode).toBe('server_resolved');
  });

  it('la proiezione non contiene alcun termine vietato dal perimetro privacy', async () => {
    seedDraft();
    seedLabel();
    await activateVerification('ver-1', null, OWNER, db);
    const serialized = JSON.stringify(store.get('verifications/ver-1/publishedProjection/data'));
    for (const forbidden of [
      'labelId',
      'labelName',
      'labels',
      'differentiation',
      'differentiated',
      'Percorso A',
      'nameKey',
      'draftUsageCount',
      'assignedCount',
      'byStudentUid',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('senza differenziazione la proiezione porta assignmentMode = same_questions', async () => {
    seedDraft({
      config: {
        title: 'Verifica',
        classId: 'cls-1',
        programId: 'prog-1',
        importId: 'imp-1',
        questionRefs: [ref('q1')],
      },
    });
    await activateVerification('ver-1', null, OWNER, db);
    const projection = store.get('verifications/ver-1/publishedProjection/data')!;
    expect(projection.assignmentMode).toBe('same_questions');
    const snapshot = verificationDoc().teacherSnapshot as Record<string, unknown>;
    expect(snapshot.differentiation).toBeUndefined();
    expect(snapshot.labelAssignments).toBeUndefined();
  });
});

describe('contatori: decremento nello stesso commit', () => {
  it('decrementa ogni etichetta congelata con un valore esplicito', async () => {
    seedDraft();
    seedLabel(3);
    await activateVerification('ver-1', null, OWNER, db);
    expect(store.get('differentiationLabels/L1')!.draftUsageCount).toBe(2);
  });

  it('stato, snapshot, proiezione e decremento sono nello stesso commit', async () => {
    seedDraft();
    seedLabel();
    await activateVerification('ver-1', null, OWNER, db);
    const paths = writes.map((write) => write.path);
    expect(paths).toContain('verifications/ver-1');
    expect(paths).toContain('verifications/ver-1/publishedProjection/data');
    expect(paths).toContain('differentiationLabels/L1');
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
  });

  it('T41d — un contatore incoerente annulla l’intera attivazione', async () => {
    seedDraft();
    seedLabel(0);
    await expect(activateVerification('ver-1', null, OWNER, db)).rejects.toThrow(/incoerente/);
    expect(writes).toEqual([]);
    expect(verificationDoc().status).toBe('draft');
    expect(store.has('verifications/ver-1/publishedProjection/data')).toBe(false);
  });

  it('un’etichetta eliminata fra preflight e commit fa fallire senza congelare nulla', async () => {
    seedDraft();
    seedLabel();
    const plan = await prepareVerificationActivation('ver-1', null, OWNER, db);
    store.delete('differentiationLabels/L1');
    await expect(commitVerificationActivation(plan, db)).rejects.toThrow(/non esiste più/);
    expect(writes).toEqual([]);
    expect(verificationDoc().status).toBe('draft');
  });

  it('nessun audit viene scritto quando la transazione fallisce', async () => {
    seedDraft();
    seedLabel(0);
    await expect(activateVerification('ver-1', null, OWNER, db)).rejects.toThrow();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('un solo audit verification.activated, fuori dalla transazione', async () => {
    seedDraft();
    seedLabel();
    await activateVerification('ver-1', null, OWNER, db);
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const auditPayload = (mockSetDoc.mock.calls[0] as unknown[])[1] as { action: string };
    expect(auditPayload.action).toBe('verification.activated');
  });
});

describe('guardie in transazione G17→G21', () => {
  it('G17/G21 — verifica già attiva: blocca senza scrivere nulla', async () => {
    seedDraft();
    seedLabel();
    const plan = await prepareVerificationActivation('ver-1', null, OWNER, db);
    store.set('verifications/ver-1', { ...verificationDoc(), status: 'active' });
    await expect(commitVerificationActivation(plan, db)).rejects.toThrow(/non è in bozza/);
    expect(writes).toEqual([]);
  });

  it('G18 — selezione domande cambiata durante l’attivazione', async () => {
    seedDraft();
    seedLabel();
    const plan = await prepareVerificationActivation('ver-1', null, OWNER, db);
    const doc = verificationDoc();
    store.set('verifications/ver-1', {
      ...doc,
      config: { ...(doc.config as object), questionRefs: [ref('q1')] },
    });
    await expect(commitVerificationActivation(plan, db)).rejects.toThrow(/selezione delle domande/);
    expect(writes).toEqual([]);
  });

  it('G19 — configurazione varianti cambiata durante l’attivazione', async () => {
    seedDraft();
    seedLabel();
    const plan = await prepareVerificationActivation('ver-1', null, OWNER, db);
    const doc = verificationDoc();
    store.set('verifications/ver-1', {
      ...doc,
      config: {
        ...(doc.config as object),
        differentiation: {
          version: 1,
          questions: [{ baseQuestionIndexEntryId: 'q1', choices: { L1: { kind: 'none' } } }],
        },
      },
    });
    await expect(commitVerificationActivation(plan, db)).rejects.toThrow(
      /configurazione delle varianti/,
    );
    expect(writes).toEqual([]);
  });

  it('G20 — assegnazioni cambiate fra preflight e transazione', async () => {
    seedDraft();
    seedLabel();
    const plan = await prepareVerificationActivation('ver-1', null, OWNER, db);
    mockListAssignments.mockResolvedValue([
      { studentUid: 's1', ownerUid: OWNER, labelId: 'L1' },
      { studentUid: 's2', ownerUid: OWNER, labelId: 'L1' },
    ]);
    await expect(commitVerificationActivation(plan, db)).rejects.toThrow(
      /etichette degli studenti sono cambiate/,
    );
    expect(writes).toEqual([]);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it('G20 — assegnazioni invariate: l’impronta combacia e la transazione parte', async () => {
    seedDraft();
    seedLabel();
    const plan = await prepareVerificationActivation('ver-1', null, OWNER, db);
    await commitVerificationActivation(plan, db);
    expect(committed).toBe(true);
    expect(attempts).toBe(1);
  });

  it('G21 — replay dell’attivazione: la seconda si ferma su G17, zero scritture nuove', async () => {
    seedDraft();
    seedLabel();
    const plan = await prepareVerificationActivation('ver-1', null, OWNER, db);
    await commitVerificationActivation(plan, db);
    const after = writes.length;
    await expect(commitVerificationActivation(plan, db)).rejects.toThrow(/non è in bozza/);
    expect(writes).toHaveLength(after);
    expect(store.get('differentiationLabels/L1')!.draftUsageCount).toBe(0);
  });
});

describe('blocker: nessuna attivazione con un percorso vuoto', () => {
  it('assertNoBlockers ferma il commit anche se la UI avesse lasciato premere', async () => {
    store.set('verifications/ver-1', {
      ownerUid: OWNER,
      status: 'draft',
      config: {
        title: 'Verifica',
        classId: 'cls-1',
        programId: 'prog-1',
        importId: 'imp-1',
        questionRefs: [ref('q1')],
        differentiation: {
          version: 1,
          questions: [{ baseQuestionIndexEntryId: 'q1', choices: { L1: { kind: 'none' } } }],
        },
      },
    });
    seedLabel();
    const plan = await prepareVerificationActivation('ver-1', null, OWNER, db);
    expect(plan.blockers).toHaveLength(1);
    await expect(commitVerificationActivation(plan, db)).rejects.toThrow(/Impossibile attivare/);
    expect(writes).toEqual([]);
  });
});
