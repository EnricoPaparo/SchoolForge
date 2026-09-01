import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  AiContentError,
  assertGenericAiContentCallableKind,
  canonicalRequest,
  computeInputHash,
  validateAiContentRequest,
  type AiContentRequest,
  type VisualPlanProposalRequest,
} from './aiContentCore.js';
import {
  MAX_VISUAL_ALT_TEXT_CHARS,
  MAX_VISUAL_CAPTION_CHARS,
  MAX_VISUAL_RATIONALE_CHARS,
  MAX_VISUAL_REASON_CHARS,
  MAX_VISUAL_SUBJECT_CHARS,
} from './aiContentVisualProposal.js';
import {
  AI_CONCEPT_MAP_PROMPT_VERSION,
  AI_CONTENT_PROMPT_VERSION,
  AI_VISUAL_PLAN_PROPOSAL_PROMPT_VERSION,
  AI_VISUAL_PROPOSAL_PROMPT_VERSION,
  buildVisualPlanProposalPrompt,
} from './aiContentPrompt.js';
import {
  buildContentStructuredRequest,
  buildVisualPlanProposalOutputSchema,
  resolveMaxOutputTokens,
} from './aiContentPayload.js';
import { parseStoredRunDocument, serializeRun } from './aiContentRunDoc.js';
import { createContentProvider } from './aiContentProvider.js';
import {
  AI_CONTENT_LEASE_TTL_MS,
  generateContent,
  type AiContentPorts,
  type StoredAiContentRun,
} from './aiContentEngine.js';
import {
  OPENAI_RUNTIME_LUNA_MODEL,
  OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
} from './aiCorrectionCost.js';
import type { AiRuntimeConfig } from './aiCorrectionRuntimeConfig.js';
import { DEFAULT_OPENAI_RETRY_POLICY, type OpenAiTransport } from './openAiGrader.js';
import {
  VISUAL_PLAN_PROPOSAL_ENVELOPE_KEY,
  assertVisualPlanProposalMatchesRequest,
  isValidStoredVisualPlanProposalOutput,
  validateVisualPlanProposalDecision,
  validateVisualPlanProposalEnvelope,
  type VisualPlanProposalDecision,
} from './aiContentVisualPlanProposal.js';

/**
 * MULTI-VISUAL-02 — la proposta coordinata generalizza la proposta visuale
 * singola (VE-01) a un array 0..ceiling di esiti. I test seguono lo stesso
 * ordine di garanzie, più due nuove:
 *
 * 1. **l'astensione resta di prima classe**, ora per slot: un array vuoto,
 *    o con "none" ovunque, è un esito completo;
 * 2. **l'ancora è indice+testo** (MULTI-VISUAL-01), non il solo testo: due
 *    heading omonimi devono restare due scelte distinte;
 * 3. **il vincolo di diversità (§7.4)** vieta l'idea duplicata, non l'ancora
 *    condivisa: due slot sullo stesso heading con soggetti distinti sono
 *    leciti, due slot con lo stesso soggetto (o la stessa utilità) non lo
 *    sono, ancora uguale o diversa che sia;
 * 4. **i quattro kind preesistenti (incluso `visual_proposal`) non si
 *    spostano di un byte**.
 */

const REQUEST_ID = '99999999-9999-4999-8999-999999999999';

const LESSON_BODY_TWO_HEADINGS =
  '## Reti\n\nLa rete idrica cittadina.\n\n## Il bilancio idrico\n\nPrecipitazione e ruscellamento.\n\n## Reti\n\nLe reti elettriche.';

function planPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'visual_plan_proposal',
    requestId: REQUEST_ID,
    modelProfile: 'quality',
    titolo: 'Il ciclo dell’acqua',
    sottotitolo: null,
    difficolta: '2 — base',
    concettiChiave: ['evaporazione', 'condensazione'],
    obiettivi: ['Descrivere il ciclo dell’acqua'],
    udaTitle: 'Idrosfera',
    udaContext: {
      title: 'Idrosfera',
      descrizione: null,
      competenze: [],
      obiettivi: [],
      currentLessonPosition: 1,
      lessons: [{ position: 1, titolo: 'Il ciclo dell’acqua', sottotitolo: null }],
    },
    lessonBody: LESSON_BODY_TWO_HEADINGS,
    quantity: { mode: 'auto', requested: null, ceiling: 3 },
    ...over,
  };
}

function planRequest(over: Record<string, unknown> = {}): VisualPlanProposalRequest {
  return validateAiContentRequest(planPayload(over)) as VisualPlanProposalRequest;
}

