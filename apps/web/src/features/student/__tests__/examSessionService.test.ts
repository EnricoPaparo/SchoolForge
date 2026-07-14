import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearActiveSessionHint,
  findActiveDraftSession,
  readActiveSessionHint,
  resolveActiveSession,
  writeActiveSessionHint,
} from '../examSessionService.js';
import type { Firestore } from 'firebase/firestore';
import type { StudentVerificationItem } from '../../repository/verifications/studentVerificationsService.js';

const mockLoadSubmission = vi.fn();
vi.mock('../submissionsService.js', () => ({
  loadSubmission: (...args: unknown[]) => mockLoadSubmission(...args),
}));

const mockLoadStudentVerifications = vi.fn();
vi.mock('../../repository/verifications/studentVerificationsService.js', () => ({
  loadStudentVerifications: (...args: unknown[]) => mockLoadStudentVerifications(...args),
}));

const fakeDb = {} as Firestore;

const ITEM_A: StudentVerificationItem = {
  id: 'ver-a',
  title: 'Verifica A',
  className: 'Classe 3A',
  activatedAt: {} as never,
  questionCount: 1,
  questions: [],
  onlineEnabled: true,
  studentPdfEnabled: false,
  ownerUid: 'owner-uid',
  status: 'active',
};

const ITEM_B: StudentVerificationItem = {
  id: 'ver-b',
  title: 'Verifica B',
  className: 'Classe 3A',
  activatedAt: {} as never,
  questionCount: 1,
  questions: [],
  onlineEnabled: true,
  studentPdfEnabled: false,
  ownerUid: 'owner-uid',
  status: 'active',
};

const DRAFT = {
  submissionId: 'ver-b_student-uid',
  verificationId: 'ver-b',
  studentUid: 'student-uid',
  ownerUid: 'owner-uid',
  status: 'draft' as const,
  answers: {},
  flagged: {},
  attentionEvents: [],
  deliveryCode: null,
  verificationTitle: 'Verifica B',
  className: 'Classe 3A',
  startedAt: {} as never,
  lastSavedAt: {} as never,
  submittedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
});

describe('active session hint (sessionStorage)', () => {
  it('round-trips read/write/clear', () => {
    expect(readActiveSessionHint()).toBeNull();
    writeActiveSessionHint('ver-x');
    expect(readActiveSessionHint()).toBe('ver-x');
    clearActiveSessionHint();
    expect(readActiveSessionHint()).toBeNull();
  });
});

describe('findActiveDraftSession', () => {
  it('returns null and never calls loadSubmission when there are no online-enabled items', async () => {
    const result = await findActiveDraftSession('uid', [], fakeDb);
    expect(result).toBeNull();
    expect(mockLoadSubmission).not.toHaveBeenCalled();
  });

  it('uses only deterministic single-document get()s — never a collection query', async () => {
    mockLoadSubmission.mockResolvedValueOnce(null).mockResolvedValueOnce(DRAFT);
    const result = await findActiveDraftSession('uid', [ITEM_A, ITEM_B], fakeDb);

    expect(result).toEqual({ item: ITEM_B, submission: DRAFT });
    expect(mockLoadSubmission).toHaveBeenCalledWith('ver-a', 'uid', fakeDb);
    expect(mockLoadSubmission).toHaveBeenCalledWith('ver-b', 'uid', fakeDb);
    expect(mockLoadSubmission).toHaveBeenCalledTimes(2);
  });

  it('writes the hint once a draft is found, and clears it when none is found', async () => {
    mockLoadSubmission.mockResolvedValue(null);
    await findActiveDraftSession('uid', [ITEM_A], fakeDb);
    expect(readActiveSessionHint()).toBeNull();

    mockLoadSubmission.mockResolvedValue(DRAFT);
    await findActiveDraftSession('uid', [ITEM_B], fakeDb);
    expect(readActiveSessionHint()).toBe('ver-b');
  });

  it('checks the hinted verification first, before any other', async () => {
    writeActiveSessionHint('ver-b');
    mockLoadSubmission.mockResolvedValueOnce(DRAFT);

    const result = await findActiveDraftSession('uid', [ITEM_A, ITEM_B], fakeDb);

    expect(result?.item.id).toBe('ver-b');
    expect(mockLoadSubmission).toHaveBeenCalledTimes(1);
    expect(mockLoadSubmission).toHaveBeenCalledWith('ver-b', 'uid', fakeDb);
  });

  it('treats a denied get() (already-submitted verification) as "not a draft" and continues the scan', async () => {
    mockLoadSubmission
      .mockRejectedValueOnce(new Error('permission-denied'))
      .mockResolvedValueOnce(DRAFT);

    const result = await findActiveDraftSession('uid', [ITEM_A, ITEM_B], fakeDb);

    expect(result).toEqual({ item: ITEM_B, submission: DRAFT });
  });

  it('never mistakes a submitted submission for an active draft', async () => {
    mockLoadSubmission.mockResolvedValue({ ...DRAFT, status: 'submitted' });
    const result = await findActiveDraftSession('uid', [ITEM_A], fakeDb);
    expect(result).toBeNull();
  });
});

describe('resolveActiveSession', () => {
  it('fetches the student verification list first, then scans only the online-enabled ones', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [ITEM_A, { ...ITEM_B, onlineEnabled: false }],
    });
    mockLoadSubmission.mockResolvedValue(null);

    const result = await resolveActiveSession('uid', fakeDb);

    expect(result).toBeNull();
    expect(mockLoadSubmission).toHaveBeenCalledTimes(1);
    expect(mockLoadSubmission).toHaveBeenCalledWith('ver-a', 'uid', fakeDb);
  });

  it('returns null without calling loadSubmission when the student has no class', async () => {
    mockLoadStudentVerifications.mockResolvedValue({ status: 'no-class' });
    const result = await resolveActiveSession('uid', fakeDb);
    expect(result).toBeNull();
    expect(mockLoadSubmission).not.toHaveBeenCalled();
  });

  it('returns the active draft session when one exists', async () => {
    mockLoadStudentVerifications.mockResolvedValue({ status: 'ok', verifications: [ITEM_B] });
    mockLoadSubmission.mockResolvedValue(DRAFT);

    const result = await resolveActiveSession('uid', fakeDb);

    expect(result).toEqual({ item: ITEM_B, submission: DRAFT });
  });
});
