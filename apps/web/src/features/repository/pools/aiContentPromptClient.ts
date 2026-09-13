import { httpsCallable, type Functions } from 'firebase/functions';
import {
  buildLessonContentRequest,
  buildPoolContentRequest,
  DEFAULT_LESSON_DEPTH,
  DEFAULT_POOL_MODEL_PROFILE,
  DEFAULT_POOL_LEVEL,
  DEFAULT_POOL_COUNTS,
  newRequestId,
  type LessonAiContext,
} from './aiContentClient.js';
import { buildConceptMapRequest } from './aiConceptMapClient.js';
export type CopyPromptKind = 'lesson' | 'concept_map' | 'pool';
/** The same initial settings used when opening the generation dialogs today. */
export function buildCurrentPromptRequest(
  kind: CopyPromptKind,
  context: LessonAiContext,
  existingPoolQuestionCount: number,
) {
  const base = { requestId: newRequestId(), modelProfile: DEFAULT_POOL_MODEL_PROFILE };
  if (kind === 'lesson')
    return buildLessonContentRequest({ ...base, context, depth: DEFAULT_LESSON_DEPTH });
  if (kind === 'concept_map')
    return buildConceptMapRequest({ ...base, lessonBody: context.currentBody });
  return buildPoolContentRequest({
    ...base,
    level: DEFAULT_POOL_LEVEL,
    counts: DEFAULT_POOL_COUNTS,
    lessonSource: context.currentBody,
    existingPoolQuestionCount,
  });
}
export async function fetchCurrentPrompt(
  functions: Functions,
  kind: CopyPromptKind,
  context: LessonAiContext,
  existingPoolQuestionCount: number,
): Promise<string> {
  const request = buildCurrentPromptRequest(kind, context, existingPoolQuestionCount);
  const response = await httpsCallable<
    ReturnType<typeof buildCurrentPromptRequest>,
    { prompt: string }
  >(
    functions,
    'aiContentPromptExport',
  )(request);
  if (typeof response.data?.prompt !== 'string' || !response.data.prompt)
    throw new Error('Prompt non disponibile.');
  return response.data.prompt;
}
