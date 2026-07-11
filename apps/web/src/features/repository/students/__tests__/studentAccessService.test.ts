import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/firebase.js', () => ({ db: {} }));

const mockGetDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockDoc = vi.fn();
const mockCollection = vi.fn();
const mockOnSnapshot = vi.fn();
const mockServerTimestamp = vi.fn(() => ({ _type: 'serverTimestamp' }));

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  serverTimestamp: () => mockServerTimestamp(),
}));

import {
  getStudentAccessSettings,
  setExamMode,
  setNewStudentRequestsEnabled,
  setStudentPortalEnabled,
  watchStudentAccessSettings,
} from '../studentAccessService.js';
import type { Firestore } from 'firebase/firestore';

const fakeDb = {} as Firestore;
const OWNER_UID = 'owner-uid';
const fakeDocRef = { id: 'student-access' };
const SAFE_DEFAULT_EXAM_MODE = { enabled: false, scope: 'all', classIds: [], enabledAt: null };

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
    expect(result).toEqual({
      studentPortalEnabled: false,
      newStudentRequestsEnabled: false,
      examMode: SAFE_DEFAULT_EXAM_MODE,
    });
  });

  it('returns safe defaults when the read is denied', async () => {
    mockGetDoc.mockRejectedValue({ code: 'permission-denied' });

    const result = await getStudentAccessSettings(fakeDb);
    expect(result).toEqual({
      studentPortalEnabled: false,
      newStudentRequestsEnabled: false,
      examMode: SAFE_DEFAULT_EXAM_MODE,
    });
  });

  it('returns the stored values when the document exists', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ studentPortalEnabled: true, newStudentRequestsEnabled: true }),
    });

    const result = await getStudentAccessSettings(fakeDb);
    expect(result).toEqual({
      studentPortalEnabled: true,
      newStudentRequestsEnabled: true,
      examMode: SAFE_DEFAULT_EXAM_MODE,
    });
  });

  it('treats a non-boolean stored value as false', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ studentPortalEnabled: 'yes' }),
    });

    const result = await getStudentAccessSettings(fakeDb);
    expect(result.studentPortalEnabled).toBe(false);
  });

  it('normalizes a stored examMode field', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ examMode: { enabled: true, scope: 'all', classIds: [], enabledAt: null } }),
    });

    const result = await getStudentAccessSettings(fakeDb);
    expect(result.examMode).toEqual({ enabled: true, scope: 'all', classIds: [], enabledAt: null });
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

