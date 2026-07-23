import {
  parsePool,
  serializePool,
  DEFAULT_MAX_CHARACTERS,
  POOL_SCHEMA_VERSION,
} from '@schoolforge/lesson-contract';
import type { ParsedPool, PoolQuestion } from '@schoolforge/lesson-contract';
import type { AiPoolProposalOutput } from './aiContentClient.js';

/**
 * AIGEN-02 — mapper **puro** proposta IA → `schoolforge-pool/v2`. Vive nel dominio
 * web (dove `@schoolforge/lesson-contract` è disponibile): AIGEN-01 lato Functions
 * valida solo la struttura semantica **senza ID**; l'assegnazione di
 * `questionLocalId`/`optionId` persistiti e la materializzazione `parsePool`
 * appartengono al web.
 *
 * Pipeline: proposta senza ID → normalizzazione locale (editabile dal docente) →
 * assegnazione ID validi e non collidenti → costruzione `schoolforge-pool/v2` →
 * `parsePool` (autorevole). Nessun ID restituito dal modello è mai autorevole.
 *
 * **Algoritmo ID.** Le opzioni usano la convenzione canonica del pool editor
 * (`a`, `b`, `c`, … = `String.fromCharCode(97 + index)`), locali alla domanda e
 * quindi sempre distinte. Gli ID domanda sono `ia-<n>` con `n` il più piccolo
 * intero ≥ 1 che non collide con gli ID del pool esistente né con quelli già
 * assegnati alle domande generate: deterministico a parità di pool esistente e di
 * proposta, senza collisioni. `maxPoints` è derivato da `difficolta` dal parser;
 * nessun `peso`. Le aperte hanno `maxCharacters` (default canonico 2000).
 */

/** Convenzione canonica degli ID opzione del pool editor (a, b, c, …). */
export function optionIdFromIndex(index: number): string {
  return String.fromCharCode(97 + index);
}

/** Domanda proposta **editabile** nello stato locale del dialog (nessun ID persistito). */
export type LocalProposalQuestion = {
  /** Chiave locale stabile per React/edit; NON persistita. */
  localKey: string;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  testo: string;
  difficolta: number;
  /** Solo aperta. */
  soluzione: string;
  /** Solo aperta: limite caratteri risposta (default 2000). */
  maxCharacters: number;
  /** Solo chiuse: testi delle opzioni (senza ID). */
  opzioni: string[];
  /** Solo chiuse: indici 0-based delle opzioni corrette. */
  soluzioneIndici: number[];
};

let localKeySeq = 0;
function nextLocalKey(): string {
  localKeySeq += 1;
  return `local-${localKeySeq}`;
}

/**
 * Converte la proposta del server (senza ID) nel modello locale **editabile**.
 * Le aperte ricevono il default canonico `maxCharacters = 2000`.
 */
export function proposalToLocalQuestions(output: AiPoolProposalOutput): LocalProposalQuestion[] {
  return output.questions.map((q) => {
    if (q.tipo === 'aperta') {
      return {
        localKey: nextLocalKey(),
        tipo: 'aperta',
        testo: q.testo,
        difficolta: q.difficolta,
        soluzione: q.soluzione,
        maxCharacters: DEFAULT_MAX_CHARACTERS,
        opzioni: [],
        soluzioneIndici: [],
      };
    }
    return {
      localKey: nextLocalKey(),
      tipo: q.tipo,
      testo: q.testo,
      difficolta: q.difficolta,
      soluzione: '',
      maxCharacters: DEFAULT_MAX_CHARACTERS,
      opzioni: [...q.opzioni],
      soluzioneIndici: [...q.soluzioneIndici],
    };
  });
}

/** ID domanda `ia-<n>` deterministico, non collidente con `used`. */
function nextQuestionId(used: Set<string>): string {
  let n = 1;
  let id = `ia-${n}`;
  while (used.has(id)) {
    n += 1;
    id = `ia-${n}`;
  }
  used.add(id);
  return id;
}

export type MapperResult =
  | { ok: true; pool: ParsedPool; addedCount: number }
  | { ok: false; errors: string[] };

