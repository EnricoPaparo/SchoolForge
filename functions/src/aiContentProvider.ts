/**
 * AIGEN-01 — provider di generazione contenuti. Selezione **esplicita** mock vs
 * OpenAI (nessun fallback silenzioso). Il percorso reale usa la **Responses API**
 * con **Structured Output**; resta disabilitato dal kill switch finché Rules/TTL/
 * smoke DEV non sono verificati e finché il secret non è valorizzato.
 *
 * Il mock è deterministico, **a costo zero e senza rete**: serve allo smoke DEV e
 * ai test. Nessuna API key, chiamata reale o costo in questa PR.
 */

import { buildLessonPrompt, buildPoolPrompt } from './aiContentPrompt.js';
import { AiContentError, type AiContentRequest } from './aiContentCore.js';
import type { ProviderOutput } from './aiContentEngine.js';

export type ContentProviderMode = 'mock' | 'openai' | 'disabled';

export interface ContentProvider {
  generate(request: AiContentRequest, model: string): Promise<ProviderOutput>;
}

/** Proposta mock deterministica, strutturalmente valida per lo schema richiesto. */
class MockContentProvider implements ContentProvider {
  async generate(request: AiContentRequest): Promise<ProviderOutput> {
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
      return { output: { questions }, usage: null };
    }
    return {
      output: { body: `## ${request.titolo ?? 'Lezione'}\n\nBozza generata (mock).` },
      usage: null,
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
 * richiesta esplicita; richiede model + apiKey. **Non** invocato dai test/CI.
 * Il transport concreto è iniettabile per non accoppiare i test alla rete.
 */
export interface OpenAiResponsesTransport {
  createStructured(params: {
    model: string;
    system: string;
    user: string;
    schemaName: string;
    schema: Record<string, unknown>;
  }): Promise<{ parsed: unknown; usage: { inputTokens?: number; outputTokens?: number } | null }>;
}

class OpenAiContentProvider implements ContentProvider {
  constructor(private readonly transport: OpenAiResponsesTransport) {}
  async generate(request: AiContentRequest, model: string): Promise<ProviderOutput> {
    const prompt = request.kind === 'pool' ? buildPoolPrompt(request) : buildLessonPrompt(request);
    const res = await this.transport.createStructured({
      model,
      system: prompt.system,
      user: prompt.user,
      schemaName: request.kind === 'pool' ? 'PoolProposal' : 'LessonProposal',
      schema: request.kind === 'pool' ? POOL_OUTPUT_SCHEMA : LESSON_OUTPUT_SCHEMA,
    });
    return { output: res.parsed, usage: res.usage };
  }
}

/** JSON Schema (Structured Output) — proposta pool senza ID tecnici. */
export const POOL_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tipo', 'testo', 'difficolta'],
        properties: {
          tipo: { type: 'string', enum: ['aperta', 'chiusa_singola', 'chiusa_multipla'] },
          testo: { type: 'string' },
          difficolta: { type: 'integer', minimum: 1, maximum: 5 },
          soluzione: {},
          opzioni: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

/** JSON Schema — solo corpo Markdown. */
export const LESSON_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['body'],
  properties: { body: { type: 'string' } },
};

export interface CreateContentProviderConfig {
  mode: ContentProviderMode;
  transport?: OpenAiResponsesTransport;
}

/** Selezione esplicita del provider — nessun fallback silenzioso. */
export function createContentProvider(config: CreateContentProviderConfig): ContentProvider {
  if (config.mode === 'disabled') {
    throw new AiContentError('feature_disabled', 'La generazione IA è disattivata.');
  }
  if (config.mode === 'mock') return new MockContentProvider();
  if (!config.transport) {
    throw new AiContentError('provider_config_invalid', 'Provider OpenAI non configurato.');
  }
  return new OpenAiContentProvider(config.transport);
}
