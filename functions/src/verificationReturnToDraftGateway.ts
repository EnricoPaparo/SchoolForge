import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { DocumentData, Firestore, Transaction } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { SCHOOLFORGE_FUNCTION_REGION } from './deploymentRegion.js';

const SUBMISSION_ERROR = 'Elimina prima tutte le consegne associate alla verifica.';

if (getApps().length === 0) initializeApp();

function parseInput(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', 'Input non valido.');
  }
  const keys = Object.keys(value);
  const verificationId = (value as Record<string, unknown>).verificationId;
  if (
    keys.length !== 1 ||
    keys[0] !== 'verificationId' ||
    typeof verificationId !== 'string' ||
    verificationId.length === 0 ||
    verificationId.length > 1500 ||
    verificationId.includes('/') ||
    verificationId === '.' ||
    verificationId === '..'
  ) {
    throw new HttpsError('invalid-argument', 'verificationId non valido.');
  }
  return verificationId;
}

function referencedLabelIds(data: DocumentData): string[] {
  const differentiation = data.config?.differentiation as Record<string, unknown> | undefined;
  if (differentiation === undefined) return [];
  if (differentiation.version !== 1 || !Array.isArray(differentiation.questions)) {
    throw new HttpsError('failed-precondition', 'Configurazione delle varianti non valida.');
  }
  const result = new Set<string>();
  for (const raw of differentiation.questions) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new HttpsError('failed-precondition', 'Configurazione delle varianti non valida.');
    }
    const choices = (raw as Record<string, unknown>).choices;
    if (typeof choices !== 'object' || choices === null || Array.isArray(choices)) {
      throw new HttpsError('failed-precondition', 'Configurazione delle varianti non valida.');
    }
    for (const labelId of Object.keys(choices)) {
      if (!labelId || labelId.includes('/')) {
        throw new HttpsError('failed-precondition', 'Configurazione delle varianti non valida.');
      }
      result.add(labelId);
    }
  }
  return [...result];
}

function configWithoutMissingLabels(data: DocumentData, missing: Set<string>): DocumentData {
  if (missing.size === 0) return data.config;
  const config = { ...(data.config as Record<string, unknown>) };
  const differentiation = config.differentiation as Record<string, unknown>;
  const questions = (differentiation.questions as Record<string, unknown>[])
    .map((question) => {
      const choices = Object.fromEntries(
        Object.entries(question.choices as Record<string, unknown>).filter(
          ([labelId]) => !missing.has(labelId),
        ),
      );
      return { ...question, choices };
    })
    .filter((question) => Object.keys(question.choices).length > 0);
  if (questions.length === 0) delete config.differentiation;
  else config.differentiation = { ...differentiation, questions };
  return config;
}

async function assertNoSubmissions(
  tx: Transaction,
  db: Firestore,
  verificationId: string,
): Promise<void> {
  const snap = await tx.get(
    db.collection('submissions').where('verificationId', '==', verificationId).limit(1),
  );
  if (!snap.empty) {
    throw new HttpsError('failed-precondition', SUBMISSION_ERROR, { code: 'submissions_exist' });
  }
}

/**
 * Fence atomico: la stessa transazione che prova l'assenza di consegne spegne
 * ogni canale studente. Una create concorrente viene quindi serializzata prima
 * (e fa rifiutare il fence) oppure dopo (e Rules/status autoritativo la negano).
 */
