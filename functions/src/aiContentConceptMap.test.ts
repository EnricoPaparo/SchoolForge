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
  CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS,
  CONCEPT_MAP_DISCLAIMER,
  composeConceptMapMarkdown,
  isValidStoredConceptMapOutput,
  parseCanonicalConceptMapMarkdown,
  validateAndComposeConceptMap,
  validateConceptMapProposal,
  validateStoredConceptMapOutput,
} from './aiContentConceptMap.js';
import {
  AI_CONCEPT_MAP_PROMPT_VERSION,
  AI_CONTENT_PROMPT_VERSION,
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
 * CONCEPT-MAP-01 — il valore di questo pacchetto sta in tre garanzie, e i test
 * difendono soprattutto quelle:
 *
 * 1. la struttura dell'artefatto non dipende dal prompt ma dal server;
 * 2. un documento accettato in **replay** è indistinguibile da uno appena
 *    prodotto: non basta che sia una stringa non vuota;
 * 3. l'aggiunta di un terzo kind non sposta un byte di pool e lezione.
 *
 * La terza è la più facile da rompere senza accorgersene: `inputHash` è la
 * chiave di replay dei run già memorizzati, quindi due hash sono congelati come
 * costanti. Se cambiano, il replay di tutte le generazioni precedenti è saltato.
 */

const CONCEPT_MAP_REQUEST_ID = '33333333-3333-4333-8333-333333333333';

function conceptMapPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'concept_map',
    requestId: CONCEPT_MAP_REQUEST_ID,
    modelProfile: 'quality',
    lessonBody: '## La densità\n\nLa densità è il rapporto fra massa e volume.',
    ...over,
  };
}

function conceptMapRequest(over: Record<string, unknown> = {}): ConceptMapRequest {
  return validateAiContentRequest(conceptMapPayload(over)) as ConceptMapRequest;
}

/** Output del provider strutturalmente valido (v2), base di ogni caso negativo. */
function proposal(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    summaryMarkdown: 'La densità lega massa e volume di un corpo.',
    diagram: 'DENSITÀ\n└─ massa ──divisa per──▶ volume',
    ...over,
  };
}

/** Documento canonico v2 di riferimento, prodotto dalla composizione reale. */
function canonicalMarkdown(over: Record<string, unknown> = {}): string {
  return validateAndComposeConceptMap(proposal(over)).conceptMapMarkdown;
}

/**
 * Documento canonico **v1**, scritto a mano perché il compositore non è più in
 * grado di produrlo: è esattamente ciò che si trova nelle mappe già salvate.
 */
function legacyMarkdown(
  over: { outline?: string; summary?: string; diagram?: string } = {},
): string {
  const outline = over.outline ?? '- densità\n  - massa ──divisa per──▶ volume';
  const summary = over.summary ?? 'La densità lega massa e volume di un corpo.';
  const diagram = over.diagram ?? 'DENSITÀ\n└─ massa ──divisa per──▶ volume';
  return [
    '## Ossatura della lezione',
    '',
    outline,
    '',
    '## Sintesi',
    '',
    summary,
    '',
    '## Diagramma',
    '',
    '```text',
    diagram,
    '```',
    '',
    '> [!IMPORTANT]',
    `> ${CONCEPT_MAP_DISCLAIMER}`,
    '',
  ].join('\n');
}

// ─── Payload ──────────────────────────────────────────────────────────────────

