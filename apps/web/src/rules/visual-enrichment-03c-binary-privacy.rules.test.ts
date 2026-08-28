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
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORAGE_RULES = resolve(__dirname, '../../../../storage.rules');
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const STUDENT_UID = 'student-uid';
const OTHER_TEACHER_UID = 'other-teacher-uid';
const ASSET = '11111111-2222-4333-8444-555555555555';
const ASSET_2 = '99999999-8888-4777-8666-555555555555';
const VISUAL_PATH = `repository/${OWNER_UID}/imp-1/uda-01-reti/visuals/${ASSET}.webp`;
const LESSON_PATH = `repository/${OWNER_UID}/imp-1/uda-01-reti/lezione-001.md`;
const PAYLOAD = new Uint8Array([0x52, 0x49, 0x46, 0x46]);

/**
 * VISUAL-ENRICHMENT-03C — privacy del percorso binario.
 *
 * La domanda a cui questi test rispondono è una sola: **esiste un secondo modo
 * di arrivare ai byte di un'immagine, oltre alla callable verificata?** La
 * risposta deve essere no per chiunque — studente, anonimo, altro docente, e
 * anche per il docente proprietario, che quei byte li ottiene solo attraverso
 * `aiVisualExportBatch` dopo che il server ha verificato manifest, hash e
 * dimensioni.
 */

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-schoolforge',
    firestore: {
      rules: readFileSync(FIRESTORE_RULES, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
    storage: {
      rules: readFileSync(STORAGE_RULES, 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });
});

afterEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
});

afterAll(async () => {
  await testEnv.cleanup();
});

async function seedObject(path: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), path), PAYLOAD);
  });
}

const ownerStorage = () => testEnv.authenticatedContext(OWNER_UID).storage();
const studentStorage = () => testEnv.authenticatedContext(STUDENT_UID).storage();
const otherStorage = () => testEnv.authenticatedContext(OTHER_TEACHER_UID).storage();
const anonStorage = () => testEnv.unauthenticatedContext().storage();

describe('Storage — i binari visuali non hanno una seconda porta', () => {
  /**
   * Il caso che conta di più, e il solo che questa fase cambia davvero: anche
   * il proprietario passa dalla callable. Il runtime web non legge Storage
   * direttamente da SGW-02C, quindi non toglie nulla a nessuno — chiude una
   * lettura non verificata accanto a una verificata.
   */
  it('nega la lettura diretta anche al docente proprietario', async () => {
    await seedObject(VISUAL_PATH);
    await assertFails(getBytes(ref(ownerStorage(), VISUAL_PATH)));
  });

  it('nega la scrittura diretta anche al docente proprietario', async () => {
    await assertFails(uploadBytes(ref(ownerStorage(), VISUAL_PATH), PAYLOAD));
  });

  it('nega studente, altro docente e anonimo', async () => {
    await seedObject(VISUAL_PATH);
    await assertFails(getBytes(ref(studentStorage(), VISUAL_PATH)));
    await assertFails(getBytes(ref(otherStorage(), VISUAL_PATH)));
    await assertFails(getBytes(ref(anonStorage(), VISUAL_PATH)));
  });

  /**
   * La regola è più specifica di quella generale del repository e deve vincere
   * solo su `visuals/`: il resto dell'archivio del docente non cambia
   * comportamento, altrimenti questa fase avrebbe rotto l'editor.
   */
  it('non tocca il resto del repository del docente', async () => {
    await seedObject(LESSON_PATH);
    await assertSucceeds(getBytes(ref(ownerStorage(), LESSON_PATH)));
    await assertFails(getBytes(ref(studentStorage(), LESSON_PATH)));
  });

  it('lo staging resta chiuso a chiunque', async () => {
    const staging = `staging/${OWNER_UID}/abc.webp`;
    await seedObject(staging);
    await assertFails(getBytes(ref(ownerStorage(), staging)));
    await assertFails(getBytes(ref(studentStorage(), staging)));
  });
});

