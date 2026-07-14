import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  extractSubpath,
  handleGateway,
  type GatewayInput,
  type StoragePort,
} from './repositoryGatewayCore.js';

/**
 * SGW-01 — Repository Storage Gateway (Cloud Function HTTPS 2ª gen).
 *
 * Wiring runtime: monta la logica pura di `repositoryGatewayCore.ts` sull'Admin
 * SDK e su `onRequest`. Una sola Function dietro il rewrite Hosting
 * `/api/repository/**`, rotte `read`/`write`/`delete`. L'Admin SDK **bypassa le
 * Storage Rules**: l'autorizzazione/validazione equivalente o più stretta è nel
 * core. Questo è solo il codice: il deploy DEV e lo smoke Brave restano da fare.
 */

/**
 * Regione della Function. **Da confermare** contro la location effettiva del
 * bucket di `schoolforge-dev` prima del primo deploy: se il bucket non è in
 * `us-central1`, questo valore va allineato per evitare egress cross-region.
 * `us-central1` è il default Firebase, usato qui come placeholder esplicito.
 */
export const GATEWAY_REGION = 'us-central1';

if (getApps().length === 0) initializeApp();

function adminStoragePort(): StoragePort {
  const bucket = getStorage().bucket();
  return {
    read: async (path) => {
      const file = bucket.file(path);
      const [exists] = await file.exists();
      if (!exists) return { exists: false };
      const [buf] = await file.download();
      return { exists: true, content: buf.toString('utf-8') };
    },
    write: async (path, buf) => {
      await bucket.file(path).save(buf, {
        contentType: 'text/markdown; charset=utf-8',
        resumable: false,
      });
    },
    delete: async (path) => {
      const file = bucket.file(path);
      const [exists] = await file.exists();
      if (!exists) return false;
      await file.delete();
      return true;
    },
  };
}

export const repositoryGateway = onRequest(
  { region: GATEWAY_REGION, minInstances: 0, maxInstances: 3, cors: false },
  async (req, res) => {
    const started = Date.now();
    const subpath = extractSubpath(req.path);
    const result = await handleGateway(
      {
        method: req.method,
        subpath,
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
        storage: adminStoragePort(),
      },
    );
    // Log minimale e NON sensibile: nessun path, token, contenuto, pool o soluzione.
    logger.info('repositoryGateway', {
      op: subpath,
      status: result.status,
      durationMs: Date.now() - started,
    });
    res.status(result.status).json(result.body);
  },
);
