import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/firebase.js', () => ({ db: {} }));

const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockGetCountFromServer = vi.fn();
const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockDeleteDoc = vi.fn();
const mockDoc = vi.fn();
const mockCollection = vi.fn();
const mockQuery = vi.fn((...args: unknown[]) => ({ args }));
const mockWhere = vi.fn((...args: unknown[]) => ({ where: args }));
const mockServerTimestamp = vi.fn(() => ({ _type: 'serverTimestamp' }));

const mockRemoveStudentWithAssignment = vi.fn();

/*
 * VDIF-02 — `removeStudent` non è più `deleteDoc` + audit: delega alla
 * transazione che elimina studente e assegnazione e rilascia il contatore
 * dell'etichetta. Qui si verifica la **delega** e il valore restituito; la
 * transazione ha i propri test in `studentLabelAssignments/__tests__`.
 */
vi.mock('../../studentLabelAssignments/studentLabelAssignmentsService.js', () => ({
  removeStudentWithAssignment: (...args: unknown[]) => mockRemoveStudentWithAssignment(...args),
}));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  getCountFromServer: (...args: unknown[]) => mockGetCountFromServer(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  serverTimestamp: () => mockServerTimestamp(),
}));

import {
  approveStudent,
  assignStudentClass,
  blockStudent,
  countPendingStudents,
  getOwnStudentDoc,
  listStudents,
  recordPortalAccess,
  removeStudent,
  requestStudentAccess,
  resetStudentToPending,
} from '../studentsService.js';
import type { Firestore } from 'firebase/firestore';

const fakeDb = {} as Firestore;
const OWNER_UID = 'owner-uid';
const OTHER_OWNER_UID = 'other-owner-uid';
const STUDENT_UID = 'student-uid';
const fakeDocRef = { id: STUDENT_UID };

beforeEach(() => {
  vi.clearAllMocks();
  mockDoc.mockReturnValue(fakeDocRef);
  mockCollection.mockReturnValue({ id: 'students' });
  mockSetDoc.mockResolvedValue(undefined);
  mockUpdateDoc.mockResolvedValue(undefined);
  mockDeleteDoc.mockResolvedValue(undefined);
});

describe('listStudents', () => {
  it('returns items filtered by ownerUid, normalizing status', () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: 's1',
          data: () => ({ ownerUid: OWNER_UID, status: 'approved', email: 'a@test.com' }),
        },
        {
          id: 's2',
          data: () => ({ ownerUid: OTHER_OWNER_UID, status: 'approved', email: 'b@test.com' }),
        },
        {
          id: 's3',
          data: () => ({ ownerUid: OWNER_UID, status: 'not-a-real-status', email: 'c@test.com' }),
        },
      ],
    });

    return listStudents(OWNER_UID, fakeDb).then((result) => {
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(['s1', 's3']);
      expect(result[1].status).toBe('pending');
    });
  });
});

describe('countPendingStudents', () => {
  it('uses a status == pending query with getCountFromServer, not getDocs/listStudents', async () => {
    mockGetCountFromServer.mockResolvedValue({ data: () => ({ count: 3 }) });

    const result = await countPendingStudents(OWNER_UID, fakeDb);

    expect(result).toBe(3);
    expect(mockGetCountFromServer).toHaveBeenCalledTimes(1);
    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalledWith('status', '==', 'pending');
  });

  it('propagates an error from getCountFromServer', async () => {
    mockGetCountFromServer.mockRejectedValue(new Error('boom'));
    await expect(countPendingStudents(OWNER_UID, fakeDb)).rejects.toThrow('boom');
  });
});

describe('getOwnStudentDoc', () => {
  it('returns null when the document does not exist', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    expect(await getOwnStudentDoc(STUDENT_UID, fakeDb)).toBeNull();
  });

  it('returns the normalized document when it exists', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ ownerUid: OWNER_UID, status: 'blocked', email: 'x@test.com' }),
    });
    const result = await getOwnStudentDoc(STUDENT_UID, fakeDb);
    expect(result?.status).toBe('blocked');
  });
});

describe('requestStudentAccess', () => {
  it('creates a pending doc with classId null and no audit event', async () => {
    await requestStudentAccess(
      { uid: STUDENT_UID, ownerUid: OWNER_UID, email: 'x@test.com', displayName: 'X' },
      fakeDb,
    );

    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [, data] = mockSetDoc.mock.calls[0];
    expect(data.status).toBe('pending');
    expect(data.classId).toBeNull();
    expect(data.ownerUid).toBe(OWNER_UID);
    expect(data.uid).toBe(STUDENT_UID);
  });
});

