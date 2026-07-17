import {
  AiGatewayError,
  MockAiGrader,
  type AiFeatureMode,
  type AiGrader,
} from './aiCorrectionGatewayCore.js';
import {
  DEFAULT_OPENAI_RETRY_POLICY,
  OpenAiGrader,
  createOpenAiSdkTransport,
  type OpenAiGraderDeps,
  type OpenAiTransport,
} from './openAiGrader.js';
import type { RetryPolicy } from './openAiRetryPolicy.js';

const MODEL_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export interface AiProviderConfiguration {
  mode: AiFeatureMode;
  openAiModel?: string;
  openAiApiKey?: string;
  /**
   * M5-05D2B-2 — retry/timeout dalla **config runtime validata**: la config può
   * solo **restringere** i ceiling (retry ≤ 1, timeout ≤ 60_000 ms). Assenti ⇒
   * default prudenti. È l'unica fonte del numero di retry.
   */
  retry?: { maxRetries: number; attemptTimeoutMs: number };
}

export interface AiProviderFactories {
  createOpenAiTransport?: (apiKey: string) => OpenAiTransport;
  /** Deps iniettabili del grader reale (clock/sleep/random) per i test. */
  openAiGraderDeps?: OpenAiGraderDeps;
}

/** Ceiling DEV: retry ≤ 1, timeout ≤ 60_000 ms. La config può solo restringere. */
function resolveRetryPolicy(retry: AiProviderConfiguration['retry']): RetryPolicy {
  const maxRetries = Math.max(
    0,
    Math.min(
      DEFAULT_OPENAI_RETRY_POLICY.maxRetries,
      retry?.maxRetries ?? DEFAULT_OPENAI_RETRY_POLICY.maxRetries,
    ),
  );
  const attemptTimeoutMs = Math.max(
    1,
    Math.min(
      DEFAULT_OPENAI_RETRY_POLICY.attemptTimeoutMs,
      retry?.attemptTimeoutMs ?? DEFAULT_OPENAI_RETRY_POLICY.attemptTimeoutMs,
    ),
  );
  return { ...DEFAULT_OPENAI_RETRY_POLICY, maxRetries, attemptTimeoutMs };
}

export function requireConfiguredOpenAiModel(value: string | undefined): string {
  const model = value?.trim();
  if (!model || !MODEL_ID_RE.test(model)) {
    throw new AiGatewayError(
      'provider_config_invalid',
      'Il modello OpenAI non è configurato correttamente.',
    );
  }
  return model;
}

/** Selezione esplicita: nessun fallback silenzioso fra mock e OpenAI. */
export function createConfiguredAiGrader(
  configuration: AiProviderConfiguration,
  factories: AiProviderFactories = {},
): AiGrader {
  if (configuration.mode === 'disabled') {
    throw new AiGatewayError('feature_disabled', 'Il modulo di correzione IA è disattivato.');
  }
  if (configuration.mode === 'mock') return new MockAiGrader();

  const model = requireConfiguredOpenAiModel(configuration.openAiModel);
  const apiKey = configuration.openAiApiKey?.trim();
  if (!apiKey) {
    throw new AiGatewayError(
      'provider_config_invalid',
      'Il secret OpenAI non è disponibile per la funzione di esecuzione.',
    );
  }
  const createTransport = factories.createOpenAiTransport ?? createOpenAiSdkTransport;
  return new OpenAiGrader(model, createTransport(apiKey), {
    policy: resolveRetryPolicy(configuration.retry),
    ...factories.openAiGraderDeps,
  });
}
