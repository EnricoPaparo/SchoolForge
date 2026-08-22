/**
 * AIGEN-01 — provider di generazione contenuti. Selezione **esplicita** mock vs
 * OpenAI (nessun fallback silenzioso). Il percorso reale usa la **Responses API**
 * con **Structured Output** tramite il transport già collaudato dalla correzione
 * IA (`OpenAiTransport`) e il runner condiviso (`runStructuredCall`): stessa
 * policy di retry, stesso timeout, stessa classificazione errori. Nessun nuovo
 * client HTTP, nessuna reimplementazione del backoff.
 *
 * Il mock è deterministico, **a costo zero e senza rete**, con usage esplicito a
 * zero. Nessuna API key, chiamata reale o costo nei test.
 */

import { buildContentStructuredRequest } from './aiContentPayload.js';
import { AiContentError, type AiContentRequest } from './aiContentCore.js';
import { createOpenAiSdkTransport, type OpenAiTransport } from './openAiGrader.js';
import { runStructuredCall, type StructuredRunnerDeps } from './openAiStructuredRunner.js';

export type ContentProviderMode = 'mock' | 'openai' | 'disabled';

/** Usage grezzo del provider (interi non negativi attesi; validati a valle). */
export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Esito **tipizzato** del provider (AIGEN-01-REVIEW-FIX §6). `metered=false`
 * (mock) ⇒ costo zero autorevole; `metered=true` (openai) ⇒ costo dall'usage
 * reale, e usage assente/incoerente è fail-closed a valle. Gli errori distinguono
 * pre-invocazione (costo zero) da invocazione incerta (settlement conservativo).
 */
export type ContentProviderOutcome =
  | {
      status: 'ok';
      output: unknown;
      usage: ProviderUsage | null;
      metered: boolean;
      /**
       * `true` se un tentativo precedente (poi ritentato con successo) poteva aver
       * generato costo: il consumo totale non è conoscibile ⇒ settlement
       * conservativo a valle, `actualCost` non presentato come reale.
       */
      priorBillingRisk: boolean;
    }
  | {
      status: 'error';
      phase: 'pre_invocation' | 'invocation_unknown';
      reason?: 'max_output_tokens' | 'content_filter' | 'other';
    };

export interface ContentProvider {
  generate(request: AiContentRequest, model: string): Promise<ContentProviderOutcome>;
}

/** Proposta mock deterministica, strutturalmente valida per lo schema richiesto. */
class MockContentProvider implements ContentProvider {
  async generate(request: AiContentRequest): Promise<ContentProviderOutcome> {
    if (request.kind === 'pool') {
      const questions: unknown[] = [];
      for (let i = 0; i < request.counts.aperta; i++) {
        questions.push({
          tipo: 'aperta',
          testo: `Domanda aperta ${i + 1} (mock).`,
          difficolta: clampDifficulty(request.level),
          soluzione: 'Risposta di riferimento (mock).',
        });
      }
      for (let i = 0; i < request.counts.chiusa_singola; i++) {
        questions.push({
          tipo: 'chiusa_singola',
          testo: `Domanda a risposta singola ${i + 1} (mock).`,
          difficolta: clampDifficulty(request.level),
          opzioni: ['Opzione A', 'Opzione B', 'Opzione C'],
          soluzione: [0],
        });
      }
      for (let i = 0; i < request.counts.chiusa_multipla; i++) {
        questions.push({
          tipo: 'chiusa_multipla',
          testo: `Domanda a risposta multipla ${i + 1} (mock).`,
          difficolta: clampDifficulty(request.level),
          opzioni: ['Opzione A', 'Opzione B', 'Opzione C'],
          soluzione: [0, 1],
        });
      }
      // Usage esplicitamente zero: il mock non genera costo, mai un costo inventato.
      return {
        status: 'ok',
        output: { questions },
        usage: { inputTokens: 0, outputTokens: 0 },
        metered: false,
        priorBillingRisk: false,
      };
    }
    if (request.kind === 'concept_map') {
      // Strutturalmente valido per il validator reale: due campi non vuoti
      // (CONCEPT-MAP-05), nessuna fence, diagramma entro la larghezza massima.
      return {
        status: 'ok',
        output: {
          summaryMarkdown: 'Sintesi di riferimento (mock).',
          diagram: 'CONCETTO PRINCIPALE\n└─ dettaglio ──spiegato da──▶ esempio',
        },
        usage: { inputTokens: 0, outputTokens: 0 },
        metered: false,
        priorBillingRisk: false,
      };
    }
    if (request.kind === 'visual_proposal') {
      // VISUAL-ENRICHMENT-01 — il mock sceglie deliberatamente `none`: è l'esito
      // che il contratto considera legittimo e frequente, ed è quello che un
      // mock non può sbagliare inventando un soggetto plausibile.
      return {
        status: 'ok',
        // L'envelope `{ proposal }` è quello che il provider reale restituisce
        // per lo Structured Output strict: il mock deve produrlo identico,
        // altrimenti verificherebbe un percorso che in produzione non esiste.
        output: {
          proposal: {
            decision: 'none',
            reason: 'Esito di riferimento (mock): nessuna illustrazione utile.',
          },
        },
        usage: { inputTokens: 0, outputTokens: 0 },
        metered: false,
        priorBillingRisk: false,
      };
    }
    return {
      status: 'ok',
      output: { body: `## ${request.titolo ?? 'Lezione'}\n\nBozza generata (mock).` },
      usage: { inputTokens: 0, outputTokens: 0 },
      metered: false,
      priorBillingRisk: false,
    };
  }
}

