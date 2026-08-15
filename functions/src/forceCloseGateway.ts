import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest, FunctionsErrorCode } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import type { Request as TaskRequest } from 'firebase-functions/v2/tasks';
import * as logger from 'firebase-functions/logger';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { ForceSubmitError } from './forceSubmitCore.js';
import {
  ForceCloseError,
  type ForceCloseTaskPayload,
  type ScheduleForceCloseResult,
} from './forceCloseCore.js';
import {
  ForceCloseTooEarlyError,
  runForceCloseTask,
  runScheduleForceClose,
  type ForceCloseEnqueueOptions,
  type ForceCloseTaskEnqueue,
} from './forceCloseRunner.js';
import { SCHOOLFORGE_FUNCTION_REGION, SCHOOLFORGE_TASK_REGION } from './deploymentRegion.js';

/**
 * FORCE-SUBMIT-02 — chiusura multipla con preavviso di 60 secondi.
 *
 * `scheduleForceCloseSubmissions` (callable owner-only) **programma**: valida,
 * scrive un marcatore server-only sulle sole bozze eleggibili e accoda una
 * Cloud Task per ciascuna, con `scheduleTime` a +60 s.
 *
 * `runScheduledForceClose` (task queue) **esegue**: alla scadenza rilegge lo
 * stato autorevole in transazione e, se la richiesta è ancora quella, riusa il
 * core FORCE-SUBMIT-01 per la transizione `draft → submitted`.
 *
 * Nessuna Function resta in attesa; nessun timer del browser partecipa alla
 * decisione; la chiusura avviene anche se docente e studente chiudono tutto.
 */

export const FORCE_CLOSE_REGION = SCHOOLFORGE_FUNCTION_REGION;
export const FORCE_CLOSE_TASK_REGION = SCHOOLFORGE_TASK_REGION;
/** Nome della coda: coincide con il nome della Function task-queue. */
export const FORCE_CLOSE_QUEUE = 'runScheduledForceClose';

/**
 * Riferimento **completo** della coda.
 *
 * `getFunctions().taskQueue(name, extensionId)` accetta come secondo argomento
 * un `extensionId`, **non** una region: passarvi `us-central1` faceva risolvere
 * un percorso inesistente. La forma corretta per una coda regionale è il nome
 * qualificato `locations/{region}/functions/{queue}`, con un solo argomento.
 */
export const FORCE_CLOSE_QUEUE_PATH = `locations/${FORCE_CLOSE_TASK_REGION}/functions/${FORCE_CLOSE_QUEUE}`;

if (getApps().length === 0) initializeApp();

/**
 * Accodamento reale su Cloud Tasks. Una task per submission eleggibile, con
 * nome deterministico derivato dal `requestId`: un retry dell'accodamento non
 * può creare un duplicato (Cloud Tasks risponde `ALREADY_EXISTS`, che il runner
 * interpreta correttamente come «era già fatto»).
 */
export const enqueueForceCloseTask: ForceCloseTaskEnqueue = async (
  payload: ForceCloseTaskPayload,
  options: ForceCloseEnqueueOptions,
) => {
  await getFunctions()
    .taskQueue(FORCE_CLOSE_QUEUE_PATH)
    .enqueue(payload, { scheduleTime: options.scheduleTime, id: options.id });
};

// ── Wiring Functions ───────────────────────────────────────────────────────────

function toHttpsError(err: ForceCloseError): HttpsError {
  const map: Record<ForceCloseError['code'], FunctionsErrorCode> = {
    unauthenticated: 'unauthenticated',
    invalid_input: 'invalid-argument',
    not_found: 'not-found',
    permission_denied: 'permission-denied',
    failed_precondition: 'failed-precondition',
  };
  return new HttpsError(map[err.code], err.message, { code: err.code });
}

export const scheduleForceCloseSubmissions = onCall(
  {
    region: FORCE_CLOSE_REGION,
    minInstances: 0,
    maxInstances: 3,
    // Un batch pieno (60 studenti) fa 1 lettura + fino a 60 transazioni e 60
    // accodamenti, con concorrenza limitata: il default di 60 s sarebbe stretto.
    timeoutSeconds: 300,
  },
  async (request: CallableRequest): Promise<ScheduleForceCloseResult> => {
    const started = Date.now();
    try {
      const result = await runScheduleForceClose(
        getFirestore(),
        request.auth?.uid ?? null,
        request.data,
        enqueueForceCloseTask,
      );
      // Log minimale e non sensibile: nessun id, uid o contenuto.
      logger.info('scheduleForceCloseSubmissions', {
        requested: result.results.length,
        scheduled: result.results.filter((r) => r.outcome === 'scheduled').length,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (err) {
      if (err instanceof ForceCloseError) {
        logger.info('scheduleForceCloseSubmissions', {
          outcome: err.code,
          durationMs: Date.now() - started,
        });
        throw toHttpsError(err);
      }
      logger.error('scheduleForceCloseSubmissions', {
        outcome: 'internal',
        durationMs: Date.now() - started,
      });
      throw new HttpsError('internal', 'Errore interno della programmazione.');
    }
  },
);

export const runScheduledForceClose = onTaskDispatched(
  {
    region: FORCE_CLOSE_TASK_REGION,
    minInstances: 0,
    maxInstances: 5,
    // Retry contenuti: l'operazione è idempotente, ma un retry infinito su uno
    // stato irrecuperabile non aiuterebbe nessuno.
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 10 },
    rateLimits: { maxConcurrentDispatches: 10 },
  },
  async (request: TaskRequest): Promise<void> => {
    const started = Date.now();
    try {
      const outcome = await runForceCloseTask(getFirestore(), request.data);
      logger.info('runScheduledForceClose', { outcome, durationMs: Date.now() - started });
    } catch (err) {
      if (err instanceof ForceCloseTooEarlyError) {
        // Consegna anticipata della coda: si rilancia perché Cloud Tasks
        // ritenti dopo il backoff. Chiudere in anticipo romperebbe la promessa
        // fatta allo studente.
        logger.warn('runScheduledForceClose', {
          outcome: 'too_early',
          remainingMs: err.remainingMs,
        });
        throw err;
      }
      if (err instanceof ForceCloseError || err instanceof ForceSubmitError) {
        // Payload non valido: nessun retry potrebbe ripararlo.
        logger.error('runScheduledForceClose', {
          outcome: err.code,
          durationMs: Date.now() - started,
        });
        return;
      }
      logger.error('runScheduledForceClose', {
        outcome: 'internal',
        durationMs: Date.now() - started,
      });
      throw err;
    }
  },
);
