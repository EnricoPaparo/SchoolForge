import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockDoc = vi.fn((_db: unknown, coll: string, id: string) => ({ path: `${coll}/${id}` }));
const mockServerTimestamp = vi.fn(() => ({ _type: 'serverTimestamp' }));

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => mockDoc(...(args as [unknown, string, string])),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  serverTimestamp: () => mockServerTimestamp(),
}));

import {
  DEFAULT_TEACHER_AI_PREFERENCES,
  TeacherAiPreferencesError,
  loadTeacherAiPreferences,
  saveTeacherAiPreferences,
  type TeacherAiPreferences,
} from '../teacherAiPreferencesService.js';
import type { Firestore } from 'firebase/firestore';

const db = {} as Firestore;
const OWNER = 'owner-uid';

function present(data: Record<string, unknown>) {
  mockGetDoc.mockResolvedValue({ exists: () => true, data: () => data });
}
function absent() {
  mockGetDoc.mockResolvedValue({ exists: () => false });
}
const validPrefs = (over: Partial<TeacherAiPreferences> = {}): TeacherAiPreferences => ({
  modelProfile: 'economy',
  gradingMode: 'balanced',
  teacherGuidance: '',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
});

describe('loadTeacherAiPreferences (TWU-02 fail-closed)', () => {
  it('absent document → application defaults (quality/balanced/empty)', async () => {
    absent();
    expect(await loadTeacherAiPreferences(OWNER, db)).toEqual(DEFAULT_TEACHER_AI_PREFERENCES);
    expect(DEFAULT_TEACHER_AI_PREFERENCES).toEqual({
      modelProfile: 'quality',
      gradingMode: 'balanced',
      teacherGuidance: '',
    });
  });

  it('a failed get REJECTS (never treated as an absent document)', async () => {
    mockGetDoc.mockRejectedValue(new Error('permission-denied'));
    await expect(loadTeacherAiPreferences(OWNER, db)).rejects.toThrow('permission-denied');
  });

  it('present + valid economy → economy (values preserved, guidance trimmed)', async () => {
    present({
      ownerUid: OWNER,
      modelProfile: 'economy',
      gradingMode: 'rigorous',
      teacherGuidance: '  Premia il metodo.  ',
    });
    expect(await loadTeacherAiPreferences(OWNER, db)).toEqual({
      modelProfile: 'economy',
      gradingMode: 'rigorous',
      teacherGuidance: 'Premia il metodo.',
    });
  });

  it('wrong ownerUid → reject (no silent fallback)', async () => {
    present({ ownerUid: 'someone-else', modelProfile: 'economy', gradingMode: 'balanced' });
    await expect(loadTeacherAiPreferences(OWNER, db)).rejects.toBeInstanceOf(
      TeacherAiPreferencesError,
    );
  });

  it('null/unknown/non-string modelProfile → reject (never defaulted to quality)', async () => {
    for (const bad of [null, undefined, 'premium', 'gpt-5.6-luna', 3, {}]) {
      present({ ownerUid: OWNER, modelProfile: bad, gradingMode: 'balanced' });
      await expect(loadTeacherAiPreferences(OWNER, db)).rejects.toBeInstanceOf(
        TeacherAiPreferencesError,
      );
    }
  });

  it('null/unknown/non-string gradingMode → reject', async () => {
    for (const bad of [null, 'strict', 5, {}]) {
      present({ ownerUid: OWNER, modelProfile: 'economy', gradingMode: bad });
      await expect(loadTeacherAiPreferences(OWNER, db)).rejects.toBeInstanceOf(
        TeacherAiPreferencesError,
      );
    }
  });

  it('whitespace-only, non-string or >500 teacherGuidance → reject', async () => {
    for (const bad of ['   ', 42, 'x'.repeat(501)]) {
      present({
        ownerUid: OWNER,
        modelProfile: 'economy',
        gradingMode: 'balanced',
        teacherGuidance: bad,
      });
      await expect(loadTeacherAiPreferences(OWNER, db)).rejects.toBeInstanceOf(
        TeacherAiPreferencesError,
      );
    }
  });
});

describe('saveTeacherAiPreferences (TWU-02 fail-closed)', () => {
  it('writes a closed payload with ownerUid + serverTimestamp and trims guidance', async () => {
    await saveTeacherAiPreferences(
      OWNER,
      validPrefs({ teacherGuidance: '  Sii sintetico.  ' }),
      db,
    );
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = mockSetDoc.mock.calls[0];
    expect(ref.path).toBe(`teacherAiPreferences/${OWNER}`);
    expect(data).toEqual({
      ownerUid: OWNER,
      modelProfile: 'economy',
      gradingMode: 'balanced',
      teacherGuidance: 'Sii sintetico.',
      updatedAt: { _type: 'serverTimestamp' },
    });
  });

  it('omits teacherGuidance entirely when empty/whitespace', async () => {
    await saveTeacherAiPreferences(OWNER, validPrefs({ teacherGuidance: '   ' }), db);
    const [, data] = mockSetDoc.mock.calls[0];
    expect('teacherGuidance' in data).toBe(false);
  });

  it('guidance over 500 → client-side error, ZERO setDoc (no slice)', async () => {
    await expect(
      saveTeacherAiPreferences(OWNER, validPrefs({ teacherGuidance: 'x'.repeat(501) }), db),
    ).rejects.toBeInstanceOf(TeacherAiPreferencesError);
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('invalid enum → error, no write', async () => {
    await expect(
      saveTeacherAiPreferences(
        OWNER,
        { modelProfile: 'premium' as never, gradingMode: 'balanced', teacherGuidance: '' },
        db,
      ),
    ).rejects.toBeInstanceOf(TeacherAiPreferencesError);
    await expect(
      saveTeacherAiPreferences(
        OWNER,
        { modelProfile: 'economy', gradingMode: 'strict' as never, teacherGuidance: '' },
        db,
      ),
    ).rejects.toBeInstanceOf(TeacherAiPreferencesError);
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('empty/invalid ownerUid → error, no write', async () => {
    await expect(saveTeacherAiPreferences('', validPrefs(), db)).rejects.toBeInstanceOf(
      TeacherAiPreferencesError,
    );
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('a valid save performs exactly one setDoc', async () => {
    await saveTeacherAiPreferences(OWNER, validPrefs({ teacherGuidance: 'ok' }), db);
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
  });
});
