import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest, FunctionsErrorCode } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { defineSecret } from 'firebase-functions/params';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import {
  AiGatewayError,
  resolveAiFeatureMode,
  type AiCorrectionAuthDeps,
  type AiGatewayErrorCode,
} from './aiCorrectionGatewayCore.js';
import { createConfiguredAiGrader, requireConfiguredOpenAiModel } from './aiCorrectionProvider.js';
import {
  runExecution,
  runPreview,
  type CommitSubmissionInput,
  type CommitSubmissionResult,
  type CorrectionData,
  type EngineWritePorts,
  type ExistingEvaluation,
  type PersistedRun,
  type SubmissionData,
  type TeacherQuestion,
  type ValidatedScore,
  type VerificationData,
} from './aiCorrectionEngine.js';

/**
 * M5-02 — wiring runtime del motore della correzione assistita da IA.
 *
 * Due Cloud Functions v2 `onCall`, scale-to-zero, che montano il motore puro di
 * `aiCorrectionEngine.ts` sull'Admin SDK: preflight reale (`aiCorrectionPreview`)
 * ed esecuzione con scritture atomiche per consegna e idempotenza
 * (`aiCorrectionRun`). M5-05C mantiene il default `disabled`, conserva il mock
 * e predispone OpenAI con configurazione fail-closed e secret binding non
 * valorizzato. Nessuna API key, chiamata reale o deploy in questa PR.
 */

export const AI_GATEWAY_REGION = 'us-central1';
export const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

if (getApps().length === 0) initializeApp();

// ── Porte Admin SDK ───────────────────────────────────────────────────────────

async function getOwnerUid(db: Firestore): Promise<string | null> {
  const snap = await db.doc('settings/owner').get();
  return snap.exists ? ((snap.data()?.ownerUid as string | undefined) ?? null) : null;
}

function loadVerification(db: Firestore) {
  return async (verificationId: string): Promise<VerificationData | null> => {
    const snap = await db.doc(`verifications/${verificationId}`).get();
    if (!snap.exists) return null;
    const data = snap.data() as Record<string, unknown>;
    const teacherSnapshot = data.teacherSnapshot as { questions?: unknown[] } | null | undefined;
    const rawQuestions = Array.isArray(teacherSnapshot?.questions)
      ? teacherSnapshot!.questions
      : null;
    const teacherQuestions: TeacherQuestion[] | null = rawQuestions
      ? rawQuestions.map((q) => {
          const question = q as Record<string, unknown>;
          // M5-04C: gli ID delle opzioni (dal teacherSnapshot congelato) servono
          // allo scoring parziale delle chiuse multiple. Nessuna lettura in più.
          const rawOptions = Array.isArray(question.opzioni) ? question.opzioni : null;
          const optionIds = rawOptions
            ? rawOptions
                .map((o) => (o as Record<string, unknown>)?.id)
                .filter((id): id is string => typeof id === 'string')
            : undefined;
          return {
            order: question.order as number,
            tipo: question.tipo as TeacherQuestion['tipo'],
            maxPoints: question.maxPoints as number,
            testo: (question.testo as string) ?? '',
            soluzione: question.soluzione as string | string[],
            ...(optionIds ? { optionIds } : {}),
          };
        })
      : null;
    return {
      ownerUid: (data.ownerUid as string) ?? '',
      status: (data.status as string) ?? '',
      teacherQuestions,
    };
  };
}

function loadSubmission(db: Firestore) {
  return async (submissionId: string): Promise<SubmissionData | null> => {
    const snap = await db.doc(`submissions/${submissionId}`).get();
    if (!snap.exists) return null;
    const data = snap.data() as Record<string, unknown>;
    return {
      ownerUid: (data.ownerUid as string) ?? '',
      verificationId: (data.verificationId as string) ?? '',
      studentUid: (data.studentUid as string) ?? '',
      status: (data.status as string) ?? '',
      answers: (data.answers as SubmissionData['answers']) ?? {},
    };
  };
}

function toCorrectionData(data: Record<string, unknown>): CorrectionData {
  return {
    status: data.status as CorrectionData['status'],
    evaluations: (data.evaluations as Record<string, ExistingEvaluation>) ?? {},
    reopenCount: (data.reopenCount as number) ?? 0,
  };
}

function loadCorrection(db: Firestore) {
  return async (submissionId: string): Promise<CorrectionData | null> => {
    const snap = await db.doc(`corrections/${submissionId}`).get();
    if (!snap.exists) return null;
    return toCorrectionData(snap.data() as Record<string, unknown>);
  };
}

