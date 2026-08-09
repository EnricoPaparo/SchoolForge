import { describe, expect, it } from 'vitest';
import {
  AI_CONTENT_LIMITS,
  AiContentError,
  canonicalRequest,
  computeInputHash,
  validateAiContentRequest,
  type AiContentRequest,
  type ConceptMapRequest,
} from './aiContentCore.js';
import {
  CONCEPT_MAP_DISCLAIMER,
  composeConceptMapMarkdown,
  validateAndComposeConceptMap,
  validateConceptMapProposal,
} from './aiContentConceptMap.js';
import {
  AI_CONCEPT_MAP_PROMPT_VERSION,
  AI_CONTENT_PROMPT_VERSION,
  CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS,
  buildConceptMapPrompt,
} from './aiContentPrompt.js';
import {
  CONCEPT_MAP_OUTPUT_SCHEMA,
  CONCEPT_MAP_OUTPUT_TOKENS,
  buildContentStructuredRequest,
  resolveMaxOutputTokens,
} from './aiContentPayload.js';
import { parseStoredRunDocument, serializeRun } from './aiContentRunDoc.js';
import { createContentProvider } from './aiContentProvider.js';
import type { StoredAiContentRun } from './aiContentEngine.js';

/**
 * CONCEPT-MAP-01 — il valore di questo pacchetto sta in due garanzie, e i test
 * difendono soprattutto quelle:
 *
 * 1. la struttura dell'artefatto non dipende dal prompt ma dal server;
 * 2. l'aggiunta di un terzo kind non sposta un byte di pool e lezione.
 *
 * La seconda è la più facile da rompere senza accorgersene: `inputHash` è la
 * chiave di replay dei run già memorizzati, quindi due hash sono congelati come
 * costanti. Se cambiano, il replay di tutte le generazioni precedenti è saltato.
 */

const CONCEPT_MAP_REQUEST_ID = '33333333-3333-4333-8333-333333333333';

function conceptMapPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'concept_map',
    requestId: CONCEPT_MAP_REQUEST_ID,
    modelProfile: 'economy',
    lessonBody: '## La densità\n\nLa densità è il rapporto fra massa e volume.',
    ...over,
  };
}

function conceptMapRequest(over: Record<string, unknown> = {}): ConceptMapRequest {
  return validateAiContentRequest(conceptMapPayload(over)) as ConceptMapRequest;
}

/** Output del provider strutturalmente valido, usato come base dei casi negativi. */
function proposal(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    outlineMarkdown: '- densità\n  - massa ──divisa per──▶ volume',
    summaryMarkdown: 'La densità lega massa e volume di un corpo.',
    diagram: 'DENSITÀ\n└─ massa ──divisa per──▶ volume',
    ...over,
  };
}