function imageDecision(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decision: 'image',
    subject: 'Schema del bilancio idrico con precipitazione e ruscellamento su un rilievo',
    rationale: 'Mostra in un colpo d’occhio la relazione spaziale che il testo descrive a parole.',
    anchor: { anchorHeadingIndex: 1, anchorHeadingText: 'Il bilancio idrico' },
    caption: 'Il bilancio idrico fra precipitazione e ruscellamento.',
    altText: 'Schema del rilievo con la pioggia che cade e l’acqua che scorre verso valle.',
    ...over,
  };
}

function secondDistinctImageDecision(over: Record<string, unknown> = {}): Record<string, unknown> {
  return imageDecision({
    subject: 'Fotografia schematica di un ruscello reale che scorre su un pendio roccioso',
    rationale: 'Mostra un caso reale concreto dello stesso fenomeno appena descritto in astratto.',
    caption: 'Il ruscellamento osservato su un pendio reale.',
    altText: 'Un ruscello che scorre su un pendio, fra rocce e vegetazione rada.',
    ...over,
  });
}

function noneDecision(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decision: 'none',
    reason: 'La lezione elenca definizioni: un’illustrazione sarebbe decorativa.',
    ...over,
  };
}

function envelope(decisions: unknown[]): Record<string, unknown> {
  return { [VISUAL_PLAN_PROPOSAL_ENVELOPE_KEY]: decisions };
}

// ─── Payload chiuso ─────────────────────────────────────────────────────────

describe('payload della proposta coordinata', () => {
  it('accetta un payload valido con quantity auto', () => {
    const request = planRequest();
    expect(request.kind).toBe('visual_plan_proposal');
    expect(request.quantity).toEqual({ mode: 'auto', requested: null, ceiling: 3 });
  });

  it('accetta quantity exact con requested === ceiling', () => {
    const request = planRequest({ quantity: { mode: 'exact', requested: 2, ceiling: 2 } });
    expect(request.quantity).toEqual({ mode: 'exact', requested: 2, ceiling: 2 });
  });

  it('rifiuta exact con requested diverso da ceiling', () => {
    expect(() =>
      validateAiContentRequest(
        planPayload({ quantity: { mode: 'exact', requested: 1, ceiling: 2 } }),
      ),
    ).toThrow(AiContentError);
  });

  it('rifiuta auto con requested non nullo', () => {
    expect(() =>
      validateAiContentRequest(
        planPayload({ quantity: { mode: 'auto', requested: 1, ceiling: 2 } }),
      ),
    ).toThrow(AiContentError);
  });

  it('rifiuta ceiling fuori 1..3', () => {
    expect(() =>
      validateAiContentRequest(
        planPayload({ quantity: { mode: 'auto', requested: null, ceiling: 4 } }),
      ),
    ).toThrow(AiContentError);
  });

  it('rifiuta un profilo diverso da quality', () => {
    expect(() => validateAiContentRequest(planPayload({ modelProfile: 'economy' }))).toThrow(
      AiContentError,
    );
  });

  it('rifiuta proprietà extra', () => {
    expect(() => validateAiContentRequest(planPayload({ storageRef: 'x' }))).toThrow(
      AiContentError,
    );
  });

  it('rifiuta un corpo lezione vuoto', () => {
    expect(() => validateAiContentRequest(planPayload({ lessonBody: '   ' }))).toThrow(
      AiContentError,
    );
  });
});

describe('confine delle callable generiche', () => {
  it('rifiuta il kind interno senza rimuoverlo dal validator/engine', () => {
    const request = planRequest();
    expect(request.kind).toBe('visual_plan_proposal');
    expect(() => assertGenericAiContentCallableKind(request)).toThrow(
      expect.objectContaining({ code: 'invalid_input' }),
    );
  });

  it('blocca preview e generate prima di config, budget, provider o scritture', () => {
    const source = readFileSync(new URL('./aiContentGateway.ts', import.meta.url), 'utf8');
    for (const [startMarker, endMarker] of [
      ['export const aiContentPreview', 'export const aiContentGenerate'],
      ['export const aiContentGenerate', null],
    ] as const) {
      const start = source.indexOf(startMarker);
      const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      const block = source.slice(start, end);
      const validation = block.indexOf('validateAiContentRequest(request.data)');
      const guard = block.indexOf('assertGenericAiContentCallableKind(validated)');
      expect(validation).toBeGreaterThanOrEqual(0);
      expect(guard).toBeGreaterThan(validation);
      for (const effect of [
        'loadRuntimeConfig(database)',
        'readOpenAiSecret()',
        'createPorts(',
        'previewContent(',
        'generateContent(',
      ]) {
        const position = block.indexOf(effect);
        if (position >= 0) expect(guard).toBeLessThan(position);
      }
    }
  });
});

// ─── inputHash: sensibilità e stabilità ──────────────────────────────────────