function computeTotals(evaluations: Record<string, ExistingEvaluation>): {
  totalPoints: number;
  maxPoints: number;
  percentage: number | null;
} {
  let totalPoints = 0;
  let maxPoints = 0;
  for (const e of Object.values(evaluations)) {
    if (e.points !== null) totalPoints += e.points;
    maxPoints += e.maxPoints;
  }
  return {
    totalPoints,
    maxPoints,
    percentage: maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : null,
  };
}

function progressStatus(
  evaluations: Record<string, ExistingEvaluation>,
): 'submitted' | 'in_progress' {
  return Object.values(evaluations).some((e) => e.points !== null) ? 'in_progress' : 'submitted';
}

/** `true` quando la consegna ha almeno una domanda e tutte sono valutate. */
function isFullyEvaluated(evaluations: Record<string, ExistingEvaluation>): boolean {
  const values = Object.values(evaluations);
  return values.length > 0 && values.every((e) => e.points !== null);
}

/**
 * Decide il feedback generale da scrivere (M5-04B): il candidato **solo se** la
 * consegna è ora interamente valutata **e** il testo docente esistente è vuoto
 * (mai sovrascritto). Altrimenti mantiene il valore esistente (o `null`).
 */
function resolveGeneralFeedback(
  evaluations: Record<string, ExistingEvaluation>,
  existing: string | null,
  candidate: string | null,
): string | null {
  const docenteHasText = typeof existing === 'string' && existing.trim().length > 0;
  if (docenteHasText) return existing;
  if (candidate !== null && isFullyEvaluated(evaluations)) return candidate;
  return existing;
}

function applyProposed(
  evaluations: Record<string, ExistingEvaluation>,
  proposed: Map<number, ValidatedScore>,
): number[] {
  const written: number[] = [];
  for (const [order, score] of proposed) {
    const key = order.toString();
    const current = evaluations[key];
    if (!current || current.points !== null) continue; // mai sovrascrivere
    evaluations[key] = {
      order: current.order,
      maxPoints: current.maxPoints,
      points: score.points,
      ...(score.feedback !== undefined ? { feedback: score.feedback } : {}),
    };
    written.push(order);
  }
  return written;
}

function commitSubmission(db: Firestore) {
  return async (input: CommitSubmissionInput): Promise<CommitSubmissionResult> => {
    const correctionRef = db.doc(`corrections/${input.submissionId}`);
    const submissionRef = db.doc(`submissions/${input.submissionId}`);
    const receiptRef = db.doc(`submissionReceipts/${input.submissionId}`);

    return db.runTransaction(async (tx: Transaction): Promise<CommitSubmissionResult> => {
      const snap = await tx.get(correctionRef);
      const now = FieldValue.serverTimestamp();

      if (!snap.exists) {
        // Crea in_progress con lo scheletro congelato, poi applica le proposte.
        const evaluations: Record<string, ExistingEvaluation> = {};
        for (const q of input.skeleton) {
          evaluations[q.order.toString()] = {
            order: q.order,
            points: null,
            maxPoints: q.maxPoints,
          };
        }
        const written = applyProposed(evaluations, input.proposed);
        const totals = computeTotals(evaluations);
        // M5-04B: nuovo doc → nessun testo docente; scrivi il feedback generale
        // candidato solo se la consegna è già interamente valutata.
        const generalFeedback = resolveGeneralFeedback(
          evaluations,
          null,
          input.proposedGeneralFeedback,
        );
        tx.set(correctionRef, {
          submissionId: input.submissionId,
          verificationId: input.verificationId,
          studentUid: input.studentUid,
          ownerUid: input.ownerUid,
          status: 'in_progress',
          evaluations,
          generalFeedback,
          totalPoints: totals.totalPoints,
          maxPoints: totals.maxPoints,
          percentage: totals.percentage,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          returnedAt: null,
          reopenCount: 0,
        });
        writeMirror(tx, {
          submissionRef,
          receiptRef,
          totals,
          status: progressStatus(evaluations),
          now,
        });
        return { result: 'written', writtenOrders: written };
      }

      const rawCorrection = snap.data() as Record<string, unknown>;
      const correction = toCorrectionData(rawCorrection);
      if (correction.status !== 'in_progress') {
        return { result: 'changed', writtenOrders: [] };
      }

      const evaluations: Record<string, ExistingEvaluation> = { ...correction.evaluations };
      const written = applyProposed(evaluations, input.proposed);
      const totals = computeTotals(evaluations);
      // M5-04B: applica il feedback generale candidato solo se la consegna è ora
      // interamente valutata e il docente non ne ha già scritto uno. Il campo è
      // incluso nell'update solo quando cambia davvero, così non genera scritture
      // superflue né sovrascrive il testo docente.
      const existingGeneralFeedback =
        typeof rawCorrection.generalFeedback === 'string' ? rawCorrection.generalFeedback : null;
      const nextGeneralFeedback = resolveGeneralFeedback(
        evaluations,
        existingGeneralFeedback,
        input.proposedGeneralFeedback,
      );
      tx.update(correctionRef, {
        evaluations,
        totalPoints: totals.totalPoints,
        maxPoints: totals.maxPoints,
        percentage: totals.percentage,
        updatedAt: now,
        ...(nextGeneralFeedback !== existingGeneralFeedback
          ? { generalFeedback: nextGeneralFeedback }
          : {}),
      });
      writeMirror(tx, {
        submissionRef,
        receiptRef,
        totals,
        status: progressStatus(evaluations),
        now,
      });

      // Semantica M4: su correction riaperta (reopenCount > 0), un cambiamento
      // reale scrive un evento append-only 'scoreAdjusted' con delta minimale.
      if (correction.reopenCount > 0 && written.length > 0) {
        const eventRef = db.collection('correctionEvents').doc();
        tx.set(eventRef, {
          correctionId: input.submissionId,
          ownerUid: input.ownerUid,
          type: 'scoreAdjusted',
          actorUid: input.actorUid,
          previousStatus: 'in_progress',
          nextStatus: 'in_progress',
          reason: null,
          questionDeltas: written.map((order) => ({
            order,
            previousPoints: null,
            nextPoints: evaluations[order.toString()]!.points,
          })),
          timestamp: now,
        });
      }

      return { result: 'written', writtenOrders: written };
    });
  };
}

