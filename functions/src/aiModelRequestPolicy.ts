import {
  OPENAI_RUNTIME_GPT61_SOL_MODEL,
  OPENAI_RUNTIME_GPT6_LUNA_MODEL,
} from './aiCorrectionCost.js';
import type { ModelProfile } from './aiCorrectionModelProfile.js';
import type { AiContentRequest, LessonRequest } from './aiContentCore.js';

export type OpenAiReasoningEffort = 'low' | 'medium' | 'high';
export type OpenAiTextVerbosity = 'low' | 'medium' | 'high';

/**
 * Parametri della politica GPT-6 attiva. I modelli GPT-5.6 e il precedente
 * GPT-6 Sol non ricevono implicitamente parametri nuovi: questo preserva il
 * comportamento di rollback e la compatibilità diagnostica storica.
 */
export function reasoningEffortForModel(model: string): OpenAiReasoningEffort | null {
  if (model === OPENAI_RUNTIME_GPT6_LUNA_MODEL) return 'low';
  if (model === OPENAI_RUNTIME_GPT61_SOL_MODEL) return 'medium';
  return null;
}

/**
 * Quality + lezione approfondita richiede una progettazione didattica più
 * impegnativa del profilo standard. L'override resta confinato alla policy
 * GPT-6: Economy e tutte le altre operazioni conservano l'effort di profilo,
 * mentre i modelli di rollback continuano a non ricevere parametri nuovi.
 */
export function reasoningEffortForContentRequest(
  model: string,
  request: AiContentRequest,
): OpenAiReasoningEffort | null {
  const baseline = reasoningEffortForModel(model);
  if (
    model === OPENAI_RUNTIME_GPT61_SOL_MODEL &&
    (request.kind === 'lesson' || request.kind === 'lesson_review') &&
    request.depth === 'in_depth'
  ) {
    return 'high';
  }
  return baseline;
}

export function lessonVerbosity(depth: LessonRequest['depth']): OpenAiTextVerbosity {
  if (depth === 'synthetic') return 'low';
  if (depth === 'complete') return 'medium';
  return 'high';
}

export function usesGpt6LessonPolicy(model: string): boolean {
  return reasoningEffortForModel(model) !== null;
}

/** Test/documentation helper: profile settings without exposing provider IDs to clients. */
export const GPT6_REASONING_BY_PROFILE: Readonly<Record<ModelProfile, OpenAiReasoningEffort>> = {
  economy: 'low',
  quality: 'medium',
};
