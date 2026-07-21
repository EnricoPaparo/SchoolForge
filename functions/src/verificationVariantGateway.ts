import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest, FunctionsErrorCode } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { secureRandomIntBelow, VexAssignmentError } from './verificationVariantCore.js';
import {
  AssignGatewayError,
  decideAssignment,
  runAssignVariant,
  type AssignErrorCode,
  type AssignVariantDeps,
  type PersistAssignmentInput,
  type PersistAssignmentResult,
  type StudentContext,
  type VerificationContext,
} from './verificationVariantGatewayCore.js';

/**
 * VEX-01B — callable `assignVerificationVariant` (Cloud Functions v2 `onCall`,
 * scale-to-zero, regione del progetto). Assegna in modo **idempotente** una
 * variante equivalente allo studente e restituisce **solo** le domande
 * assegnate, senza soluzioni né alternative non assegnate. Tutta la logica pura
 * è in `verificationVariantGatewayCore`/`verificationVariantCore`; qui c'è solo
 * il wiring Admin SDK (letture puntuali + transazione a scrittura singola).
 */

export const VEX_GATEWAY_REGION = 'us-central1';

if (getApps().length === 0) initializeApp();

// ── Porte Admin SDK ────────────────────────────────────────────────────────────

function portalEnabled(db: Firestore) {
  return async (): Promise<boolean> => {
    const snap = await db.doc('settings/studentAccess').get();
    return snap.exists ? snap.data()?.studentPortalEnabled === true : false;
  };
}

function loadVerification(db: Firestore) {
  return async (verificationId: string): Promise<VerificationContext | null> => {
    const snap = await db.doc(`verifications/${verificationId}`).get();
    if (!snap.exists) return null;
    const data = snap.data() as Record<string, unknown>;
    const teacherSnapshot = (data.teacherSnapshot ?? null) as Record<string, unknown> | null;
    return {
      ownerUid: (data.ownerUid as string) ?? '',
      status: (data.status as string) ?? '',
      onlineEnabled: data.onlineEnabled === true,
      visibility: (data.visibility as string) ?? 'hidden',
      classId:
        teacherSnapshot && typeof teacherSnapshot.classId === 'string'
          ? (teacherSnapshot.classId as string)
          : (((data.config as Record<string, unknown>)?.classId as string | null) ?? null),
      title: (teacherSnapshot?.title as string) ?? '',
      className: (teacherSnapshot?.className as string | null) ?? null,
      teacherSnapshotRaw: teacherSnapshot,
    };
  };
}

function loadStudent(db: Firestore) {
  return async (uid: string): Promise<StudentContext | null> => {
    const snap = await db.doc(`students/${uid}`).get();
    if (!snap.exists) return null;
    const data = snap.data() as Record<string, unknown>;
    return {
      ownerUid: (data.ownerUid as string) ?? '',
      status: (data.status as string) ?? '',
      classId: (data.classId as string | null) ?? null,
    };
  };
}

/**
 * Transazione idempotente **read-or-assign** su `submissions/{submissionId}`:
 * legge la submission, decide (riuso/aggiornamento/creazione) con la logica
 * pura, e scrive **una sola volta** (0 scritture al riuso). L'estrazione casuale
 * avviene solo quando l'assegnazione non esiste ancora.
 */
function persistAssignment(db: Firestore) {
  return async (input: PersistAssignmentInput): Promise<PersistAssignmentResult> => {
    const ref = db.doc(`submissions/${input.submissionId}`);
    return db.runTransaction(async (tx: Transaction): Promise<PersistAssignmentResult> => {
      const snap = await tx.get(ref);
      const existing = snap.exists
        ? {
            exists: true as const,
            assignedQuestionOrders: (snap.data() as Record<string, unknown>)
              .assignedQuestionOrders as number[] | undefined,
          }
        : { exists: false as const };

      const decision = decideAssignment(existing, input.snapshot, input.randomIntBelow);
      const now = FieldValue.serverTimestamp();

      if (decision.kind === 'reuse') {
        return { assignedQuestionOrders: decision.assignedQuestionOrders, writes: 0 };
      }
      if (decision.kind === 'update') {
        // Unica scrittura: aggiunge il campo server-only alla submission esistente.
        tx.update(ref, { assignedQuestionOrders: decision.assignedQuestionOrders });
        return { assignedQuestionOrders: decision.assignedQuestionOrders, writes: 1 };
      }
      // create: submission assente ⇒ una sola scrittura, forma di avvio + assegnazione.
      tx.set(ref, {
        submissionId: input.submissionId,
        verificationId: input.verificationId,
        studentUid: input.studentUid,
        ownerUid: input.ownerUid,
        status: 'draft',
        answers: {},
        flagged: {},
        attentionEvents: [],
        deliveryCode: null,
        verificationTitle: input.verificationTitle,
        className: input.className,
        assignedQuestionOrders: decision.assignedQuestionOrders,
        startedAt: Timestamp.now(),
        lastSavedAt: now,
        submittedAt: null,
      });
      return { assignedQuestionOrders: decision.assignedQuestionOrders, writes: 1 };
    });
  };
}

function buildDeps(request: CallableRequest, db: Firestore): AssignVariantDeps {
  return {
    callerUid: request.auth?.uid ?? null,
    portalEnabled: portalEnabled(db),
    loadVerification: loadVerification(db),
    loadStudent: loadStudent(db),
    persistAssignment: persistAssignment(db),
    randomIntBelow: secureRandomIntBelow,
  };
}

// ── Errori → HttpsError ──────────────────────────────────────────────────────────

function toHttpsError(err: AssignGatewayError): HttpsError {
  const map: Record<AssignErrorCode, FunctionsErrorCode> = {
    unauthenticated: 'unauthenticated',
    invalid_input: 'invalid-argument',
    not_found: 'not-found',
    permission_denied: 'permission-denied',
    failed_precondition: 'failed-precondition',
  };
  return new HttpsError(map[err.code], err.message, { code: err.code });
}

export const assignVerificationVariant = onCall(
  { region: VEX_GATEWAY_REGION, minInstances: 0, maxInstances: 3 },
  async (request) => {
    const started = Date.now();
    const db = getFirestore();
    try {
      const result = await runAssignVariant(request.data, buildDeps(request, db));
      // Log minimale e NON sensibile: nessun id/uid/contenuto, solo esito e durata.
      logger.info('assignVerificationVariant', {
        outcome: 'ok',
        durationMs: Date.now() - started,
      });
      return result;
    } catch (err) {
      if (err instanceof AssignGatewayError) {
        logger.info('assignVerificationVariant', {
          outcome: err.code,
          durationMs: Date.now() - started,
        });
        throw toHttpsError(err);
      }
      if (err instanceof VexAssignmentError) {
        // Fail-closed su dati server incoerenti (nessun dettaglio sensibile).
        logger.error('assignVerificationVariant', {
          outcome: err.code,
          durationMs: Date.now() - started,
        });
        throw new HttpsError('failed-precondition', err.message, { code: err.code });
      }
      logger.error('assignVerificationVariant', {
        outcome: 'internal',
        durationMs: Date.now() - started,
      });
      throw new HttpsError('internal', "Errore interno dell'assegnazione variante.");
    }
  },
);
