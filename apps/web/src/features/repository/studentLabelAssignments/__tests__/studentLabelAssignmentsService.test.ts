import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

/**
 * VDIF-02 — test del service canonico dell'assegnazione studente → etichetta.
 *
 * La transazione è simulata con lo stesso piccolo store in memoria dei test
 * VDIF-01, che riproduce le tre proprietà di Firestore da cui dipendono le
 * garanzie di questo service:
 *
 * 1. `transaction.get` registra il documento letto **anche se assente** — è ciò
 *    che rende mutuamente esclusive due assegnazioni concorrenti sullo stesso
 *    studente;
 * 2. tutte le letture di un tentativo vedono lo **stesso istante**: una modifica
 *    concorrente non compare a metà callback;
 * 3. il commit fallisce se un documento letto è cambiato nel frattempo, e il
 *    callback riparte da capo.
 *
 * Senza la (2) i test dimostrerebbero un comportamento che il codice reale non
 * ha: il callback deciderebbe su uno stato misto che Firestore non produce mai.
 */

type Store = Map<string, Record<string, unknown>>;

const store: Store = new Map();
/** Mutazione applicata da «un'altra scheda» alla prima lettura di un path. */
let concurrentMutation: { path: string; apply: () => void; fired: boolean } | null = null;
let commitAttempts = 0;

let autoId = 0;
const mockDoc = vi.fn((first: unknown, ...segments: string[]) => {
  // `doc(collectionRef)` — nuovo documento con id generato: così il service
  // crea l'evento di audit dentro la transazione.
  if (typeof first === 'object' && first !== null && '__collection' in first) {
    return { path: `${(first as { __collection: string }).__collection}/auto-${++autoId}` };
  }
  return { path: segments.join('/') };
});
const mockCollection = vi.fn((_db: unknown, name: string) => ({ path: name, __collection: name }));
const mockQuery = vi.fn((coll: unknown, ...constraints: unknown[]) => ({ coll, constraints }));
const mockWhere = vi.fn((field: string, op: string, value: unknown) => ({ field, op, value }));
const mockServerTimestamp = vi.fn(() => ({ __serverTimestamp: true }));
const mockGetDocs = vi.fn();

/**
 * Il commit **risolve** i sentinel `serverTimestamp()`, come fa il server. Non è
 * un dettaglio cosmetico: senza questo, un documento appena scritto e riletto
 * porterebbe un sentinel non risolto e il parser fail-closed lo rifiuterebbe —
 * un fallimento che il codice reale non ha, e che nasconderebbe quello che il
 * test vuole dimostrare (il replay di un'assegnazione è un no-op).
 */
function resolveSentinels(data: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const isSentinel =
      typeof value === 'object' && value !== null && '__serverTimestamp' in (value as object);
    resolved[key] = isSentinel ? ts(COMMIT_MILLIS) : value;
  }
  return resolved;
}

const mockRunTransaction = vi.fn(
  async (_db: unknown, updateFn: (t: unknown) => Promise<unknown>) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      commitAttempts += 1;
      const readVersions = new Map<string, string>();
      const writes: { type: 'set' | 'update' | 'delete'; path: string; data?: unknown }[] = [];
      // Istante di lettura del tentativo: tutte le get vedono questo stato.
      const readSnapshot = new Map(store);

      const transaction = {
        get: async (ref: { path: string }) => {
          const path = ref.path;
          const data = readSnapshot.get(path);
          readVersions.set(path, JSON.stringify(data ?? null));
          if (concurrentMutation && !concurrentMutation.fired && concurrentMutation.path === path) {
            concurrentMutation.fired = true;
            concurrentMutation.apply();
          }
          return { exists: () => data !== undefined, data: () => data };
        },
        set: (ref: { path: string }, data: unknown) => {
          writes.push({ type: 'set', path: ref.path, data });
        },
        update: (ref: { path: string }, data: unknown) => {
          writes.push({ type: 'update', path: ref.path, data });
        },
        delete: (ref: { path: string }) => {
          writes.push({ type: 'delete', path: ref.path });
        },
      };

      const result = await updateFn(transaction);

      const stale = [...readVersions.entries()].some(
        ([path, version]) => JSON.stringify(store.get(path) ?? null) !== version,
      );
      if (stale) continue;

      for (const write of writes) {
        if (write.type === 'delete') store.delete(write.path);
        else if (write.type === 'set')
          store.set(write.path, resolveSentinels(write.data as Record<string, unknown>));
        else
          store.set(write.path, {
            ...(store.get(write.path) ?? {}),
            ...resolveSentinels(write.data as Record<string, unknown>),
          });
      }
      return result;
    }
    throw new Error('Transazione non riuscita dopo troppi tentativi.');
  },
);

