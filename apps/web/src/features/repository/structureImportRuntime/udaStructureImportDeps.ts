import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import type { DocumentReference, Firestore } from 'firebase/firestore';
import type { ProgramDoc, UdaDoc } from '../../../types/firestore.js';
import {
  deleteFile,
  isFileNotFound,
  readTexts,
  writeText,
} from '../gateway/repositoryGatewayClient.js';
import { computeManifestHash } from './manifestHash.js';
import type {
  UdaStructureImportContext,
  UdaStructureImportDeps,
} from './udaStructureImportRepository.js';

/**
 * STRUCTURE-IMPORT-02A — Firestore + same-origin Storage Gateway implementation
 * of the append ports.
 *
 * It deliberately reuses the protocol "Importa UDA" already established
 * (uda-import-contract §5.1, §8) instead of inventing a second one: the same
 * `udaAppendLease` field on the import document provides mutual exclusion, so
 * an in-flight structural import also blocks manual create/reorder/delete of a
 * UDA — `assertNoActiveUdaAppendLease` already reads that exact field — and two
 * tabs cannot append at the same time. The attempt records live in their own
 * collection because their manifest shape differs.
 *
 * Everything written here stays under `programs/{programId}/**` and
 * `repository/{ownerUid}/imports/{importId}/**`, both already owner-only under
 * the current Rules: this task adds no Rule, no Function, no index.
 */

/** Lease validity window — same as the ZIP append, so the two cannot deadlock each other. */
const LEASE_TTL_MS = 5 * 60 * 1000;
/** Gateway upload/delete concurrency (contract §8). */
const STORAGE_CONCURRENCY = 3;
/** Point-read fan-out per round of the collision preflight. */
const PREFLIGHT_CHUNK = 50;

function importBase(programId: string, importId: string): string {
  return `programs/${programId}/imports/${importId}`;
}

function attemptPath(programId: string, importId: string, requestId: string): string {
  return `${importBase(programId, importId)}/structureImportAttempts/${requestId}`;
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(items.slice(i, i + limit).map(fn));
  }
}

