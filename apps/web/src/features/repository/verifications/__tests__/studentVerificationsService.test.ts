import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/firebase.js', () => ({ db: {} }));

const mockGetDocs = vi.fn();
const mockGetOwnStudentDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  collectionGroup: (_db: unknown, name: string) => ({ __collectionGroup: name }),
  query: (collRef: unknown, ...clauses: unknown[]) => ({ __collRef: collRef, __clauses: clauses }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
}));

vi.mock('../../students/studentsService.js', () => ({
  getOwnStudentDoc: (...args: unknown[]) => mockGetOwnStudentDoc(...args),
}));

import { loadStudentVerifications } from '../studentVerificationsService.js';
import type { Firestore } from 'firebase/firestore';

const fakeDb = {} as Firestore;
const STUDENT_UID = 'student-uid';

function fakeDoc(verificationId: string, data: Record<string, unknown>) {
  return {
    id: 'data',
    data: () => data,
    ref: { parent: { parent: { id: verificationId } } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadStudentVerifications — no class assigned', () => {
  it('returns no-class when classId is null', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: null });

    const result = await loadStudentVerifications(STUDENT_UID, fakeDb);
    expect(result).toEqual({ status: 'no-class' });
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('returns no-class when the student document does not exist', async () => {
    mockGetOwnStudentDoc.mockResolvedValue(null);

    const result = await loadStudentVerifications(STUDENT_UID, fakeDb);
    expect(result).toEqual({ status: 'no-class' });
  });
});

describe('loadStudentVerifications — class filtering', () => {
  it('queries the publishedProjection collection group filtered by the student classId', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-a' });
    mockGetDocs.mockResolvedValue({ docs: [] });

    await loadStudentVerifications(STUDENT_UID, fakeDb);

    const [queryArg] = mockGetDocs.mock.calls[0] as [
      {
        __collRef: { __collectionGroup: string };
        __clauses: { field: string; op: string; value: string }[];
      },
    ];
    expect(queryArg.__collRef.__collectionGroup).toBe('publishedProjection');
    expect(queryArg.__clauses[0]).toEqual({ field: 'classId', op: '==', value: 'class-a' });
  });

  it('maps each publishedProjection doc to its parent verification id', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-a' });
    mockGetDocs.mockResolvedValue({
      docs: [
        fakeDoc('ver-1', {
          ownerUid: 'owner',
          title: 'Verifica 1',
          className: 'Classe A',
          classId: 'class-a',
          questions: [{ order: 0, tipo: 'aperta', maxPoints: 3, testo: 'Domanda?' }],
          activatedAt: { seconds: 100 },
        }),
      ],
    });

    const result = await loadStudentVerifications(STUDENT_UID, fakeDb);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.verifications).toEqual([
      {
        id: 'ver-1',
        title: 'Verifica 1',
        className: 'Classe A',
        activatedAt: { seconds: 100 },
        questionCount: 1,
        questions: [{ order: 0, tipo: 'aperta', maxPoints: 3, testo: 'Domanda?' }],
        onlineEnabled: false,
        studentPdfEnabled: false,
        distributionMode: 'same_questions',
        ownerUid: 'owner',
        status: 'active',
      },
    ]);
  });

  it('keeps closed public projections visible and normalizes legacy status to active', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-a' });
    mockGetDocs.mockResolvedValue({
      docs: [
        fakeDoc('ver-closed', {
          ownerUid: 'owner',
          title: 'Chiusa',
          className: 'Classe A',
          classId: 'class-a',
          status: 'closed',
          questions: [],
          activatedAt: { seconds: 200 },
        }),
        fakeDoc('ver-legacy', {
          ownerUid: 'owner',
          title: 'Legacy',
          className: 'Classe A',
          classId: 'class-a',
          questions: [],
          activatedAt: { seconds: 100 },
        }),
      ],
    });

    const result = await loadStudentVerifications(STUDENT_UID, fakeDb);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.verifications.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'ver-closed', status: 'closed' },
      { id: 'ver-legacy', status: 'active' },
    ]);
  });

  it('normalizes onlineEnabled: true only when the projection field is literally true', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-a' });
    mockGetDocs.mockResolvedValue({
      docs: [
        fakeDoc('ver-1', {
          title: 'Verifica 1',
          className: 'Classe A',
          classId: 'class-a',
          onlineEnabled: true,
          questions: [],
          activatedAt: { seconds: 100 },
        }),
      ],
    });

    const result = await loadStudentVerifications(STUDENT_UID, fakeDb);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.verifications[0]?.onlineEnabled).toBe(true);
  });

  it('normalizes studentPdfEnabled: true only when the projection field is literally true', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-a' });
    mockGetDocs.mockResolvedValue({
      docs: [
        fakeDoc('ver-1', {
          title: 'Verifica 1',
          className: 'Classe A',
          classId: 'class-a',
          studentPdfEnabled: true,
          questions: [],
          activatedAt: { seconds: 100 },
        }),
      ],
    });

    const result = await loadStudentVerifications(STUDENT_UID, fakeDb);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.verifications[0]?.studentPdfEnabled).toBe(true);
  });

  it('a legacy projection with no studentPdfEnabled field normalizes to false', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-a' });
    mockGetDocs.mockResolvedValue({
      docs: [
        fakeDoc('ver-1', {
          title: 'Verifica 1',
          className: 'Classe A',
          classId: 'class-a',
          questions: [],
          activatedAt: { seconds: 100 },
        }),
      ],
    });

    const result = await loadStudentVerifications(STUDENT_UID, fakeDb);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.verifications[0]?.studentPdfEnabled).toBe(false);
  });

  it('carries ownerUid through (needed by submissionsService, M3F-04) but never questionRefs/soluzione', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-a' });
    mockGetDocs.mockResolvedValue({
      docs: [
        fakeDoc('ver-1', {
          ownerUid: 'owner',
          title: 'Verifica 1',
          className: null,
          classId: 'class-a',
          questions: [{ order: 0, tipo: 'aperta', maxPoints: 3, testo: 'Domanda?' }],
          activatedAt: null,
        }),
      ],
    });

    const result = await loadStudentVerifications(STUDENT_UID, fakeDb);
    if (result.status !== 'ok') throw new Error('expected ok');
    const item = result.verifications[0]!;
    expect(item.ownerUid).toBe('owner');
    expect(item).not.toHaveProperty('questionRefs');
    expect(JSON.stringify(item)).not.toContain('soluzione');
    expect(JSON.stringify(item)).not.toContain('poolStorageRef');
  });
});

