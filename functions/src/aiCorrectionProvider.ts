import {
  AiGatewayError,
  MockAiGrader,
  type AiFeatureMode,
  type AiGrader,
} from './aiCorrectionGatewayCore.js';
import { OpenAiGrader, createOpenAiSdkTransport, type OpenAiTransport } from './openAiGrader.js';

const MODEL_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export interface AiProviderConfiguration {
  mode: AiFeatureMode;
  openAiModel?: string;
  openAiApiKey?: string;
}

export interface AiProviderFactories {
  createOpenAiTransport?: (apiKey: string) => OpenAiTransport;
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
  return new OpenAiGrader(model, createTransport(apiKey));
}
