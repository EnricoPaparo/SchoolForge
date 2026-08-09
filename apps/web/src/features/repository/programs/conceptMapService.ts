import { collection, deleteField, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { LessonDoc, PublicLessonDoc } from '../../../types/firestore.js';
import { assertValidConceptMap } from './conceptMapContract.js';
import {
  checkLessonBeforeProjection,
  checkProjectionMatchesLesson,
  identityFailureMessage,
} from './lessonProjectionIdentity.js';

/**
 * CONCEPT-MAP-02 — salvataggio **autorevole** della mappa concettuale.
 *
 * Vive in un modulo proprio e non dentro `repositoryEditorService`: quello
 * gestisce il ciclo di vita dei documenti del repository (creazione, riordino,
 * corpo, eliminazione) attraverso Storage e batch, mentre questa è una singola
 * operazione transazionale su due documenti che non tocca Storage. Infilarla lì
 * avrebbe aggiunto una dipendenza da `runTransaction` a un modulo che non ne ha
 * bisogno per nient'altro.
 *
 * **Perché una transazione e non un batch.** Un `writeBatch` scrive senza
 * leggere, e qui la decisione dipende da uno stato letto: se la lezione è
 * svolta la mappa va copiata nella proiezione, altrimenti il campo pubblico
 * deve restare assente. Con un batch quella lettura sarebbe fuori
 * dall'atomicità, e una lezione marcata svolta fra la lettura e la scrittura
 * lascerebbe la proiezione senza la mappa (o, peggio nel verso opposto, con la
 * mappa su una lezione non svolta).
 *
 * **Perché le letture sono sequenziali.** L'indirizzo della proiezione non è un
 * dato del chiamante ma una conseguenza del `LessonDoc`: va quindi letto prima
 * il documento tecnico, derivato l'id atteso, e solo allora letta la proiezione.
 * Leggerli in parallelo significherebbe fidarsi dell'id ricevuto.
 *
 * Nessuno stato parziale: o tutto il commit riesce, o non è successo nulla.
 */

export interface SaveLessonConceptMapParams {
  programId: string;
  importId: string;
  lessonId: string;
  /**
   * Id della proiezione **proposto** dal chiamante. Non è autorevole: viene
   * confrontato con quello derivato dal `LessonDoc`, e un disallineamento è un
   * rifiuto. Ometterlo è legittimo — l'id corretto si ricava comunque.
   */
  publicLessonId?: string | null;
  /** UID autenticato del docente: verificato contro entrambi i documenti. */
  ownerUid: string;
  /** Markdown della mappa. Salvato **esattamente** come ricevuto. */
  conceptMapMarkdown: string;
  db: Firestore;
}

export class ConceptMapSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConceptMapSaveError';
  }
}

function lessonPath(programId: string, importId: string, lessonId: string): string {
  return `programs/${programId}/imports/${importId}/lessons/${lessonId}`;
}

/**
 * Salva la mappa sul `LessonDoc` e, **solo** se la lezione è già svolta, la
 * sincronizza nella proiezione studente — tutto in un unico commit, audit
 * compreso.
 *
 * La validazione del testo avviene **prima** della transazione: un payload non
 * valido non deve costare nemmeno una lettura, e la garanzia «zero write»
 * diventa «zero operazioni». Il testo non viene mai modificato.
 */
export async function saveLessonConceptMap(params: SaveLessonConceptMapParams): Promise<void> {
  const { programId, importId, lessonId, publicLessonId, ownerUid, db } = params;
  const conceptMapMarkdown = assertValidConceptMap(params.conceptMapMarkdown);

  await runTransaction(db, async (tx) => {
    // 1. documento tecnico: esistenza, appartenenza, id pubblico atteso.
    const lessonRef = doc(db, lessonPath(programId, importId, lessonId));
    const lessonSnap = await tx.get(lessonRef);
    const lesson = lessonSnap.exists() ? (lessonSnap.data() as LessonDoc) : null;
    const gate = checkLessonBeforeProjection({
      lesson,
      lessonId,
      requestedPublicLessonId: publicLessonId,
      ownerUid,
      importId,
    });
    if (!gate.ok) throw new ConceptMapSaveError(identityFailureMessage(gate.failure));

    // 2. proiezione all'indirizzo **derivato**, mai a quello ricevuto.
    const publicRef = doc(db, 'publicLessons', gate.publicLessonId);
    const publicSnap = await tx.get(publicRef);
    const publicLesson = publicSnap.exists() ? (publicSnap.data() as PublicLessonDoc) : null;
    const projectionGate = checkProjectionMatchesLesson({
      lesson: lesson as LessonDoc,
      publicLesson,
      programId,
      importId,
      ownerUid,
    });
    if (!projectionGate.ok) {
      throw new ConceptMapSaveError(identityFailureMessage(projectionGate.failure));
    }

    // 3. scritture, solo dopo che ogni precondizione è dimostrata.
    const completed = (lesson as LessonDoc).completed === true;
    tx.update(lessonRef, { conceptMapMarkdown });

    if (completed) {
      tx.update(publicRef, { conceptMapMarkdown });
    } else if ((publicLesson as PublicLessonDoc).conceptMapMarkdown !== undefined) {
      // La lezione non è svolta: il campo pubblico non deve esistere. Si scrive
      // solo se c'è davvero qualcosa da rimuovere — un `deleteField()` su un
      // campo già assente sarebbe una scrittura fatturata per non fare nulla.
      tx.update(publicRef, { conceptMapMarkdown: deleteField() });
    }

    tx.set(doc(collection(db, 'auditEvents')), {
      actorUid: ownerUid,
      action: 'lesson.conceptMapSaved',
      targetId: lessonId,
      outcome: 'success',
      reason: completed ? 'saved and projected' : 'saved (lesson not completed)',
      timestamp: serverTimestamp(),
    });
  });
}