describe('recordPortalAccess (TWU-01)', () => {
  it('stamps both first and last portal access on the first entry', async () => {
    await recordPortalAccess(STUDENT_UID, false, fakeDb);

    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [, data] = mockUpdateDoc.mock.calls[0];
    expect(data.firstPortalAccessAt).toEqual({ _type: 'serverTimestamp' });
    expect(data.lastPortalAccessAt).toEqual({ _type: 'serverTimestamp' });
    // No other field touched (no updatedAt bump, no status/class).
    expect(Object.keys(data).sort()).toEqual(['firstPortalAccessAt', 'lastPortalAccessAt']);
  });

  it('stamps only last portal access on subsequent entries', async () => {
    await recordPortalAccess(STUDENT_UID, true, fakeDb);

    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [, data] = mockUpdateDoc.mock.calls[0];
    expect(data.lastPortalAccessAt).toEqual({ _type: 'serverTimestamp' });
    expect(data.firstPortalAccessAt).toBeUndefined();
    expect(Object.keys(data)).toEqual(['lastPortalAccessAt']);
  });

  it('uses serverTimestamp, never a persisted Date.now', async () => {
    await recordPortalAccess(STUDENT_UID, true, fakeDb);
    expect(mockServerTimestamp).toHaveBeenCalled();
    const [, data] = mockUpdateDoc.mock.calls[0];
    expect(typeof data.lastPortalAccessAt).not.toBe('number');
  });
});

describe('approveStudent', () => {
  it('updates status to approved and writes an audit event', async () => {
    await approveStudent(STUDENT_UID, OWNER_UID, fakeDb);

    const [, updateData] = mockUpdateDoc.mock.calls[0];
    expect(updateData.status).toBe('approved');

    const [, auditData] = mockSetDoc.mock.calls[0];
    expect(auditData.action).toBe('student.approved');
    expect(auditData.targetId).toBe(STUDENT_UID);
    expect(auditData.actorUid).toBe(OWNER_UID);
  });
});

describe('blockStudent', () => {
  it('updates status to blocked and writes an audit event', async () => {
    await blockStudent(STUDENT_UID, OWNER_UID, fakeDb);
    expect(mockUpdateDoc.mock.calls[0][1].status).toBe('blocked');
    expect(mockSetDoc.mock.calls[0][1].action).toBe('student.blocked');
  });
});

describe('resetStudentToPending', () => {
  it('updates status to pending and writes an audit event', async () => {
    await resetStudentToPending(STUDENT_UID, OWNER_UID, fakeDb);
    expect(mockUpdateDoc.mock.calls[0][1].status).toBe('pending');
    expect(mockSetDoc.mock.calls[0][1].action).toBe('student.reset');
  });
});

describe('removeStudent', () => {
  it('delega alla transazione, senza deleteDoc sciolto né audit separato', async () => {
    const effect = { studentUid: STUDENT_UID, releasedLabel: null };
    mockRemoveStudentWithAssignment.mockResolvedValue(effect);

    const result = await removeStudent(STUDENT_UID, OWNER_UID, fakeDb);

    expect(mockRemoveStudentWithAssignment).toHaveBeenCalledWith(STUDENT_UID, OWNER_UID, fakeDb);
    expect(result).toBe(effect);
    // Nessuna scrittura fuori dalla transazione: l'eliminazione e l'audit
    // vivono nello stesso commit dell'assegnazione.
    expect(mockDeleteDoc).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('restituisce l’etichetta liberata con il contatore scritto', async () => {
    mockRemoveStudentWithAssignment.mockResolvedValue({
      studentUid: STUDENT_UID,
      releasedLabel: { labelId: 'label-1', assignedCount: 0 },
    });

    const result = await removeStudent(STUDENT_UID, OWNER_UID, fakeDb);

    expect(result.releasedLabel).toEqual({ labelId: 'label-1', assignedCount: 0 });
  });
});

describe('assignStudentClass', () => {
  it('updates classId and writes an audit event with the class id as reason', async () => {
    await assignStudentClass(STUDENT_UID, 'class-1', OWNER_UID, fakeDb);
    expect(mockUpdateDoc.mock.calls[0][1].classId).toBe('class-1');
    const [, auditData] = mockSetDoc.mock.calls[0];
    expect(auditData.action).toBe('student.classAssigned');
    expect(auditData.reason).toBe('class-1');
  });

  it('clears classId when passed null', async () => {
    await assignStudentClass(STUDENT_UID, null, OWNER_UID, fakeDb);
    expect(mockUpdateDoc.mock.calls[0][1].classId).toBeNull();
    expect(mockSetDoc.mock.calls[0][1].reason).toBe('nessuna classe');
  });
});
