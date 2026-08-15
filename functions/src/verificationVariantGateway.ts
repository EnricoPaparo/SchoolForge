import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest, FunctionsErrorCode } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import {
  isValidResolvedAssignment,
  secureRandomIntBelow,
  VexAssignmentError,
} from './verificationVariantCore.js';
import {
  AssignGatewayError,
  decideAssignment,
  runAssignVariant,
  runResolveStudentPdf,
  type AssignErrorCode,
  type AssignVariantDeps,
  type PersistAssignmentInput,
  type PersistAssignmentResult,
  type ResolveStudentPdfDeps,
  type StudentContext,
  type VerificationContext,
} from './verificationVariantGatewayCore.js';
import { SCHOOLFORGE_FUNCTION_REGION } from './deploymentRegion.js';

/**
 * VEX-01B — callable `assignVerificationVariant` (Cloud Functions v2 `onCall`,
 * scale-to-zero, regione del progetto). Assegna in modo **idempotente** una
 * variante equivalente allo studente e restituisce **solo** le domande
 * assegnate, senza soluzioni né alternative non assegnate. Tutta la logica pura
 * è in `verificationVariantGatewayCore`/`verificationVariantCore`; qui c'è solo
 * il wiring Admin SDK (letture puntuali + transazione a scrittura singola).
 */

export const VEX_GATEWAY_REGION = SCHOOLFORGE_FUNCTION_REGION;

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
      studentPdfEnabled: data.studentPdfEnabled === true,
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

function sameOrders(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((order, index) => order === right[index]);
}

function readPdfAssignment(
  raw: Record<string, unknown>,
  input: Pick<PersistAssignmentInput, 'verificationId' | 'studentUid' | 'ownerUid'>,
): number[] {
  const keys = Object.keys(raw).sort();
  const expected = [
    'assignedQuestionOrders',
    'createdAt',
    'ownerUid',
    'studentUid',
    'verificationId',
  ].sort();
  if (
    keys.length !== expected.length ||
    !keys.every((key, index) => key === expected[index]) ||
    raw.verificationId !== input.verificationId ||
    raw.studentUid !== input.studentUid ||
    raw.ownerUid !== input.ownerUid ||
    !Array.isArray(raw.assignedQuestionOrders) ||
    !(raw.createdAt instanceof Timestamp)
  ) {
    throw new VexAssignmentError('invalid_assignment', 'Assegnazione PDF non coerente.');
  }
  return raw.assignedQuestionOrders as number[];
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
    const pdfAssignmentRef = db.doc(
      `verifications/${input.verificationId}/studentAssignments/${input.studentUid}`,
    );
    return db.runTransaction(async (tx: Transaction): Promise<PersistAssignmentResult> => {
      const [snap, pdfAssignmentSnap] = await Promise.all([tx.get(ref), tx.get(pdfAssignmentRef)]);
      const pdfOrders = pdfAssignmentSnap.exists
        ? readPdfAssignment(pdfAssignmentSnap.data() as Record<string, unknown>, input)
        : null;
      const existing = snap.exists
        ? {
            exists: true as const,
            assignedQuestionOrders: (snap.data() as Record<string, unknown>)
              .assignedQuestionOrders as number[] | undefined,
          }
        : { exists: false as const };
      let assignedQuestionOrders: number[];
      if (existing.assignedQuestionOrders !== undefined) {
        const decision = decideAssignment(
          existing,
          input.snapshot,
          input.studentUid,
          input.randomIntBelow,
        );
        assignedQuestionOrders = decision.assignedQuestionOrders;
        if (pdfOrders && !sameOrders(pdfOrders, assignedQuestionOrders)) {
          throw new VexAssignmentError(
            'invalid_assignment',
            'Assegnazione PDF e submission divergenti.',
          );
        }
        return { assignedQuestionOrders, writes: 0 };
      }
      if (pdfOrders) {
        if (!isValidResolvedAssignment(input.snapshot, input.studentUid, pdfOrders)) {
          throw new VexAssignmentError('invalid_assignment', 'Assegnazione PDF non valida.');
        }
        assignedQuestionOrders = pdfOrders;
      } else {
        assignedQuestionOrders = decideAssignment(
          existing,
          input.snapshot,
          input.studentUid,
          input.randomIntBelow,
        ).assignedQuestionOrders;
      }
      const now = FieldValue.serverTimestamp();
      // VEX-02A: `assignedAnswerKeys` è il mirror string di
      // `assignedQuestionOrders` (order.toString()) — server-only, scritto nella
      // STESSA singola scrittura. Serve solo alle Firestore Rules (che non sanno
      // convertire numeri→stringa) per validare che le chiavi di answers/flagged
      // siano un sottoinsieme della variante assegnata.
      const assignedAnswerKeys = assignedQuestionOrders.map((o) => o.toString());
      if (snap.exists) {
        // Unica scrittura: aggiunge i campi server-only alla submission esistente.
        tx.update(ref, {
          assignedQuestionOrders,
          assignedAnswerKeys,
        });
        return { assignedQuestionOrders, writes: 1 };
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
        assignedQuestionOrders,
        assignedAnswerKeys,
        startedAt: Timestamp.now(),
        lastSavedAt: now,
        submittedAt: null,
      });
      return { assignedQuestionOrders, writes: 1 };
    });
  };
}