vi.mock('firebase/firestore', () => ({
  collection: (db: unknown, name: string) => mockCollection(db, name),
  doc: (first: unknown, ...segments: string[]) => mockDoc(first, ...segments),
  getDocs: (built: unknown) => mockGetDocs(built),
  query: (coll: unknown, ...constraints: unknown[]) => mockQuery(coll, ...constraints),
  runTransaction: (db: unknown, updateFn: (t: unknown) => Promise<unknown>) =>
    mockRunTransaction(db, updateFn),
  serverTimestamp: () => mockServerTimestamp(),
  where: (field: string, op: string, value: unknown) => mockWhere(field, op, value),
}));

import {
  StudentLabelAssignmentError,
  listStudentLabelAssignments,
  parseStudentLabelAssignment,
  removeStudentWithAssignment,
  setStudentLabelAssignment,
} from '../studentLabelAssignmentsService.js';
import type { Firestore } from 'firebase/firestore';

const fakeDb = {} as Firestore;
const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-uid';
const STUDENT = 'student-1';

function ts(millis: number) {
  return {
    seconds: Math.floor(millis / 1000),
    nanoseconds: (millis % 1000) * 1e6,
    toMillis: () => millis,
  };
}

const CREATED_AT = ts(1_760_000_000_000);
const UPDATED_AT = ts(1_760_000_500_000);
/** Istante in cui il commit simulato risolve i `serverTimestamp()`. */
const COMMIT_MILLIS = 1_760_001_000_000;

function validAssignment(over: Record<string, unknown> = {}) {
  return {
    studentUid: STUDENT,
    ownerUid: OWNER_UID,
    labelId: 'label-a',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...over,
  };
}

function seedStudent(uid = STUDENT, ownerUid = OWNER_UID) {
  store.set(`students/${uid}`, {
    uid,
    ownerUid,
    email: `${uid}@test.com`,
    displayName: uid,
    status: 'approved',
    classId: null,
  });
}

function seedLabel(labelId: string, over: Record<string, unknown> = {}) {
  store.set(`differentiationLabels/${labelId}`, {
    labelId,
    ownerUid: OWNER_UID,
    name: labelId.toUpperCase(),
    nameKey: labelId,
    assignedCount: 0,
    draftUsageCount: 0,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...over,
  });
}

function seedAssignment(over: Record<string, unknown> = {}) {
  const assignment = validAssignment(over);
  store.set(`studentLabelAssignments/${assignment.studentUid as string}`, assignment);
  return assignment;
}

function assignmentDocs() {
  return [...store.keys()].filter((key) => key.startsWith('studentLabelAssignments/'));
}

function auditWrites() {
  return [...store.keys()]
    .filter((key) => key.startsWith('auditEvents/'))
    .map((key) => store.get(key)!);
}

function counts(labelId: string) {
  return store.get(`differentiationLabels/${labelId}`)?.assignedCount;
}