function writeMirror(
  tx: Transaction,
  args: {
    submissionRef: FirebaseFirestore.DocumentReference;
    receiptRef: FirebaseFirestore.DocumentReference;
    totals: { totalPoints: number; maxPoints: number; percentage: number | null };
    status: 'submitted' | 'in_progress';
    now: FirebaseFirestore.FieldValue;
  },
): void {
  tx.update(args.submissionRef, {
    correctionStatus: args.status,
    correctionStatusUpdatedAt: args.now,
    correctionSummary: {
      totalPoints: args.totals.totalPoints,
      maxPoints: args.totals.maxPoints,
      percentage: args.totals.percentage,
    },
    correctionSummaryUpdatedAt: args.now,
  });
  tx.set(
    args.receiptRef,
    { correctionStatus: args.status, correctionStatusUpdatedAt: args.now },
    { merge: true },
  );
}

function beginRun(db: Firestore): EngineWritePorts['beginRun'] {
  return async (requestId, meta) => {
    const ref = db.doc(`aiCorrectionRuns/${requestId}`);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = FieldValue.serverTimestamp();
      const nowMs = Date.now();
      const acquire = () => {
        // Acquisisce/rinnova la lease per questo executionId.
        tx.set(
          ref,
          {
            requestId,
            ownerUid: meta.ownerUid,
            actorUid: meta.actorUid,
            verificationId: meta.verificationId,
            mode: meta.provider,
            provider: meta.provider,
            ...(meta.model ? { model: meta.model } : {}),
            status: 'running',
            selectionHash: meta.selectionHash,
            submissionCount: meta.submissionCount,
            executionId: meta.executionId,
            leaseExpiresAt: nowMs + meta.leaseMs,
            updatedAt: now,
            ...(snap.exists
              ? {}
              : { createdAt: now, tokensEstimated: 0, tokensActual: 0, cost: 0 }),
          },
          { merge: true },
        );
        return { state: 'acquired' as const, executionId: meta.executionId };
      };

      if (!snap.exists) return acquire();

      const data = snap.data() as Record<string, unknown>;
      if (data.selectionHash !== meta.selectionHash) return { state: 'conflict' as const };

      const status = data.status as PersistedRun['status'];
      const response = data.response as PersistedRun['response'];
      if ((status === 'completed' || status === 'partial' || status === 'failed') && response) {
        return {
          state: 'completed' as const,
          existing: { status, selectionHash: data.selectionHash as string, response },
        };
      }

      // status === 'running' (o terminale senza response): lease valida → locked;
      // lease scaduta o assente → takeover.
      const leaseExpiresAt = typeof data.leaseExpiresAt === 'number' ? data.leaseExpiresAt : 0;
      if (status === 'running' && leaseExpiresAt > nowMs) {
        return { state: 'locked' as const };
      }
      return acquire();
    });
  };
}

