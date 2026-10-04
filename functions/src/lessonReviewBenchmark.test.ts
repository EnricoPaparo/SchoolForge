import { describe, expect, it } from 'vitest';
import { buildLessonReviewPlan, LESSON_REVIEW_BENCHMARK_VERSION } from './lessonReviewBenchmark.js';

describe('lesson review benchmark plan', () => {
  it('is dry-run and exposes the call count and cost cap without a provider', () => {
    const plan = buildLessonReviewPlan({
      version: LESSON_REVIEW_BENCHMARK_VERSION,
      samples: [
        {
          id: 'sample-1',
          request: {
            kind: 'lesson_review',
            requestId: '11111111-1111-4111-8111-111111111111',
            modelProfile: 'economy',
            teacherGuidance: null,
            depth: 'complete',
            titolo: 'Titolo',
            sottotitolo: null,
            difficolta: 'base',
            concettiChiave: ['A'],
            obiettivi: ['Capire A'],
            udaTitle: 'UDA',
            udaContext: {
              title: 'UDA',
              descrizione: null,
              competenze: [],
              obiettivi: [],
              currentLessonPosition: 1,
              lessons: [{ position: 1, titolo: 'Titolo', sottotitolo: null }],
            },
            candidateBody: '## A\n\nSpiegazione congelata.',
          },
        },
      ],
    });
    expect(plan.dryRun).toBe(true);
    expect(plan.plannedCalls).toBe(1);
    expect(plan.samples[0]?.model).toBe('gpt-5.6-luna');
    expect(plan.costUpperBoundMicroUsd).toBeGreaterThan(0);
  });
});
