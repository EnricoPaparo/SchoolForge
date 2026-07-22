import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import type { DocumentReference, Firestore, WriteBatch } from 'firebase/firestore';
import type { ProgramDoc, UdaDoc } from '../../../types/firestore.js';
import {
  deleteFile,
  isFileNotFound,
  readTexts,
  writeText,
} from '../gateway/repositoryGatewayClient.js';
import { commitOpsInChunks, deleteDocRefsInBatches } from '../firestoreChunks.js';
import type { UdaImportContext, UdaImportDeps } from './importUdaRepository.js';

/** Lease validity window — a stale lease past this can be taken over after cleanup. */
const LEASE_TTL_MS = 5 * 60 * 1000;
/** SGW upload/delete concurrency (uda-import-contract §8/§10). */
const STORAGE_CONCURRENCY = 3;

function importBase(programId: string, importId: string): string {
  return `programs/${programId}/imports/${importId}`;
}

function udaOrder(uda: Pick<UdaDoc, 'dir' | 'order'>): number {
  if (uda.order !== undefined) return uda.order;
  const match = /^uda-(\d+)(?:-|$)/.exec(uda.dir);
  return match ? Number(match[1]) - 1 : Number.MAX_SAFE_INTEGER;
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
 * Concrete Firestore + same-origin Storage Gateway implementation of the
 * `UdaImportDeps` ports (uda-import-contract §5.1, §8). Staging docs
 * (lessons/questionIndex) are written before the commit but carry no `UdaDoc`,
 * so the reader-coherence helpers treat them as invisible until commit. The
 * final `UdaDoc` + all `publicLessons` are created in ONE transaction (the
 * commit marker). Cleanup only ever touches the attempt manifest.
 */
export function createFirestoreUdaImportDeps(db: Firestore): UdaImportDeps {
  return {
    async loadContext(programId): Promise<UdaImportContext | null> {
      const programSnap = await getDoc(doc(db, 'programs', programId));
      if (!programSnap.exists()) return null;
      const program = programSnap.data() as ProgramDoc;
      if (!program.activeImportId) return null;
      const udasSnap = await getDocs(
        collection(db, `${importBase(programId, program.activeImportId)}/udas`),
      );
      const existingUdaOrders = udasSnap.docs.map((d) => udaOrder(d.data() as UdaDoc));
      return {
        ownerUid: program.ownerUid,
        activeImportId: program.activeImportId,
        existingUdaOrders,
      };
    },

    async findCommittedAttempt({ programId, activeImportId, manifest, requestId }) {
      const attemptSnap = await getDoc(
        doc(db, `${importBase(programId, activeImportId)}/udaImportAttempts/${requestId}`),
      );
      if (!attemptSnap.exists()) return 'none';
      const data = attemptSnap.data() as { manifestHash?: string; status?: string };
      if (data.manifestHash !== manifest.manifestHash) return 'conflict';
      return data.status === 'committed' ? 'committed' : 'none';
    },

    async preflight({ programId, context, manifest }) {
      const base = importBase(programId, context.activeImportId);
      const refs: Array<{
        kind: 'uda' | 'lesson' | 'questionIndex' | 'publicLesson';
        id: string;
        ref: DocumentReference;
      }> = [
        { kind: 'uda', id: manifest.udaId, ref: doc(db, `${base}/udas/${manifest.udaId}`) },
        ...manifest.lessonIds.map((id) => ({
          kind: 'lesson' as const,
          id,
          ref: doc(db, `${base}/lessons/${id}`),
        })),
        ...manifest.questionIndexIds.map((id) => ({
          kind: 'questionIndex' as const,
          id,
          ref: doc(db, `${base}/questionIndex/${id}`),
        })),
        ...manifest.publicLessonIds.map((id) => ({
          kind: 'publicLesson' as const,
          id,
          ref: doc(db, `publicLessons/${id}`),
        })),
      ];
      // Bounded, point reads: any existing target (even a pre-existing orphan) blocks.
      for (let i = 0; i < refs.length; i += 50) {
        const batch = refs.slice(i, i + 50);
        const snaps = await Promise.all(batch.map((r) => getDoc(r.ref)));
        const hit = snaps.findIndex((s) => s.exists());
        if (hit !== -1) return { collision: { kind: batch[hit]!.kind, id: batch[hit]!.id } };
      }
      // Storage: any target path that already exists is a collision.
      const results = await readTexts(manifest.storagePaths);
      const existing = results.find((r) => r.ok);
      if (existing) return { collision: { kind: 'storage', id: existing.path } };
      return { collision: null };
    },

    async acquireLease({ programId, activeImportId, manifest, requestId }) {
      return runTransaction(db, async (tx) => {
        const programRef = doc(db, 'programs', programId);
        const importRef = doc(db, importBase(programId, activeImportId));
        const [programSnap, importSnap] = await Promise.all([
          tx.get(programRef),
          tx.get(importRef),
        ]);
        if (!programSnap.exists() || !importSnap.exists()) return 'busy' as const;
        if ((programSnap.data() as ProgramDoc).activeImportId !== activeImportId) {
          return 'busy' as const;
        }
        const lease = (
          importSnap.data() as { udaAppendLease?: { requestId: string; expiresAt: number } }
        ).udaAppendLease;
        const now = Date.now();
        if (lease && lease.requestId !== requestId && lease.expiresAt > now) return 'busy' as const;
        const expiresAt = now + LEASE_TTL_MS;
        tx.set(
          importRef,
          {
            udaAppendLease: {
              requestId,
              manifestHash: manifest.manifestHash,
              udaId: manifest.udaId,
              expiresAt,
            },
          },
          { merge: true },
        );
        tx.set(
          doc(db, `${importBase(programId, activeImportId)}/udaImportAttempts/${requestId}`),
          {
            requestId,
            manifestHash: manifest.manifestHash,
            udaId: manifest.udaId,
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
      await mapWithConcurrency(files, STORAGE_CONCURRENCY, (f) => writeText(f.path, f.content));
    },

    async stageDocs({ programId, payload }) {
      const base = importBase(programId, payload.uda.data.importId);
      await commitOpsInChunks(db, [
        ...payload.lessons.map(
          (l) => (batch: WriteBatch) => batch.set(doc(db, `${base}/lessons/${l.id}`), l.data),
        ),
        ...payload.questionIndex.map(
          (q) => (batch: WriteBatch) => batch.set(doc(db, `${base}/questionIndex/${q.id}`), q.data),
        ),
      ]);
    },

    async commit({ programId, payload, requestId }) {
      const activeImportId = payload.uda.data.importId;
      const base = importBase(programId, activeImportId);
      await runTransaction(db, async (tx) => {
        const programRef = doc(db, 'programs', programId);
        const importRef = doc(db, base);
        const udaRef = doc(db, `${base}/udas/${payload.uda.id}`);
        const [programSnap, importSnap, udaSnap] = await Promise.all([
          tx.get(programRef),
          tx.get(importRef),
          tx.get(udaRef),
        ]);
        if (!programSnap.exists() || !importSnap.exists()) throw new Error('import_missing');
        if ((programSnap.data() as ProgramDoc).activeImportId !== activeImportId) {
          throw new Error('active_import_changed');
        }
        if (udaSnap.exists()) throw new Error('uda_collision');
        const importData = importSnap.data() as {
          udaCount?: number;
          lessonCount?: number;
          questionCount?: number;
          udaAppendLease?: { requestId: string };
        };
        if (importData.udaAppendLease && importData.udaAppendLease.requestId !== requestId) {
          throw new Error('lease_lost');
        }

        tx.set(udaRef, { ...payload.uda.data, sourceRequestId: requestId });
        for (const pub of payload.publicLessons) {
          tx.set(doc(db, `publicLessons/${pub.id}`), pub.data);
        }
        tx.set(
          importRef,
          {
            udaCount: (importData.udaCount ?? 0) + 1,
            lessonCount: (importData.lessonCount ?? 0) + payload.lessons.length,
            questionCount: (importData.questionCount ?? 0) + payload.questionIndex.length,
            udaAppendLease: null,
          },
          { merge: true },
        );
        tx.set(programRef, { updatedAt: serverTimestamp() }, { merge: true });
        tx.set(
          doc(db, `${base}/udaImportAttempts/${requestId}`),
          { status: 'committed', committedAt: serverTimestamp() },
          { merge: true },
        );
        tx.set(doc(collection(db, 'auditEvents')), {
          actorUid: payload.uda.data.ownerUid,
          action: 'uda.imported',
          targetId: payload.uda.id,
          outcome: 'success',
          reason: null,
          timestamp: serverTimestamp(),
        });
      });
    },

    async cleanup({ programId, activeImportId, manifest, requestId }) {
      try {
        const base = importBase(programId, activeImportId);
        const udaSnap = await getDoc(doc(db, `${base}/udas/${manifest.udaId}`));
        // Never delete a committed UDA's data.
        if (
          udaSnap.exists() &&
          (udaSnap.data() as { sourceRequestId?: string }).sourceRequestId === requestId
        ) {
          return 'done';
        }
        await deleteDocRefsInBatches(db, [
          ...manifest.lessonIds.map((id) => doc(db, `${base}/lessons/${id}`)),
          ...manifest.questionIndexIds.map((id) => doc(db, `${base}/questionIndex/${id}`)),
        ]);
        await mapWithConcurrency(manifest.storagePaths, STORAGE_CONCURRENCY, async (path) => {
          try {
            await deleteFile(path);
          } catch (e) {
            if (!isFileNotFound(e)) throw e;
          }
        });
        await runTransaction(db, async (tx) => {
          const importRef = doc(db, base);
          const importSnap = await tx.get(importRef);
          if (importSnap.exists()) {
            const lease = (importSnap.data() as { udaAppendLease?: { requestId: string } })
              .udaAppendLease;
            if (lease && lease.requestId === requestId) {
              tx.set(importRef, { udaAppendLease: null }, { merge: true });
            }
          }
          tx.delete(doc(db, `${base}/udaImportAttempts/${requestId}`));
        });
        return 'done';
      } catch {
        return 'pending';
      }
    },
  };
}
