import type { LessonUdaContext } from './aiContentClient.js';

/**
 * AIGEN-CONTEXT-01 — costruzione **pura** dell'indice compatto dell'UDA a partire
 * dall'albero **già caricato in memoria** dal workspace (`tree.udas` /
 * `tree.lessons`): nessuna `getDoc`/`getDocs`, nessuna query, nessuna lettura
 * Storage, nessun listener, nessun polling. Costo passivo invariato.
 *
 * L'indice contiene **solo** posizione e titolazione: nessun `lessonId`,
 * `udaId`, `filename`, `storageRef` o `publicLessonId`, nessun corpo Markdown,
 * pool, domanda, soluzione, concetto o obiettivo delle altre lezioni, nessun
 * dato studente. Serve al modello per delimitare l'argomento, non per attingere
 * contenuto.
 */

/** Forma minima richiesta a una lezione dell'albero (nessun campo tecnico usato oltre l'id). */
export interface UdaOutlineSourceLesson {
  id: string;
  udaDir: string;
  titolo?: string | null;
  sottotitolo?: string | null;
}

/**
 * @param lessons        Lezioni dell'albero **già ordinate canonicamente** dal
 *                       workspace (`sortLessons`): l'ordine di input è la fonte
 *                       dell'ordine dell'indice, così non esiste una seconda
 *                       definizione di «ordine canonico» che possa divergere.
 * @param udaDir         UDA della lezione corrente.
 * @param udaTitle       Titolo dell'UDA (dall'albero, già in memoria).
 * @param currentLessonId Lezione corrente, da marcare con `currentLessonPosition`.
 * @returns L'indice, oppure `null` se il contesto non è coerente (UDA senza
 *          titolo, nessuna lezione, titoli mancanti o lezione corrente assente):
 *          fail-closed, mai un indice parziale o inventato.
 */
export function buildLessonUdaContext(params: {
  lessons: readonly UdaOutlineSourceLesson[];
  udaDir: string;
  udaTitle: string | null | undefined;
  currentLessonId: string;
}): LessonUdaContext | null {
  const title = params.udaTitle?.trim();
  if (!title) return null;

  const inUda = params.lessons.filter((l) => l.udaDir === params.udaDir);
  if (inUda.length === 0) return null;

  // Una lezione senza titolo renderebbe l'indice ambiguo: fail-closed.
  if (inUda.some((l) => !l.titolo?.trim())) return null;

  const currentIndex = inUda.findIndex((l) => l.id === params.currentLessonId);
  if (currentIndex < 0) return null;

  return {
    title,
    currentLessonPosition: currentIndex + 1,
    lessons: inUda.map((l, index) => ({
      position: index + 1,
      titolo: l.titolo!.trim(),
      sottotitolo: l.sottotitolo?.trim() ? l.sottotitolo.trim() : null,
    })),
  };
}