describe('payload della mappa concettuale', () => {
  it('accetta il payload minimo e non trattiene altro', () => {
    const request = conceptMapRequest();
    expect(request.kind).toBe('concept_map');
    expect(request.modelProfile).toBe('economy');
    expect(Object.keys(request).sort()).toEqual([
      'kind',
      'lessonBody',
      'modelProfile',
      'requestId',
    ]);
  });

  it('rifiuta il profilo quality invece di degradarlo a economy', () => {
    // Il punto non è che `quality` sia costoso: è che un profilo non richiesto
    // non deve poter essere scelto in silenzio, in nessuna delle due direzioni.
    expect(() => conceptMapRequest({ modelProfile: 'quality' })).toThrow(AiContentError);
    expect(() => conceptMapRequest({ modelProfile: 'quality' })).toThrow(/profilo economico/);
  });

  it.each([
    ['teacherGuidance', { teacherGuidance: 'Insisti sui prerequisiti.' }],
    ['titolo', { titolo: 'La densità' }],
    ['udaContext', { udaContext: { title: 'Grandezze' } }],
    ['depth', { depth: 'complete' }],
    ['model', { model: 'gpt-5.6-luna' }],
    ['ownerUid', { ownerUid: 'uid-docente' }],
  ])('rifiuta la proprietà extra %s', (_label, extra) => {
    expect(() => conceptMapRequest(extra)).toThrow(/proprietà non ammesse/);
  });

  it('rifiuta un corpo assente, vuoto o di soli spazi', () => {
    expect(() => conceptMapRequest({ lessonBody: undefined })).toThrow(/mancante o vuoto/);
    expect(() => conceptMapRequest({ lessonBody: '' })).toThrow(/mancante o vuoto/);
    expect(() => conceptMapRequest({ lessonBody: '   \n\t ' })).toThrow(/mancante o vuoto/);
    expect(() => conceptMapRequest({ lessonBody: 42 })).toThrow(/mancante o vuoto/);
  });

  it('applica lo stesso cap del sorgente lezione (200.000 byte)', () => {
    const justUnder = 'a'.repeat(AI_CONTENT_LIMITS.MAX_LESSON_SOURCE_BYTES);
    expect(() => conceptMapRequest({ lessonBody: justUnder })).not.toThrow();
    const justOver = 'a'.repeat(AI_CONTENT_LIMITS.MAX_LESSON_SOURCE_BYTES + 1);
    expect(() => conceptMapRequest({ lessonBody: justOver })).toThrow(/troppo grande/);
  });

  it('rifiuta un requestId non UUID come gli altri contenuti', () => {
    expect(() => conceptMapRequest({ requestId: 'non-un-uuid' })).toThrow(/requestId/);
  });

  it('non normalizza il corpo: al prompt arriva esattamente ciò che è salvato', () => {
    const body = '  ## Titolo\n\n   testo indentato  \n';
    expect(conceptMapRequest({ lessonBody: body }).lessonBody).toBe(body);
  });
});

describe('inputHash e idempotenza', () => {
  it('cambia se cambia il corpo della lezione', () => {
    const a = computeInputHash(conceptMapRequest({ lessonBody: 'Corpo A' }));
    const b = computeInputHash(conceptMapRequest({ lessonBody: 'Corpo B' }));
    expect(a).not.toBe(b);
  });

  it('è stabile a parità di payload e non dipende dalla requestId', () => {
    const a = computeInputHash(conceptMapRequest());
    const b = computeInputHash(
      conceptMapRequest({ requestId: '44444444-4444-4444-8444-444444444444' }),
    );
    expect(a).toBe(b);
  });

  it('non collide con una lezione che contenga lo stesso testo', () => {
    const map = canonicalRequest(conceptMapRequest({ lessonBody: 'Testo condiviso' }));
    expect(map).toContain('"kind":"concept_map"');
    expect(map).not.toContain('"depth"');
    expect(map).not.toContain('"teacherGuidance"');
  });
});

describe('non-regressione di pool e lezione', () => {
  // Hash congelati: un cambiamento nella forma canonica di pool o lezione
  // invaliderebbe in silenzio il replay di ogni run già memorizzato. Se questi
  // test falliscono, la domanda non è «aggiorno la costante?» ma «perché la
  // serializzazione è cambiata?».
  const POOL_INPUT_HASH = 'e4636cb932697c7bfb22a66e1954855b50382e10d02d97b5de193b822df179b3';
  const LESSON_INPUT_HASH = '2c0dacd58d9ed5304fd964ed973e8c21a370824ef973ab367ed79ba64485798f';

  function poolRequest(): AiContentRequest {
    return validateAiContentRequest({
      kind: 'pool',
      requestId: '11111111-1111-4111-8111-111111111111',
      modelProfile: 'economy',
      teacherGuidance: null,
      level: 'balanced',
      counts: { aperta: 1, chiusa_singola: 1, chiusa_multipla: 1 },
      lessonSource: 'Corpo della lezione di prova.',
      existingPoolQuestionCount: 0,
    });
  }

  function lessonRequest(): AiContentRequest {
    return validateAiContentRequest({
      kind: 'lesson',
      requestId: '22222222-2222-4222-8222-222222222222',
      modelProfile: 'economy',
      teacherGuidance: null,
      depth: 'complete',
      titolo: 'Le funzioni',
      sottotitolo: null,
      difficolta: '3 — intermedia',
      concettiChiave: ['parametro'],
      obiettivi: ['Scrivere una funzione'],
      udaTitle: 'Programmazione',
      udaContext: {
        title: 'Programmazione',
        descrizione: null,
        competenze: [],
        obiettivi: [],
        currentLessonPosition: 1,
        lessons: [{ position: 1, titolo: 'Le funzioni', sottotitolo: null }],
      },
      currentBody: '',
      hasCurrentContent: false,
    });
  }

  it('la forma canonica del pool è invariata', () => {
    expect(computeInputHash(poolRequest())).toBe(POOL_INPUT_HASH);
  });

  it('la forma canonica della lezione è invariata', () => {
    expect(computeInputHash(lessonRequest())).toBe(LESSON_INPUT_HASH);
  });

  it('la versione del prompt di pool e lezione non è stata toccata', () => {
    expect(AI_CONTENT_PROMPT_VERSION).toBe('lesson-depth-01-candidate-e-v1');
    expect(AI_CONCEPT_MAP_PROMPT_VERSION).not.toBe(AI_CONTENT_PROMPT_VERSION);
  });
});