describe('inputHash della proposta coordinata', () => {
  it('è deterministico per lo stesso payload', () => {
    expect(computeInputHash(planRequest())).toBe(computeInputHash(planRequest()));
  });

  it('è sensibile a ogni campo semantico, incluso quantity', () => {
    const base = computeInputHash(planRequest());
    expect(computeInputHash(planRequest({ lessonBody: 'Altro corpo.' }))).not.toBe(base);
    expect(computeInputHash(planRequest({ titolo: 'Altro titolo' }))).not.toBe(base);
    expect(
      computeInputHash(planRequest({ quantity: { mode: 'exact', requested: 1, ceiling: 1 } })),
    ).not.toBe(base);
    expect(
      computeInputHash(planRequest({ quantity: { mode: 'auto', requested: null, ceiling: 2 } })),
    ).not.toBe(base);
  });

  it('non dipende da requestId (identità del replay, non del contenuto)', () => {
    expect(computeInputHash(planRequest())).toBe(
      computeInputHash(planRequest({ requestId: '11111111-1111-4111-8111-111111111111' })),
    );
  });
});

// ─── Structured Output: singolo elemento ─────────────────────────────────────

describe('validazione di un elemento della proposta', () => {
  it('accetta none e image nella forma canonica', () => {
    expect(validateVisualPlanProposalDecision(noneDecision())).toEqual({
      decision: 'none',
      reason: noneDecision().reason,
    });
    const parsed = validateVisualPlanProposalDecision(imageDecision());
    expect(parsed.decision).toBe('image');
  });

  it('rifiuta chiavi extra o mancanti su entrambi i rami', () => {
    expect(() => validateVisualPlanProposalDecision(noneDecision({ subject: 'x' }))).toThrow(
      AiContentError,
    );
    expect(() => validateVisualPlanProposalDecision({ decision: 'image', subject: 'x' })).toThrow(
      AiContentError,
    );
  });

  it('rifiuta un ramo ibrido (none con caption, image con reason)', () => {
    expect(() => validateVisualPlanProposalDecision(noneDecision({ caption: 'x' }))).toThrow(
      AiContentError,
    );
    expect(() => validateVisualPlanProposalDecision(imageDecision({ reason: 'x' }))).toThrow(
      AiContentError,
    );
  });

  it('rifiuta decision non riconosciuta', () => {
    expect(() => validateVisualPlanProposalDecision({ decision: 'maybe' })).toThrow(AiContentError);
  });

  it('applica gli stessi limiti VE per campo', () => {
    expect(() =>
      validateVisualPlanProposalDecision(
        imageDecision({ subject: 'x'.repeat(MAX_VISUAL_SUBJECT_CHARS + 1) }),
      ),
    ).toThrow(AiContentError);
    expect(() =>
      validateVisualPlanProposalDecision(
        imageDecision({ rationale: 'x'.repeat(MAX_VISUAL_RATIONALE_CHARS + 1) }),
      ),
    ).toThrow(AiContentError);
    expect(() =>
      validateVisualPlanProposalDecision(
        imageDecision({ caption: 'x'.repeat(MAX_VISUAL_CAPTION_CHARS + 1) }),
      ),
    ).toThrow(AiContentError);
    expect(() =>
      validateVisualPlanProposalDecision(
        imageDecision({ altText: 'x'.repeat(MAX_VISUAL_ALT_TEXT_CHARS + 1) }),
      ),
    ).toThrow(AiContentError);
    expect(() =>
      validateVisualPlanProposalDecision(
        noneDecision({ reason: 'x'.repeat(MAX_VISUAL_REASON_CHARS + 1) }),
      ),
    ).toThrow(AiContentError);
  });

  it('rifiuta un selettore di ancora malformato', () => {
    expect(() =>
      validateVisualPlanProposalDecision(
        imageDecision({ anchor: { anchorHeadingIndex: -1, anchorHeadingText: 'x' } }),
      ),
    ).toThrow(AiContentError);
    expect(() => validateVisualPlanProposalDecision(imageDecision({ anchor: 'Reti' }))).toThrow(
      AiContentError,
    );
  });
});

// ─── Envelope e array 0..ceiling ──────────────────────────────────────────────

