import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import type { DocumentReference, Firestore } from 'firebase/firestore';
import type { LessonDoc, ProgramDoc, UdaDoc } from '../../../types/firestore.js';
import {
  deleteFile,
  isFileNotFound,
  readTexts,
  writeText,
} from '../gateway/repositoryGatewayClient.js';
import { computeManifestHash } from './manifestHash.js';
import {
  checkCommitPreconditions,
  classifyAttempt,
  classifySourceAttempt,
  mayCleanupAttempt,
} from './attemptState.js';
import type { AttemptExpectation, AttemptRecord, LeaseRecord } from './attemptState.js';
import { LESSON_APPEND_LEASE_FIELD, LESSON_LEASE_TTL_MS } from './lessonAppendLease.js';
import type {
  LessonStructureImportContext,
  LessonStructureImportDeps,
} from './lessonStructureImportRepository.js';

/**
 * STRUCTURE-IMPORT-02B — implementazione Firestore + Storage Gateway
 * dell'append di lezioni.
 *
 * **Lease per singola UDA.** A differenza dell'append di UDA, che deve
 * escludere tutto il corso, qui basta escludere la UDA di destinazione: il
 * lease vive sul documento della UDA (`lessonAppendLease`), quindi due UDA
 * diverse possono essere popolate in parallelo, mentre creazione, riordino ed
 * eliminazione di lezioni **di quella UDA** sono bloccate finché l'import è in
 * volo (vedi `assertNoActiveLessonAppendLease`).
 *
 * I record dei tentativi vivono in una collezione dedicata
 * (`lessonStructureImportAttempts`): un tentativo di import UDA non può in
 * nessun caso essere scambiato per un replay di un import lezioni, e la
 * classificazione controlla comunque `kind` e `udaId`.
 *
 * Tutto ciò che viene scritto sta sotto `programs/{programId}/**` e
 * `repository/{ownerUid}/imports/**`, già owner-only con le Rules correnti:
 * nessuna Rule, Function o indice aggiunto.
 */

const STORAGE_CONCURRENCY = 3;
const PREFLIGHT_CHUNK = 50;

function importBase(programId: string, importId: string): string {
  return `programs/${programId}/imports/${importId}`;
}

