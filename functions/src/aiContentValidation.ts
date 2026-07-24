/**
 * AIGEN-01 — validazione **semantico-strutturale** dell'output del provider,
 * puro e senza dipendenze. Non costruisce `schoolforge-pool/v2`, non assegna ID
 * e non chiama `parsePool` (quello è AIGEN-02, nel web). Qui si verifica che la
 * proposta del modello rispetti quantità, tipi, range difficoltà, opzioni e
 * soluzioni, e si **rifiutano fail-closed** eventuali ID/campi tecnici prodotti
 * dal modello (mai autorevoli).
 */

import {
  AiContentError,
  AI_CONTENT_LIMITS,
  POOL_LEVEL_DIFFICULTY,
  utf8ByteLength,
  type PoolCounts,
  type PoolLevel,
  type QuestionType,
} from './aiContentCore.js';

/** Domanda proposta e validata (senza ID persistiti). */
export type ValidatedProposalQuestion =
  | {
      order: number;
      tipo: 'aperta';
      testo: string;
      difficolta: number;
      soluzione: string;
    }
  | {
      order: number;
      tipo: 'chiusa_singola' | 'chiusa_multipla';
      testo: string;
      difficolta: number;
      /** Testi delle opzioni, senza ID. */
      opzioni: string[];
      /** Indici (0-based) delle opzioni corrette. */
      soluzioneIndici: number[];
    };

export interface ValidatedPoolProposal {
  questions: ValidatedProposalQuestion[];
}

/**
 * Campi tecnici/ID che il modello **non** deve produrre: se presenti, l'output è
 * rifiutato integralmente (mai considerati autorevoli).
 */
const FORBIDDEN_QUESTION_KEYS = [
  'id',
  'questionLocalId',
  'optionId',
  'optionIds',
  'maxPoints',
  'peso',
];

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AiContentError('provider_invalid_output', 'Struttura della domanda non valida.');
  }
  return value as Record<string, unknown>;
}

function assertNoForbiddenKeys(obj: Record<string, unknown>): void {
  for (const key of FORBIDDEN_QUESTION_KEYS) {
    if (key in obj) {
      throw new AiContentError(
        'provider_invalid_output',
        'La proposta contiene campi tecnici non ammessi.',
      );
    }
  }
}

function nonEmptyString(value: unknown, msg: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AiContentError('provider_invalid_output', msg);
  }
  return value.trim();
}

/**
 * Valida la proposta pool del provider contro il payload richiesto.
 * @param output   Oggetto grezzo restituito dal provider (Structured Output).
 * @param counts   Conteggi esatti richiesti per tipo.
 * @param level    Stile del pool (range difficoltà).
 */
