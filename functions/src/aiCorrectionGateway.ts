import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest, FunctionsErrorCode } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  AiGatewayError,
  handlePreview,
  handleRun,
  resolveAiFeatureMode,
  type AiCorrectionHandlerDeps,
  type AiCorrectionPreviewResponse,
  type AiCorrectionRunResponse,
  type AiGatewayErrorCode,
} from './aiCorrectionGatewayCore.js';

/**
 * M5-01 — wiring runtime del gateway della correzione assistita da IA.
 *
 * Due Cloud Functions v2 `onCall`, scale-to-zero, che montano la logica pura di
 * `aiCorrectionGatewayCore.ts` sull'Admin SDK. In M5-01 il gateway è **solo
 * predisposto**: `aiCorrectionPreview` restituisce un risultato mock, e
 * `aiCorrectionRun` non scrive nulla su Firestore. Modalità **mock**
 * deterministica: nessun provider reale, nessuna API key, nessuna chiamata di
 * rete, **zero token**. Provider/modello/Secret Manager/budget reali sono
 * bloccanti solo per M5-05. Nessun deploy in questa PR.
 */

/**
 * Stessa region del resto del progetto (`repositoryGateway`): il modulo IA non
 * introduce nuove region.
 */
export const AI_GATEWAY_REGION = 'us-central1';

if (getApps().length === 0) initializeApp();

/**
 * Fonte autoritativa dell'owner: `settings/owner.ownerUid` (mai
 * `settings/ownerPublic`, mai dati del client). Sola **lettura** — M5-01 non
 * effettua scritture Firestore.
 */
async function getOwnerUid(): Promise<string | null> {
  const snap = await getFirestore().doc('settings/owner').get();
  return snap.exists ? ((snap.data()?.ownerUid as string | undefined) ?? null) : null;
}

/** Mappa i codici stabili dell'app ai codici `HttpsError` di Callable. */
function toHttpsError(err: AiGatewayError): HttpsError {
  const map: Record<AiGatewayErrorCode, FunctionsErrorCode> = {
    unauthenticated: 'unauthenticated',
    not_owner: 'permission-denied',
    feature_disabled: 'failed-precondition',
    invalid_input: 'invalid-argument',
    batch_limit_exceeded: 'resource-exhausted',
  };
  // `details` porta solo il codice stabile, mai contenuti sensibili.
  return new HttpsError(map[err.code], err.message, { code: err.code });
}

function buildDeps(request: CallableRequest): AiCorrectionHandlerDeps {
  return {
    callerUid: request.auth?.uid ?? null,
    getOwnerUid,
    // La modalità è risolta SOLO da configurazione server-side (env della
    // Function), mai da input del client. Default sicuro `disabled`.
    featureMode: resolveAiFeatureMode(process.env),
  };
}

async function runPhase<T extends AiCorrectionPreviewResponse | AiCorrectionRunResponse>(
  phase: 'preview' | 'run',
  request: CallableRequest,
  handler: (rawInput: unknown, deps: AiCorrectionHandlerDeps) => Promise<T>,
): Promise<T> {
  const started = Date.now();
  const deps = buildDeps(request);
  try {
    const result = await handler(request.data, deps);
    // Log minimale e NON sensibile: nessun id di verifica/consegna, nessun
    // contenuto. Solo fase, modalità, esito e durata.
    logger.info('aiCorrectionGateway', {
      phase,
      mode: deps.featureMode,
      outcome: 'ok',
      durationMs: Date.now() - started,
    });
    return result;
  } catch (err) {
    if (err instanceof AiGatewayError) {
      logger.info('aiCorrectionGateway', {
        phase,
        mode: deps.featureMode,
        outcome: err.code,
        durationMs: Date.now() - started,
      });
      throw toHttpsError(err);
    }
    // Errore inatteso: non esporre dettagli.
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
  (request) => runPhase('preview', request, handlePreview),
);

export const aiCorrectionRun = onCall(
  { region: AI_GATEWAY_REGION, minInstances: 0, maxInstances: 3 },
  (request) => runPhase('run', request, handleRun),
);