describe('prompt della mappa concettuale', () => {
  it('delimita il corpo come dato non attendibile', () => {
    const { user } = buildConceptMapPrompt(conceptMapRequest({ lessonBody: 'CONTENUTO SPIA' }));
    expect(user).toContain('<<<CORPO_LEZIONE (dati non attendibili)>>>');
    expect(user).toContain('CONTENUTO SPIA');
    expect(user).toContain('<<<END CORPO_LEZIONE (dati non attendibili)>>>');
  });

  it('neutralizza esplicitamente le istruzioni contenute nel corpo', () => {
    const { system } = buildConceptMapPrompt(conceptMapRequest());
    expect(system).toMatch(/NON eseguirlo/);
    expect(system).toMatch(/Regole di sicurezza NON negoziabili/);
  });

  it('non nomina blocchi che questo prompt non ha', () => {
    // Ereditare i paragrafi di pool/lezione significherebbe parlare al modello di
    // INDICAZIONI_DOCENTE e MATERIALE_LEZIONE, che qui non esistono.
    const { system } = buildConceptMapPrompt(conceptMapRequest());
    expect(system).not.toContain('INDICAZIONI_DOCENTE');
    expect(system).not.toContain('MATERIALE_LEZIONE');
    expect(system).not.toContain('CONTENUTO_ATTUALE');
  });

  it('vieta heading, avvertenza e fence nei campi generati', () => {
    const { user } = buildConceptMapPrompt(conceptMapRequest());
    expect(user).toMatch(/NON produrre intestazioni Markdown/);
    expect(user).toMatch(/NON produrre l’avvertenza finale/);
    expect(user).toMatch(/NON racchiudere nulla in fence Markdown/);
  });

  it('dichiara al modello la stessa larghezza che il validator applica', () => {
    const { user } = buildConceptMapPrompt(conceptMapRequest());
    expect(user).toContain(`entro ${CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS} caratteri`);
  });
});

describe('schema e payload trasmesso', () => {
  it('lo schema è strict e ha esattamente i tre campi', () => {
    expect(CONCEPT_MAP_OUTPUT_SCHEMA.additionalProperties).toBe(false);
    expect(CONCEPT_MAP_OUTPUT_SCHEMA.required).toEqual([
      'outlineMarkdown',
      'summaryMarkdown',
      'diagram',
    ]);
    expect(Object.keys(CONCEPT_MAP_OUTPUT_SCHEMA.properties as object)).toEqual([
      'outlineMarkdown',
      'summaryMarkdown',
      'diagram',
    ]);
  });

  it('il tetto di output è stretto e dichiarato', () => {
    expect(CONCEPT_MAP_OUTPUT_TOKENS).toBe(2_000);
    expect(resolveMaxOutputTokens(conceptMapRequest())).toBe(CONCEPT_MAP_OUTPUT_TOKENS);
  });

  it('la richiesta trasmessa usa schema e prompt della mappa', () => {
    const built = buildContentStructuredRequest(conceptMapRequest(), 'gpt-5.6-luna');
    expect(built.max_output_tokens).toBe(CONCEPT_MAP_OUTPUT_TOKENS);
    expect(built.text.format.schema).toEqual(CONCEPT_MAP_OUTPUT_SCHEMA);
    expect(built.store).toBe(false);
    expect(JSON.stringify(built)).toContain('CORPO_LEZIONE');
  });
});

