// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const STUDENT_UID = 'student-uid';
const OTHER_STUDENT_UID = 'other-student-uid';

/**
 * VISUAL-ENRICHMENT-03A — le due invarianti fondamentali difese dalle Rules.
 *
 * 1. **`publicLessons.visual` esiste solo su una lezione svolta**, e ha una
 *    forma chiusa di sole chiavi di presentazione. Nessun `storageRef`, nessun
 *    `sha256`, nessun `sourceBodyHash`, nessun `approvedAt`: non servono a
 *    mostrare un'immagine, servirebbero solo a raccontare dove sta e di che
 *    testo parlava.
 * 2. **`publicLessonVisuals` è server-only in scrittura** e in lettura è gated
 *    esattamente come `publicLessons`. Una condizione più debole qui renderebbe
 *    visibile attraverso l'immagine ciò che la lezione nega.
 */

const VISUAL = {
  assetId: '11111111-2222-4333-8444-555555555555',
  anchor: {
    headingSlug: 'la-fotosintesi',
    headingText: 'La fotosintesi',
    placement: 'after-heading',
  },
  caption: 'Schema della fotosintesi',
  altText: 'Diagramma con foglia, luce e anidride carbonica',
  width: 1024,
  height: 1024,
};

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge-visual-03a',
    firestore: {
      rules: readFileSync(FIRESTORE_RULES, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

function ownerDb() {
  return testEnv.authenticatedContext(OWNER_UID).firestore() as unknown as Firestore;
}
function studentDb() {
  return testEnv.authenticatedContext(STUDENT_UID).firestore() as unknown as Firestore;
}
function otherStudentDb() {
  return testEnv.authenticatedContext(OTHER_STUDENT_UID).firestore() as unknown as Firestore;
}
function anonDb() {
  return testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
}

function projection(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ownerUid: OWNER_UID,
    programId: 'p1',
    importId: 'i1',
    udaId: 'uda-1',
    udaDir: 'uda-01-reti',
    path: 'uda-01-reti/lezione-001.md',
    filename: 'lezione-001.md',
    contentPath: 'repository/owner-uid/imports/i1/uda-01-reti/lezione-001.md',
    createdAt: null,
    ...over,
  };
}

function visualDoc(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    publicLessonId: 'l1',
    programId: 'p1',
    importId: 'i1',
    assetId: VISUAL.assetId,
    dataUri: 'data:image/webp;base64,AAAA',
    width: 1024,
    height: 1024,
    ...over,
  };
}

async function seed(
  params: {
    publicLesson?: Record<string, unknown> | null;
    visual?: Record<string, unknown> | null;
    program?: Record<string, unknown>;
    examMode?: boolean;
  } = {},
) {
  const { publicLesson = projection(), visual = null, program, examMode = false } = params;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/owner'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/ownerPublic'), { ownerUid: OWNER_UID });
    await setDoc(doc(db, 'settings/studentAccess'), {
      ownerUid: OWNER_UID,
      studentPortalEnabled: true,
      newStudentRequestsEnabled: false,
      // La modalità esame vive qui, non sulla classe: è una leva globale con
      // uno scope, ed è la stessa che spegne l'accesso alle lezioni.
      ...(examMode ? { examMode: { enabled: true, scope: 'classes', classIds: ['class-a'] } } : {}),
    });
    for (const [uid, classId] of [
      [STUDENT_UID, 'class-a'],
      [OTHER_STUDENT_UID, 'class-b'],
    ] as const) {
      await setDoc(doc(db, 'students', uid), {
        uid,
        ownerUid: OWNER_UID,
        email: `${uid}@example.com`,
        displayName: null,
        status: 'approved',
        classId,
      });
    }
    await setDoc(doc(db, 'programs/p1'), {
      ownerUid: OWNER_UID,
      title: 'Scienze',
      activeImportId: 'i1',
      classIds: ['class-a'],
      createdAt: null,
      updatedAt: null,
      ...program,
    });
    if (publicLesson) await setDoc(doc(db, 'publicLessons/l1'), publicLesson);
    if (visual) await setDoc(doc(db, 'publicLessonVisuals/l1'), visual);
  });
}

describe('publicLessons.visual — invariante di visibilità', () => {
  it('il docente può proiettare l’immagine su una lezione svolta', async () => {
    await seed({ publicLesson: projection({ completed: true }) });
    await assertSucceeds(updateDoc(doc(ownerDb(), 'publicLessons/l1'), { visual: VISUAL }));
  });

  it('NON può proiettarla su una lezione non svolta', async () => {
    await seed({ publicLesson: projection({ completed: false }) });
    await assertFails(updateDoc(doc(ownerDb(), 'publicLessons/l1'), { visual: VISUAL }));
  });

  /** Legacy: `completed` assente significa «non svolta», non «vincolo assente». */
  it('NON può proiettarla su una proiezione priva del campo completed', async () => {
    await seed({ publicLesson: projection() });
    await assertFails(updateDoc(doc(ownerDb(), 'publicLessons/l1'), { visual: VISUAL }));
  });

  it('NON può conservare l’immagine smarcando la lezione', async () => {
    await seed({ publicLesson: projection({ completed: true, visual: VISUAL }) });
    await assertFails(updateDoc(doc(ownerDb(), 'publicLessons/l1'), { completed: false }));
  });

  it('può smarcare la lezione rimuovendo l’immagine nello stesso commit', async () => {
    await seed({ publicLesson: projection({ completed: true, visual: VISUAL }) });
    await assertSucceeds(
      setDoc(doc(ownerDb(), 'publicLessons/l1'), projection({ completed: false })),
    );
  });

  it('una proiezione legacy senza visual resta scrivibile', async () => {
    await seed({ publicLesson: projection({ completed: true }) });
    await assertSucceeds(updateDoc(doc(ownerDb(), 'publicLessons/l1'), { completed: false }));
  });
});

