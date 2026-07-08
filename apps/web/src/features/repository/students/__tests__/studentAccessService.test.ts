import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/firebase.js', () => ({ db: {} }));

const mockGetDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockDoc = vi.fn();
const mockCollection = vi.fn();
const mockServerTimestamp = vi.fn(() => ({ _type: 'serverTimestamp' }));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  serverTimestamp: () => mockServerTimestamp(),
}));

import {
  getStudentAccessSettings,
  setNewStudentRequestsEnabled,
  setStudentPortalEnabled,
} from '../studentAccessService.js';
import type { Firestore } from 'firebase/firestore';

const fakeDb = {} as Firestore;
const OWNER_UID = 'owner-uid';
const fakeDocRef = { id: 'student-access' };

beforeEach(() => {
  vi.clearAllMocks();
  mockDoc.mockReturnValue(fakeDocRef);
  mockCollection.mockReturnValue({ id: 'auditEvents' });
  mockSetDoc.mockResolvedValue(undefined);
});

describe('getStudentAccessSettings', () => {
  it('returns safe defaults when the document does not exist', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });

    const result = await getStudentAccessSettings(fakeDb);
    expect(result).toEqual({ studentPortalEnabled: false, newStudentRequestsEnabled: false });
  });

  it('returns safe defaults when the read is denied', async () => {
    mockGetDoc.mockRejectedValue({ code: 'permission-denied' });

    const result = await getStudentAccessSettings(fakeDb);
    expect(result).toEqual({ studentPortalEnabled: false, newStudentRequestsEnabled: false });
  });

  it('returns the stored values when the document exists', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ studentPortalEnabled: true, newStudentRequestsEnabled: true }),
    });

    const result = await getStudentAccessSettings(fakeDb);
    expect(result).toEqual({ studentPortalEnabled: true, newStudentRequestsEnabled: true });
  });

  it('treats a non-boolean stored value as false', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ studentPortalEnabled: 'yes' }),
    });

    const result = await getStudentAccessSettings(fakeDb);
    expect(result.studentPortalEnabled).toBe(false);
  });
});

describe('setStudentPortalEnabled', () => {
  it('merges studentPortalEnabled and writes an audit event', async () => {
    await setStudentPortalEnabled(true, OWNER_UID, fakeDb);

    expect(mockSetDoc).toHaveBeenCalledTimes(2);
    const [, settingsData, options] = mockSetDoc.mock.calls[0];
    expect(settingsData.studentPortalEnabled).toBe(true);
    expect(settingsData.ownerUid).toBe(OWNER_UID);
    expect(options).toEqual({ merge: true });

    const [, auditData] = mockSetDoc.mock.calls[1];
    expect(auditData.action).toBe('studentAccess.updated');
    expect(auditData.actorUid).toBe(OWNER_UID);
    expect(auditData.reason).toContain('studentPortalEnabled=true');
  });
});

describe('setNewStudentRequestsEnabled', () => {
  it('merges newStudentRequestsEnabled and writes an audit event', async () => {
    await setNewStudentRequestsEnabled(false, OWNER_UID, fakeDb);

    const [, settingsData] = mockSetDoc.mock.calls[0];
    expect(settingsData.newStudentRequestsEnabled).toBe(false);

    const [, auditData] = mockSetDoc.mock.calls[1];
    expect(auditData.action).toBe('studentAccess.updated');
    expect(auditData.reason).toContain('newStudentRequestsEnabled=false');
  });
});