export async function installReturnToDraftFence(
  db: Firestore,
  verificationId: string,
  ownerUid: string,
): Promise<void> {
  const verificationRef = db.doc(`verifications/${verificationId}`);
  const projectionRef = verificationRef.collection('publishedProjection').doc('data');
  await db.runTransaction(async (tx) => {
    const verificationSnap = await tx.get(verificationRef);
    if (!verificationSnap.exists) throw new HttpsError('not-found', 'Verifica non trovata.');
    const data = verificationSnap.data()!;
    if (data.ownerUid !== ownerUid) {
      throw new HttpsError('permission-denied', 'Verifica non accessibile.');
    }
    if (data.status === 'draft' && data.returnToDraftPending !== true) return;
    if (data.status !== 'active' && data.status !== 'closed') {
      throw new HttpsError('failed-precondition', 'Verifica non riportabile in bozza.');
    }
    await assertNoSubmissions(tx, db, verificationId);
    const projectionSnap = await tx.get(projectionRef);

    tx.update(verificationRef, {
      visibility: 'hidden',
      onlineEnabled: false,
      studentPdfEnabled: false,
      returnToDraftPending: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (projectionSnap.exists) {
      tx.update(projectionRef, {
        visibility: 'hidden',
        onlineEnabled: false,
        studentPdfEnabled: false,
      });
    }
  });
}

export async function finalizeReturnToDraft(
  db: Firestore,
  verificationId: string,
  ownerUid: string,
): Promise<void> {
  const verificationRef = db.doc(`verifications/${verificationId}`);
  const projectionRef = verificationRef.collection('publishedProjection').doc('data');
  const auditRef = db.collection('auditEvents').doc();
  await db.runTransaction(async (tx) => {
    const verificationSnap = await tx.get(verificationRef);
    if (!verificationSnap.exists) throw new HttpsError('not-found', 'Verifica non trovata.');
    const data = verificationSnap.data()!;
    if (data.ownerUid !== ownerUid) {
      throw new HttpsError('permission-denied', 'Verifica non accessibile.');
    }
    // Replay dopo un successo la cui risposta è andata persa.
    if (data.status === 'draft' && data.returnToDraftPending !== true) return;
    if (
      (data.status !== 'active' && data.status !== 'closed') ||
      data.returnToDraftPending !== true
    ) {
      throw new HttpsError('failed-precondition', 'Verifica non riportabile in bozza.');
    }
    await assertNoSubmissions(tx, db, verificationId);

    const labelIds = referencedLabelIds(data);
    const labels = await Promise.all(
      labelIds.map(async (labelId) => ({
        ref: db.doc(`differentiationLabels/${labelId}`),
        snap: await tx.get(db.doc(`differentiationLabels/${labelId}`)),
      })),
    );
    const missingLabelIds = new Set<string>();
    for (const { ref, snap } of labels) {
      if (!snap.exists) {
        missingLabelIds.add(ref.id);
        continue;
      }
      const label = snap.data();
      if (
        label?.ownerUid !== ownerUid ||
        !Number.isSafeInteger(label.draftUsageCount) ||
        label.draftUsageCount < 0
      ) {
        throw new HttpsError('failed-precondition', 'Contatore delle etichette non coerente.');
      }
      tx.update(ref, {
        draftUsageCount: label.draftUsageCount + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const verificationUpdate: DocumentData = {
      status: 'draft',
      visibility: 'hidden',
      onlineEnabled: false,
      studentPdfEnabled: false,
      teacherSnapshot: null,
      activatedAt: null,
      closedAt: null,
      returnToDraftPending: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (missingLabelIds.size > 0) {
      verificationUpdate.config = configWithoutMissingLabels(data, missingLabelIds);
    }
    tx.update(verificationRef, verificationUpdate);
    tx.delete(projectionRef);
    tx.set(auditRef, {
      actorUid: ownerUid,
      action: 'verification.returnedToDraft',
      targetId: verificationId,
      outcome: 'success',
      reason: null,
      timestamp: FieldValue.serverTimestamp(),
    });
  });
}

/** Esportata per i test Emulator: la callable aggiunge soltanto auth/error mapping. */
export async function returnVerificationToDraftWithDb(
  db: Firestore,
  verificationId: string,
  ownerUid: string,
): Promise<void> {
  await installReturnToDraftFence(db, verificationId, ownerUid);
  const current = await db.doc(`verifications/${verificationId}`).get();
  if (current.data()?.status === 'draft' && current.data()?.returnToDraftPending !== true) return;

  // Le assegnazioni sono derivate e server-only. Il fence resta attivo se la
  // pulizia fallisce: ripetere l'azione riprende da qui senza riaprire accessi.
  await db.recursiveDelete(db.collection(`verifications/${verificationId}/studentAssignments`));
  await finalizeReturnToDraft(db, verificationId, ownerUid);
}

export const returnVerificationToDraft = onCall(
  { region: SCHOOLFORGE_FUNCTION_REGION, minInstances: 0, maxInstances: 3 },
  async (request: CallableRequest) => {
    const started = Date.now();
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Autenticazione richiesta.');
    const verificationId = parseInput(request.data);
    try {
      await returnVerificationToDraftWithDb(getFirestore(), verificationId, request.auth.uid);
      logger.info('returnVerificationToDraft', {
        outcome: 'ok',
        durationMs: Date.now() - started,
      });
      return { status: 'draft' as const };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('returnVerificationToDraft', {
        outcome: 'internal',
        durationMs: Date.now() - started,
      });
      throw new HttpsError('internal', 'Impossibile riportare la verifica in bozza.');
    }
  },
);
