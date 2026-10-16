import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
  readPrivate: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  serverTimestamp: () => 'timestamp',
  runTransaction: (...args: unknown[]) => mocks.transaction(...args),
  getDoc: vi.fn(),
  getDocFromServer: (...args: unknown[]) => mocks.readPrivate(...args),
}));
import { saveStudyPractice, loadPrivateStudyPractice } from '../studyPracticeService.js';
import { STUDY_BODY, studyFixture } from './studyFixture.js';
const lesson = {
  ownerUid: 'owner',
  importId: 'i1',
  udaDir: 'uda-1',
  filename: 'lesson.md',
  path: 'uda-1/lesson.md',
  publicLessonId: 'i1_l1',
  completed: true,
};
const projection = { ...lesson, programId: 'p1', content: STUDY_BODY };
const snap = (data: unknown) => ({ exists: () => !!data, data: () => data });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockReset();
  mocks.transaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) =>
    fn(mocks),
  );
});
function save(publish = true, publicData: unknown = projection, privateData: unknown = lesson) {
  mocks.get.mockResolvedValueOnce(snap(privateData)).mockResolvedValueOnce(snap(publicData));
  return saveStudyPractice({
    programId: 'p1',
    importId: 'i1',
    lessonId: 'l1',
    ownerUid: 'owner',
    sourceBody: STUDY_BODY,
    practice: studyFixture(),
    publish,
    db: {} as Firestore,
  });
}
describe('atomic practice approval', () => {
  it('derives public identity and commits private draft plus public approval together', async () => {
    await save();
    expect(mocks.get.mock.calls.map((c) => c[0])).toEqual([
      'programs/p1/imports/i1/lessons/l1',
      'publicLessons/i1_l1',
    ]);
    expect(mocks.set).toHaveBeenCalledWith(
      'publicLessonPractice/i1_l1',
      expect.objectContaining({ publicLessonId: 'i1_l1', ownerUid: 'owner' }),
    );
  });
  it('rejects stale source, sibling projection and unpublished lesson before any writes', async () => {
    for (const data of [
      { ...projection, content: STUDY_BODY + ' changed' },
      { ...projection, path: 'uda-1/other.md' },
      { ...projection, completed: false },
    ]) {
      mocks.get.mockReset();
      await expect(save(true, data)).rejects.toThrow();
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.set).not.toHaveBeenCalled();
    }
  });
  it('draft save removes public approval in the same transaction', async () => {
    await save(false);
    expect(mocks.delete).toHaveBeenCalledWith('publicLessonPractice/i1_l1');
    expect(mocks.update).toHaveBeenCalledWith(
      'programs/p1/imports/i1/lessons/l1',
      expect.objectContaining({ studyPractice: studyFixture() }),
    );
  });
});

it('loads the current private draft by identity and never falls back to a stale lesson snapshot', async () => {
  const params = {
    programId: 'p1',
    importId: 'i1',
    lessonId: 'l1',
    ownerUid: 'owner',
    sourceBody: STUDY_BODY,
    db: {} as Firestore,
  };
  const fresh = studyFixture();
  fresh.plan.steps[0]!.hints[0] = 'Salvato più recente';
  mocks.readPrivate.mockResolvedValue(snap({ ...lesson, studyPractice: fresh }));
  expect(await loadPrivateStudyPractice(params)).toEqual(fresh);
  expect(mocks.readPrivate).toHaveBeenLastCalledWith('programs/p1/imports/i1/lessons/l1');
  mocks.readPrivate.mockResolvedValue(snap({ ...lesson, studyPractice: studyFixture() }));
  expect(
    await loadPrivateStudyPractice({ ...params, sourceBody: STUDY_BODY + ' nuova versione' }),
  ).toBeNull();
  for (const invalid of [
    null,
    { ...lesson, ownerUid: 'other' },
    { ...lesson, importId: 'other' },
  ]) {
    mocks.readPrivate.mockResolvedValue(snap(invalid));
    await expect(loadPrivateStudyPractice(params)).rejects.toThrow();
  }
});
