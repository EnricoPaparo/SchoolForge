/**
 * CONCEPT-MAP-02 — contratto **puro** della mappa concettuale persistita: cap
 * dimensionale, validazione fail-closed e letture normalizzate dei due campi.
 *
 * Nessun Firestore, nessuna rete, nessun React: è il punto in cui si decide che
 * cosa è una mappa valida, e vive separato dal servizio perché la stessa
 * risposta serve al salvataggio, al cambio svolta/non svolta e alla lettura.
 *
 * **La struttura canonica non si valida qui.** Quella (quattro sezioni
 * nell'ordine giusto, fence singola, avvertenza esatta) è verificata in
 * `functions/src/aiContentConceptMap.ts` quando la mappa viene generata. Qui il
 * confine è dimensionale e di tipo: il docente può modificare la mappa a mano
 * in CONCEPT-MAP-03, e un editor che rifiutasse ogni deviazione dal canonico
 * renderebbe il campo non modificabile — che è l'opposto di ciò che la roadmap
 * chiede. Il perimetro di ciascun livello è dichiarato, non implicito.
 */

import { utf8ByteLength } from './lessonContentSize.js';

/**
 * Cap in byte UTF-8, identico a `MAX_CONCEPT_MAP_OUTPUT_BYTES` del lato
 * Functions. Due ordini di grandezza sotto il corpo della lezione: una mappa
 * lunga è una mappa fallita, e il cap tiene l'artefatto lontanissimo dal limite
 * documentale Firestore anche sommato al resto del `LessonDoc`.
 */
export const MAX_CONCEPT_MAP_BYTES = 32_000;

/**
 * Bound **in caratteri** replicato nelle Security Rules. Le Rules non sanno
 * contare i byte UTF-8 (`size()` conta caratteri), quindi il valore è lo stesso
 * numero ma misura una cosa diversa: per un testo non ASCII i byte sono più dei
 * caratteri, quindi il bound delle Rules è **più debole** di quello applicativo.
 * È voluto e dichiarato: le Rules fermano payload assurdi, il limite autorevole
 * resta questo modulo. La costante è esportata perché il test delle Rules possa
 * riferirsi allo stesso numero invece di ripeterlo a mano.
 */
export const CONCEPT_MAP_RULES_MAX_CHARS = 32_000;

export class ConceptMapValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConceptMapValidationError';
  }
}

/**
 * Valida senza modificare. Nessun trim, nessun troncamento, nessuna correzione:
 * il valore restituito è **identico** a quello ricevuto. Un salvataggio vuoto è
 * rifiutato — cancellare la mappa non è un salvataggio, e non esiste
 * cancellazione implicita.
 */
export function assertValidConceptMap(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ConceptMapValidationError('La mappa concettuale deve essere testo.');
  }
  if (value.trim().length === 0) {
    throw new ConceptMapValidationError('La mappa concettuale non può essere vuota.');
  }
  const bytes = utf8ByteLength(value);
  if (bytes > MAX_CONCEPT_MAP_BYTES) {
    throw new ConceptMapValidationError(
      `La mappa concettuale (${bytes} byte) supera il limite di ${MAX_CONCEPT_MAP_BYTES} byte.`,
    );
  }
  return value;
}

/** Predicato senza eccezioni, per i percorsi che devono decidere e non fallire. */
export function isValidConceptMap(value: unknown): value is string {
  try {
    assertValidConceptMap(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lettura **fail-closed** del campo privato di un `LessonDoc`. Assente, di tipo
 * sbagliato, vuoto o oltre il cap ⇒ `null`: mai una stringa parziale, mai un
 * valore inventato. Un documento legacy privo del campo è valido e legge
 * `null`, senza migrazione.
 */
export function readPrivateConceptMap(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const value = (data as Record<string, unknown>).conceptMapMarkdown;
  return isValidConceptMap(value) ? value : null;
}

/**
 * Lettura fail-closed del campo **pubblico**, con l'invariante di visibilità
 * applicato in lettura oltre che in scrittura: se la proiezione non è marcata
 * svolta, la mappa è `null` **anche** quando un documento malformato la
 * contiene. Difesa in profondità: le Rules impediscono di scriverla, questa
 * lettura impedisce di mostrarla se ci fosse finita comunque.
 */
export function readPublicConceptMap(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record.completed !== true) return null;
  return isValidConceptMap(record.conceptMapMarkdown) ? record.conceptMapMarkdown : null;
}
