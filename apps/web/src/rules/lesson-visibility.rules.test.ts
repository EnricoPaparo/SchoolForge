// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-lesson-visibility',
    firestore: {
      rules: readFileSync(resolve(process.cwd(), '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});
afterEach(async () => {
  await env.clearFirestore();
});
afterAll(async () => {
  await env.cleanup();
});
const projection = (id: string) => ({
  ownerUid: 'owner',
  programId: 'p',
  importId: 'i',
  udaId: 'u',
  udaDir: 'uda-01',
  path: `uda-01/${id}.md`,
  filename: `${id}.md`,
  contentPath: `repository/owner/imports/i/uda-01/${id}.md`,
  content: 'Corpo',
  completed: false,
  createdAt: null,
});
async function seed(hidden = true) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/owner'), { ownerUid: 'owner' });
    await setDoc(doc(db, 'settings/ownerPublic'), { ownerUid: 'owner' });
    await setDoc(doc(db, 'settings/studentAccess'), {
      ownerUid: 'owner',
      studentPortalEnabled: true,
      newStudentRequestsEnabled: false,
    });
    await setDoc(doc(db, 'students/s'), {
      uid: 's',
      ownerUid: 'owner',
      status: 'approved',
      classId: 'class',
    });
    await setDoc(doc(db, 'programs/p'), {
      ownerUid: 'owner',
      activeImportId: 'i',
      classIds: ['class'],
    });
    await setDoc(doc(db, 'programs/p/imports/i/lessons/l'), {
      ownerUid: 'owner',
      importId: 'i',
      hiddenFromStudents: hidden,
      completed: false,
    });
    await setDoc(doc(db, 'lessonVisibilityLocks/p/imports/i'), {
      ownerUid: 'owner',
      programId: 'p',
      importId: 'i',
      hiddenPublicLessonIds: hidden ? ['l'] : [],
    });
    await setDoc(doc(db, hidden ? 'hiddenLessonProjections/l' : 'publicLessons/l'), {
      ...projection('l'),
      ...(hidden ? { lessonId: 'l' } : {}),
    });
    await setDoc(doc(db, 'publicLessonPractice/l'), {
      ownerUid: 'owner',
      publicLessonId: 'l',
      practice: {},
    });
    await setDoc(doc(db, 'publicLessonVisuals/l'), {
      ownerUid: 'owner',
      publicLessonId: 'l',
      programId: 'p',
      importId: 'i',
    });
    await setDoc(doc(db, 'students/s/lessonNotes/l'), {
      studentUid: 's',
      publicLessonId: 'l',
      programId: 'p',
      importId: 'i',
      content: 'Appunti conservati',
    });
  });
}
describe('teacher-only lesson visibility boundary', () => {
  it('denies student direct reads of hidden shadow, missing parent, bytes, practice and notes; query safely omits it', async () => {
    await seed();
    const db = env.authenticatedContext('s').firestore();
    for (const path of [
      'hiddenLessonProjections/l',
      'publicLessons/l',
      'publicLessonPractice/l',
      'publicLessonVisuals/l',
      'students/s/lessonNotes/l',
    ])
      await assertFails(getDoc(doc(db, path)));
    const visible = await assertSucceeds(
      getDocs(
        query(
          collection(db, 'publicLessons'),
          where('programId', '==', 'p'),
          where('importId', '==', 'i'),
        ),
      ),
    );
    expect(visible.empty).toBe(true);
    await assertFails(
      updateDoc(doc(db, 'programs/p/imports/i/lessons/l'), { hiddenFromStudents: false }),
    );
    const owner = env.authenticatedContext('owner').firestore();
    await assertSucceeds(getDoc(doc(owner, 'hiddenLessonProjections/l')));
  });
  it('blocks stale owner create/update republication and shadow lifecycle bypass while allowing bounded teacher edits', async () => {
    await seed();
    const db = env.authenticatedContext('owner').firestore();
    await assertFails(setDoc(doc(db, 'publicLessons/l'), projection('l')));
    await assertFails(
      setDoc(doc(db, 'hiddenLessonProjections/new'), { ...projection('new'), lessonId: 'new' }),
    );
    await assertFails(deleteDoc(doc(db, 'hiddenLessonProjections/l')));
    await assertFails(updateDoc(doc(db, 'hiddenLessonProjections/l'), { lessonId: 'another' }));
    await assertFails(updateDoc(doc(db, 'hiddenLessonProjections/l'), { completed: true }));
    await assertFails(
      updateDoc(doc(db, 'lessonVisibilityLocks/p/imports/i'), { hiddenPublicLessonIds: [] }),
    );
    await assertSucceeds(
      updateDoc(doc(db, 'hiddenLessonProjections/l'), {
        content: 'Contenuto docente aggiornato',
        titolo: 'Titolo',
      }),
    );
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'publicLessons/l'), projection('l'));
    });
    await assertFails(updateDoc(doc(db, 'publicLessons/l'), { content: 'Client obsoleto' }));
  });
  it('preserves the supported atomic publication of forty lessons using one shared import lock', async () => {
    await seed();
    const db = env.authenticatedContext('owner').firestore();
    const batch = writeBatch(db);
    for (let n = 0; n < 40; n++) {
      batch.set(doc(db, `publicLessons/new-${n}`), projection(`new-${n}`));
      batch.set(doc(db, `programs/p/imports/i/lessons/new-${n}`), {
        ownerUid: 'owner',
        importId: 'i',
        completed: false,
      });
    }
    await assertSucceeds(batch.commit());
    const next = writeBatch(db);
    for (let n = 0; n < 40; n++) next.update(doc(db, `publicLessons/new-${n}`), { order: n });
    await assertSucceeds(next.commit());
  });
  it('allows canonical cleanup only after lesson deletion and keeps registry tombstones until program deletion', async () => {
    await seed();
    const db = env.authenticatedContext('owner').firestore();
    await assertFails(deleteDoc(doc(db, 'lessonVisibilityLocks/p/imports/i')));
    const batch = writeBatch(db);
    batch.delete(doc(db, 'programs/p/imports/i/lessons/l'));
    batch.delete(doc(db, 'hiddenLessonProjections/l'));
    await assertSucceeds(batch.commit());
    await assertSucceeds(deleteDoc(doc(db, 'hiddenLessonProjections/nonexistent')));
    await assertFails(setDoc(doc(db, 'publicLessons/l'), projection('l')));
    await assertSucceeds(deleteDoc(doc(db, 'programs/p')));
    await assertSucceeds(deleteDoc(doc(db, 'lessonVisibilityLocks/p/imports/i')));
  });
  it('permits eight atomic canonical-plus-shadow deletions within the Rules lookup budget', async () => {
    await seed();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const batch = writeBatch(db);
      for (let n = 0; n < 8; n++) {
        batch.set(doc(db, `programs/p/imports/i/lessons/hidden-${n}`), {
          ownerUid: 'owner',
          hiddenFromStudents: true,
        });
        batch.set(doc(db, `hiddenLessonProjections/hidden-${n}`), {
          ...projection(`hidden-${n}`),
          lessonId: `hidden-${n}`,
        });
      }
      await batch.commit();
    });
    const db = env.authenticatedContext('owner').firestore(),
      batch = writeBatch(db);
    for (let n = 0; n < 8; n++) {
      batch.delete(doc(db, `programs/p/imports/i/lessons/hidden-${n}`));
      batch.delete(doc(db, `publicLessons/hidden-${n}`));
      batch.delete(doc(db, `publicLessonPractice/hidden-${n}`));
      batch.delete(doc(db, `hiddenLessonProjections/hidden-${n}`));
    }
    await assertSucceeds(batch.commit());
  });
});