describe('setExamMode', () => {
  it('activates globally, merging without touching other toggles, and writes an audit event', async () => {
    await setExamMode({ enabled: true, scope: 'all' }, OWNER_UID, fakeDb);

    expect(mockSetDoc).toHaveBeenCalledTimes(2);
    const [, settingsData, options] = mockSetDoc.mock.calls[0];
    expect(settingsData.ownerUid).toBe(OWNER_UID);
    expect(settingsData.examMode).toEqual({
      enabled: true,
      scope: 'all',
      classIds: [],
      enabledAt: mockServerTimestamp(),
    });
    expect(settingsData).not.toHaveProperty('studentPortalEnabled');
    expect(settingsData).not.toHaveProperty('newStudentRequestsEnabled');
    expect(options).toEqual({ merge: true });

    const [, auditData] = mockSetDoc.mock.calls[1];
    expect(auditData.action).toBe('studentAccess.examModeUpdated');
    expect(auditData.actorUid).toBe(OWNER_UID);
    expect(auditData.reason).toContain('scope=all');
  });

  it('activates for selected classes', async () => {
    await setExamMode(
      { enabled: true, scope: 'classes', classIds: ['c1', 'c2'] },
      OWNER_UID,
      fakeDb,
    );

    const [, settingsData] = mockSetDoc.mock.calls[0];
    expect(settingsData.examMode).toEqual({
      enabled: true,
      scope: 'classes',
      classIds: ['c1', 'c2'],
      enabledAt: mockServerTimestamp(),
    });
    const [, auditData] = mockSetDoc.mock.calls[1];
    expect(auditData.reason).toContain('scope=classes');
    expect(auditData.reason).toContain('c1,c2');
  });

  it('rejects scope=classes with no classIds, without writing anything', async () => {
    await expect(
      setExamMode({ enabled: true, scope: 'classes', classIds: [] }, OWNER_UID, fakeDb),
    ).rejects.toThrow(/almeno una classe/);
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('deactivates, resetting scope/classIds/enabledAt to their safe defaults', async () => {
    await setExamMode({ enabled: false }, OWNER_UID, fakeDb);

    const [, settingsData] = mockSetDoc.mock.calls[0];
    expect(settingsData.examMode).toEqual({
      enabled: false,
      scope: 'all',
      classIds: [],
      enabledAt: null,
    });
    const [, auditData] = mockSetDoc.mock.calls[1];
    expect(auditData.action).toBe('studentAccess.examModeUpdated');
    expect(auditData.reason).toContain('disabled');
  });

  it('always writes updatedAt/updatedBy using serverTimestamp, never a client timestamp', async () => {
    await setExamMode({ enabled: true, scope: 'all' }, OWNER_UID, fakeDb);

    const [, settingsData] = mockSetDoc.mock.calls[0];
    expect(settingsData.updatedAt).toEqual(mockServerTimestamp());
    expect(settingsData.updatedBy).toBe(OWNER_UID);
  });
});

describe('watchStudentAccessSettings', () => {
  it('subscribes with onSnapshot and returns its unsubscribe function', () => {
    const unsubscribe = vi.fn();
    mockOnSnapshot.mockReturnValue(unsubscribe);

    const result = watchStudentAccessSettings(fakeDb, vi.fn());

    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
    expect(result).toBe(unsubscribe);
  });

  it('normalizes the same way as the one-shot read, on every snapshot', () => {
    let capturedNext: ((snap: unknown) => void) | undefined;
    mockOnSnapshot.mockImplementation((_ref: unknown, next: (snap: unknown) => void) => {
      capturedNext = next;
      return vi.fn();
    });
    const onChange = vi.fn();
    watchStudentAccessSettings(fakeDb, onChange);

    capturedNext?.({
      exists: () => true,
      data: () => ({
        studentPortalEnabled: true,
        examMode: { enabled: true, scope: 'all', classIds: [], enabledAt: null },
      }),
    });

    expect(onChange).toHaveBeenCalledWith({
      studentPortalEnabled: true,
      newStudentRequestsEnabled: false,
      examMode: { enabled: true, scope: 'all', classIds: [], enabledAt: null },
    });
  });

  it('reports the safe default on a missing document', () => {
    let capturedNext: ((snap: unknown) => void) | undefined;
    mockOnSnapshot.mockImplementation((_ref: unknown, next: (snap: unknown) => void) => {
      capturedNext = next;
      return vi.fn();
    });
    const onChange = vi.fn();
    watchStudentAccessSettings(fakeDb, onChange);

    capturedNext?.({ exists: () => false });

    expect(onChange).toHaveBeenCalledWith({
      studentPortalEnabled: false,
      newStudentRequestsEnabled: false,
      examMode: SAFE_DEFAULT_EXAM_MODE,
    });
  });

  it('reports the safe default and forwards the error on a listener error', () => {
    let capturedError: ((err: unknown) => void) | undefined;
    mockOnSnapshot.mockImplementation(
      (_ref: unknown, _next: unknown, errCb: (err: unknown) => void) => {
        capturedError = errCb;
        return vi.fn();
      },
    );
    const onChange = vi.fn();
    const onError = vi.fn();
    watchStudentAccessSettings(fakeDb, onChange, onError);

    const boom = new Error('permission-denied');
    capturedError?.(boom);

    expect(onChange).toHaveBeenCalledWith({
      studentPortalEnabled: false,
      newStudentRequestsEnabled: false,
      examMode: SAFE_DEFAULT_EXAM_MODE,
    });
    expect(onError).toHaveBeenCalledWith(boom);
  });
});