function clampDifficulty(level: 'base' | 'balanced' | 'advanced'): number {
  if (level === 'base') return 2;
  if (level === 'advanced') return 4;
  return 3;
}

/**
 * Provider reale OpenAI (Responses API + Structured Output). Costruito solo su
 * richiesta esplicita; richiede un transport valido. Il transport è iniettabile
 * per non accoppiare i test alla rete. **Non** invocato dai test/CI con rete reale.
 */
class OpenAiContentProvider implements ContentProvider {
  constructor(
    private readonly transport: OpenAiTransport,
    private readonly deps: StructuredRunnerDeps = {},
  ) {}

  async generate(request: AiContentRequest, model: string): Promise<ContentProviderOutcome> {
    // Payload **esatto**: lo stesso builder usato da stima e prenotazione, così il
    // `max_output_tokens` prenotato è quello trasmesso.
    const httpRequest = buildContentStructuredRequest(request, model);
    const outcome = await runStructuredCall(this.transport, httpRequest, this.deps);
    if (outcome.status === 'incomplete') {
      return {
        status: 'error',
        phase: 'invocation_unknown',
        reason: outcome.reason,
      };
    }
    if (outcome.status !== 'ok') {
      return { status: 'error', phase: outcome.status };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(outcome.outputText);
    } catch {
      // Output non-JSON: la validazione a valle lo rifiuta come provider_invalid_output.
      parsed = null;
    }
    return {
      status: 'ok',
      output: parsed,
      usage: outcome.usage,
      metered: true,
      priorBillingRisk: outcome.priorBillingRisk,
    };
  }
}

export interface CreateContentProviderConfig {
  mode: ContentProviderMode;
  /** API key OpenAI, letta **solo** sul percorso generate in mode openai. */
  openAiApiKey?: string | undefined;
  /** Transport iniettabile (test): sostituisce l'SDK reale. */
  transport?: OpenAiTransport;
  /** Deps del runner (policy/sleep/random) per test deterministici. */
  runnerDeps?: StructuredRunnerDeps;
}

/**
 * Selezione esplicita del provider — nessun fallback silenzioso. In mode `openai`
 * senza transport né secret ⇒ `provider_config_invalid` **prima della rete**.
 */
export function createContentProvider(config: CreateContentProviderConfig): ContentProvider {
  if (config.mode === 'disabled') {
    throw new AiContentError('feature_disabled', 'La generazione IA è disattivata.');
  }
  if (config.mode === 'mock') return new MockContentProvider();
  // mode === 'openai'
  const transport =
    config.transport ??
    (config.openAiApiKey && config.openAiApiKey.trim().length > 0
      ? createOpenAiSdkTransport(config.openAiApiKey.trim())
      : undefined);
  if (!transport) {
    throw new AiContentError('provider_config_invalid', 'Provider OpenAI non configurato.');
  }
  return new OpenAiContentProvider(transport, config.runnerDeps);
}

/**
 * Wiring **concreto** del provider per le porte (AIGEN-01-REVIEW-FIX-2 §1).
 * `withProvider=false` (preview) ⇒ **nessuna** costruzione, `null`, mai un accesso
 * al secret. `withProvider=true` (generate) ⇒ costruzione **eager** prima di
 * reserve/lease/rete: in mode `openai` senza secret/transport lancia
 * `provider_config_invalid`. `disabled` ⇒ `null` (il gate a monte ha già emesso
 * `feature_disabled`).
 */
export function selectContentProvider(params: {
  mode: ContentProviderMode;
  withProvider: boolean;
  openAiApiKey?: string | undefined;
  transport?: OpenAiTransport;
  runnerDeps?: StructuredRunnerDeps;
}): ContentProvider | null {
  if (!params.withProvider || params.mode === 'disabled') return null;
  return createContentProvider({
    mode: params.mode,
    openAiApiKey: params.openAiApiKey,
    ...(params.transport ? { transport: params.transport } : {}),
    ...(params.runnerDeps ? { runnerDeps: params.runnerDeps } : {}),
  });
}
