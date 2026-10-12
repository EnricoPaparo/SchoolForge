import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { SCHOOLFORGE_FUNCTION_REGION } from './deploymentRegion.js';

/** Authenticated clock sample only: no database, secrets or school data. */
export const examServerTime = onCall(
  { region: SCHOOLFORGE_FUNCTION_REGION, minInstances: 0, maxInstances: 3 },
  (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Accesso richiesto.');
    return { serverTimeMs: Date.now() };
  },
);