/** Fotografia dello store, per dimostrare che un errore non lascia scritture. */
function snapshot() {
  return JSON.stringify([...store.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  concurrentMutation = null;
  commitAttempts = 0;
  autoId = 0;
});

describe('parseStudentLabelAssignment — fail-closed', () => {
  it('accetta la forma esatta a cinque chiavi', () => {
    const parsed = parseStudentLabelAssignment(STUDENT, validAssignment(), OWNER_UID);
    expect(parsed).toEqual({ studentUid: STUDENT, ownerUid: OWNER_UID, labelId: 'label-a' });
  });

  it('rifiuta il documento assente', () => {
    expect(() => parseStudentLabelAssignment(STUDENT, undefined, OWNER_UID)).toThrow(
      StudentLabelAssignmentError,
    );
  });

  it('rifiuta una chiave in più', () => {
    expect(() =>
      parseStudentLabelAssignment(STUDENT, validAssignment({ note: 'x' }), OWNER_UID),
    ).toThrow(StudentLabelAssignmentError);
  });

  it('rifiuta una chiave in meno', () => {
    const withoutUpdatedAt = { ...validAssignment() } as Record<string, unknown>;
    delete withoutUpdatedAt.updatedAt;
    expect(() => parseStudentLabelAssignment(STUDENT, withoutUpdatedAt, OWNER_UID)).toThrow(
      StudentLabelAssignmentError,
    );
  });

  it('rifiuta un studentUid diverso dall’id del documento', () => {
    expect(() =>
      parseStudentLabelAssignment(STUDENT, validAssignment({ studentUid: 'altro' }), OWNER_UID),
    ).toThrow(StudentLabelAssignmentError);
  });

  it('rifiuta un documento di un altro docente', () => {
    expect(() => parseStudentLabelAssignment(STUDENT, validAssignment(), OTHER_UID)).toThrow(
      StudentLabelAssignmentError,
    );
  });

  it.each([
    ['', 'stringa vuota'],
    [null, 'null'],
    ['a/b', 'con slash'],
    [7, 'numero'],
  ] as const)('rifiuta un labelId non usabile come id (%s)', (labelId, _descrizione) => {
    expect(() =>
      parseStudentLabelAssignment(STUDENT, validAssignment({ labelId }), OWNER_UID),
    ).toThrow(StudentLabelAssignmentError);
  });

  it('rifiuta un sentinel serverTimestamp non risolto', () => {
    expect(() =>
      parseStudentLabelAssignment(
        STUDENT,
        validAssignment({ updatedAt: { __serverTimestamp: true } }),
        OWNER_UID,
      ),
    ).toThrow(StudentLabelAssignmentError);
  });

  it('rifiuta updatedAt anteriore a createdAt', () => {
    expect(() =>
      parseStudentLabelAssignment(
        STUDENT,
        validAssignment({ createdAt: UPDATED_AT, updatedAt: CREATED_AT }),
        OWNER_UID,
      ),
    ).toThrow(StudentLabelAssignmentError);
  });
});

describe('listStudentLabelAssignments — una sola query', () => {
  it('filtra su ownerUid e non legge nulla per studente', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [{ id: STUDENT, data: () => validAssignment() }],
    });
    const items = await listStudentLabelAssignments(OWNER_UID, fakeDb);
    expect(items).toEqual([{ studentUid: STUDENT, ownerUid: OWNER_UID, labelId: 'label-a' }]);
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledWith('ownerUid', '==', OWNER_UID);
    expect(mockCollection).toHaveBeenCalledWith(fakeDb, 'studentLabelAssignments');
  });

  it('un documento malformato fa fallire l’intera lista, mai una lista parziale', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        { id: STUDENT, data: () => validAssignment() },
        { id: 'student-2', data: () => ({ studentUid: 'student-2' }) },
      ],
    });
    await expect(listStudentLabelAssignments(OWNER_UID, fakeDb)).rejects.toThrow(
      StudentLabelAssignmentError,
    );
  });
});