/**
 * Assegnazione PDF separata dalla submission: la prima lettura personale può
 * fissare le domande, ma non marca la verifica come iniziata. La callable di
 * svolgimento rilegge lo stesso documento prima di creare la submission.
 */
function persistPdfAssignment(db: Firestore) {
  return async (input: PersistAssignmentInput): Promise<PersistAssignmentResult> => {
    const submissionRef = db.doc(`submissions/${input.submissionId}`);
    const assignmentRef = db.doc(
      `verifications/${input.verificationId}/studentAssignments/${input.studentUid}`,
    );
    return db.runTransaction(async (tx: Transaction): Promise<PersistAssignmentResult> => {
      const [submissionSnap, assignmentSnap] = await Promise.all([
        tx.get(submissionRef),
        tx.get(assignmentRef),
      ]);
      const assignmentOrders = assignmentSnap.exists
        ? readPdfAssignment(assignmentSnap.data() as Record<string, unknown>, input)
        : null;
      const submissionOrders = submissionSnap.exists
        ? ((submissionSnap.data() as Record<string, unknown>).assignedQuestionOrders as
            | number[]
            | undefined)
        : undefined;

      if (submissionOrders !== undefined) {
        if (!isValidResolvedAssignment(input.snapshot, input.studentUid, submissionOrders)) {
          throw new VexAssignmentError('invalid_assignment', 'Submission non coerente.');
        }
        if (assignmentOrders && !sameOrders(assignmentOrders, submissionOrders)) {
          throw new VexAssignmentError(
            'invalid_assignment',
            'Assegnazione PDF e submission divergenti.',
          );
        }
        return { assignedQuestionOrders: submissionOrders, writes: 0 };
      }
      if (assignmentOrders) {
        if (!isValidResolvedAssignment(input.snapshot, input.studentUid, assignmentOrders)) {
          throw new VexAssignmentError('invalid_assignment', 'Assegnazione PDF non valida.');
        }
        return { assignedQuestionOrders: assignmentOrders, writes: 0 };
      }

      const assignedQuestionOrders = decideAssignment(
        { exists: false },
        input.snapshot,
        input.studentUid,
        input.randomIntBelow,
      ).assignedQuestionOrders;
      tx.set(assignmentRef, {
        verificationId: input.verificationId,
        studentUid: input.studentUid,
        ownerUid: input.ownerUid,
        assignedQuestionOrders,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { assignedQuestionOrders, writes: 1 };
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

function buildPdfDeps(request: CallableRequest, db: Firestore): ResolveStudentPdfDeps {
  return {
    callerUid: request.auth?.uid ?? null,
    portalEnabled: portalEnabled(db),
    loadVerification: loadVerification(db),
    loadStudent: loadStudent(db),
    persistPdfAssignment: persistPdfAssignment(db),
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

export const resolveStudentVerificationPdf = onCall(
  { region: VEX_GATEWAY_REGION, minInstances: 0, maxInstances: 3 },
  async (request) => {
    const started = Date.now();
    const db = getFirestore();
    try {
      const result = await runResolveStudentPdf(request.data, buildPdfDeps(request, db));
      logger.info('resolveStudentVerificationPdf', {
        outcome: 'ok',
        durationMs: Date.now() - started,
      });
      return result;
    } catch (err) {
      if (err instanceof AssignGatewayError) {
        logger.info('resolveStudentVerificationPdf', {
          outcome: err.code,
          durationMs: Date.now() - started,
        });
        throw toHttpsError(err);
      }
      if (err instanceof VexAssignmentError) {
        logger.error('resolveStudentVerificationPdf', {
          outcome: err.code,
          durationMs: Date.now() - started,
        });
        throw new HttpsError('failed-precondition', 'PDF non disponibile.', {
          code: err.code,
        });
      }
      logger.error('resolveStudentVerificationPdf', {
        outcome: 'internal',
        durationMs: Date.now() - started,
      });
      throw new HttpsError('internal', 'Impossibile preparare il PDF.');
    }
  },
);