describe('publicLessons.visual — forma chiusa e campi privati', () => {
  /**
   * Il cuore della garanzia negativa: ogni campo privato aggiunto alla
   * proiezione deve essere rifiutato dalle Rules, non solo omesso dal server.
   */
  it('rifiuta qualunque campo privato aggiunto alla proiezione', async () => {
    await seed({ publicLesson: projection({ completed: true }) });
    const privates = [
      'storageRef',
      'sha256',
      'byteLength',
      'sourceBodyHash',
      'approvedAt',
      'mimeType',
      'styleVersion',
      'ownerUid',
      'runId',
      'subject',
      'prompt',
      'costMicroUsd',
    ];
    for (const key of privates) {
      await assertFails(
        updateDoc(doc(ownerDb(), 'publicLessons/l1'), { visual: { ...VISUAL, [key]: 'x' } }),
      );
    }
  });

  it('rifiuta un manifest a cui manca una chiave di presentazione', async () => {
    await seed({ publicLesson: projection({ completed: true }) });
    for (const key of ['assetId', 'anchor', 'caption', 'altText', 'width', 'height']) {
      const partial: Record<string, unknown> = { ...VISUAL };
      delete partial[key];
      await assertFails(updateDoc(doc(ownerDb(), 'publicLessons/l1'), { visual: partial }));
    }
  });

  it('rifiuta tipi errati e un placement diverso da after-heading', async () => {
    await seed({ publicLesson: projection({ completed: true }) });
    await assertFails(
      updateDoc(doc(ownerDb(), 'publicLessons/l1'), { visual: { ...VISUAL, width: '1024' } }),
    );
    await assertFails(
      updateDoc(doc(ownerDb(), 'publicLessons/l1'), { visual: { ...VISUAL, caption: 42 } }),
    );
    await assertFails(
      updateDoc(doc(ownerDb(), 'publicLessons/l1'), {
        visual: { ...VISUAL, anchor: { ...VISUAL.anchor, placement: 'inline' } },
      }),
    );
    await assertFails(
      updateDoc(doc(ownerDb(), 'publicLessons/l1'), {
        visual: { ...VISUAL, anchor: { ...VISUAL.anchor, storageRef: 'x' } },
      }),
    );
  });
});

describe('publicLessonVisuals — server-only in scrittura', () => {
  it('nega la creazione anche al docente proprietario', async () => {
    await seed({ publicLesson: projection({ completed: true }) });
    await assertFails(setDoc(doc(ownerDb(), 'publicLessonVisuals/l1'), visualDoc()));
  });

  it('nega aggiornamento e cancellazione anche al docente proprietario', async () => {
    await seed({ publicLesson: projection({ completed: true }), visual: visualDoc() });
    await assertFails(updateDoc(doc(ownerDb(), 'publicLessonVisuals/l1'), { width: 512 }));
    await assertFails(deleteDoc(doc(ownerDb(), 'publicLessonVisuals/l1')));
  });

  it('nega ogni scrittura a uno studente e a un anonimo', async () => {
    await seed({ publicLesson: projection({ completed: true }), visual: visualDoc() });
    await assertFails(setDoc(doc(studentDb(), 'publicLessonVisuals/l2'), visualDoc()));
    await assertFails(deleteDoc(doc(studentDb(), 'publicLessonVisuals/l1')));
    await assertFails(setDoc(doc(anonDb(), 'publicLessonVisuals/l2'), visualDoc()));
  });
});

describe('publicLessonVisuals — lettura gated come publicLessons', () => {
  it('lo studente della classe legge l’immagine dell’import attivo', async () => {
    await seed({ publicLesson: projection({ completed: true }), visual: visualDoc() });
    await assertSucceeds(getDoc(doc(studentDb(), 'publicLessonVisuals/l1')));
  });

  it('il docente proprietario legge sempre', async () => {
    await seed({ publicLesson: projection({ completed: true }), visual: visualDoc() });
    await assertSucceeds(getDoc(doc(ownerDb(), 'publicLessonVisuals/l1')));
  });

  it('un anonimo non legge mai', async () => {
    await seed({ publicLesson: projection({ completed: true }), visual: visualDoc() });
    await assertFails(getDoc(doc(anonDb(), 'publicLessonVisuals/l1')));
  });

  it('uno studente di un’altra classe non legge', async () => {
    await seed({ publicLesson: projection({ completed: true }), visual: visualDoc() });
    await assertFails(getDoc(doc(otherStudentDb(), 'publicLessonVisuals/l1')));
  });

  /** Import superato: la lezione è negata, e l'immagine deve esserlo con lei. */
  it('nega l’immagine di un import non più attivo', async () => {
    await seed({
      publicLesson: projection({ completed: true }),
      visual: visualDoc({ importId: 'i0' }),
      program: { activeImportId: 'i1' },
    });
    await assertFails(getDoc(doc(studentDb(), 'publicLessonVisuals/l1')));
  });

  it('nega l’immagine in modalità esame', async () => {
    await seed({
      publicLesson: projection({ completed: true }),
      visual: visualDoc(),
      examMode: true,
    });
    await assertFails(getDoc(doc(studentDb(), 'publicLessonVisuals/l1')));
  });

  it('nega l’immagine di un corso inesistente', async () => {
    await seed({
      publicLesson: projection({ completed: true }),
      visual: visualDoc({ programId: 'p-ignoto' }),
    });
    await assertFails(getDoc(doc(studentDb(), 'publicLessonVisuals/l1')));
  });
});
