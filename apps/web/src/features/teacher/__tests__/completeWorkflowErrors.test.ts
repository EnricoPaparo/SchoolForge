import { describe, expect, it } from 'vitest';
import {
  CompleteWorkflowError,
  describeCompleteWorkflowError,
} from '../TotalLessonGenerationDialog.js';

describe('complete lesson stage errors', () => {
  it.each([
    ['persist_body', /salvare la lezione/i],
    ['concept_map', /riprova dalla mappa/i],
    ['question_pool', /riprova dalle domande/i],
    ['visual_plan', /riprova le immagini/i],
  ] as const)('descrive la fase %s senza esporre il messaggio raw', (stage, expected) => {
    const message = describeCompleteWorkflowError(
      new CompleteWorkflowError(stage, {
        details: { code: 'provider_unavailable' },
        message: 'raw-provider-secret-message',
      }),
    );
    expect(message).toMatch(expected);
    expect(message).not.toContain('raw-provider-secret-message');
  });

  it('non presenta un invalid_input visuale come errore dei campi', () => {
    const message = describeCompleteWorkflowError(
      new CompleteWorkflowError('visual_plan', { details: { code: 'invalid_input' } }),
    );
    expect(message).toMatch(/piano immagini/i);
    expect(message).not.toMatch(/configurazione non valida/i);
  });
});
