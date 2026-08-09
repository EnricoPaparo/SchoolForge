import { collection, deleteField, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { LessonDoc, PublicLessonDoc } from '../../../types/firestore.js';
import { assertValidConceptMap } from './conceptMapContract.js';

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
 * Nessuno stato parziale: o tutto il commit riesce, o non è successo nulla.
 */

export interface SaveLessonConceptMapParams {
  programId: string;
  importId: string;
  lessonId: string;
  publicLessonId: string;
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
 * Verifica che i due documenti siano davvero quelli attesi. Un `publicLessonId`
 * sbagliato non deve poter scrivere la mappa di una lezione sulla proiezione di
 * un'altra: senza questo controllo il servizio si fiderebbe di un parametro
 * costruito dal chiamante.
 */
function assertCoherentPair(params: {
  lesson: LessonDoc;
  publicLesson: PublicLessonDoc;
  programId: string;
  importId: string;
  ownerUid: string;
}): void {
  const { lesson, publicLesson, programId, importId, ownerUid } = params;
  if (lesson.ownerUid !== ownerUid || publicLesson.ownerUid !== ownerUid) {
    throw new ConceptMapSaveError('La lezione non appartiene a questo utente.');
  }
  if (lesson.importId !== importId || publicLesson.importId !== importId) {
    throw new ConceptMapSaveError('La lezione non appartiene a questa importazione.');
  }
  if (publicLesson.programId !== programId) {
    throw new ConceptMapSaveError('La proiezione non appartiene a questo corso.');
  }
}

/**
 * Salva la mappa sul `LessonDoc` e, **solo** se la lezione è già svolta, la
 * sincronizza nella proiezione studente — tutto in un unico commit, audit
 * compreso.
 *
 * La validazione avviene **prima** della transazione: un payload non valido non
 * deve costare nemmeno le due letture, e la garanzia «zero write» diventa così
 * «zero operazioni». Il testo non viene mai modificato.
 */
export async function saveLessonConceptMap(params: SaveLessonConceptMapParams): Promise<void> {
  const { programId, importId, lessonId, publicLessonId, ownerUid, db } = params;
  const conceptMapMarkdown = assertValidConceptMap(params.conceptMapMarkdown);

  await runTransaction(db, async (tx) => {
    const lessonRef = doc(db, lessonPath(programId, importId, lessonId));
    const publicRef = doc(db, 'publicLessons', publicLessonId);
    const [lessonSnap, publicSnap] = await Promise.all([tx.get(lessonRef), tx.get(publicRef)]);

    if (!lessonSnap.exists()) {
      throw new ConceptMapSaveError('La lezione non esiste.');
    }
    if (!publicSnap.exists()) {
      throw new ConceptMapSaveError('La proiezione della lezione non esiste.');
    }
    const lesson = lessonSnap.data() as LessonDoc;
    const publicLesson = publicSnap.data() as PublicLessonDoc;
    assertCoherentPair({ lesson, publicLesson, programId, importId, ownerUid });

    tx.update(lessonRef, { conceptMapMarkdown });

    if (lesson.completed === true) {
      tx.update(publicRef, { conceptMapMarkdown });
    } else if (publicLesson.conceptMapMarkdown !== undefined) {
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
      reason: lesson.completed === true ? 'saved and projected' : 'saved (lesson not completed)',
      timestamp: serverTimestamp(),
    });
  });
}
