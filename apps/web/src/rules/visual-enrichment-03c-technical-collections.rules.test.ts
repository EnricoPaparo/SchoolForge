// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRESTORE_RULES = resolve(__dirname, '../../../../firestore.rules');

const OWNER_UID = 'owner-uid';
const STUDENT_UID = 'student-uid';

/**
 * VISUAL-ENRICHMENT-03C — le collezioni tecniche restano server-only.
 *
 * VE-03 ne ha introdotte cinque. Contengono identità, percorsi canonici e
 * impronte del corpo delle lezioni: servono al server e a nessun altro. Questo
 * file è la verifica che la chiusura valga ancora dopo l'aggiunta dell'export,
 * e che l'export non abbia aperto una collezione nuova per comodità.
 *
 * File separato dal test sui binari perché lì convivono contesti Storage e
 * Firestore per gli stessi uid, e il client Firestore rifiuta di riconfigurare
 * un'istanza già avviata.
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
  });
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

const TECHNICAL = [
  'visualRuns/x',
  'aiVisualCandidates/x',
  'aiVisualPromotions/x',
  'aiVisualAbandonments/x',
  'aiVisualRemovals/x',
  // MULTI-VISUAL-04 — chiavi di idempotenza della revisione gratuita §8.4.
  'visualPlanSlotEdits/x',
];

describe('collezioni tecniche VE-03 — nessuna è raggiungibile dal client', () => {
  it('nega la lettura a proprietario, studente e anonimo', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      for (const path of TECHNICAL) {
        await setDoc(doc(db, path), { ownerUid: OWNER_UID, tecnico: true });
      }
    });

    const dbs = [
      testEnv.authenticatedContext(OWNER_UID).firestore(),
      testEnv.authenticatedContext(STUDENT_UID).firestore(),
      testEnv.unauthenticatedContext().firestore(),
    ];
    for (const path of TECHNICAL) {
      for (const db of dbs) {
        await assertFails(getDoc(doc(db, path)));
      }
    }
  });

  it('nega la scrittura anche al docente proprietario', async () => {
    const ownerDb = testEnv.authenticatedContext(OWNER_UID).firestore();
    for (const path of TECHNICAL) {
      await assertFails(setDoc(doc(ownerDb, path), { x: 1 }));
    }
  });
});
