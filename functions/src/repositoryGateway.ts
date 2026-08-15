import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  createStoragePort,
  handleGateway,
  parseRoute,
  type GatewayInput,
} from './repositoryGatewayCore.js';
import { SCHOOLFORGE_FUNCTION_REGION } from './deploymentRegion.js';

/**
 * SGW-01 — Repository Storage Gateway (Cloud Function HTTPS 2ª gen).
 *
 * Wiring runtime: monta la logica pura di `repositoryGatewayCore.ts` sull'Admin
 * SDK e su `onRequest`. Una sola Function dietro il rewrite Hosting
 * `/api/repository/**`, rotte `read`/`write`/`delete`/`delete-prefix`/`batch-read`. L'Admin SDK **bypassa le
 * Storage Rules**: l'autorizzazione/validazione equivalente o più stretta è nel
 * core. Questo è solo il codice: il deploy DEV e lo smoke Brave restano da fare.
 */

/**
 * Regione della Function. **Verificata** contro la location del bucket di
 * `schoolforge-dev` (`gcloud storage buckets describe
 * gs://schoolforge-dev.firebasestorage.app` → `location: US-CENTRAL1`,
 * `location_type: region`): la Function gira nella stessa region del bucket per
 * evitare egress cross-region.
 */
export const GATEWAY_REGION = SCHOOLFORGE_FUNCTION_REGION;

if (getApps().length === 0) initializeApp();

export const repositoryGateway = onRequest(
  { region: GATEWAY_REGION, minInstances: 0, maxInstances: 3, cors: false },
  async (req, res) => {
    const started = Date.now();
    // Il traffico è same-origin: nessuna cache delle risposte del gateway.
    res.set('Cache-Control', 'no-store');
    const route = parseRoute(req.path);
    const result = await handleGateway(
      {
        method: req.method,
        route,
        contentType: req.get('content-type') ?? undefined,
        authHeader: req.get('authorization') ?? undefined,
        body: req.body as GatewayInput['body'],
      },
      {
        verifyIdToken: (token) => getAuth().verifyIdToken(token),
        getOwnerUid: async () => {
          const snap = await getFirestore().doc('settings/owner').get();
          return snap.exists ? ((snap.data()?.ownerUid as string | undefined) ?? null) : null;
        },
        storage: createStoragePort(getStorage().bucket()),
      },
    );
    // Log minimale e NON sensibile: nessun path, token, contenuto, pool o soluzione.
    logger.info('repositoryGateway', {
      route: route ?? 'unknown',
      status: result.status,
      durationMs: Date.now() - started,
    });
    res.status(result.status).json(result.body);
  },
);