function validateLocal(q: LocalProposalQuestion, ordinal: number): string[] {
  const errors: string[] = [];
  const label = `Domanda ${ordinal}`;
  if (q.testo.trim().length === 0) errors.push(`${label}: il testo è vuoto.`);
  if (!Number.isInteger(q.difficolta) || q.difficolta < 1 || q.difficolta > 5) {
    errors.push(`${label}: la difficoltà deve essere un intero da 1 a 5.`);
  }
  if (q.tipo === 'aperta') {
    if (q.soluzione.trim().length === 0) errors.push(`${label}: la soluzione è vuota.`);
    if (!Number.isInteger(q.maxCharacters) || q.maxCharacters < 1 || q.maxCharacters > 10000) {
      errors.push(`${label}: il limite caratteri deve essere un intero da 1 a 10000.`);
    }
    return errors;
  }
  // chiuse
  const opzioni = q.opzioni.map((o) => o.trim());
  if (opzioni.length < 2) errors.push(`${label}: servono almeno due opzioni.`);
  if (opzioni.some((o) => o.length === 0)) errors.push(`${label}: un'opzione è vuota.`);
  const lowered = opzioni.map((o) => o.toLowerCase());
  if (new Set(lowered).size !== lowered.length) errors.push(`${label}: opzioni duplicate.`);
  const sol = q.soluzioneIndici;
  if (sol.length === 0) errors.push(`${label}: seleziona almeno una risposta corretta.`);
  if (sol.some((i) => !Number.isInteger(i) || i < 0 || i >= opzioni.length)) {
    errors.push(`${label}: la soluzione riferisce un'opzione inesistente.`);
  }
  if (new Set(sol).size !== sol.length) errors.push(`${label}: soluzione con indici duplicati.`);
  if (q.tipo === 'chiusa_singola' && sol.length !== 1) {
    errors.push(`${label}: una domanda a risposta singola ha esattamente una soluzione.`);
  }
  if (q.tipo === 'chiusa_multipla' && sol.length >= opzioni.length) {
    errors.push(`${label}: lascia almeno un'opzione non corretta.`);
  }
  return errors;
}

function localToRaw(q: LocalProposalQuestion, id: string): Record<string, unknown> {
  const base = { id, tipo: q.tipo, difficolta: q.difficolta, testo: q.testo.trim() };
  if (q.tipo === 'aperta') {
    // maxCharacters incluso sempre: il serializer omette il default 2000.
    return { ...base, soluzione: q.soluzione.trim(), maxCharacters: q.maxCharacters };
  }
  const opzioni = q.opzioni.map((testo, index) => ({
    id: optionIdFromIndex(index),
    testo: testo.trim(),
  }));
  const soluzione = q.soluzioneIndici.map((i) => optionIdFromIndex(i));
  return { ...base, opzioni, soluzione };
}

/**
 * Costruisce il pool combinato. Con `existing` presente le domande esistenti sono
 * **preservate integralmente** (ordine, contenuto, ID) e le nuove sono
 * **appese**; con `existing` assente/vuoto crea un nuovo pool. La validazione
 * finale è `parsePool` sul documento serializzato: se fallisce, `{ ok: false }` e
 * nessuna write a monte. Ritorna il numero di domande aggiunte.
 */
export function buildPoolFromProposal(
  existing: PoolQuestion[] | null,
  locals: LocalProposalQuestion[],
): MapperResult {
  if (locals.length === 0) {
    return { ok: false, errors: ['Nessuna domanda da applicare.'] };
  }
  const localErrors = locals.flatMap((q, i) => validateLocal(q, i + 1));
  if (localErrors.length > 0) return { ok: false, errors: localErrors };

  const used = new Set<string>((existing ?? []).map((q) => q.id));
  const mappedRaw = locals.map((q) => localToRaw(q, nextQuestionId(used)));

  const candidateQuestions: unknown[] = [...(existing ?? []), ...mappedRaw];
  const candidatePool = { schema: POOL_SCHEMA_VERSION, questions: candidateQuestions };
  const serialized = serializePool(candidatePool as unknown as ParsedPool);
  const result = parsePool(serialized);
  if (!result.ok) {
    return {
      ok: false,
      errors: result.errors.map(
        (e) => `${e.questionId ? `[${e.questionId}] ` : ''}${e.field}: ${e.message}`,
      ),
    };
  }
  return { ok: true, pool: result.pool, addedCount: mappedRaw.length };
}