export function validatePoolProposal(
  output: unknown,
  counts: PoolCounts,
  level: PoolLevel,
): ValidatedPoolProposal {
  const root = asObject(output);
  const rawQuestions = root.questions;
  if (!Array.isArray(rawQuestions)) {
    throw new AiContentError('provider_invalid_output', 'Elenco domande mancante.');
  }
  const range = POOL_LEVEL_DIFFICULTY[level];
  const requestedTotal = counts.aperta + counts.chiusa_singola + counts.chiusa_multipla;
  if (rawQuestions.length !== requestedTotal) {
    throw new AiContentError(
      'provider_invalid_output',
      'Numero di domande diverso da quello richiesto.',
    );
  }

  const perType: Record<QuestionType, number> = {
    aperta: 0,
    chiusa_singola: 0,
    chiusa_multipla: 0,
  };
  const questions: ValidatedProposalQuestion[] = [];

  rawQuestions.forEach((raw, index) => {
    const q = asObject(raw);
    assertNoForbiddenKeys(q);
    const tipo = q.tipo;
    if (tipo !== 'aperta' && tipo !== 'chiusa_singola' && tipo !== 'chiusa_multipla') {
      throw new AiContentError('provider_invalid_output', 'Tipo di domanda non ammesso.');
    }
    const testo = nonEmptyString(q.testo, 'Testo della domanda mancante.');
    const difficolta = q.difficolta;
    if (
      typeof difficolta !== 'number' ||
      !Number.isInteger(difficolta) ||
      difficolta < range.min ||
      difficolta > range.max
    ) {
      throw new AiContentError(
        'provider_invalid_output',
        `Difficoltà fuori dall'intervallo ${range.min}–${range.max}.`,
      );
    }
    perType[tipo] += 1;

    if (tipo === 'aperta') {
      const soluzione = nonEmptyString(q.soluzione, 'Soluzione della domanda aperta mancante.');
      if ('opzioni' in q) {
        throw new AiContentError('provider_invalid_output', 'Una domanda aperta non ha opzioni.');
      }
      questions.push({ order: index, tipo, testo, difficolta, soluzione });
      return;
    }

    // chiuse: opzioni + soluzioneIndici
    if (!Array.isArray(q.opzioni) || q.opzioni.length < 2) {
      throw new AiContentError('provider_invalid_output', 'Servono almeno due opzioni.');
    }
    const opzioni = q.opzioni.map((o) => nonEmptyString(o, 'Opzione vuota non ammessa.'));
    const lowered = opzioni.map((o) => o.toLowerCase());
    if (new Set(lowered).size !== lowered.length) {
      throw new AiContentError(
        'provider_invalid_output',
        'Le opzioni non possono essere duplicate.',
      );
    }
    const soluzione = q.soluzione;
    if (!Array.isArray(soluzione) || soluzione.length === 0) {
      throw new AiContentError(
        'provider_invalid_output',
        'Soluzione della domanda chiusa mancante.',
      );
    }
    const soluzioneIndici = soluzione.map((s) => {
      if (typeof s !== 'number' || !Number.isInteger(s) || s < 0 || s >= opzioni.length) {
        throw new AiContentError(
          'provider_invalid_output',
          'La soluzione deve riferirsi alle opzioni fornite.',
        );
      }
      return s;
    });
    if (new Set(soluzioneIndici).size !== soluzioneIndici.length) {
      throw new AiContentError('provider_invalid_output', 'Indici soluzione duplicati.');
    }
    if (tipo === 'chiusa_singola' && soluzioneIndici.length !== 1) {
      throw new AiContentError(
        'provider_invalid_output',
        'Una risposta singola ha esattamente una soluzione.',
      );
    }
    // AIGEN-PROMPT-01: una multipla **generata dall'IA** deve avere almeno due
    // soluzioni corrette e almeno una opzione errata (selezionare tutto non è
    // corretto). Restrizione sulla sola proposta IA: il contratto canonico del
    // pool e gli editor esistenti non cambiano.
    if (tipo === 'chiusa_multipla') {
      if (soluzioneIndici.length < 2) {
        throw new AiContentError(
          'provider_invalid_output',
          'Una risposta multipla generata deve avere almeno due soluzioni corrette.',
        );
      }
      if (soluzioneIndici.length >= opzioni.length) {
        throw new AiContentError(
          'provider_invalid_output',
          'Una risposta multipla generata deve avere almeno una opzione errata.',
        );
      }
    }
    questions.push({ order: index, tipo, testo, difficolta, opzioni, soluzioneIndici });
  });

  if (
    perType.aperta !== counts.aperta ||
    perType.chiusa_singola !== counts.chiusa_singola ||
    perType.chiusa_multipla !== counts.chiusa_multipla
  ) {
    throw new AiContentError(
      'provider_invalid_output',
      'La distribuzione dei tipi non corrisponde a quella richiesta.',
    );
  }

  // Cap dimensionale dell'output persistito.
  if (utf8ByteLength(JSON.stringify({ questions })) > AI_CONTENT_LIMITS.MAX_POOL_OUTPUT_BYTES) {
    throw new AiContentError('output_too_large', 'Le domande generate superano il limite.');
  }

  return { questions };
}

// ─── Lezione ──────────────────────────────────────────────────────────────────

const FRONT_MATTER_RE = /^\uFEFF?\s*---\s*\n/;
const DANGEROUS_HTML_RE = /<\s*(script|style|iframe|object|embed)\b/i;

export interface ValidatedLessonProposal {
  body: string;
}

/**
 * Valida il corpo Markdown generato. **Nessuna garanzia regex assoluta contro
 * l'HTML**: la difesa autoritativa resta la sanitizzazione del renderer (web).
 * Qui si rifiutano soltanto segnali espliciti di output non conforme (front
 * matter YAML, blocchi pericolosi noti), oltre a UTF-8/dimensione.
 */
export function validateLessonProposal(output: unknown): ValidatedLessonProposal {
  const root = asObject(output);
  const body = root.body;
  if (typeof body !== 'string' || body.trim().length === 0) {
    throw new AiContentError('provider_invalid_output', 'Corpo della lezione mancante.');
  }
  if (FRONT_MATTER_RE.test(body)) {
    throw new AiContentError(
      'provider_invalid_output',
      'Il corpo non deve contenere front matter.',
    );
  }
  if (DANGEROUS_HTML_RE.test(body)) {
    throw new AiContentError('provider_invalid_output', 'Il corpo contiene HTML non ammesso.');
  }
  if (utf8ByteLength(body) > AI_CONTENT_LIMITS.MAX_LESSON_OUTPUT_BYTES) {
    throw new AiContentError(
      'output_too_large',
      'La bozza generata supera il limite di dimensione.',
    );
  }
  return { body };
}