describe('validazione dell’output', () => {
  it('accetta una proposta conforme e ne restituisce i tre campi', () => {
    const parts = validateConceptMapProposal(proposal());
    expect(parts.outlineMarkdown).toContain('densità');
    expect(parts.diagram).toContain('DENSITÀ');
  });

  it.each(['outlineMarkdown', 'summaryMarkdown', 'diagram'])(
    'rifiuta %s mancante o vuoto',
    (field) => {
      expect(() => validateConceptMapProposal(proposal({ [field]: '' }))).toThrow(/incompleta/);
      expect(() => validateConceptMapProposal(proposal({ [field]: '   ' }))).toThrow(/incompleta/);
      expect(() => validateConceptMapProposal(proposal({ [field]: undefined }))).toThrow(
        /incompleta/,
      );
    },
  );

  it('rifiuta proprietà extra, anche innocue', () => {
    expect(() => validateConceptMapProposal(proposal({ note: 'extra' }))).toThrow(
      /campi non ammessi/,
    );
    expect(() => validateConceptMapProposal(proposal({ disclaimer: 'mia avvertenza' }))).toThrow(
      /campi non ammessi/,
    );
  });

  it('rifiuta le fence prodotte dal modello in qualunque campo', () => {
    // Una fence dentro il diagramma chiuderebbe a metà il blocco ```text
    // composto dal server: l'output *sembrerebbe* valido e non lo sarebbe.
    for (const field of ['outlineMarkdown', 'summaryMarkdown', 'diagram']) {
      expect(() => validateConceptMapProposal(proposal({ [field]: 'testo\n```\naltro' }))).toThrow(
        /blocchi di codice/,
      );
    }
  });

  it('rifiuta front matter e HTML pericoloso', () => {
    expect(() =>
      validateConceptMapProposal(proposal({ summaryMarkdown: '---\ntitolo: x\n' })),
    ).toThrow(/front matter/);
    expect(() =>
      validateConceptMapProposal(proposal({ outlineMarkdown: '- <script>alert(1)</script>' })),
    ).toThrow(/HTML non ammesso/);
  });

  it('rifiuta una riga del diagramma oltre la larghezza massima, senza troncarla', () => {
    const wide = 'A'.repeat(CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS + 1);
    expect(() => validateConceptMapProposal(proposal({ diagram: wide }))).toThrow(
      /supera 80 caratteri per riga/,
    );
    const exact = 'A'.repeat(CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS);
    expect(() => validateConceptMapProposal(proposal({ diagram: exact }))).not.toThrow();
  });

  it('conta i caratteri di disegno una volta sola', () => {
    // 40 «▶» sono 40 caratteri per chi legge, non 80 unità UTF-16.
    const arrows = '▶'.repeat(40);
    expect(() => validateConceptMapProposal(proposal({ diagram: arrows }))).not.toThrow();
  });

  it('rifiuta un output non oggetto', () => {
    for (const value of [null, 'testo', 42, ['a']]) {
      expect(() => validateConceptMapProposal(value)).toThrow(/Struttura della mappa/);
    }
  });
});

describe('composizione del Markdown canonico', () => {
  it('produce esattamente le quattro parti, nell’ordine fisso', () => {
    const markdown = composeConceptMapMarkdown({
      outlineMarkdown: '- primo',
      summaryMarkdown: 'Sintesi.',
      diagram: 'RADICE\n└─ foglia',
    });
    expect(markdown).toBe(
      [
        '## Ossatura della lezione',
        '',
        '- primo',
        '',
        '## Sintesi',
        '',
        'Sintesi.',
        '',
        '## Diagramma',
        '',
        '```text',
        'RADICE',
        '└─ foglia',
        '```',
        '',
        '> [!IMPORTANT]',
        `> ${CONCEPT_MAP_DISCLAIMER}`,
        '',
      ].join('\n'),
    );
  });

  it('l’avvertenza è una costante del server, non testo generato', () => {
    const markdown = composeConceptMapMarkdown(validateConceptMapProposal(proposal()));
    expect(markdown).toContain(CONCEPT_MAP_DISCLAIMER);
    expect(markdown).toContain('> [!IMPORTANT]');
  });

  it('l’ordine non dipende dall’ordine dei campi ricevuti', () => {
    const a = composeConceptMapMarkdown(validateConceptMapProposal(proposal()));
    const reordered = {
      diagram: proposal().diagram,
      summaryMarkdown: proposal().summaryMarkdown,
      outlineMarkdown: proposal().outlineMarkdown,
    };
    const b = composeConceptMapMarkdown(validateConceptMapProposal(reordered));
    expect(a).toBe(b);
  });

  it('applica il cap dimensionale sul documento composto', () => {
    const huge = Array.from({ length: 900 }, () => 'x'.repeat(60)).join('\n');
    expect(() => validateAndComposeConceptMap(proposal({ summaryMarkdown: huge }))).toThrow(
      /supera il limite/,
    );
  });

  it('valida e compone in un passaggio solo', () => {
    const composed = validateAndComposeConceptMap(proposal());
    expect(composed.conceptMapMarkdown).toContain('## Ossatura della lezione');
    expect(composed.conceptMapMarkdown).toContain(CONCEPT_MAP_DISCLAIMER);
    expect(composed.diagram).toContain('DENSITÀ');
  });
});

