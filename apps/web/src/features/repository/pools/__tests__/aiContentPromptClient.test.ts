import { describe, expect, it } from 'vitest';
import { buildCurrentPromptRequest } from '../aiContentPromptClient.js';
import {
  buildLessonContentRequest,
  buildPoolContentRequest,
  DEFAULT_LESSON_DEPTH,
  DEFAULT_POOL_MODEL_PROFILE,
  DEFAULT_POOL_COUNTS,
  DEFAULT_POOL_LEVEL,
  type LessonAiContext,
} from '../aiContentClient.js';
import { buildConceptMapRequest } from '../aiConceptMapClient.js';
const context: LessonAiContext = {
  titolo: 'Le reti',
  sottotitolo: null,
  difficolta: 'intermedia',
  udaTitle: 'UDA 1',
  concettiChiave: ['TCP'],
  obiettivi: ['Capire i livelli'],
  currentBody: '## Reti\n\nTesto aggiornato.',
  udaContext: {
    title: 'UDA 1',
    descrizione: 'Contesto aggiornato',
    competenze: ['Progettare una LAN'],
    obiettivi: ['Riconoscere i livelli'],
    currentLessonPosition: 1,
    lessons: [{ position: 1, titolo: 'Le reti', sottotitolo: null }],
  },
};
describe('current prompt requests', () => {
  it.each(['lesson', 'concept_map', 'pool'] as const)(
    'uses the exact current %s dialog defaults and context',
    (kind) => {
      const actual = buildCurrentPromptRequest(kind, context, 4);
      const base = { requestId: actual.requestId, modelProfile: DEFAULT_POOL_MODEL_PROFILE };
      const expected =
        kind === 'lesson'
          ? buildLessonContentRequest({ ...base, depth: DEFAULT_LESSON_DEPTH, context })
          : kind === 'concept_map'
            ? buildConceptMapRequest({ ...base, lessonBody: context.currentBody })
            : buildPoolContentRequest({
                ...base,
                level: DEFAULT_POOL_LEVEL,
                counts: DEFAULT_POOL_COUNTS,
                lessonSource: context.currentBody,
                existingPoolQuestionCount: 4,
              });
      expect(actual).toEqual(expected);
      expect(JSON.stringify(actual)).toContain('Testo aggiornato.');
      expect(actual.modelProfile).toBe('economy');
    },
  );
});