describe('envelope della proposta coordinata', () => {
  it('accetta un array vuoto (esito legittimo)', () => {
    expect(validateVisualPlanProposalEnvelope(envelope([]), 3)).toEqual([]);
  });

  it('accetta un array con soli "none"', () => {
    const decisions = validateVisualPlanProposalEnvelope(
      envelope([noneDecision(), noneDecision()]),
      3,
    );
    expect(decisions).toHaveLength(2);
    expect(decisions.every((d) => d.decision === 'none')).toBe(true);
  });

  it('rifiuta un array più lungo del ceiling autorizzato', () => {
    expect(() =>
      validateVisualPlanProposalEnvelope(
        envelope([noneDecision(), noneDecision(), noneDecision()]),
        2,
      ),
    ).toThrow(AiContentError);
  });

  it('rifiuta una radice diversa dall’envelope atteso', () => {
    expect(() => validateVisualPlanProposalEnvelope({ proposal: [] }, 3)).toThrow(AiContentError);
    expect(() => validateVisualPlanProposalEnvelope([], 3)).toThrow(AiContentError);
    expect(() => validateVisualPlanProposalEnvelope({ decisions: [], extra: 1 }, 3)).toThrow(
      AiContentError,
    );
  });

  it('rifiuta decisions non-array', () => {
    expect(() => validateVisualPlanProposalEnvelope({ decisions: 'x' }, 3)).toThrow(AiContentError);
  });
});

// ─── Ancora indice+testo: heading omonimi, corpo fresco ──────────────────────

describe('ancora indice+testo sul corpo fresco (§7.2, §7.3)', () => {
  it('due heading omonimi restano due indici distinti e validi', () => {
    const decisions: VisualPlanProposalDecision[] = [
      validateVisualPlanProposalDecision(
        imageDecision({
          anchor: { anchorHeadingIndex: 0, anchorHeadingText: 'Reti' },
          subject: 'Soggetto A',
        }),
      ),
      validateVisualPlanProposalDecision(
        imageDecision({
          anchor: { anchorHeadingIndex: 2, anchorHeadingText: 'Reti' },
          subject: 'Soggetto B, del tutto diverso dal primo',
          rationale: 'Utilità didattica diversa dalla prima, spiegata in altre parole distinte.',
        }),
      ),
    ];
    expect(() =>
      assertVisualPlanProposalMatchesRequest(decisions, LESSON_BODY_TWO_HEADINGS),
    ).not.toThrow();
  });

  it('rifiuta un indice fuori range rispetto al corpo fresco', () => {
    const decisions = [
      validateVisualPlanProposalDecision(
        imageDecision({ anchor: { anchorHeadingIndex: 99, anchorHeadingText: 'Reti' } }),
      ),
    ];
    expect(() =>
      assertVisualPlanProposalMatchesRequest(decisions, LESSON_BODY_TWO_HEADINGS),
    ).toThrow(AiContentError);
  });

  it('rifiuta un testo che non corrisponde all’indice dopo una modifica del corpo', () => {
    const decisions = [
      validateVisualPlanProposalDecision(
        imageDecision({ anchor: { anchorHeadingIndex: 0, anchorHeadingText: 'Reti' } }),
      ),
    ];
    const changedBody = '## Un altro titolo\n\nTesto.\n\n## Il bilancio idrico\n\nTesto.';
    expect(() => assertVisualPlanProposalMatchesRequest(decisions, changedBody)).toThrow(
      AiContentError,
    );
  });
});

// ─── Diversità didattica (§7.4) ───────────────────────────────────────────────

describe('vincolo di diversità (§7.4) — vieta l’idea duplicata, non l’ancora condivisa', () => {
  it('accetta due slot sulla STESSA ancora con idee genuinamente distinte', () => {
    const decisions = [
      validateVisualPlanProposalDecision(imageDecision()),
      validateVisualPlanProposalDecision(secondDistinctImageDecision()),
    ];
    expect(() =>
      assertVisualPlanProposalMatchesRequest(decisions, LESSON_BODY_TWO_HEADINGS),
    ).not.toThrow();
  });

  it('rifiuta due subject normalizzati identici, ancora uguale o diversa', () => {
    const sameSubjectDifferentAnchor = [
      validateVisualPlanProposalDecision(imageDecision()),
      validateVisualPlanProposalDecision(
        imageDecision({
          anchor: { anchorHeadingIndex: 0, anchorHeadingText: 'Reti' },
          subject: `  ${imageDecision().subject as string}  `.trim().toUpperCase(),
          rationale: 'Una motivazione differente dalla prima, scritta in altro modo.',
        }),
      ),
    ];
    expect(() =>
      assertVisualPlanProposalMatchesRequest(sameSubjectDifferentAnchor, LESSON_BODY_TWO_HEADINGS),
    ).toThrow(AiContentError);
  });

  it('rifiuta due rationale normalizzati identici anche con subject diversi', () => {
    const decisions = [
      validateVisualPlanProposalDecision(imageDecision()),
      validateVisualPlanProposalDecision(
        secondDistinctImageDecision({
          rationale: `  ${imageDecision().rationale as string}  `.trim().toUpperCase(),
        }),
      ),
    ];
    expect(() =>
      assertVisualPlanProposalMatchesRequest(decisions, LESSON_BODY_TWO_HEADINGS),
    ).toThrow(AiContentError);
  });

  it('la sola uguaglianza di anchorHeadingIndex, con subject/rationale distinti, non produce mai un rifiuto', () => {
    const decisions = [
      validateVisualPlanProposalDecision(imageDecision()),
      validateVisualPlanProposalDecision(secondDistinctImageDecision()),
    ];
    expect(decisions[0]!.decision === 'image' && decisions[1]!.decision === 'image').toBe(true);
    if (decisions[0]!.decision === 'image' && decisions[1]!.decision === 'image') {
      expect(decisions[0]!.anchor).toEqual(decisions[1]!.anchor);
    }
    expect(() =>
      assertVisualPlanProposalMatchesRequest(decisions, LESSON_BODY_TWO_HEADINGS),
    ).not.toThrow();
  });
});