describe('documento run', () => {
  const SAMPLE_RUN: StoredAiContentRun = {
    contractVersion: 1,
    kind: 'concept_map',
    status: 'completed',
    inputHash: 'a'.repeat(64),
    modelProfile: 'economy',
    model: 'gpt-5.6-luna',
    priceListVersion: 'v5-2026-07-20-luna-dev',
    estimatedInputTokens: 100,
    maxOutputTokens: CONCEPT_MAP_OUTPUT_TOKENS,
    actualInputTokens: 100,
    actualOutputTokens: 200,
    estimatedCostMicroUsd: 10,
    reservedCostMicroUsd: 20,
    settledCostMicroUsd: 10,
    actualCostMicroUsd: 10,
    leaseExecutionId: 'exec-1',
    leaseExpiresAtMs: 1_000,
    output: null,
    createdAtMs: 1,
    updatedAtMs: 1,
    expireAtMs: 100_000,
  };

  it('accetta un run completato con il Markdown canonico', () => {
    const doc = serializeRun({
      ...SAMPLE_RUN,
      output: { conceptMapMarkdown: '## Ossatura della lezione\n\n- primo\n' },
    });
    expect(parseStoredRunDocument(doc)).not.toBeNull();
  });

  it('rifiuta i tre campi grezzi al posto del documento composto', () => {
    const doc = serializeRun({ ...SAMPLE_RUN, output: proposal() });
    expect(parseStoredRunDocument(doc)).toBeNull();
  });

  it('rifiuta output scambiati con gli altri kind', () => {
    expect(
      parseStoredRunDocument(serializeRun({ ...SAMPLE_RUN, output: { body: 'x' } })),
    ).toBeNull();
    expect(
      parseStoredRunDocument(serializeRun({ ...SAMPLE_RUN, output: { questions: [{}] } })),
    ).toBeNull();
    expect(
      parseStoredRunDocument(
        serializeRun({ ...SAMPLE_RUN, kind: 'lesson', output: { conceptMapMarkdown: 'x' } }),
      ),
    ).toBeNull();
  });

  it('rifiuta un Markdown vuoto o oltre il cap', () => {
    expect(
      parseStoredRunDocument(serializeRun({ ...SAMPLE_RUN, output: { conceptMapMarkdown: '  ' } })),
    ).toBeNull();
    const tooBig = 'x'.repeat(AI_CONTENT_LIMITS.MAX_CONCEPT_MAP_OUTPUT_BYTES + 1);
    expect(
      parseStoredRunDocument(
        serializeRun({ ...SAMPLE_RUN, output: { conceptMapMarkdown: tooBig } }),
      ),
    ).toBeNull();
  });
});

describe('provider mock', () => {
  it('produce un output che il validator reale accetta', async () => {
    const provider = createContentProvider({ mode: 'mock' });
    const outcome = await provider.generate(conceptMapRequest(), 'gpt-5.6-luna');
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    const composed = validateAndComposeConceptMap(outcome.output);
    expect(composed.conceptMapMarkdown).toContain('## Diagramma');
    // Il mock non genera costo: mai un costo inventato.
    expect(outcome.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(outcome.metered).toBe(false);
  });
});