describe('payload della mappa concettuale', () => {
  it('accetta il payload minimo e non trattiene altro', () => {
    const request = conceptMapRequest();
    expect(request.kind).toBe('concept_map');
    expect(request.modelProfile).toBe('quality');
    expect(Object.keys(request).sort()).toEqual([
      'kind',
      'lessonBody',
      'modelProfile',
      'requestId',
    ]);
  });

  it.each(['economy', 'quality'] as const)('accetta il profilo chiuso %s', (modelProfile) => {
    expect(conceptMapRequest({ modelProfile }).modelProfile).toBe(modelProfile);
  });

  it('rifiuta un profilo sconosciuto senza fallback', () => {
    expect(() => conceptMapRequest({ modelProfile: 'ultra' })).toThrow(AiContentError);
    expect(() => conceptMapRequest({ modelProfile: 'ultra' })).toThrow(/Profilo modello/);
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
  it('il profilo resta parte della richiesta canonica e cambia l’hash', () => {
    const economy = conceptMapRequest({ modelProfile: 'economy' });
    const quality = conceptMapRequest({ modelProfile: 'quality' });
    expect(canonicalRequest(economy)).toContain('"modelProfile":"economy"');
    expect(canonicalRequest(quality)).toContain('"modelProfile":"quality"');
    expect(computeInputHash(economy)).not.toBe(computeInputHash(quality));
  });

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
  // POOL-ROLLOUT-01: stessa forma canonica storica, fissata sul solo profilo
  // ora valido per il kind pool.
  const POOL_INPUT_HASH = '0938486c38232b6c997e4bb365bbaa8764dddedeb4de58db5e1a2f9fa528967f';
  const LESSON_INPUT_HASH = '2c0dacd58d9ed5304fd964ed973e8c21a370824ef973ab367ed79ba64485798f';

  function poolRequest(): AiContentRequest {
    return validateAiContentRequest({
      kind: 'pool',
      requestId: '11111111-1111-4111-8111-111111111111',
      modelProfile: 'quality',
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

  it('il pool accetta il profilo Quality qualificato', () => {
    expect(poolRequest().modelProfile).toBe('quality');
  });

  it('il pool rifiuta Economy senza fallback', () => {
    expect(() =>
      validateAiContentRequest({
        ...poolRequest(),
        modelProfile: 'economy',
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_input' }));
  });

  it('la lezione accetta ancora economy', () => {
    expect(lessonRequest().modelProfile).toBe('economy');
  });

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

// ─── Prompt e payload trasmesso ───────────────────────────────────────────────

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

  it('chiede due campi e non nomina più l’ossatura', () => {
    const { user } = buildConceptMapPrompt(conceptMapRequest());
    expect(user).toContain('Restituisci esattamente due campi.');
    expect(user).not.toContain('outlineMarkdown');
    expect(user).not.toMatch(/ossatura/i);
  });

  it('chiede una sintesi ragionata con compressione didattica, senza cap editoriale', () => {
    const { user } = buildConceptMapPrompt(conceptMapRequest());
    // Nessun limite rigido: la compressione nasce dalla selezione dei nuclei e
    // delle relazioni, non dal taglio arbitrario di parole o paragrafi.
    expect(user).not.toMatch(/poche righe/);
    expect(user).toMatch(/RAGIONATA/);
    expect(user).toMatch(/cause, conseguenze, dipendenze/);
    expect(user).toMatch(/sostanzialmente più breve del CORPO_LEZIONE/i);
    expect(user).toMatch(/non esiste un numero\s+obbligatorio di paragrafi o caratteri/i);
    expect(user).toMatch(/selezione, gerarchia e relazioni/i);
    expect(user).toMatch(/NIENTE elenchi/);
  });

  it('impedisce che la sintesi diventi una seconda lezione', () => {
    const { user } = buildConceptMapPrompt(conceptMapRequest());
    expect(user).toMatch(/non una mini-lezione/i);
    expect(user).toMatch(/al massimo UN esempio/i);
    expect(user).toMatch(/non riprodurre serie di esempi/i);
    expect(user).toMatch(/prezzi, modelli commerciali, aneddoti/i);
    expect(user).toMatch(/non aggiungere un riepilogo finale/i);
    expect(user).not.toMatch(/copri TUTTI i concetti portanti/i);
    expect(user).not.toMatch(/una lezione complessa merita una sintesi lunga/i);
  });

  it('chiede un diagramma selettivo e relazioni non assolutizzate', () => {
    const { user } = buildConceptMapPrompt(conceptMapRequest());
    expect(user).toMatch(/QUATTRO a SETTE nodi principali/);
    expect(user).toMatch(/non tutti i dettagli/);
    expect(user).toMatch(/non presentare come\s+universale una relazione/i);
    expect(user).toMatch(/completarsi, non duplicarsi/i);
  });

  it('la versione del prompt della mappa è stata incrementata', () => {
    // Il prompt è cambiato in modo sostanziale: lasciare la versione precedente
    // renderebbe indistinguibili due contratti diversi.
    expect(AI_CONCEPT_MAP_PROMPT_VERSION).toBe('concept-map-07-v1');
  });
});

describe('schema e payload trasmesso', () => {
  it('lo schema è strict e ha esattamente i due campi v2', () => {
    expect(CONCEPT_MAP_OUTPUT_SCHEMA.additionalProperties).toBe(false);
    expect(CONCEPT_MAP_OUTPUT_SCHEMA.required).toEqual(['summaryMarkdown', 'diagram']);
    expect(Object.keys(CONCEPT_MAP_OUTPUT_SCHEMA.properties as object)).toEqual([
      'summaryMarkdown',
      'diagram',
    ]);
  });

  it('lo schema non ammette più outlineMarkdown', () => {
    expect(JSON.stringify(CONCEPT_MAP_OUTPUT_SCHEMA)).not.toContain('outlineMarkdown');
  });

  it('il margine tecnico di output è dichiarato e non modifica il cap del documento', () => {
    expect(CONCEPT_MAP_OUTPUT_TOKENS).toBe(6_000);
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

// ─── Contratto dei due campi ──────────────────────────────────────────────────

describe('contratto dei due campi — struttura', () => {
  it('accetta una proposta conforme e restituisce i valori identici', () => {
    const input = proposal();
    const parts = validateConceptMapProposal(input);
    expect(parts.summaryMarkdown).toBe(input.summaryMarkdown);
    expect(parts.diagram).toBe(input.diagram);
    expect(Object.keys(parts).sort()).toEqual(['diagram', 'summaryMarkdown']);
  });

  it('rifiuta outlineMarkdown come qualunque altra proprietà extra', () => {
    // È il campo che il modello potrebbe ancora produrre per abitudine: deve
    // essere rifiutato come tutti gli altri, non ignorato in silenzio.
    expect(() => validateConceptMapProposal(proposal({ outlineMarkdown: '- una voce' }))).toThrow(
      /campi non ammessi/,
    );
  });

  it.each(['summaryMarkdown', 'diagram'])('rifiuta %s mancante o vuoto', (field) => {
    expect(() => validateConceptMapProposal(proposal({ [field]: '' }))).toThrow(/incompleta/);
    expect(() => validateConceptMapProposal(proposal({ [field]: '   ' }))).toThrow(/incompleta/);
    expect(() => validateConceptMapProposal(proposal({ [field]: undefined }))).toThrow(
      /incompleta/,
    );
  });

  it('rifiuta proprietà extra, anche innocue', () => {
    expect(() => validateConceptMapProposal(proposal({ note: 'extra' }))).toThrow(
      /campi non ammessi/,
    );
    expect(() => validateConceptMapProposal(proposal({ disclaimer: 'mia avvertenza' }))).toThrow(
      /campi non ammessi/,
    );
  });

  it('rifiuta un output non oggetto', () => {
    for (const value of [null, 'testo', 42, ['a']]) {
      expect(() => validateConceptMapProposal(value)).toThrow(/Struttura della mappa/);
    }
  });
});

describe('contratto dei due campi — normalizzazione controllata del provider', () => {
  it('rimuove solo gli spazi esterni prima della composizione canonica', () => {
    const parts = validateConceptMapProposal(
      proposal({
        summaryMarkdown: '  Sintesi con spazi interni.  ',
        diagram: '\nRADICE ──▶ FIGLIO\n',
      }),
    );
    expect(parts).toEqual({
      summaryMarkdown: 'Sintesi con spazi interni.',
      diagram: 'RADICE ──▶ FIGLIO',
    });
    expect(composeConceptMapMarkdown(parts)).toContain(
      '## Sintesi\n\nSintesi con spazi interni.\n\n## Diagramma',
    );
  });

  it('conserva gli spazi interni e le righe vuote', () => {
    const summary = 'Primo  paragrafo.\n\nSecondo   paragrafo.';
    const parts = validateConceptMapProposal(proposal({ summaryMarkdown: summary }));
    expect(parts.summaryMarkdown).toBe(summary);
    expect(composeConceptMapMarkdown(parts)).toContain(summary);
  });
});

describe('contratto dei due campi — markup vietato', () => {
  it.each(['summaryMarkdown', 'diagram'])('rifiuta le fence in %s', (field) => {
    // Una fence dentro il diagramma chiuderebbe a metà il blocco ```text
    // composto dal server: l'output *sembrerebbe* valido e non lo sarebbe.
    expect(() => validateConceptMapProposal(proposal({ [field]: '- testo\n```\naltro' }))).toThrow(
      /blocchi di codice/,
    );
  });

  it('rifiuta gli heading ATX in entrambi i campi', () => {
    expect(() => validateConceptMapProposal(proposal({ summaryMarkdown: '# Titolo' }))).toThrow(
      /intestazioni non sono ammesse/,
    );
    expect(() => validateConceptMapProposal(proposal({ diagram: 'RADICE\n### nodo' }))).toThrow(
      /intestazioni non sono ammesse/,
    );
  });

  it('rifiuta gli heading Setext', () => {
    expect(() =>
      validateConceptMapProposal(proposal({ summaryMarkdown: 'Titolo\n======\nTesto.' })),
    ).toThrow(/intestazioni non sono ammesse/);
    expect(() =>
      validateConceptMapProposal(proposal({ summaryMarkdown: 'Titolo\n---\nTesto.' })),
    ).toThrow(/intestazioni non sono ammesse/);
  });

  it('rifiuta qualunque tag HTML, non solo script e iframe', () => {
    for (const html of [
      'Testo <b>grassetto</b>.',
      'Testo <div>contenuto</div>.',
      'Testo <img src="x.png">.',
      'Testo <span class="x">testo</span>.',
      'Testo <script>alert(1)</script>.',
    ]) {
      expect(() => validateConceptMapProposal(proposal({ summaryMarkdown: html }))).toThrow(
        /HTML non è ammesso/,
      );
    }
  });

  it('rifiuta commenti HTML, doctype e CDATA', () => {
    expect(() =>
      validateConceptMapProposal(proposal({ summaryMarkdown: 'Testo <!-- nota -->' })),
    ).toThrow(/HTML non è ammesso/);
    expect(() =>
      validateConceptMapProposal(proposal({ summaryMarkdown: '<!DOCTYPE html> testo' })),
    ).toThrow(/HTML non è ammesso/);
    expect(() =>
      validateConceptMapProposal(proposal({ summaryMarkdown: 'Testo <![CDATA[x]]>' })),
    ).toThrow(/HTML non è ammesso/);
  });

  it('non scambia per HTML un confronto matematico', () => {
    // Il vincolo serve a fermare markup, non aritmetica.
    for (const text of [
      'Se a < b allora la densità cresce.',
      'Vale x <= y e y >= z.',
      'Il rapporto 3 < 5 > 2 resta vero.',
    ]) {
      expect(() => validateConceptMapProposal(proposal({ summaryMarkdown: text }))).not.toThrow();
    }
  });

  it('rifiuta il front matter', () => {
    expect(() =>
      validateConceptMapProposal(proposal({ summaryMarkdown: '---\ntitolo: x' })),
    ).toThrow(/front matter/);
  });
});

/**
 * CONCEPT-MAP-05 — i contratti dell'ossatura non sono spariti con il campo: una
 * mappa v1 già salvata deve continuare a rispettarli per essere accettata in
 * replay. Sono quindi verificati attraverso la sola porta rimasta, il parser del
 * documento persistito, con gli stessi casi di prima.
 */
describe('forma dell’ossatura nelle mappe v1 già salvate', () => {
  it('rifiuta un’ossatura che sia prosa libera', () => {
    expect(() =>
      parseCanonicalConceptMapMarkdown(
        legacyMarkdown({ outline: 'La densità lega massa e volume.' }),
      ),
    ).toThrow(/voce di elenco/);
  });

  it('accetta una continuazione CommonMark lazy e la restituisce byte per byte', () => {
    const doc = legacyMarkdown({
      outline: '- densità ──dipende da──▶ massa e volume\nche descrivono la materia',
    });
    expect(parseCanonicalConceptMapMarkdown(doc)).toBe(doc);
  });

  it('accetta una continuazione indentata dopo una riga vuota', () => {
    const doc = legacyMarkdown({
      outline: '- densità ──dipende da──▶ massa e volume\n\n  che descrivono la materia',
    });
    expect(parseCanonicalConceptMapMarkdown(doc)).toBe(doc);
  });

  it('rifiuta un paragrafo non indentato dopo una riga vuota', () => {
    expect(() =>
      parseCanonicalConceptMapMarkdown(
        legacyMarkdown({ outline: '- densità\n\nprosa davvero fuori elenco' }),
      ),
    ).toThrow(/appartenere a una voce di elenco/);
  });

  it('accetta righe vuote fra due vere voci di elenco', () => {
    const doc = legacyMarkdown({ outline: '- densità\n\n- volume' });
    expect(parseCanonicalConceptMapMarkdown(doc)).toBe(doc);
  });

  it('accetta i tre marker di elenco ammessi', () => {
    for (const marker of ['-', '*', '+']) {
      const doc = legacyMarkdown({ outline: `${marker} radice\n    ${marker} figlio` });
      expect(parseCanonicalConceptMapMarkdown(doc)).toBe(doc);
    }
  });

  it('rifiuta un marker di elenco senza contenuto', () => {
    expect(() => parseCanonicalConceptMapMarkdown(legacyMarkdown({ outline: '-' }))).toThrow(
      /voce di elenco|struttura canonica/,
    );
  });
});

describe('contratto dei due campi — forma di ciascuna sezione', () => {
  it('rifiuta una sintesi scritta come elenco puntato', () => {
    expect(() =>
      validateConceptMapProposal(proposal({ summaryMarkdown: '- primo punto\n- secondo punto' })),
    ).toThrow(/prosa, non un elenco/);
  });

  it('rifiuta una sintesi scritta come elenco numerato', () => {
    expect(() =>
      validateConceptMapProposal(
        proposal({ summaryMarkdown: '1. Primo concetto\n2. Secondo concetto' }),
      ),
    ).toThrow(/prosa, non un elenco/);
  });

  it('rifiuta una sintesi in cui compare una sola voce numerata', () => {
    expect(() =>
      validateConceptMapProposal(
        proposal({ summaryMarkdown: 'La densità lega massa e volume.\n2) altro punto' }),
      ),
    ).toThrow(/prosa, non un elenco/);
  });

  it('rifiuta anche le voci numerate indentate', () => {
    expect(() =>
      validateConceptMapProposal(proposal({ summaryMarkdown: 'Testo.\n   3. terzo punto' })),
    ).toThrow(/prosa, non un elenco/);
  });

  it('non scambia per elenco un numero in mezzo alla prosa', () => {
    // Lo spazio dopo il marcatore è ciò che distingue «1. voce» da «3.14 è…».
    for (const text of [
      '2026 è un anno bisestile.',
      'Il valore 3.14 è approssimato.',
      'La densità dell’acqua è 1.0 g/cm³.',
      'Il capitolo 2) resta valido.',
    ]) {
      expect(() => validateConceptMapProposal(proposal({ summaryMarkdown: text }))).not.toThrow();
    }
  });

  it('rifiuta una sintesi anche solo parzialmente puntata', () => {
    expect(() =>
      validateConceptMapProposal(
        proposal({ summaryMarkdown: 'La densità lega massa e volume.\n- e anche altro' }),
      ),
    ).toThrow(/prosa, non un elenco/);
  });

  it('accetta una sintesi su più righe di prosa', () => {
    expect(() =>
      validateConceptMapProposal(
        proposal({ summaryMarkdown: 'Prima riga di prosa.\n\nSeconda riga di prosa.' }),
      ),
    ).not.toThrow();
  });

  it('rifiuta una riga del diagramma oltre la larghezza massima, senza troncarla', () => {
    const wide = 'A'.repeat(CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS + 1);
    expect(() => validateConceptMapProposal(proposal({ diagram: wide }))).toThrow(
      /supera 80 caratteri/,
    );
    const exact = 'A'.repeat(CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS);
    expect(() => validateConceptMapProposal(proposal({ diagram: exact }))).not.toThrow();
  });

  it('conta i caratteri di disegno una volta sola', () => {
    // 40 «▶» sono 40 caratteri per chi legge, non 80 unità UTF-16.
    expect(() => validateConceptMapProposal(proposal({ diagram: '▶'.repeat(40) }))).not.toThrow();
  });
});

// ─── Composizione ─────────────────────────────────────────────────────────────

describe('composizione del Markdown canonico', () => {
  it('produce esattamente le tre parti v2, nell’ordine fisso', () => {
    const markdown = composeConceptMapMarkdown({
      summaryMarkdown: 'Sintesi.',
      diagram: 'RADICE\n└─ foglia',
    });
    expect(markdown).toBe(
      [
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
    const markdown = canonicalMarkdown();
    expect(markdown).toContain(CONCEPT_MAP_DISCLAIMER);
    expect(markdown).toContain('> [!IMPORTANT]');
  });

  it('l’ordine non dipende dall’ordine dei campi ricevuti', () => {
    const base = proposal();
    const reordered = {
      diagram: base.diagram,
      summaryMarkdown: base.summaryMarkdown,
    };
    expect(composeConceptMapMarkdown(validateConceptMapProposal(reordered))).toBe(
      canonicalMarkdown(),
    );
  });

  it('applica il cap dimensionale sul documento composto', () => {
    const huge = Array.from({ length: 900 }, () => 'x'.repeat(60)).join('\n');
    expect(() => validateAndComposeConceptMap(proposal({ summaryMarkdown: huge }))).toThrow(
      /supera il limite/,
    );
  });
});

// ─── Documento persistito e replay ────────────────────────────────────────────

describe('validazione del Markdown persistito', () => {
  it('accetta il documento canonico e lo restituisce byte per byte', () => {
    const markdown = canonicalMarkdown();
    const returned = parseCanonicalConceptMapMarkdown(markdown);
    expect(returned).toBe(markdown);
    // Identità referenziale del contenuto: nessuna ricomposizione restituita.
    expect(Buffer.from(returned, 'utf8').equals(Buffer.from(markdown, 'utf8'))).toBe(true);
  });

  it('accetta e riproduce byte per byte un’ossatura con continuazione lazy', () => {
    const markdown = composeConceptMapMarkdown({
      outlineMarkdown: '- densità ──dipende da──▶ massa e volume\nche descrivono la materia',
      summaryMarkdown: 'La densità collega massa e volume.',
      diagram: 'DENSITÀ\n└─ dipende da ─▶ MASSA E VOLUME',
    });
    expect(parseCanonicalConceptMapMarkdown(markdown)).toBe(markdown);
    expect(isValidStoredConceptMapOutput({ conceptMapMarkdown: markdown })).toBe(true);
  });

  it('rifiuta un documento con la sola intestazione dell’ossatura', () => {
    // È il caso che il controllo precedente accettava: stringa non vuota entro
    // il cap, ma non un artefatto che la composizione avrebbe mai prodotto.
    expect(() =>
      parseCanonicalConceptMapMarkdown('## Ossatura della lezione\n\n- primo\n'),
    ).toThrow(/esattamente una volta|struttura canonica/);
  });

  it('rifiuta un documento senza avvertenza', () => {
    const withoutDisclaimer = canonicalMarkdown()
      .replace(`> ${CONCEPT_MAP_DISCLAIMER}\n`, '')
      .replace('> [!IMPORTANT]\n', '');
    expect(() => parseCanonicalConceptMapMarkdown(withoutDisclaimer)).toThrow(
      /esattamente una volta/,
    );
  });

  it('rifiuta un’avvertenza modificata anche di poco', () => {
    const altered = canonicalMarkdown().replace(
      CONCEPT_MAP_DISCLAIMER,
      CONCEPT_MAP_DISCLAIMER.replace('non sostituisce', 'non sostituisce del tutto'),
    );
    expect(() => parseCanonicalConceptMapMarkdown(altered)).toThrow(/esattamente una volta/);
  });

  it('rifiuta un ordine di sezioni alterato', () => {
    const swapped = [
      '## Sintesi',
      '',
      'Sintesi.',
      '',
      '## Ossatura della lezione',
      '',
      '- primo',
      '',
      '## Diagramma',
      '',
      '```text',
      'RADICE',
      '```',
      '',
      '> [!IMPORTANT]',
      `> ${CONCEPT_MAP_DISCLAIMER}`,
      '',
    ].join('\n');
    expect(() => parseCanonicalConceptMapMarkdown(swapped)).toThrow(/struttura canonica/);
  });

  it('rifiuta fence mancante, doppia o non chiusa', () => {
    const markdown = canonicalMarkdown();
    const noFence = markdown.replace('```text\n', '').replace('\n```\n', '\n');
    expect(() => parseCanonicalConceptMapMarkdown(noFence)).toThrow(/un solo blocco di diagramma/);
    const unclosed = markdown.replace('\n```\n', '\n');
    expect(() => parseCanonicalConceptMapMarkdown(unclosed)).toThrow(/un solo blocco di diagramma/);
    const doubled = markdown.replace('```text\n', '```text\n```\n```text\n');
    expect(() => parseCanonicalConceptMapMarkdown(doubled)).toThrow(/un solo blocco di diagramma/);
  });

  it('rifiuta un diagramma a 81 caratteri dentro il documento persistito', () => {
    const wide = composeConceptMapMarkdown({
      outlineMarkdown: '- voce',
      summaryMarkdown: 'Sintesi.',
      diagram: 'A'.repeat(CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS + 1),
    });
    expect(() => parseCanonicalConceptMapMarkdown(wide)).toThrow(/supera 80 caratteri/);
  });

  it('rifiuta un heading extra dentro l’ossatura di una mappa v1', () => {
    expect(() =>
      parseCanonicalConceptMapMarkdown(legacyMarkdown({ outline: '- voce\n### intruso' })),
    ).toThrow(/intestazioni non sono ammesse|struttura canonica/);
  });

  it('rifiuta una sintesi numerata dentro il documento persistito', () => {
    // Struttura canonica perfetta, contenuto non conforme: il replay riapplica
    // i contratti dei campi alle sezioni estratte, quindi non passa.
    const numbered = composeConceptMapMarkdown({
      outlineMarkdown: '- voce',
      summaryMarkdown: '1. Primo concetto\n2. Secondo concetto',
      diagram: 'RADICE',
    });
    expect(() => parseCanonicalConceptMapMarkdown(numbered)).toThrow(/prosa, non un elenco/);
    expect(isValidStoredConceptMapOutput({ conceptMapMarkdown: numbered })).toBe(false);
  });

  it('rifiuta contenuto dopo l’avvertenza', () => {
    const withTrailer = `${canonicalMarkdown()}Testo aggiunto dopo.\n`;
    expect(() => parseCanonicalConceptMapMarkdown(withTrailer)).toThrow(/struttura canonica/);
  });

  it('rifiuta un documento oltre il cap o vuoto', () => {
    expect(() => parseCanonicalConceptMapMarkdown('   ')).toThrow(/mancante o vuota/);
    expect(() => parseCanonicalConceptMapMarkdown(42)).toThrow(/mancante o vuota/);
    const tooBig = 'x'.repeat(AI_CONTENT_LIMITS.MAX_CONCEPT_MAP_OUTPUT_BYTES + 1);
    expect(() => parseCanonicalConceptMapMarkdown(tooBig)).toThrow(/supera il limite/);
  });
});

describe('forma dell’output persistito', () => {
  it('accetta esattamente una chiave', () => {
    const markdown = canonicalMarkdown();
    expect(validateStoredConceptMapOutput({ conceptMapMarkdown: markdown })).toEqual({
      conceptMapMarkdown: markdown,
    });
  });

  it('rifiuta proprietà extra accanto al Markdown', () => {
    expect(() =>
      validateStoredConceptMapOutput({
        conceptMapMarkdown: canonicalMarkdown(),
        outlineMarkdown: '- voce',
      }),
    ).toThrow(/Output della mappa non valido/);
  });

  it('rifiuta i tre campi grezzi al posto del documento', () => {
    expect(() => validateStoredConceptMapOutput(proposal())).toThrow(
      /Output della mappa non valido/,
    );
  });

  it('rifiuta output di altri kind', () => {
    expect(() => validateStoredConceptMapOutput({ body: 'corpo lezione' })).toThrow(
      /Output della mappa non valido/,
    );
    expect(() => validateStoredConceptMapOutput({ questions: [{}] })).toThrow(
      /Output della mappa non valido/,
    );
  });

  it('il predicato non lancia mai', () => {
    expect(isValidStoredConceptMapOutput({ conceptMapMarkdown: canonicalMarkdown() })).toBe(true);
    expect(isValidStoredConceptMapOutput(null)).toBe(false);
    expect(isValidStoredConceptMapOutput({ conceptMapMarkdown: 'testo qualunque' })).toBe(false);
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

  it('accetta un run completato con il Markdown canonico e lo restituisce identico', () => {
    const markdown = canonicalMarkdown();
    const parsed = parseStoredRunDocument(
      serializeRun({ ...SAMPLE_RUN, output: { conceptMapMarkdown: markdown } }),
    );
    expect(parsed).not.toBeNull();
    expect((parsed?.output as { conceptMapMarkdown: string }).conceptMapMarkdown).toBe(markdown);
  });

  it('rifiuta un Markdown non canonico che prima sarebbe passato', () => {
    const doc = serializeRun({
      ...SAMPLE_RUN,
      output: { conceptMapMarkdown: '## Ossatura della lezione\n\n- primo\n' },
    });
    expect(parseStoredRunDocument(doc)).toBeNull();
  });

  it('rifiuta i tre campi grezzi al posto del documento composto', () => {
    expect(parseStoredRunDocument(serializeRun({ ...SAMPLE_RUN, output: proposal() }))).toBeNull();
  });

  it('rifiuta output scambiati fra i tre kind', () => {
    const markdown = canonicalMarkdown();
    expect(
      parseStoredRunDocument(serializeRun({ ...SAMPLE_RUN, output: { body: 'x' } })),
    ).toBeNull();
    expect(
      parseStoredRunDocument(serializeRun({ ...SAMPLE_RUN, output: { questions: [{}] } })),
    ).toBeNull();
    expect(
      parseStoredRunDocument(
        serializeRun({ ...SAMPLE_RUN, kind: 'lesson', output: { conceptMapMarkdown: markdown } }),
      ),
    ).toBeNull();
    expect(
      parseStoredRunDocument(
        serializeRun({ ...SAMPLE_RUN, kind: 'pool', output: { conceptMapMarkdown: markdown } }),
      ),
    ).toBeNull();
  });

  it('rifiuta proprietà extra accanto al Markdown', () => {
    const doc = serializeRun({
      ...SAMPLE_RUN,
      output: { conceptMapMarkdown: canonicalMarkdown(), extra: true },
    });
    expect(parseStoredRunDocument(doc)).toBeNull();
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
    // Il documento prodotto è accettato dal validator del replay: scrittura e
    // lettura non possono divergere.
    expect(parseCanonicalConceptMapMarkdown(composed.conceptMapMarkdown)).toBe(
      composed.conceptMapMarkdown,
    );
    // Il mock non genera costo: mai un costo inventato.
    expect(outcome.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(outcome.metered).toBe(false);
  });
});

// ─── CONCEPT-MAP-05/06: convivenza v1/v2 e profilo esplicito ─────────────────

describe('convivenza v1/v2 nel documento persistito', () => {
  it('accetta una mappa v2 e la restituisce byte per byte', () => {
    const doc = canonicalMarkdown();
    expect(parseCanonicalConceptMapMarkdown(doc)).toBe(doc);
  });

  it('accetta una mappa v1 già salvata e la restituisce byte per byte', () => {
    const doc = legacyMarkdown();
    expect(parseCanonicalConceptMapMarkdown(doc)).toBe(doc);
  });

  it('non converte una v1 in v2 durante il replay', () => {
    // Convertire cambierebbe ciò che il docente ha salvato e ciò che lo
    // studente sta già leggendo, senza che nessuno l'abbia chiesto.
    const doc = legacyMarkdown();
    const replayed = parseCanonicalConceptMapMarkdown(doc);
    expect(replayed).toContain('## Ossatura della lezione');
    expect(replayed).toBe(doc);
  });

  it('una v2 non contiene alcuna ossatura', () => {
    expect(canonicalMarkdown()).not.toContain('## Ossatura della lezione');
    expect(canonicalMarkdown().startsWith('## Sintesi\n')).toBe(true);
  });

  it('rifiuta una v1 malformata come rifiuta una v2 malformata', () => {
    // Ossatura in prosa, sintesi numerata, diagramma troppo largo, avvertenza
    // alterata: la tolleranza verso il legacy è sulla *forma*, non sui vincoli.
    expect(() =>
      parseCanonicalConceptMapMarkdown(legacyMarkdown({ outline: 'prosa fuori elenco' })),
    ).toThrow(AiContentError);
    expect(() =>
      parseCanonicalConceptMapMarkdown(legacyMarkdown({ summary: '1. primo\n2. secondo' })),
    ).toThrow(AiContentError);
    expect(() =>
      parseCanonicalConceptMapMarkdown(
        legacyMarkdown({ diagram: 'x'.repeat(CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS + 1) }),
      ),
    ).toThrow(AiContentError);
    expect(() =>
      parseCanonicalConceptMapMarkdown(legacyMarkdown().replace(CONCEPT_MAP_DISCLAIMER, 'Altro.')),
    ).toThrow(AiContentError);
  });

  it('rifiuta un ibrido: ossatura senza sintesi, o sezioni fuori ordine', () => {
    const swapped = [
      '## Ossatura della lezione',
      '',
      '- voce',
      '',
      '## Diagramma',
      '',
      '```text',
      'RADICE',
      '```',
      '',
      '> [!IMPORTANT]',
      `> ${CONCEPT_MAP_DISCLAIMER}`,
      '',
    ].join('\n');
    expect(() => parseCanonicalConceptMapMarkdown(swapped)).toThrow(AiContentError);
  });

  it('l’output persistito accetta entrambe le versioni sotto la stessa chiave', () => {
    expect(isValidStoredConceptMapOutput({ conceptMapMarkdown: canonicalMarkdown() })).toBe(true);
    expect(isValidStoredConceptMapOutput({ conceptMapMarkdown: legacyMarkdown() })).toBe(true);
    expect(
      isValidStoredConceptMapOutput({ conceptMapMarkdown: '## Sintesi\n\nsolo questo\n' }),
    ).toBe(false);
  });
});