describe('setStudentLabelAssignment — i quattro casi', () => {
  it('nessuna → A: crea l’assegnazione e incrementa il contatore nello stesso commit', async () => {
    seedStudent();
    seedLabel('label-a', { assignedCount: 2 });

    const result = await setStudentLabelAssignment(STUDENT, 'label-a', OWNER_UID, fakeDb);

    expect(result).toEqual({
      studentUid: STUDENT,
      labelId: 'label-a',
      labelCounts: [{ labelId: 'label-a', assignedCount: 3 }],
      changed: true,
    });
    expect(counts('label-a')).toBe(3);
    expect(store.get(`studentLabelAssignments/${STUDENT}`)).toMatchObject({
      studentUid: STUDENT,
      ownerUid: OWNER_UID,
      labelId: 'label-a',
    });
    expect(commitAttempts).toBe(1);
  });

  it('A → nessuna: elimina l’assegnazione e decrementa', async () => {
    seedStudent();
    seedLabel('label-a', { assignedCount: 1 });
    seedAssignment();

    const result = await setStudentLabelAssignment(STUDENT, null, OWNER_UID, fakeDb);

    expect(result.labelId).toBeNull();
    expect(result.labelCounts).toEqual([{ labelId: 'label-a', assignedCount: 0 }]);
    expect(assignmentDocs()).toEqual([]);
    expect(counts('label-a')).toBe(0);
  });

  it('A → B: −1 su A e +1 su B nello stesso commit, createdAt conservato', async () => {
    seedStudent();
    seedLabel('label-a', { assignedCount: 3 });
    seedLabel('label-b', { assignedCount: 0 });
    seedAssignment();

    const result = await setStudentLabelAssignment(STUDENT, 'label-b', OWNER_UID, fakeDb);

    expect(result.changed).toBe(true);
    expect(result.labelCounts).toEqual(
      expect.arrayContaining([
        { labelId: 'label-a', assignedCount: 2 },
        { labelId: 'label-b', assignedCount: 1 },
      ]),
    );
    expect(counts('label-a')).toBe(2);
    expect(counts('label-b')).toBe(1);
    const stored = store.get(`studentLabelAssignments/${STUDENT}`)!;
    expect(stored.labelId).toBe('label-b');
    // `createdAt` è quando lo studente ha ricevuto la **prima** etichetta.
    expect(stored.createdAt).toBe(CREATED_AT);
    expect(commitAttempts).toBe(1);
  });

  it('A → A: no-op, zero scritture e zero audit', async () => {
    seedStudent();
    seedLabel('label-a', { assignedCount: 1 });
    seedAssignment();
    const before = snapshot();

    const result = await setStudentLabelAssignment(STUDENT, 'label-a', OWNER_UID, fakeDb);

    expect(result).toEqual({
      studentUid: STUDENT,
      labelId: 'label-a',
      labelCounts: [],
      changed: false,
    });
    expect(snapshot()).toBe(before);
    expect(auditWrites()).toEqual([]);
  });

  it('nessuna → nessuna: no-op anche senza documento di assegnazione', async () => {
    seedStudent();
    const before = snapshot();

    const result = await setStudentLabelAssignment(STUDENT, null, OWNER_UID, fakeDb);

    expect(result.changed).toBe(false);
    expect(snapshot()).toBe(before);
  });
});

describe('setStudentLabelAssignment — audit', () => {
  it('scrive student.labelAssigned nello stesso commit, senza labelId né nome in reason', async () => {
    seedStudent();
    seedLabel('label-a');

    await setStudentLabelAssignment(STUDENT, 'label-a', OWNER_UID, fakeDb);

    const audit = auditWrites();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorUid: OWNER_UID,
      action: 'student.labelAssigned',
      targetId: STUDENT,
      outcome: 'success',
      reason: null,
    });
    // Nessun campo dell'audit nomina l'etichetta, in nessuna forma.
    expect(JSON.stringify(audit[0])).not.toContain('label-a');
    expect(JSON.stringify(audit[0])).not.toContain('LABEL-A');
  });
});