export function createFirestoreUdaStructureImportDeps(db: Firestore): UdaStructureImportDeps {
  return {
    async loadContext(programId): Promise<UdaStructureImportContext | null> {
      const programSnap = await getDoc(doc(db, 'programs', programId));
      if (!programSnap.exists()) return null;
      const program = programSnap.data() as ProgramDoc;
      if (!program.activeImportId) return null;
      // One collection read, scoped to this course's active import: never a
      // global scan, and never on an ordinary course open.
      const udasSnap = await getDocs(
        collection(db, `${importBase(programId, program.activeImportId)}/udas`),
      );
      return {
        ownerUid: program.ownerUid,
        activeImportId: program.activeImportId,
        existingUdas: udasSnap.docs.map((d) => {
          const data = d.data() as Partial<UdaDoc>;
          return {
            udaId: d.id,
            dir: data.dir,
            order: data.order,
            titolo: data.titolo ?? null,
          };
        }),
      };
    },

    hashManifest(manifestCanonical) {
      return computeManifestHash(manifestCanonical);
    },

    async findCommittedAttempt({ programId, activeImportId, requestId, manifestHash }) {
      const snap = await getDoc(doc(db, attemptPath(programId, activeImportId, requestId)));
      if (!snap.exists()) return 'none';
      const data = snap.data() as { manifestHash?: string; status?: string };
      // Same request id with a different plan is never a replay: fail closed.
      if (data.manifestHash !== manifestHash) return 'conflict';
      return data.status === 'committed' ? 'committed' : 'none';
    },

    async preflight({ programId, context, manifest }) {
      const base = importBase(programId, context.activeImportId);
      const refs: Array<{ id: string; ref: DocumentReference }> = manifest.udaIds.map((id) => ({
        id,
        ref: doc(db, `${base}/udas/${id}`),
      }));
      // Bounded point reads: any existing target — even a pre-existing orphan —
      // blocks the whole attempt.
      for (let i = 0; i < refs.length; i += PREFLIGHT_CHUNK) {
        const batch = refs.slice(i, i + PREFLIGHT_CHUNK);
        const snaps = await Promise.all(batch.map((entry) => getDoc(entry.ref)));
        const hit = snaps.findIndex((snap) => snap.exists());
        if (hit !== -1) return { collision: { kind: 'uda', id: batch[hit]!.id } };
      }
      if (manifest.storagePaths.length > 0) {
        const results = await readTexts(manifest.storagePaths);
        const existing = results.find((entry) => entry.ok);
        if (existing) return { collision: { kind: 'storage', id: existing.path } };
      }
      return { collision: null };
    },

    async acquireLease({ programId, activeImportId, requestId, manifestHash, manifest }) {
      return runTransaction(db, async (tx) => {
        const programRef = doc(db, 'programs', programId);
        const importRef = doc(db, importBase(programId, activeImportId));
        const [programSnap, importSnap] = await Promise.all([
          tx.get(programRef),
          tx.get(importRef),
        ]);
        if (!programSnap.exists() || !importSnap.exists()) return 'busy' as const;
        // The destination must still be the one the plan was built against.
        if ((programSnap.data() as ProgramDoc).activeImportId !== activeImportId) {
          return 'busy' as const;
        }
        const lease = (
          importSnap.data() as { udaAppendLease?: { requestId: string; expiresAt: number } }
        ).udaAppendLease;
        const now = Date.now();
        // Another live attempt holds it — including a ZIP "Importa UDA".
        if (lease && lease.requestId !== requestId && lease.expiresAt > now) return 'busy' as const;

        const expiresAt = now + LEASE_TTL_MS;
        tx.set(
          importRef,
          { udaAppendLease: { requestId, manifestHash, expiresAt } },
          { merge: true },
        );
        tx.set(
          doc(db, attemptPath(programId, activeImportId, requestId)),
          {
            requestId,
            manifestHash,
            kind: 'uda',
            udaIds: manifest.udaIds,
            storagePaths: manifest.storagePaths,
            status: 'reserved',
            expiresAt,
            createdAt: serverTimestamp(),
          },
          { merge: true },
        );
        return 'acquired' as const;
      });
    },

    async uploadStorage(files) {
      await mapWithConcurrency(files, STORAGE_CONCURRENCY, (file) =>
        writeText(file.path, file.content),
      );
    },

    async commit({ programId, manifest, requestId, manifestHash }) {
      const base = importBase(programId, manifest.importId);
      await runTransaction(db, async (tx) => {
        const programRef = doc(db, 'programs', programId);
        const importRef = doc(db, base);
        const udaRefs = manifest.udaIds.map((id) => doc(db, `${base}/udas/${id}`));
        const [programSnap, importSnap, ...udaSnaps] = await Promise.all([
          tx.get(programRef),
          tx.get(importRef),
          ...udaRefs.map((ref) => tx.get(ref)),
        ]);

        if (!programSnap.exists() || !importSnap.exists()) throw new Error('import_missing');
        if ((programSnap.data() as ProgramDoc).activeImportId !== manifest.importId) {
          throw new Error('active_import_changed');
        }
        // Re-checked inside the transaction: the preflight is an early exit, not
        // the guarantee. Nothing may be overwritten.
        if (udaSnaps.some((snap) => snap.exists())) throw new Error('uda_collision');

        const importData = importSnap.data() as {
          udaCount?: number;
          udaAppendLease?: { requestId: string };
        };
        if (importData.udaAppendLease && importData.udaAppendLease.requestId !== requestId) {
          throw new Error('lease_lost');
        }

        // Every UDA lands in this one transaction: they become visible together
        // or not at all. A UdaDoc is its own commit marker.
        for (const [index, planned] of manifest.udas.entries()) {
          tx.set(udaRefs[index]!, { ...planned.doc, sourceRequestId: requestId });
        }
        tx.set(
          importRef,
          {
            udaCount: (importData.udaCount ?? 0) + manifest.udas.length,
            udaAppendLease: null,
          },
          { merge: true },
        );
        tx.set(programRef, { updatedAt: serverTimestamp() }, { merge: true });
        tx.set(
          doc(db, attemptPath(programId, manifest.importId, requestId)),
          { status: 'committed', manifestHash, committedAt: serverTimestamp() },
          { merge: true },
        );
        tx.set(doc(collection(db, 'auditEvents')), {
          actorUid: manifest.ownerUid,
          action: 'uda.structureImported',
          targetId: manifest.importId,
          outcome: 'success',
          reason: null,
          timestamp: serverTimestamp(),
        });
      });
    },

    async cleanup({ programId, activeImportId, manifest, requestId }) {
      try {
        const base = importBase(programId, activeImportId);
        // Never touch anything this attempt actually committed.
        const committed = await getDoc(doc(db, attemptPath(programId, activeImportId, requestId)));
        if (
          committed.exists() &&
          (committed.data() as { status?: string }).status === 'committed'
        ) {
          return 'done';
        }

        // Manifest-scoped only: exactly the paths this attempt uploaded. Never a
        // prefix delete, never a pre-existing file — a path that already existed
        // would have blocked the preflight, so nothing here predates the attempt.
        await mapWithConcurrency(manifest.storagePaths, STORAGE_CONCURRENCY, async (path) => {
          try {
            await deleteFile(path);
          } catch (error) {
            if (!isFileNotFound(error)) throw error;
          }
        });

        await runTransaction(db, async (tx) => {
          const importRef = doc(db, base);
          const importSnap = await tx.get(importRef);
          if (importSnap.exists()) {
            const lease = (importSnap.data() as { udaAppendLease?: { requestId: string } })
              .udaAppendLease;
            // Only ever release our own lease.
            if (lease && lease.requestId === requestId) {
              tx.set(importRef, { udaAppendLease: null }, { merge: true });
            }
          }
          tx.delete(doc(db, attemptPath(programId, activeImportId, requestId)));
        });
        return 'done';
      } catch {
        return 'pending';
      }
    },
  };
}