describe('publicLessonVisuals resta l’unica sorgente dei byte per lo studente', () => {
  async function seedStudentReadable() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'settings/owner'), { ownerUid: OWNER_UID });
      await setDoc(doc(db, 'settings/ownerPublic'), { ownerUid: OWNER_UID });
      await setDoc(doc(db, 'settings/studentAccess'), {
        ownerUid: OWNER_UID,
        studentPortalEnabled: true,
        newStudentRequestsEnabled: false,
      });
      await setDoc(doc(db, 'students', STUDENT_UID), {
        uid: STUDENT_UID,
        ownerUid: OWNER_UID,
        email: 'student@example.com',
        displayName: null,
        status: 'approved',
        classId: 'class-a',
      });
      await setDoc(doc(db, 'programs/p1'), {
        ownerUid: OWNER_UID,
        title: 'Reti',
        activeImportId: 'i1',
        classIds: ['class-a'],
        createdAt: null,
        updatedAt: null,
      });
      await setDoc(doc(db, 'publicLessons/l1'), {
        ownerUid: OWNER_UID,
        programId: 'p1',
        importId: 'i1',
        udaId: 'uda-1',
        udaDir: 'uda-01-reti',
        path: 'uda-01-reti/lezione-001.md',
        filename: 'lezione-001.md',
        contentPath: LESSON_PATH,
        createdAt: null,
        completed: true,
        content: '# Lezione\n',
        visual: {
          assetId: ASSET,
          anchor: {
            headingSlug: 'reti',
            headingText: 'Reti',
            placement: 'after-heading',
          },
          caption: 'Schema',
          altText: 'Diagramma',
          width: 1024,
          height: 1024,
        },
      });
      await setDoc(doc(db, 'publicLessonVisuals/l1'), {
        publicLessonId: 'l1',
        programId: 'p1',
        importId: 'i1',
        assetId: ASSET,
        dataUri: 'data:image/webp;base64,UklGRg==',
        width: 1024,
        height: 1024,
      });
    });
  }

  /**
   * Il contratto di VE-03A resta intatto dopo l'introduzione dell'export: lo
   * studente legge i byte da Firestore, non da Storage, e non ha guadagnato
   * alcun percorso alternativo.
   */
  it('lo studente legge i byte dalla proiezione e da nessun’altra parte', async () => {
    await seedStudentReadable();
    await seedObject(VISUAL_PATH);

    const studentDb = testEnv.authenticatedContext(STUDENT_UID).firestore();
    const snap = await assertSucceeds(getDoc(doc(studentDb, 'publicLessonVisuals/l1')));
    expect(snap.get('dataUri')).toContain('data:image/webp;base64,');

    // La stessa immagine, cercata su Storage, resta negata.
    await assertFails(getBytes(ref(studentStorage(), VISUAL_PATH)));
  });

  it('la proiezione non espone alcun percorso da cui risalire ai byte', async () => {
    await seedStudentReadable();
    const studentDb = testEnv.authenticatedContext(STUDENT_UID).firestore();
    const snap = await assertSucceeds(getDoc(doc(studentDb, 'publicLessonVisuals/l1')));

    for (const forbidden of ['storageRef', 'sha256', 'sourceBodyHash', 'approvedAt', 'ownerUid']) {
      expect(snap.get(forbidden)).toBeUndefined();
    }
  });

  it('autorizza i byte multi solo quando le chiavi coincidono col manifest pubblico', async () => {
    await seedStudentReadable();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const item = (assetId: string) => ({
        assetId,
        anchor: { headingSlug: 'reti', headingText: 'Reti', placement: 'after-heading' },
        caption: 'Schema',
        altText: 'Diagramma',
        width: 1024,
        height: 1024,
      });
      await setDoc(
        doc(db, 'publicLessons/l1'),
        {
          visuals: {
            contractVersion: 'lesson-visuals/v1',
            items: [item(ASSET), item(ASSET_2)],
          },
          visual: null,
        },
        { merge: true },
      );
      const projection = (await getDoc(doc(db, 'publicLessons/l1'))).data()!;
      delete projection.visual;
      await setDoc(doc(db, 'publicLessons/l1'), projection);
      await setDoc(doc(db, 'publicLessonVisuals/l1'), {
        contractVersion: 'lesson-visuals/v1',
        publicLessonId: 'l1',
        programId: 'p1',
        importId: 'i1',
        bytes: {
          [ASSET]: {
            dataUri: 'data:image/webp;base64,UklGRg==',
            mimeType: 'image/webp',
            width: 1024,
            height: 1024,
          },
          [ASSET_2]: {
            dataUri: 'data:image/webp;base64,UklGRg==',
            mimeType: 'image/webp',
            width: 1024,
            height: 1024,
          },
        },
      });
    });
    const studentDb = testEnv.authenticatedContext(STUDENT_UID).firestore();
    await assertSucceeds(getDoc(doc(studentDb, 'publicLessonVisuals/l1')));
  });
});
