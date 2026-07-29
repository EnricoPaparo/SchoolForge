import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest, FunctionsErrorCode } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { DocumentData, Firestore, Transaction } from 'firebase-admin/firestore';
import { secureRandomIntBelow } from './verificationVariantCore.js';
import {
  decideForceSubmit,
  ForceSubmitError,
  forceSubmitWrites,
  generateDeliveryCode,
  parseForceSubmitInput,
  resultForDecision,
  submissionIdFor,
  type ForceSubmitErrorCode,
  type ForceSubmitResult,
  type ReceiptSnapshot,
  type SubmissionMetadata,
  type SubmissionSnapshot,
} from './forceSubmitCore.js';

/**
 * FORCE-SUBMIT-01 — callable `forceSubmitSubmission`: il docente acquisisce e
 * chiude una verifica online rimasta in bozza, congelando **l'ultima versione
 * già salvata** dallo studente.
 *
 * La transizione `draft → submitted` è server-side e transazionale perché deve
 * competere con l'autosave dello studente: chi arriva secondo rilegge lo stato
 * aggiornato e si comporta di conseguenza — l'autosave successivo alla chiusura
 * viene negato dalle Rules (la submission non è più `draft`), e una consegna
 * normale già avvenuta non viene mai sovrascritta.
 *
 * Tutta la logica decisionale vive nel core puro (`forceSubmitCore.ts`); qui
 * c'è solo il wiring Admin SDK.
 */

export const FORCE_SUBMIT_REGION = 'us-central1';

if (getApps().length === 0) initializeApp();

function toSubmissionSnapshot(data: DocumentData): SubmissionSnapshot {
  return {
    submissionId: data.submissionId,
    verificationId: data.verificationId,
    studentUid: data.studentUid,
    ownerUid: data.ownerUid,
    status: data.status,
    deliveryCode: data.deliveryCode,
    forcedByTeacher: data.forcedByTeacher,
  };
}

function toReceiptSnapshot(data: DocumentData): ReceiptSnapshot {
  return {
    submissionId: data.submissionId,
    verificationId: data.verificationId,
    studentUid: data.studentUid,
    ownerUid: data.ownerUid,
    deliveryCode: data.deliveryCode,
    forcedByTeacher: data.forcedByTeacher,
  };
}

/**
 * Transazione atomica. Ordine deliberato delle letture: verifica → submission →
 * receipt. Tutte e tre entrano nel set transazionale, quindi una scrittura
 * concorrente su una qualunque di esse fa ripartire la transazione con dati
 * freschi invece di far vincere una decisione presa su uno stato superato.
 *
 * Le sole scritture possibili sono due, nello stesso commit: l'update della
 * submission e la creazione della receipt. Il replay idempotente non scrive.
 */
export async function runForceSubmitTransaction(
  db: Firestore,
  callerUid: string | null,
  rawInput: unknown,
): Promise<ForceSubmitResult> {
  const input = parseForceSubmitInput(rawInput);
  if (!callerUid) throw new ForceSubmitError('unauthenticated', 'Autenticazione richiesta.');

  const submissionId = submissionIdFor(input.verificationId, input.studentUid);
  const verificationRef = db.doc(`verifications/${input.verificationId}`);
  const submissionRef = db.doc(`submissions/${submissionId}`);
  const receiptRef = db.doc(`submissionReceipts/${submissionId}`);

  return db.runTransaction(async (tx: Transaction): Promise<ForceSubmitResult> => {
    const [verificationSnap, submissionSnap, receiptSnap] = await Promise.all([
      tx.get(verificationRef),
      tx.get(submissionRef),
      tx.get(receiptRef),
    ]);

    const decision = decideForceSubmit(
      {
        callerUid,
        input,
        verification: verificationSnap.exists
          ? { ownerUid: (verificationSnap.data() as DocumentData).ownerUid as string }
          : null,
        submission: submissionSnap.exists
          ? toSubmissionSnapshot(submissionSnap.data() as DocumentData)
          : null,
        receipt: receiptSnap.exists ? toReceiptSnapshot(receiptSnap.data() as DocumentData) : null,
      },
      () => generateDeliveryCode(new Date().getUTCFullYear(), secureRandomIntBelow),
    );

    if (decision.kind !== 'apply') return resultForDecision(decision);

    const submission = submissionSnap.data() as DocumentData;
    // Payload composto dal core puro (contenuto ed esclusioni sono testati lì).
    const writes = forceSubmitWrites(
      decision,
      input,
      submission as unknown as SubmissionMetadata,
      FieldValue.serverTimestamp(),
    );

    tx.update(submissionRef, writes.submissionUpdate);
    tx.set(receiptRef, writes.receipt);

    return resultForDecision(decision);
  });
}

function toHttpsError(err: ForceSubmitError): HttpsError {
  const map: Record<ForceSubmitErrorCode, FunctionsErrorCode> = {
    unauthenticated: 'unauthenticated',
    invalid_input: 'invalid-argument',
    not_found: 'not-found',
    permission_denied: 'permission-denied',
    failed_precondition: 'failed-precondition',
  };
  return new HttpsError(map[err.code], err.message, { code: err.code });
}

export const forceSubmitSubmission = onCall(
  { region: FORCE_SUBMIT_REGION, minInstances: 0, maxInstances: 3 },
  async (request: CallableRequest) => {
    const started = Date.now();
    const db = getFirestore();
    try {
      const result = await runForceSubmitTransaction(db, request.auth?.uid ?? null, request.data);
      // Log minimale e non sensibile: nessun id, uid o contenuto.
      logger.info('forceSubmitSubmission', {
        outcome: result.status,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (err) {
      if (err instanceof ForceSubmitError) {
        logger.info('forceSubmitSubmission', {
          outcome: err.code,
          durationMs: Date.now() - started,
        });
        throw toHttpsError(err);
      }
      logger.error('forceSubmitSubmission', {
        outcome: 'internal',
        durationMs: Date.now() - started,
      });
      throw new HttpsError('internal', 'Errore interno della chiusura consegna.');
    }
  },
);
