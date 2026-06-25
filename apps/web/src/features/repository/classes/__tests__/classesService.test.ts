import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock firebase modules
vi.mock('../../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

const mockGetDocs = vi.fn();
const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockDoc = vi.fn();
const mockCollection = vi.fn();
const mockServerTimestamp = vi.fn(() => ({ _type: 'serverTimestamp' }));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  serverTimestamp: () => mockServerTimestamp(),
}));

import { listClasses, createClass, updateClass } from '../classesService.js';
import type { Firestore } from 'firebase/firestore';

const fakeDb = {} as Firestore;
const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-uid';

// Stub for a doc reference
const fakeDocRef = { id: 'new-class-id' };

beforeEach(() => {
  vi.clearAllMocks();
  mockDoc.mockReturnValue(fakeDocRef);
  mockCollection.mockReturnValue({ id: 'classes' });
  mockSetDoc.mockResolvedValue(undefined);
  mockUpdateDoc.mockResolvedValue(undefined);
});

describe('listClasses', () => {
  it('returns items filtered by ownerUid', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        { id: 'c1', data: () => ({ ownerUid: OWNER_UID, name: 'Classe A', description: null }) },
        { id: 'c2', data: () => ({ ownerUid: OTHER_UID, name: 'Classe B', description: null }) },
      ],
    });

    const result = await listClasses(OWNER_UID, fakeDb);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
    expect(result[0].name).toBe('Classe A');
  });
});

describe('createClass', () => {
  it('calls setDoc with correct data and writes audit event', async () => {
    const id = await createClass('Classe A', 'Descrizione', OWNER_UID, fakeDb);

    expect(id).toBe('new-class-id');
    expect(mockSetDoc).toHaveBeenCalledTimes(2);

    // First call: class doc
    const [, classData] = mockSetDoc.mock.calls[0];
    expect(classData.ownerUid).toBe(OWNER_UID);
    expect(classData.name).toBe('Classe A');
    expect(classData.description).toBe('Descrizione');

    // Second call: audit event
    const [, auditData] = mockSetDoc.mock.calls[1];
    expect(auditData.action).toBe('class.created');
    expect(auditData.actorUid).toBe(OWNER_UID);
    expect(auditData.outcome).toBe('success');
  });
});

describe('updateClass', () => {
  it('calls updateDoc with correct data and writes audit event', async () => {
    await updateClass('class-id', 'Nuovo nome', null, OWNER_UID, fakeDb);

    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = mockUpdateDoc.mock.calls[0];
    expect(ref).toBe(fakeDocRef);
    expect(data.name).toBe('Nuovo nome');
    expect(data.description).toBeNull();

    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [, auditData] = mockSetDoc.mock.calls[0];
    expect(auditData.action).toBe('class.updated');
    expect(auditData.targetId).toBe('class-id');
  });
});