// ─── Schema Structured Output ─────────────────────────────────────────────────

describe('schema Structured Output della proposta coordinata', () => {
  it('vincola maxItems al ceiling della richiesta', () => {
    const schema = buildVisualPlanProposalOutputSchema(
      planRequest({ quantity: { mode: 'exact', requested: 2, ceiling: 2 } }),
    );
    const decisionsSchema = (schema as { properties: { decisions: { maxItems: number } } })
      .properties.decisions;
    expect(decisionsSchema.maxItems).toBe(2);
  });

  it('senza heading ancorabili, ammette solo l’esito none', () => {
    const request = planRequest({ lessonBody: 'Nessun heading qui, solo testo semplice.' });
    const schema = buildVisualPlanProposalOutputSchema(request) as {
      properties: { decisions: { items: { anyOf: unknown[] } } };
    };
    expect(schema.properties.decisions.items.anyOf).toHaveLength(1);
  });
});

describe('riparazione confinata del subject grezzo del provider', () => {
  it('compatta un lieve sforamento su una frase completa prima della validazione', () => {
    const firstSentence = `Schema didattico con tre blocchi collegati e una sequenza operativa chiara ${'x'.repeat(240)}.`;
    const overlong = `${firstSentence} Dettaglio secondario ${'y'.repeat(150)}`;
    expect([...overlong].length).toBeGreaterThan(MAX_VISUAL_SUBJECT_CHARS);
    expect([...overlong].length).toBeLessThanOrEqual(MAX_VISUAL_SUBJECT_CHARS * 1.5);

    const [decision] = validateVisualPlanProposalEnvelope(
      envelope([imageDecision({ subject: overlong })]),
      3,
    );

    expect(decision?.decision).toBe('image');
    if (decision?.decision !== 'image') return;
    expect(decision.subject).toBe(firstSentence);
    expect([...decision.subject].length).toBeLessThanOrEqual(MAX_VISUAL_SUBJECT_CHARS);
  });

  it('non normalizza uno sforamento fuori controllo', () => {
    expect(() =>
      validateVisualPlanProposalEnvelope(
        envelope([
          imageDecision({ subject: 'x'.repeat(Math.floor(MAX_VISUAL_SUBJECT_CHARS * 1.5) + 1) }),
        ]),
        3,
      ),
    ).toThrow(/Soggetto/);
  });

  it('lascia byte-identico un subject già valido', () => {
    const subject = 'Schema essenziale di nodi collegati in una rete locale.';
    const [decision] = validateVisualPlanProposalEnvelope(
      envelope([imageDecision({ subject })]),
      3,
    );
    expect(decision?.decision === 'image' ? decision.subject : null).toBe(subject);
  });
});

// ─── Provider mock ─────────────────────────────────────────────────────────────

describe('provider mock', () => {
  it('produce un array vuoto, strutturalmente valido, senza chiamate reali', async () => {
    const provider = createContentProvider({ mode: 'mock' } as never);
    const outcome = await provider.generate(
      planRequest() as AiContentRequest,
      {
        model: 'mock',
        maxOutputTokens: 1,
      } as never,
    );
    expect(outcome.status).toBe('ok');
    const validated = validateVisualPlanProposalEnvelope(
      (outcome as { output: unknown }).output,
      3,
    );
    expect(validated).toEqual([]);
  });
});

// ─── Parità envelope reale/mock (zero rete reale) ────────────────────────────

function jsonTransport(
  outputText: string,
  usage: { inputTokens: number; outputTokens: number } | undefined,
): OpenAiTransport {
  return {
    async send() {
      return usage
        ? { outputText, usage: { ...usage, totalTokens: usage.inputTokens + usage.outputTokens } }
        : { outputText };
    },
  };
}