function finishRun(db: Firestore): EngineWritePorts['finishRun'] {
  return async (requestId, run) => {
    const ref = db.doc(`aiCorrectionRuns/${requestId}`);
    // Finalizza in transazione SOLO se questo executionId possiede ancora la
    // lease: un worker vecchio (lease già presa da un tentativo successivo) è un
    // no-op e non può sovrascrivere il risultato del tentativo corrente.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() as Record<string, unknown>;
      if (data.executionId !== run.executionId) return; // takeover avvenuto → no-op
      tx.set(
        ref,
        {
          status: run.status,
          updatedAt: FieldValue.serverTimestamp(),
          // Rilascia la lease: lo stato terminale rende il run non riacquisibile.
          leaseExpiresAt: 0,
          // Solo metadata: conteggi, token, esito sintetico per consegna (id +
          // outcome + counts). Nessun testo/risposta/soluzione/feedback/nome/email.
          counts: run.response?.counts ?? null,
          tokensEstimated: run.response?.tokensEstimated ?? 0,
          tokensActual: run.response?.tokensActual ?? 0,
          cost: 0,
          response: run.response ?? null,
        },
        { merge: true },
      );
    });
  };
}

function buildWritePorts(db: Firestore): EngineWritePorts {
  return {
    loadVerification: loadVerification(db),
    loadSubmission: loadSubmission(db),
    loadCorrection: loadCorrection(db),
    beginRun: beginRun(db),
    finishRun: finishRun(db),
    commitSubmission: commitSubmission(db),
  };
}

// ── Errori → HttpsError ───────────────────────────────────────────────────────

function toHttpsError(err: AiGatewayError): HttpsError {
  const map: Record<AiGatewayErrorCode, FunctionsErrorCode> = {
    unauthenticated: 'unauthenticated',
    not_owner: 'permission-denied',
    feature_disabled: 'failed-precondition',
    provider_config_invalid: 'failed-precondition',
    invalid_input: 'invalid-argument',
    batch_limit_exceeded: 'resource-exhausted',
  };
  return new HttpsError(map[err.code], err.message, { code: err.code });
}

function authDeps(request: CallableRequest, db: Firestore): AiCorrectionAuthDeps {
  return {
    callerUid: request.auth?.uid ?? null,
    getOwnerUid: () => getOwnerUid(db),
    featureMode: resolveAiFeatureMode(process.env),
  };
}

function readOpenAiSecret(): string | undefined {
  try {
    return OPENAI_API_KEY.value();
  } catch {
    return undefined;
  }
}

function validatePreviewProviderConfiguration(): void {
  if (resolveAiFeatureMode(process.env) === 'openai') {
    requireConfiguredOpenAiModel(process.env.OPENAI_MODEL);
  }
}

async function run<T>(
  phase: 'preview' | 'run',
  request: CallableRequest,
  handler: (db: Firestore) => Promise<T>,
): Promise<T> {
  const started = Date.now();
  const db = getFirestore();
  const featureMode = resolveAiFeatureMode(process.env);
  try {
    const result = await handler(db);
    // Log minimale e NON sensibile: nessun id di verifica/consegna/studente,
    // nessun contenuto. Solo fase, modalità, esito, durata.
    logger.info('aiCorrectionGateway', {
      phase,
      mode: featureMode,
      outcome: 'ok',
      durationMs: Date.now() - started,
    });
    return result;
  } catch (err) {
    if (err instanceof AiGatewayError) {
      logger.info('aiCorrectionGateway', {
        phase,
        mode: featureMode,
        outcome: err.code,
        durationMs: Date.now() - started,
      });
      throw toHttpsError(err);
    }
    logger.error('aiCorrectionGateway', {
      phase,
      outcome: 'internal',
      durationMs: Date.now() - started,
    });
    throw new HttpsError('internal', 'Errore interno del gateway IA.');
  }
}

export const aiCorrectionPreview = onCall(
  { region: AI_GATEWAY_REGION, minInstances: 0, maxInstances: 3 },
  (request) =>
    run('preview', request, (db) =>
      runPreview(request.data, {
        ...authDeps(request, db),
        ports: buildWritePorts(db),
        validateProviderConfiguration: validatePreviewProviderConfiguration,
      }),
    ),
);

export const aiCorrectionRun = onCall(
  {
    region: AI_GATEWAY_REGION,
    minInstances: 0,
    maxInstances: 3,
    secrets: [OPENAI_API_KEY],
  },
  (request) =>
    run('run', request, (db) =>
      runExecution(request.data, {
        ...authDeps(request, db),
        ports: buildWritePorts(db),
        grader: () =>
          createConfiguredAiGrader({
            mode: resolveAiFeatureMode(process.env),
            openAiModel: process.env.OPENAI_MODEL,
            openAiApiKey:
              resolveAiFeatureMode(process.env) === 'openai' ? readOpenAiSecret() : undefined,
          }),
      }),
    ),
);