describe('setStudentLabelAssignment — fail-closed', () => {
  it('studente inesistente ⇒ student_not_found e zero scritture', async () => {
    seedLabel('label-a');
    const before = snapshot();

    await expect(
      setStudentLabelAssignment(STUDENT, 'label-a', OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'student_not_found' });
    expect(snapshot()).toBe(before);
  });

  it('studente di un altro docente ⇒ student_not_found e zero scritture', async () => {
    seedStudent(STUDENT, OTHER_UID);
    seedLabel('label-a');
    const before = snapshot();

    await expect(
      setStudentLabelAssignment(STUDENT, 'label-a', OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'student_not_found' });
    expect(snapshot()).toBe(before);
  });

  it('etichetta inesistente ⇒ label_not_found e zero scritture', async () => {
    seedStudent();
    const before = snapshot();

    await expect(
      setStudentLabelAssignment(STUDENT, 'label-a', OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'label_not_found' });
    expect(snapshot()).toBe(before);
  });

  it('etichetta di un altro docente ⇒ nessuna scrittura', async () => {
    seedStudent();
    seedLabel('label-a', { ownerUid: OTHER_UID });
    const before = snapshot();

    await expect(setStudentLabelAssignment(STUDENT, 'label-a', OWNER_UID, fakeDb)).rejects.toThrow(
      StudentLabelAssignmentError,
    );
    expect(snapshot()).toBe(before);
  });

  it('etichetta malformata ⇒ corrupted_state e zero scritture', async () => {
    seedStudent();
    store.set('differentiationLabels/label-a', { labelId: 'label-a', ownerUid: OWNER_UID });
    const before = snapshot();

    await expect(
      setStudentLabelAssignment(STUDENT, 'label-a', OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'corrupted_state' });
    expect(snapshot()).toBe(before);
  });

  it('assegnazione malformata ⇒ corrupted_state e zero scritture', async () => {
    seedStudent();
    seedLabel('label-a');
    seedLabel('label-b');
    store.set(`studentLabelAssignments/${STUDENT}`, { studentUid: STUDENT, labelId: 'label-a' });
    const before = snapshot();

    await expect(
      setStudentLabelAssignment(STUDENT, 'label-b', OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'corrupted_state' });
    expect(snapshot()).toBe(before);
  });

  it('contatore già a zero da decrementare ⇒ corrupted_state, mai riparato in silenzio', async () => {
    seedStudent();
    seedLabel('label-a', { assignedCount: 0 });
    seedAssignment();
    const before = snapshot();

    await expect(setStudentLabelAssignment(STUDENT, null, OWNER_UID, fakeDb)).rejects.toMatchObject(
      {
        code: 'corrupted_state',
      },
    );
    // Nessun `max(0, n - 1)`: il contatore resta com'era, visibile e da spiegare.
    expect(counts('label-a')).toBe(0);
    expect(snapshot()).toBe(before);
  });

  it('labelId non usabile come id ⇒ rifiutato prima di aprire la transazione', async () => {
    await expect(
      setStudentLabelAssignment(STUDENT, 'a/b', OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'label_not_found' });
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });
});

describe('setStudentLabelAssignment — corse concorrenti', () => {
  it('l’etichetta viene eliminata da un’altra scheda dopo la lettura: il commit riparte e fallisce', async () => {
    seedStudent();
    seedLabel('label-a', { assignedCount: 0 });

    concurrentMutation = {
      path: 'differentiationLabels/label-a',
      apply: () => store.delete('differentiationLabels/label-a'),
      fired: false,
    };

    await expect(
      setStudentLabelAssignment(STUDENT, 'label-a', OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'label_not_found' });
    expect(commitAttempts).toBe(2);
    expect(assignmentDocs()).toEqual([]);
  });

  it('lo studente viene rimosso da un’altra scheda: nessuna assegnazione orfana', async () => {
    seedStudent();
    seedLabel('label-a');

    concurrentMutation = {
      path: `students/${STUDENT}`,
      apply: () => store.delete(`students/${STUDENT}`),
      fired: false,
    };

    await expect(
      setStudentLabelAssignment(STUDENT, 'label-a', OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'student_not_found' });
    expect(assignmentDocs()).toEqual([]);
  });

  it('due assegnazioni concorrenti sullo stesso studente: il secondo tentativo riparte e vede la prima', async () => {
    seedStudent();
    seedLabel('label-a', { assignedCount: 0 });
    seedLabel('label-b', { assignedCount: 0 });

    // «Un'altra scheda» assegna label-a mentre questa transazione sta leggendo
    // l'assegnazione (ancora assente): il commit trova il documento cambiato.
    concurrentMutation = {
      path: `studentLabelAssignments/${STUDENT}`,
      apply: () => {
        store.set(`studentLabelAssignments/${STUDENT}`, validAssignment());
        store.set('differentiationLabels/label-a', {
          ...store.get('differentiationLabels/label-a')!,
          assignedCount: 1,
        });
      },
      fired: false,
    };

    const result = await setStudentLabelAssignment(STUDENT, 'label-b', OWNER_UID, fakeDb);

    // Il retry non ha sovrascritto alla cieca: ha riletto A e l'ha rilasciata.
    expect(commitAttempts).toBe(2);
    expect(result.labelId).toBe('label-b');
    expect(counts('label-a')).toBe(0);
    expect(counts('label-b')).toBe(1);
    expect(store.get(`studentLabelAssignments/${STUDENT}`)!.labelId).toBe('label-b');
  });

  it('replay della stessa assegnazione: il secondo passaggio è un no-op, non un doppio incremento', async () => {
    seedStudent();
    seedLabel('label-a', { assignedCount: 0 });

    await setStudentLabelAssignment(STUDENT, 'label-a', OWNER_UID, fakeDb);
    const second = await setStudentLabelAssignment(STUDENT, 'label-a', OWNER_UID, fakeDb);

    expect(second.changed).toBe(false);
    expect(counts('label-a')).toBe(1);
    expect(auditWrites()).toHaveLength(1);
  });
});

