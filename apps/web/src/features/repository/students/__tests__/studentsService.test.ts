import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/firebase.js', () => ({ db: {} }));

const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockDeleteDoc = vi.fn();
const mockDoc = vi.fn();
const mockCollection = vi.fn();
const mockServerTimestamp = vi.fn(() => ({ _type: 'serverTimestamp' }));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  serverTimestamp: () => mockServerTimestamp(),
}));

import {
  approveStudent,
  assignStudentClass,
  blockStudent,
  getOwnStudentDoc,
  listStudents,
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
  it('deletes the doc and writes an audit event', async () => {
    await removeStudent(STUDENT_UID, OWNER_UID, fakeDb);
    expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
    expect(mockSetDoc.mock.calls[0][1].action).toBe('student.removed');
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
