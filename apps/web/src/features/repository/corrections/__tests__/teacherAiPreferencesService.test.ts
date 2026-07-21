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
  loadTeacherAiPreferences,
  saveTeacherAiPreferences,
} from '../teacherAiPreferencesService.js';
import type { Firestore } from 'firebase/firestore';

const db = {} as Firestore;
const OWNER = 'owner-uid';

beforeEach(() => {
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
});

describe('loadTeacherAiPreferences (TWU-02)', () => {
  it('returns app defaults when the document is absent', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    expect(await loadTeacherAiPreferences(OWNER, db)).toEqual(DEFAULT_TEACHER_AI_PREFERENCES);
    // Defaults are quality / balanced / empty.
    expect(DEFAULT_TEACHER_AI_PREFERENCES).toEqual({
      modelProfile: 'quality',
      gradingMode: 'balanced',
      teacherGuidance: '',
    });
  });

  it('returns the stored valid values', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        ownerUid: OWNER,
        modelProfile: 'economy',
        gradingMode: 'rigorous',
        teacherGuidance: '  Premia il ragionamento.  ',
      }),
    });
    expect(await loadTeacherAiPreferences(OWNER, db)).toEqual({
      modelProfile: 'economy',
      gradingMode: 'rigorous',
      teacherGuidance: 'Premia il ragionamento.',
    });
  });

  it('falls back to defaults for malformed enum values (legacy-safe)', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ modelProfile: 'premium', gradingMode: 'strict', teacherGuidance: 42 }),
    });
    expect(await loadTeacherAiPreferences(OWNER, db)).toEqual({
      modelProfile: 'quality',
      gradingMode: 'balanced',
      teacherGuidance: '',
    });
  });
});

describe('saveTeacherAiPreferences (TWU-02)', () => {
  it('writes a closed payload with ownerUid + serverTimestamp and trims guidance', async () => {
    await saveTeacherAiPreferences(
      OWNER,
      { modelProfile: 'quality', gradingMode: 'balanced', teacherGuidance: '  Sii sintetico.  ' },
      db,
    );
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = mockSetDoc.mock.calls[0];
    expect(ref.path).toBe(`teacherAiPreferences/${OWNER}`);
    expect(data.ownerUid).toBe(OWNER);
    expect(data.modelProfile).toBe('quality');
    expect(data.gradingMode).toBe('balanced');
    expect(data.teacherGuidance).toBe('Sii sintetico.');
    expect(data.updatedAt).toEqual({ _type: 'serverTimestamp' });
  });

  it('omits teacherGuidance entirely when it is empty/whitespace', async () => {
    await saveTeacherAiPreferences(
      OWNER,
      { modelProfile: 'economy', gradingMode: 'compassionate', teacherGuidance: '   ' },
      db,
    );
    const [, data] = mockSetDoc.mock.calls[0];
    expect('teacherGuidance' in data).toBe(false);
  });
});