describe('provider reale (transport mockato, zero rete reale)', () => {
  it('attraversa la stessa envelope strict del mock: stesso validator, stesso esito accettato', async () => {
    const request = planRequest();
    const outputText = JSON.stringify(envelope([imageDecision(), noneDecision()]));
    const provider = createContentProvider({
      mode: 'openai',
      transport: jsonTransport(outputText, { inputTokens: 500, outputTokens: 300 }),
      runnerDeps: { policy: { ...DEFAULT_OPENAI_RETRY_POLICY, maxRetries: 0 } },
    });
    const outcome = await provider.generate(request as AiContentRequest, 'gpt-5.6-luna');
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.metered).toBe(true);
    const decisions = assertVisualPlanProposalMatchesRequest(
      validateVisualPlanProposalEnvelope(outcome.output, request.quantity.ceiling),
      request.lessonBody,
    );
    expect(decisions).toHaveLength(2);
    expect(decisions.map((d) => d.decision)).toEqual(['image', 'none']);
  });

  it('trasmette davvero max_output_tokens proporzionale al ceiling e uno schema strict', async () => {
    let captured: unknown;
    const provider = createContentProvider({
      mode: 'openai',
      transport: {
        async send(req) {
          captured = req;
          return {
            outputText: JSON.stringify(envelope([])),
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        },
      },
      runnerDeps: { policy: { ...DEFAULT_OPENAI_RETRY_POLICY, maxRetries: 0 } },
    });
    const request = planRequest({ quantity: { mode: 'exact', requested: 2, ceiling: 2 } });
    await provider.generate(request as AiContentRequest, 'gpt-5.6-luna');
    const req = captured as {
      max_output_tokens: number;
      text: { format: { strict: boolean; name: string } };
    };
    expect(req.max_output_tokens).toBe(resolveMaxOutputTokens(request));
    expect(req.text.format.strict).toBe(true);
    expect(req.text.format.name).toBe('schoolforge_ai_content');
  });
});

// ─── Documento run e replay ────────────────────────────────────────────────────