describe('loadStudentVerifications — ordering', () => {
  it('sorts most recently activated first', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-a' });
    mockGetDocs.mockResolvedValue({
      docs: [
        fakeDoc('ver-old', {
          title: 'Vecchia',
          className: null,
          classId: 'class-a',
          questions: [],
          activatedAt: { seconds: 100 },
        }),
        fakeDoc('ver-new', {
          title: 'Nuova',
          className: null,
          classId: 'class-a',
          questions: [],
          activatedAt: { seconds: 200 },
        }),
      ],
    });

    const result = await loadStudentVerifications(STUDENT_UID, fakeDb);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.verifications.map((v) => v.id)).toEqual(['ver-new', 'ver-old']);
  });

  it('falls back to title order when activatedAt is missing', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-a' });
    mockGetDocs.mockResolvedValue({
      docs: [
        fakeDoc('ver-b', {
          title: 'Zeta',
          className: null,
          classId: 'class-a',
          questions: [],
          activatedAt: null,
        }),
        fakeDoc('ver-a', {
          title: 'Alfa',
          className: null,
          classId: 'class-a',
          questions: [],
          activatedAt: null,
        }),
      ],
    });

    const result = await loadStudentVerifications(STUDENT_UID, fakeDb);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.verifications.map((v) => v.title)).toEqual(['Alfa', 'Zeta']);
  });

  it('ranks any verification with activatedAt before one without it', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-a' });
    mockGetDocs.mockResolvedValue({
      docs: [
        fakeDoc('ver-no-date', {
          title: 'Senza data',
          className: null,
          classId: 'class-a',
          questions: [],
          activatedAt: null,
        }),
        fakeDoc('ver-with-date', {
          title: 'Con data',
          className: null,
          classId: 'class-a',
          questions: [],
          activatedAt: { seconds: 1 },
        }),
      ],
    });

    const result = await loadStudentVerifications(STUDENT_UID, fakeDb);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.verifications.map((v) => v.id)).toEqual(['ver-with-date', 'ver-no-date']);
  });
});
