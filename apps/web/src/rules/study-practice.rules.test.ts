// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import {
  studyFixture,
  STUDY_BODY,
} from '../features/repository/programs/__tests__/studyFixture.js';
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-study-practice',
    firestore: {
      rules: readFileSync(resolve(process.cwd(), '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});
afterEach(async () => env.clearFirestore());
afterAll(async () => env.cleanup());
const database = (uid: string) => env.authenticatedContext(uid).firestore();
const artifact = () => ({ ownerUid: 'owner', publicLessonId: 'i1_l1', practice: studyFixture() });
async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/owner'), { ownerUid: 'owner' });
    await setDoc(doc(db, 'settings/studentAccess'), {
      studentPortalEnabled: true,
      newStudentRequestsEnabled: false,
    });
    await setDoc(doc(db, 'students/s1'), {
      uid: 's1',
      ownerUid: 'owner',
      status: 'approved',
      classId: 'c1',
    });
    await setDoc(doc(db, 'students/s2'), {
      uid: 's2',
      ownerUid: 'owner',
      status: 'approved',
      classId: 'c2',
    });
    await setDoc(doc(db, 'programs/p1'), {
      ownerUid: 'owner',
      activeImportId: 'i1',
      classIds: ['c1'],
    });
    await setDoc(doc(db, 'publicLessons/i1_l1'), {
      ownerUid: 'owner',
      programId: 'p1',
      importId: 'i1',
      completed: true,
      content: STUDY_BODY,
    });
    await setDoc(doc(db, 'publicLessonPractice/i1_l1'), artifact());
  });
}
describe('practice public boundary', () => {
  it('allows assigned approved student and denies other class, anonymous and list', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(database('s1'), 'publicLessonPractice/i1_l1')));
    await assertFails(getDoc(doc(database('s2'), 'publicLessonPractice/i1_l1')));
    await assertFails(
      getDoc(doc(env.unauthenticatedContext().firestore(), 'publicLessonPractice/i1_l1')),
    );
    await assertFails(getDocs(collection(database('s1'), 'publicLessonPractice')));
  });
  it('denies direct access after source, import or completion changes', async () => {
    for (const change of [
      { content: STUDY_BODY + ' edit' },
      { importId: 'i2' },
      { completed: false },
    ]) {
      await seed();
      await updateDoc(doc(database('owner'), 'publicLessons/i1_l1'), change);
      await assertFails(getDoc(doc(database('s1'), 'publicLessonPractice/i1_l1')));
    }
  });
  it('denies direct access in exam mode and after student approval revocation', async () => {
    await seed();
    await updateDoc(doc(database('owner'), 'settings/studentAccess'), {
      examMode: { enabled: true, scope: 'all', classIds: [] },
    });
    await assertFails(getDoc(doc(database('s1'), 'publicLessonPractice/i1_l1')));
    await updateDoc(doc(database('owner'), 'settings/studentAccess'), {
      examMode: { enabled: false, scope: 'all', classIds: [] },
    });
    await updateDoc(doc(database('owner'), 'students/s1'), { status: 'blocked' });
    await assertFails(getDoc(doc(database('s1'), 'publicLessonPractice/i1_l1')));
  });
  it('allows bounded current owner approval and denies source mismatch, leaked private fields and student writes', async () => {
    await seed();
    await assertSucceeds(setDoc(doc(database('owner'), 'publicLessonPractice/i1_l1'), artifact()));
    await assertFails(setDoc(doc(database('s1'), 'publicLessonPractice/i1_l1'), artifact()));
    await assertFails(
      setDoc(doc(database('owner'), 'publicLessonPractice/i1_l1'), {
        ...artifact(),
        poolId: 'private',
      }),
    );
    await assertFails(
      setDoc(doc(database('owner'), 'publicLessonPractice/i1_l1'), {
        ...artifact(),
        practice: { ...studyFixture(), sourceBody: 'old' },
      }),
    );
    await assertFails(
      setDoc(doc(database('owner'), 'publicLessonPractice/i1_l1'), {
        ...artifact(),
        practice: {
          ...studyFixture(),
          questions: [
            { ...studyFixture().questions[0], questionLocalId: 'private' },
            ...studyFixture().questions.slice(1),
          ],
        },
      }),
    );
  });
});