describe('documento run', () => {
  const SAMPLE_RUN: StoredAiContentRun = {
    contractVersion: 1,
    kind: 'visual_plan_proposal',
    status: 'completed',
    inputHash: computeInputHash(planRequest()),
    modelProfile: 'quality',
    model: 'gpt-5.6-luna',
    priceListVersion: 'v5-2026-07-20-luna-dev',
    estimatedInputTokens: 100,
    maxOutputTokens: 9_000,
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

  function storedRun(output: unknown): Record<string, unknown> {
    return serializeRun({ ...SAMPLE_RUN, output }) as unknown as Record<string, unknown>;
  }

  it('accetta un run completato con array vuoto', () => {
    const parsed = parseStoredRunDocument(storedRun({ decisions: [] }));
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe('visual_plan_proposal');
    expect(parsed!.output).toEqual({ decisions: [] });
  });

  it('accetta un run completato con decisioni miste', () => {
    const output = { decisions: [noneDecision(), imageDecision()] };
    const parsed = parseStoredRunDocument(storedRun(output));
    expect(parsed!.output).toEqual(output);
  });

  it('rifiuta un run completato con output di un altro kind', () => {
    expect(parseStoredRunDocument(storedRun({ proposal: noneDecision() }))).toBeNull();
    expect(parseStoredRunDocument(storedRun({ body: '## x' }))).toBeNull();
    expect(parseStoredRunDocument(storedRun({ questions: [] }))).toBeNull();
  });

  it('rifiuta un array oltre il tetto assoluto di tre immagini', () => {
    const output = {
      decisions: [noneDecision(), noneDecision(), noneDecision(), noneDecision()],
    };
    expect(parseStoredRunDocument(storedRun(output))).toBeNull();
  });

  it('lega la cardinalità al ceiling codificato nel tetto token del run', () => {
    const twoDecisions = { decisions: [noneDecision(), imageDecision()] };
    expect(
      parseStoredRunDocument({
        ...storedRun(twoDecisions),
        maxOutputTokens: 3_000,
      }),
    ).toBeNull();
    expect(
      parseStoredRunDocument({
        ...storedRun(twoDecisions),
        maxOutputTokens: 6_000,
      }),
    ).not.toBeNull();
    expect(
      parseStoredRunDocument({
        ...storedRun({ decisions: [] }),
        maxOutputTokens: 4_500,
      }),
    ).toBeNull();
  });

  it('rifiuta in lettura subject o rationale duplicati dopo normalizzazione', () => {
    const first = imageDecision();
    const duplicateSubject = secondDistinctImageDecision({
      subject: '  SCHEMA   DEL BILANCIO IDRICO CON PRECIPITAZIONE E RUSCELLAMENTO SU UN RILIEVO  ',
    });
    const duplicateRationale = secondDistinctImageDecision({
      rationale:
        '  MOSTRA IN UN COLPO D’OCCHIO LA RELAZIONE SPAZIALE CHE IL TESTO DESCRIVE A PAROLE. ',
    });
    expect(parseStoredRunDocument(storedRun({ decisions: [first, duplicateSubject] }))).toBeNull();
    expect(
      parseStoredRunDocument(storedRun({ decisions: [first, duplicateRationale] })),
    ).toBeNull();
  });

  it('il replay riapplica ceiling e diversità prima di restituire l’output', async () => {
    const callProvider = vi.fn();
    const config: AiRuntimeConfig = {
      enabled: true,
      provider: 'openai',
      model: OPENAI_RUNTIME_LUNA_MODEL,
      environment: 'dev',
      limits: {
        maxSubmissionsPerOperation: 30,
        maxOpenQuestionsPerSubmission: 20,
        maxEstimatedTokensPerSubmission: 10_000,
        maxEstimatedTokensPerOperation: 300_000,
        maxProviderConcurrency: 3,
        attemptTimeoutMs: 60_000,
        maxApplicationRetries: 1,
      },
      maxOperationCostMicroUsd: 250_000,
      dailyBudgetMicroUsd: 1_000_000,
      monthlyBudgetMicroUsd: 5_000_000,
      configVersion: 'test',
      priceListVersion: OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
    };
    const unused = async () => {
      throw new Error('I/O inatteso dopo il replay.');
    };
    const cases = [
      {
        request: planRequest({ quantity: { mode: 'exact', requested: 1, ceiling: 1 } }),
        output: { decisions: [imageDecision(), secondDistinctImageDecision()] },
      },
      {
        request: planRequest({ quantity: { mode: 'exact', requested: 2, ceiling: 2 } }),
        output: {
          decisions: [
            imageDecision(),
            secondDistinctImageDecision({
              subject:
                ' SCHEMA DEL BILANCIO IDRICO CON PRECIPITAZIONE E RUSCELLAMENTO SU UN RILIEVO ',
            }),
          ],
        },
      },
    ];
    for (const { request, output } of cases) {
      const invalidReplayRun: StoredAiContentRun = {
        ...SAMPLE_RUN,
        inputHash: computeInputHash(request),
        maxOutputTokens: request.quantity.ceiling * 3_000,
        output,
      };
      const ports: AiContentPorts = {
        loadRuntimeConfig: async () => config,
        readAvailableBudgetMicroUsd: unused,
        loadRun: unused,
        reserveRunAndBudget: async () => ({ kind: 'replay_completed', run: invalidReplayRun }),
        markProviderPending: unused,
        callProvider,
        finalizeRun: unused,
        failRun: unused,
      } as AiContentPorts;
      await expect(
        generateContent(
          request,
          {
            authenticatedOwnerUid: 'owner-1',
            nowMs: 1_000,
            executionId: 'exec-1',
            mode: 'mock',
            leaseMs: AI_CONTENT_LEASE_TTL_MS,
          },
          ports,
        ),
      ).rejects.toMatchObject({ code: 'provider_invalid_output' });
    }
    expect(callProvider).not.toHaveBeenCalled();
  });

  it('rifiuta un elemento non canonico che prima sarebbe passato', () => {
    expect(parseStoredRunDocument(storedRun({ decisions: [{ decision: 'none' }] }))).toBeNull();
  });

  it('il predicato dello stored output non lancia mai', () => {
    for (const value of [null, undefined, 42, 'x', [], {}, { decisions: [] }, { decisions: 'x' }]) {
      expect(() => isValidStoredVisualPlanProposalOutput(value)).not.toThrow();
    }
    expect(isValidStoredVisualPlanProposalOutput({ decisions: [] })).toBe(true);
  });
});

// ─── Non-regressione dei quattro kind preesistenti ───────────────────────────

describe('l’aggiunta del quinto kind non sposta un byte degli altri quattro', () => {
  const POOL_INPUT_HASH = '0938486c38232b6c997e4bb365bbaa8764dddedeb4de58db5e1a2f9fa528967f';
  const LESSON_INPUT_HASH = '2c0dacd58d9ed5304fd964ed973e8c21a370824ef973ab367ed79ba64485798f';
  const CONCEPT_MAP_INPUT_HASH = '9448ae62cfe2d0bf931782da100023dc19b2a03baec844dbfb5d16401d1effc0';
  const VISUAL_PROPOSAL_INPUT_HASH =
    'ac06611e2358280f483b44ad1cce3df8825a14f59e0cddb753d4f073c686f2e8';
  const STRUCTURED_REQUEST_SHA256 = {
    pool: 'c9e5c6d6178b5ecb24eee81f0bf571d9f1412f1652defcbd3755cbdf9ab994f8',
    lesson: 'e7e1bd0157eb72c13381f887a085e95906288ff33dcb6222b7f5e09dfc3a62b0',
    concept_map: '08dfe67c9c308a8e37fdbcb3bdf7e41041f33e2ebd960f7aa23ffc9bcbf8a6be',
    visual_proposal: 'f87bdcf4b57ce832e1087d72fed862e5cec5c6538a457f0b994f8af3f4d6e0c4',
  } as const;

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

  function conceptMapRequest(): AiContentRequest {
    return validateAiContentRequest({
      kind: 'concept_map',
      requestId: '33333333-3333-4333-8333-333333333333',
      modelProfile: 'quality',
      lessonBody: '## La densità\n\nLa densità è il rapporto fra massa e volume.',
    });
  }

  function visualProposalRequest(): AiContentRequest {
    return validateAiContentRequest({
      kind: 'visual_proposal',
      requestId: '44444444-4444-4444-8444-444444444444',
      modelProfile: 'quality',
      titolo: 'Il ciclo dell’acqua',
      sottotitolo: null,
      difficolta: '2 — base',
      concettiChiave: ['evaporazione'],
      obiettivi: ['Descrivere il ciclo'],
      udaTitle: 'Idrosfera',
      udaContext: {
        title: 'Idrosfera',
        descrizione: null,
        competenze: [],
        obiettivi: [],
        currentLessonPosition: 1,
        lessons: [{ position: 1, titolo: 'Il ciclo dell’acqua', sottotitolo: null }],
      },
      lessonBody: '## Evaporazione\n\nL’acqua evapora e sale.',
    });
  }

  it('gli inputHash congelati su main 5171859 dei quattro kind sono invariati', () => {
    expect(computeInputHash(poolRequest())).toBe(POOL_INPUT_HASH);
    expect(computeInputHash(lessonRequest())).toBe(LESSON_INPUT_HASH);
    expect(computeInputHash(conceptMapRequest())).toBe(CONCEPT_MAP_INPUT_HASH);
    expect(computeInputHash(visualProposalRequest())).toBe(VISUAL_PROPOSAL_INPUT_HASH);
  });

  it('la forma canonica dei quattro kind non contiene traccia del nuovo', () => {
    for (const request of [
      poolRequest(),
      lessonRequest(),
      conceptMapRequest(),
      visualProposalRequest(),
    ]) {
      const canonical = canonicalRequest(request);
      expect(canonical).not.toContain('visual_plan_proposal');
      expect(canonical).not.toContain('"quantity"');
      expect(canonical).toContain(`"kind":"${request.kind}"`);
    }
  });

  it('prompt, schema e tetto di output dei quattro kind sono byte-identici a main 5171859', () => {
    const snapshots = {
      pool: JSON.stringify(buildContentStructuredRequest(poolRequest(), 'gpt-5.6-luna')),
      lesson: JSON.stringify(buildContentStructuredRequest(lessonRequest(), 'gpt-5.6-luna')),
      concept_map: JSON.stringify(
        buildContentStructuredRequest(conceptMapRequest(), 'gpt-5.6-luna'),
      ),
      visual_proposal: JSON.stringify(
        buildContentStructuredRequest(visualProposalRequest(), 'gpt-5.6-luna'),
      ),
    };
    for (const [kind, snapshot] of Object.entries(snapshots)) {
      const digest = createHash('sha256').update(snapshot, 'utf8').digest('hex');
      expect(digest).toBe(
        STRUCTURED_REQUEST_SHA256[kind as keyof typeof STRUCTURED_REQUEST_SHA256],
      );
      expect(snapshot).not.toContain('visual_plan_proposal');
      expect(snapshot).not.toContain('"decisions"');
      expect(snapshot).not.toContain(AI_VISUAL_PLAN_PROPOSAL_PROMPT_VERSION);
      expect(snapshot.length).toBeGreaterThan(0);
      expect(kind).toBeTruthy();
    }
  });

  it('le versioni di prompt degli altri kind non sono state toccate', () => {
    expect(AI_CONTENT_PROMPT_VERSION).toBe('lesson-depth-01-candidate-e-v1');
    expect(AI_CONCEPT_MAP_PROMPT_VERSION).toBe('concept-map-07-v1');
    expect(AI_VISUAL_PROPOSAL_PROMPT_VERSION).toBe('visual-proposal-01-v6');
  });

  it('i tetti di output dei quattro kind sono invariati', () => {
    expect(resolveMaxOutputTokens(conceptMapRequest())).toBe(6_000);
    expect(resolveMaxOutputTokens(poolRequest())).toBeGreaterThan(0);
    expect(resolveMaxOutputTokens(lessonRequest())).toBeGreaterThan(0);
    expect(resolveMaxOutputTokens(visualProposalRequest())).toBe(3_000);
  });

  it('il nuovo prompt builder produce un testo distinto e non vuoto', () => {
    const built = buildVisualPlanProposalPrompt(planRequest());
    expect(built.system.length).toBeGreaterThan(0);
    expect(built.user.length).toBeGreaterThan(0);
    expect(built.user).toContain('Reti');
  });
});
