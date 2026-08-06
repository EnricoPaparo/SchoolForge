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
 *
 * STRUCTURE-IMPORT-03 aggiunge allo stesso oggetto — non a un secondo oggetto
 * parallelo — il **contesto generale dell'UDA**: descrizione, competenze e
 * obiettivi dell'unità, presi dalla stessa UDA già in memoria. Questo è l'unico
 * punto in cui i campi di `UdaDoc` diventano payload, e i nomi restano quelli
 * canonici italiani.
 */

/**
 * Forma minima richiesta all'UDA dell'albero. Tutti i campi del contesto
 * generale sono facoltativi: una UDA legacy può non averli, e la loro assenza
 * non deve impedire una generazione che oggi funziona.
 */
export interface UdaContextSourceUda {
  titolo?: string | null;
  descrizione?: string | null;
  competenze?: string[] | null;
  obiettivi?: string[] | null;
}

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
 * @param uda            L'UDA della lezione corrente, dall'albero già in
 *                       memoria: titolo e contesto generale.
 * @param currentLessonId Lezione corrente, da marcare con `currentLessonPosition`.
 * @returns L'indice, oppure `null` se il contesto non è coerente (UDA senza
 *          titolo, nessuna lezione, titoli mancanti o lezione corrente assente):
 *          fail-closed, mai un indice parziale o inventato.
 */
export function buildLessonUdaContext(params: {
  lessons: readonly UdaOutlineSourceLesson[];
  udaDir: string;
  uda: UdaContextSourceUda | null | undefined;
  currentLessonId: string;
}): LessonUdaContext | null {
  const title = params.uda?.titolo?.trim();
  if (!title) return null;

  // Legacy: descrizione assente ⇒ `null`, competenze/obiettivi assenti ⇒ liste
  // vuote. Un valore **presente ma di tipo sbagliato** non viene corretto né
  // ignorato: il contesto fallisce chiuso prima della callable, perché un
  // payload che il server rifiuterebbe non deve nemmeno partire.
  const descrizione = normalizeDescription(params.uda?.descrizione);
  if (descrizione === INVALID) return null;
  const competenze = normalizeList(params.uda?.competenze);
  const obiettivi = normalizeList(params.uda?.obiettivi);
  if (competenze === INVALID || obiettivi === INVALID) return null;

  const inUda = params.lessons.filter((l) => l.udaDir === params.udaDir);
  if (inUda.length === 0) return null;

  // Una lezione senza titolo renderebbe l'indice ambiguo: fail-closed.
  if (inUda.some((l) => !l.titolo?.trim())) return null;

  const currentIndex = inUda.findIndex((l) => l.id === params.currentLessonId);
  if (currentIndex < 0) return null;

  return {
    title,
    descrizione,
    competenze,
    obiettivi,
    currentLessonPosition: currentIndex + 1,
    lessons: inUda.map((l, index) => ({
      position: index + 1,
      titolo: l.titolo!.trim(),
      sottotitolo: l.sottotitolo?.trim() ? l.sottotitolo.trim() : null,
    })),
  };
}

/** Sentinella di «valore presente ma non utilizzabile»: mai un fallback. */
const INVALID = Symbol('invalid-uda-context-field');

function normalizeDescription(value: unknown): string | null | typeof INVALID {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return INVALID;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeList(value: unknown): string[] | typeof INVALID {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return INVALID;
  return (value as string[]).map((item) => item.trim()).filter((item) => item.length > 0);
}