describe('removeStudentWithAssignment — atomicità', () => {
  it('senza assegnazione: elimina lo studente e scrive l’audit, nessuna etichetta toccata', async () => {
    seedStudent();
    seedLabel('label-a', { assignedCount: 1 });

    const result = await removeStudentWithAssignment(STUDENT, OWNER_UID, fakeDb);

    expect(result).toEqual({ studentUid: STUDENT, releasedLabel: null });
    expect(store.has(`students/${STUDENT}`)).toBe(false);
    expect(counts('label-a')).toBe(1);
    expect(auditWrites()).toHaveLength(1);
    expect(auditWrites()[0]).toMatchObject({ action: 'student.removed', targetId: STUDENT });
  });

  it('con assegnazione: elimina studente e assegnazione e decrementa, in un solo commit', async () => {
    seedStudent();
    seedLabel('label-a', { assignedCount: 2 });
    seedAssignment();

    const result = await removeStudentWithAssignment(STUDENT, OWNER_UID, fakeDb);

    expect(result.releasedLabel).toEqual({ labelId: 'label-a', assignedCount: 1 });
    expect(store.has(`students/${STUDENT}`)).toBe(false);
    expect(assignmentDocs()).toEqual([]);
    expect(counts('label-a')).toBe(1);
    expect(commitAttempts).toBe(1);
  });

  it('contatore incoerente ⇒ lo studente NON viene eliminato', async () => {
    seedStudent();
    seedLabel('label-a', { assignedCount: 0 });
    seedAssignment();
    const before = snapshot();

    await expect(removeStudentWithAssignment(STUDENT, OWNER_UID, fakeDb)).rejects.toMatchObject({
      code: 'corrupted_state',
    });
    expect(store.has(`students/${STUDENT}`)).toBe(true);
    expect(snapshot()).toBe(before);
  });

  it('etichetta puntata inesistente ⇒ lo studente NON viene eliminato', async () => {
    seedStudent();
    seedAssignment();
    const before = snapshot();

    await expect(removeStudentWithAssignment(STUDENT, OWNER_UID, fakeDb)).rejects.toMatchObject({
      code: 'label_not_found',
    });
    expect(store.has(`students/${STUDENT}`)).toBe(true);
    expect(snapshot()).toBe(before);
  });

  it('studente di un altro docente ⇒ nessuna scrittura', async () => {
    seedStudent(STUDENT, OTHER_UID);
    const before = snapshot();

    await expect(removeStudentWithAssignment(STUDENT, OWNER_UID, fakeDb)).rejects.toMatchObject({
      code: 'student_not_found',
    });
    expect(snapshot()).toBe(before);
  });
});