function attemptPath(programId: string, importId: string, requestId: string): string {
  return `${importBase(programId, importId)}/lessonStructureImportAttempts/${requestId}`;
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

export function createFirestoreLessonStructureImportDeps(
  db: Firestore,
  options: { now?: () => number } = {},
): LessonStructureImportDeps {
  const now = options.now ?? (() => Date.now());

  const expectationOf = (
    programId: string,
    requestId: string,
    sourceHash: string,
    manifestHash: string,
    manifest: {
      importId: string;
      udaId: string;
      lessonIds: string[];
      publicLessonIds: string[];
      storagePaths: string[];
    },
  ): AttemptExpectation => ({
    requestId,
    sourceHash,
    programId,
    importId: manifest.importId,
    manifestHash,
    kind: 'lesson',
    udaId: manifest.udaId,
    documentIds: manifest.lessonIds,
    publicLessonIds: manifest.publicLessonIds,
    storagePaths: manifest.storagePaths,
  });

  return {
    async loadContext({ programId, udaId }): Promise<LessonStructureImportContext | null> {
      const programSnap = await getDoc(doc(db, 'programs', programId));
      if (!programSnap.exists()) return null;
      const program = programSnap.data() as ProgramDoc;
      if (!program.activeImportId) return null;

      const base = importBase(programId, program.activeImportId);
      const udaSnap = await getDoc(doc(db, `${base}/udas/${udaId}`));
      // La UDA deve esistere **dentro l'import attivo**: una UDA sostituita o
      // appartenente a un import precedente non è una destinazione valida.
      if (!udaSnap.exists()) return null;
      const uda = udaSnap.data() as UdaDoc;
      if (uda.importId !== program.activeImportId) return null;

      // Solo le lezioni di questa UDA: query mirata, mai una scansione.
      const lessonsSnap = await getDocs(
        query(collection(db, `${base}/lessons`), where('udaDir', '==', uda.dir)),
      );

      return {
        ownerUid: program.ownerUid,
        activeImportId: program.activeImportId,
        udaId,
        udaDir: uda.dir,
        udaTitle: uda.titolo ?? null,
        existingLessons: lessonsSnap.docs.map((d) => {
          const data = d.data() as Partial<LessonDoc>;
          return {
            lessonId: d.id,
            filename: data.filename,
            order: data.order,
            titolo: data.titolo ?? null,
          };
        }),
      };
    },

    hashCanonical: (canonical) => computeManifestHash(canonical),

    async probeSourceAttempt({ programId, activeImportId, udaId, requestId, sourceHash }) {
      const snap = await getDoc(doc(db, attemptPath(programId, activeImportId, requestId)));
      return classifySourceAttempt(snap.exists() ? (snap.data() as AttemptRecord) : null, {
        requestId,
        sourceHash,
        kind: 'lesson',
        programId,
        importId: activeImportId,
        udaId,
      });
    },

    async probeAttempt({ programId, activeImportId, requestId, manifestHash, manifest }) {
      const snap = await getDoc(doc(db, attemptPath(programId, activeImportId, requestId)));
      const record = snap.exists() ? (snap.data() as AttemptRecord) : null;
      const sourceHash = typeof record?.sourceHash === 'string' ? record.sourceHash : '';
      return classifyAttempt(
        record,
        expectationOf(programId, requestId, sourceHash, manifestHash, manifest),
      );
    },

    async preflight({ programId, context, manifest, ownedStoragePaths }) {
      const base = importBase(programId, context.activeImportId);
      const refs: Array<{
        kind: 'lesson' | 'publicLesson';
        id: string;
        ref: DocumentReference;
      }> = [
        ...manifest.lessonIds.map((id) => ({
          kind: 'lesson' as const,
          id,
          ref: doc(db, `${base}/lessons/${id}`),
        })),
        ...manifest.publicLessonIds.map((id) => ({
          kind: 'publicLesson' as const,
          id,
          ref: doc(db, `publicLessons/${id}`),
        })),
      ];
      for (let i = 0; i < refs.length; i += PREFLIGHT_CHUNK) {
        const batch = refs.slice(i, i + PREFLIGHT_CHUNK);
        const snaps = await Promise.all(batch.map((entry) => getDoc(entry.ref)));
        const hit = snaps.findIndex((snap) => snap.exists());
        if (hit !== -1) {
          return { collision: { kind: batch[hit]!.kind, id: batch[hit]!.id } };
        }
      }

      const owned = new Set(ownedStoragePaths);
      const toCheck = manifest.storagePaths.filter((path) => !owned.has(path));
      if (toCheck.length > 0) {
        const results = await readTexts(toCheck);
        const existing = results.find((entry) => entry.ok);
        if (existing) return { collision: { kind: 'storage', id: existing.path } };
      }
      return { collision: null };
    },

    async acquireLease({
      programId,
      activeImportId,
      udaId,
      requestId,
      manifestHash,
      sourceHash,
      manifest,
    }) {
      return runTransaction(db, async (tx) => {
        const programRef = doc(db, 'programs', programId);
        const udaRef = doc(db, `${importBase(programId, activeImportId)}/udas/${udaId}`);
        const [programSnap, udaSnap] = await Promise.all([tx.get(programRef), tx.get(udaRef)]);
        if (!programSnap.exists() || !udaSnap.exists()) return 'busy' as const;
        if ((programSnap.data() as ProgramDoc).activeImportId !== activeImportId) {
          return 'busy' as const;
        }

        const lease = (udaSnap.data() as Record<string, LeaseRecord | undefined>)[
          LESSON_APPEND_LEASE_FIELD
        ];
        const currentTime = now();
        if (
          lease &&
          lease.requestId !== requestId &&
          typeof lease.expiresAt === 'number' &&
          lease.expiresAt > currentTime
        ) {
          return 'busy' as const;
        }

        const expiresAt = currentTime + LESSON_LEASE_TTL_MS;
        tx.set(
          udaRef,
          { [LESSON_APPEND_LEASE_FIELD]: { requestId, manifestHash, expiresAt } },
          { merge: true },
        );
        tx.set(
          doc(db, attemptPath(programId, activeImportId, requestId)),
          {
            requestId,
            sourceHash,
            manifestHash,
            kind: 'lesson',
            programId,
            importId: activeImportId,
            udaId,
            documentIds: manifest.lessonIds,
            publicLessonIds: manifest.publicLessonIds,
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

    async renewLease({ programId, activeImportId, udaId, requestId, manifestHash }) {
      return runTransaction(db, async (tx) => {
        const udaRef = doc(db, `${importBase(programId, activeImportId)}/udas/${udaId}`);
        const udaSnap = await tx.get(udaRef);
        if (!udaSnap.exists()) return 'lost' as const;
        const lease = (udaSnap.data() as Record<string, LeaseRecord | undefined>)[
          LESSON_APPEND_LEASE_FIELD
        ];
        if (
          !lease ||
          lease.requestId !== requestId ||
          lease.manifestHash !== manifestHash ||
          typeof lease.expiresAt !== 'number'
        ) {
          return 'lost' as const;
        }
        tx.set(
          udaRef,
          {
            [LESSON_APPEND_LEASE_FIELD]: {
              requestId,
              manifestHash,
              expiresAt: now() + LESSON_LEASE_TTL_MS,
            },
          },
          { merge: true },
        );
        return 'renewed' as const;
      });
    },

    async commit({ programId, manifest, requestId, manifestHash, sourceHash }) {
      const base = importBase(programId, manifest.importId);
      await runTransaction(db, async (tx) => {
        const programRef = doc(db, 'programs', programId);
        const udaRef = doc(db, `${base}/udas/${manifest.udaId}`);
        const attemptRef = doc(db, attemptPath(programId, manifest.importId, requestId));
        const lessonRefs = manifest.lessonIds.map((id) => doc(db, `${base}/lessons/${id}`));
        const publicRefs = manifest.publicLessonIds.map((id) => doc(db, `publicLessons/${id}`));

        const [programSnap, udaSnap, attemptSnap, ...targetSnaps] = await Promise.all([
          tx.get(programRef),
          tx.get(udaRef),
          tx.get(attemptRef),
          ...lessonRefs.map((ref) => tx.get(ref)),
          ...publicRefs.map((ref) => tx.get(ref)),
        ]);

        if (!programSnap.exists()) throw new Error('program_missing');
        const program = programSnap.data() as ProgramDoc;
        if (program.activeImportId !== manifest.importId) throw new Error('active_import_changed');
        if (program.ownerUid !== manifest.ownerUid) throw new Error('owner_changed');
        if (!udaSnap.exists()) throw new Error('uda_missing');
        const uda = udaSnap.data() as UdaDoc;
        // La UDA deve essere ancora quella su cui il piano è stato costruito:
        // una `dir` diversa significa numerazione e path diversi.
        if (uda.dir !== manifest.udaDir) throw new Error('uda_changed');

        const failure = checkCommitPreconditions({
          lease:
            (udaSnap.data() as Record<string, LeaseRecord | undefined>)[
              LESSON_APPEND_LEASE_FIELD
            ] ?? null,
          attempt: attemptSnap.exists() ? (attemptSnap.data() as AttemptRecord) : null,
          expected: expectationOf(programId, requestId, sourceHash, manifestHash, manifest),
          now: now(),
        });
        if (failure) throw new Error(failure);

        // Nessun documento di destinazione — tecnico o proiezione — può esistere.
        if (targetSnaps.some((snap) => snap.exists())) throw new Error('lesson_collision');

        for (const [index, planned] of manifest.lessons.entries()) {
          tx.set(lessonRefs[index]!, { ...planned.doc, sourceRequestId: requestId });
          tx.set(publicRefs[index]!, { ...planned.publicLesson, createdAt: serverTimestamp() });
        }
        // Un solo incremento per l'intero lotto, e rilascio del lease.
        tx.set(
          udaRef,
          {
            lessonCount: (uda.lessonCount ?? 0) + manifest.lessonCountIncrement,
            [LESSON_APPEND_LEASE_FIELD]: null,
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
          action: 'lesson.structureImported',
          targetId: manifest.udaId,
          outcome: 'success',
          reason: null,
          timestamp: serverTimestamp(),
        });
      });
    },

    async cleanup({ programId, activeImportId, manifest, requestId, manifestHash, sourceHash }) {
      try {
        const attemptRef = doc(db, attemptPath(programId, activeImportId, requestId));
        const expected = expectationOf(programId, requestId, sourceHash, manifestHash, manifest);
        const attemptSnap = await getDoc(attemptRef);
        const record = attemptSnap.exists() ? (attemptSnap.data() as AttemptRecord) : null;
        // Senza un record che dimostri la proprietà — committato, sostituito,
        // di un'altra UDA, di un altro tipo o malformato — non si cancella nulla.
        if (!mayCleanupAttempt(record, expected)) return 'done';

        await mapWithConcurrency(manifest.storagePaths, STORAGE_CONCURRENCY, async (path) => {
          try {
            await deleteFile(path);
          } catch (error) {
            if (!isFileNotFound(error)) throw error;
          }
        });

        await runTransaction(db, async (tx) => {
          const udaRef = doc(db, `${importBase(programId, activeImportId)}/udas/${manifest.udaId}`);
          const [udaSnap, freshAttempt] = await Promise.all([tx.get(udaRef), tx.get(attemptRef)]);
          // Riverificato dentro la transazione: fra la lettura e qui il
          // tentativo può essere stato committato o sostituito.
          const fresh = freshAttempt.exists() ? (freshAttempt.data() as AttemptRecord) : null;
          if (!mayCleanupAttempt(fresh, expected)) return;

          if (udaSnap.exists()) {
            const lease = (udaSnap.data() as Record<string, LeaseRecord | undefined>)[
              LESSON_APPEND_LEASE_FIELD
            ];
            if (lease && lease.requestId === requestId) {
              tx.set(udaRef, { [LESSON_APPEND_LEASE_FIELD]: null }, { merge: true });
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
