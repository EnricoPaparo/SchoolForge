import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setLessonVisibilityForOwner,
  lessonVisibilityLockPath,
  validateLessonVisibilityInput,
} from './lessonVisibilityGateway.js';
import { readAuthoritativeLesson } from './aiVisualIdentity.js';
import { setLessonCompletedForOwner } from './aiVisualGateway.js';
import type { BucketLike } from './repositoryGatewayCore.js';
const integration = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
it('accepts only closed visibility payloads and canonical document IDs', () => {
  const input = { programId: 'p', importId: 'i', lessonId: 'l', hiddenFromStudents: true };
  expect(validateLessonVisibilityInput(input)).toEqual(input);
  for (const extra of [
    { ownerUid: 'other' },
    { programId: '../p' },
    { hiddenFromStudents: 'true' },
  ])
    expect(() => validateLessonVisibilityInput({ ...input, ...extra })).toThrow();
});
integration('lesson visibility lifecycle', () => {
  const app = initializeApp(
    { projectId: 'demo-schoolforge-visibility-functions' },
    `visibility-${randomUUID()}`,
  );
  const db = getFirestore(app);
  beforeAll(async () => {
    await db.doc('settings/owner').set({ ownerUid: 'owner' });
  });
  afterAll(async () => {
    await deleteApp(app);
  });
  async function seed(legacy = false) {
    const programId = `program-${randomUUID()}`,
      importId = 'import',
      lessonId = `lesson-${randomUUID()}`;
    const publicLessonId = legacy ? lessonId : `${programId}_${importId}_${lessonId}`;
    const input = { programId, importId, lessonId, hiddenFromStudents: true };
    const lesson = {
      ownerUid: 'owner',
      importId,
      udaDir: 'uda-01',
      path: 'uda-01/lesson.md',
      filename: 'lesson.md',
      storageRef: `repository/owner/imports/${importId}/uda-01/lesson.md`,
      poolStatus: 'valid',
      questionCount: 2,
      ...(legacy ? {} : { publicLessonId }),
      completed: true,
      conceptMapMarkdown: 'PRIVATE MAP',
      visual: { malformed: true },
      studyPractice: { private: true },
    };
    const projection = {
      ownerUid: 'owner',
      programId,
      importId,
      udaId: 'uda-01',
      udaDir: lesson.udaDir,
      path: lesson.path,
      filename: lesson.filename,
      contentPath: lesson.storageRef,
      content: '## Metodo\n\nFonte della lezione.',
      createdAt: null,
      completed: true,
      conceptMapMarkdown: 'PUBLIC MAP',
      visual: { assetId: 'x' },
    };
    await db.doc(`programs/${programId}`).set({ ownerUid: 'owner', activeImportId: importId });
    const privateRef = db.doc(`programs/${programId}/imports/${importId}/lessons/${lessonId}`);
    const publicRef = db.doc(`publicLessons/${publicLessonId}`),
      hiddenRef = db.doc(`hiddenLessonProjections/${publicLessonId}`);
    await privateRef.set(lesson);
    await publicRef.set(projection);
    await db.doc(`publicLessonPractice/${publicLessonId}`).set({ sentinel: 'practice' });
    await db.doc(`publicLessonVisuals/${publicLessonId}`).set({ sentinel: 'bytes' });
    return { input, lesson, projection, privateRef, publicRef, hiddenRef, publicLessonId };
  }
  it('atomically hides completed legacy data, preserves all teacher sources, and restores non-completed', async () => {
    const f = await seed(true);
    await setLessonVisibilityForOwner(db, 'owner', f.input);
    expect((await f.publicRef.get()).exists).toBe(false);
    expect((await f.hiddenRef.get()).data()).toMatchObject({
      content: f.projection.content,
      completed: false,
      lessonId: f.input.lessonId,
    });
    expect((await f.hiddenRef.get()).data()).not.toHaveProperty('visual');
    expect((await f.privateRef.get()).data()).toMatchObject({
      ...f.lesson,
      completed: false,
      completedAt: null,
      hiddenFromStudents: true,
    });
    expect((await db.doc(`publicLessonPractice/${f.publicLessonId}`).get()).exists).toBe(false);
    expect((await db.doc(`publicLessonVisuals/${f.publicLessonId}`).get()).exists).toBe(false);
    expect((await readAuthoritativeLesson(db, { ownerUid: 'owner', ...f.input })).body).toBe(
      f.projection.content,
    );
    await setLessonVisibilityForOwner(db, 'owner', { ...f.input, hiddenFromStudents: false });
    expect((await f.hiddenRef.get()).exists).toBe(false);
    expect((await f.publicRef.get()).data()).toMatchObject({
      content: f.projection.content,
      completed: false,
    });
    expect((await f.publicRef.get()).data()).not.toHaveProperty('lessonId');
    expect(
      (await db.doc(lessonVisibilityLockPath(f.input.programId, f.input.importId)).get()).data()
        ?.hiddenPublicLessonIds,
    ).toEqual([]);
  });
  it('replays an already-visible request without undoing later completion or publications', async () => {
    const f = await seed();
    const before = (await f.publicRef.get()).data();
    const result = await setLessonVisibilityForOwner(db, 'owner', {
      ...f.input,
      hiddenFromStudents: false,
    });
    expect(result.completed).toBe(true);
    expect((await f.publicRef.get()).data()).toEqual(before);
    expect((await db.doc(`publicLessonPractice/${f.publicLessonId}`).get()).exists).toBe(true);
    expect((await db.doc(`publicLessonVisuals/${f.publicLessonId}`).get()).exists).toBe(true);
  });
  it('rejects wrong ownership and completion of a hidden lesson, including a hide between completion preflight and commit', async () => {
    const f = await seed();
    await f.privateRef.update({
      visual: (await import('firebase-admin/firestore')).FieldValue.delete(),
      conceptMapMarkdown: (await import('firebase-admin/firestore')).FieldValue.delete(),
      completed: false,
    });
    await f.publicRef.update({
      completed: false,
      visual: (await import('firebase-admin/firestore')).FieldValue.delete(),
      conceptMapMarkdown: (await import('firebase-admin/firestore')).FieldValue.delete(),
    });
    await expect(setLessonVisibilityForOwner(db, 'intruder', f.input)).rejects.toThrow();
    const params = {
      db,
      ownerUid: 'owner',
      input: {
        programId: f.input.programId,
        importId: f.input.importId,
        lessonId: f.input.lessonId,
        completed: true,
      },
      bucket: {} as BucketLike,
    };
    await expect(
      setLessonCompletedForOwner({
        ...params,
        beforeTransaction: async () => {
          await setLessonVisibilityForOwner(db, 'owner', f.input);
        },
      }),
    ).rejects.toThrow();
    await expect(setLessonCompletedForOwner(params)).rejects.toThrow(/visibile/);
    expect((await f.publicRef.get()).exists).toBe(false);
  });
  it('hides a legacy lesson lacking a public projection without inventing a body', async () => {
    const f = await seed();
    await f.publicRef.delete();
    await setLessonVisibilityForOwner(db, 'owner', f.input);
    expect((await f.hiddenRef.get()).data()).not.toHaveProperty('content');
    expect((await f.hiddenRef.get()).data()?.contentPath).toBe(f.lesson.storageRef);
  });
});
