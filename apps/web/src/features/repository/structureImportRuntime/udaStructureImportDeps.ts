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
import { checkCommitPreconditions, classifyAttempt, mayCleanupAttempt } from './attemptState.js';
import type { AttemptExpectation, AttemptRecord, LeaseRecord } from './attemptState.js';
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

/**
 * Injectable clock: the lease expiry checks are the whole point of the commit
 * preconditions, so tests must be able to move time without waiting.
 */
export function createFirestoreUdaStructureImportDeps(
  db: Firestore,
  options: { now?: () => number } = {},
): UdaStructureImportDeps {
  const now = options.now ?? (() => Date.now());

  const expectationOf = (
    requestId: string,
    manifestHash: string,
    manifest: { udaIds: string[]; storagePaths: string[] },
  ): AttemptExpectation => ({
    requestId,
    manifestHash,
    kind: 'uda',
    udaId: null,
    documentIds: manifest.udaIds,
    publicLessonIds: [],
    storagePaths: manifest.storagePaths,
  });

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

    async probeAttempt({ programId, activeImportId, requestId, manifestHash, manifest }) {
      const snap = await getDoc(doc(db, attemptPath(programId, activeImportId, requestId)));
      return classifyAttempt(
        snap.exists() ? (snap.data() as AttemptRecord) : null,
        expectationOf(requestId, manifestHash, manifest),
      );
    },

    async preflight({ programId, context, manifest, ownedStoragePaths }) {
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
      // On a resume, the paths the same attempt already uploaded are excluded:
      // the attempt record proved they are its own. Everything else that exists
      // is still a blocking collision.
      const owned = new Set(ownedStoragePaths);
      const toCheck = manifest.storagePaths.filter((path) => !owned.has(path));
      if (toCheck.length > 0) {
        const results = await readTexts(toCheck);
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
        const currentTime = now();
        // Another live attempt holds it — including a ZIP "Importa UDA".
        if (
          lease &&
          lease.requestId !== requestId &&
          typeof lease.expiresAt === 'number' &&
          lease.expiresAt > currentTime
        ) {
          return 'busy' as const;
        }

        const expiresAt = currentTime + LEASE_TTL_MS;
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
            documentIds: manifest.udaIds,
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

    async renewLease({ programId, activeImportId, requestId, manifestHash }) {
      return runTransaction(db, async (tx) => {
        const importRef = doc(db, importBase(programId, activeImportId));
        const importSnap = await tx.get(importRef);
        if (!importSnap.exists()) return 'lost' as const;
        const lease = (importSnap.data() as { udaAppendLease?: LeaseRecord }).udaAppendLease;
        // Renewed only when it is still ours and still carries this plan: a
        // lease taken over by someone else is never «renewed» back.
        if (
          !lease ||
          lease.requestId !== requestId ||
          lease.manifestHash !== manifestHash ||
          typeof lease.expiresAt !== 'number'
        ) {
          return 'lost' as const;
        }
        tx.set(
          importRef,
          { udaAppendLease: { requestId, manifestHash, expiresAt: now() + LEASE_TTL_MS } },
          { merge: true },
        );
        return 'renewed' as const;
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
        const attemptRef = doc(db, attemptPath(programId, manifest.importId, requestId));
        const udaRefs = manifest.udaIds.map((id) => doc(db, `${base}/udas/${id}`));
        const [programSnap, importSnap, attemptSnap, ...udaSnaps] = await Promise.all([
          tx.get(programRef),
          tx.get(importRef),
          tx.get(attemptRef),
          ...udaRefs.map((ref) => tx.get(ref)),
        ]);

        if (!programSnap.exists() || !importSnap.exists()) throw new Error('import_missing');
        const program = programSnap.data() as ProgramDoc;
        if (program.activeImportId !== manifest.importId) throw new Error('active_import_changed');
        // The owner is authoritative here too: the manifest was built from the
        // program document, and the program document must still say the same.
        if (program.ownerUid !== manifest.ownerUid) throw new Error('owner_changed');

        // A lease that is absent, expired, malformed or another attempt's is
        // NOT a permission to write: in all those cases someone else may
        // already have changed numbering, order or destination since the plan
        // was built. Nothing is repaired here — the commit simply aborts.
        const failure = checkCommitPreconditions({
          lease: (importSnap.data() as { udaAppendLease?: LeaseRecord }).udaAppendLease ?? null,
          attempt: attemptSnap.exists() ? (attemptSnap.data() as AttemptRecord) : null,
          expected: expectationOf(requestId, manifestHash, manifest),
          now: now(),
        });
        if (failure) throw new Error(failure);

        // Re-checked inside the transaction: the preflight is an early exit, not
        // the guarantee. Nothing may be overwritten.
        if (udaSnaps.some((snap) => snap.exists())) throw new Error('uda_collision');

        const importData = importSnap.data() as { udaCount?: number };

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
          attemptRef,
          { status: 'committed', committedAt: serverTimestamp() },
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

    async cleanup({ programId, activeImportId, manifest, requestId, manifestHash }) {
      try {
        const base = importBase(programId, activeImportId);
        const attemptRef = doc(db, attemptPath(programId, activeImportId, requestId));
        const attemptSnap = await getDoc(attemptRef);
        const expected = expectationOf(requestId, manifestHash, manifest);
        const record = attemptSnap.exists() ? (attemptSnap.data() as AttemptRecord) : null;

        // The record is the proof of ownership. Without it — committed,
        // replaced, malformed or simply absent — nothing is deleted: an old
        // execution waking up late must never remove the lease, the record or
        // the files of the attempt that replaced it.
        if (!mayCleanupAttempt(record, expected)) return 'done';

        // Manifest-scoped only: exactly the paths this attempt uploaded. Never a
        // prefix delete, never a pre-existing file — a path that already existed
        // and was not ours would have blocked the preflight.
        await mapWithConcurrency(manifest.storagePaths, STORAGE_CONCURRENCY, async (path) => {
          try {
            await deleteFile(path);
          } catch (error) {
            if (!isFileNotFound(error)) throw error;
          }
        });

        await runTransaction(db, async (tx) => {
          const importRef = doc(db, base);
          const [importSnap, freshAttempt] = await Promise.all([
            tx.get(importRef),
            tx.get(attemptRef),
          ]);
          // Re-verified inside the transaction: between the read above and here
          // the attempt may have been committed or replaced.
          const fresh = freshAttempt.exists() ? (freshAttempt.data() as AttemptRecord) : null;
          if (!mayCleanupAttempt(fresh, expected)) return;

          if (importSnap.exists()) {
            const lease = (importSnap.data() as { udaAppendLease?: LeaseRecord }).udaAppendLease;
            // Only ever release our own lease.
            if (lease && lease.requestId === requestId) {
              tx.set(importRef, { udaAppendLease: null }, { merge: true });
            }
          }
          tx.delete(attemptRef);
        });
        return 'done';
      } catch {
        return 'pending';
      }
    },
  };
}
