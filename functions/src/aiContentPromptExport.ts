import { AiContentError, validateAiContentRequest, resolveContentModel } from './aiContentCore.js';
import { buildContentStructuredRequest } from './aiContentPayload.js';
export function exportCurrentContentPrompt(input: unknown): { prompt: string } {
  const request = validateAiContentRequest(input);
  if (request.kind !== 'lesson' && request.kind !== 'concept_map' && request.kind !== 'pool')
    throw new AiContentError('invalid_input', 'Tipo di prompt non supportato.');
  const payload = buildContentStructuredRequest(
    request,
    resolveContentModel(request.modelProfile).model,
  );
  return { prompt: JSON.stringify(payload, null, 2) };
}
