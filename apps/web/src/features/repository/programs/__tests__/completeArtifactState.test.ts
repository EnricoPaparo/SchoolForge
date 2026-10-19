import { describe, expect, it } from 'vitest';
import { emptyArtifactState, parseArtifactState } from '../completeArtifactState.js';
import { studyFixture } from './studyFixture.js';
import {
  createCompleteLessonCheckpoint,
  parseCompleteLessonCheckpoint,
} from '../completeLessonCheckpoint.js';
const base = {
  status: 'completed' as const,
  kind: 'pool' as const,
  modelProfile: 'quality',
  actualCostMicroUsd: 3,
  replayed: false,
  output: {
    questions: studyFixture().questions,
    coverageSummary: { coveredCapabilities: ['Tracciare'], gaps: [], advancedOrdinals: [1] },
  },
};
const expected = {
  counts: { aperta: 2, chiusa_singola: 1, chiusa_multipla: 0 },
  level: 'balanced' as const,
};
const identity = { programId: 'p', importId: 'i', lessonId: 'l' };
const options = {
  ...expected,
  modelProfile: 'quality' as const,
  reviewStatus: 'improved' as const,
};
const checkpoint = () =>
  createCompleteLessonCheckpoint({
    identity,
    body: 'SOURCE',
    options,
    nowMs: 1,
    bodyPersisted: true,
    mapCompleted: true,
    poolCompleted: false,
    mapRequestId: 'map-stable',
    poolRequestId: 'pool-stable',
    poolReviewRequestId: 'review-stable',
    mapCostMicroUsd: 1,
    poolCostMicroUsd: 0,
    visual: null,
  });
describe('resumable artifact snapshots', () => {
  it('restores generated/reviewed stages with stable IDs and sticky unknown accounting', () => {
    const generated = { ...base, actualCostMicroUsd: null };
    const reviewed = {
      ...base,
      kind: 'pool_review' as const,
      output: { ...base.output, reviewOutcome: 'unchanged' as const, issueCodes: [] },
    };
    const stored = {
      ...checkpoint(),
      poolState: { base: generated, reviewed, costUnknown: false },
    };
    const restored = parseCompleteLessonCheckpoint(JSON.stringify(stored), identity, 'SOURCE', 2)!;
    expect(restored.poolState?.base?.output).toEqual(base.output);
    expect(restored.poolState?.reviewed?.output.questions).toEqual(base.output.questions);
    expect(restored.poolState?.costUnknown).toBe(true);
    expect(restored.poolReviewRequestId).toBe('review-stable');
    expect(restored.poolRequestId).toBe('pool-stable');
    expect(
      parseCompleteLessonCheckpoint(JSON.stringify(stored), identity, 'CHANGED', 2),
    ).toBeNull();
    expect(
      parseCompleteLessonCheckpoint(JSON.stringify(checkpoint()), identity, 'SOURCE', 2),
    ).not.toBeNull();
  });
  it('whitelists source-free snapshots and retains validated coverage', () => {
    const injected = {
      ...base,
      prompt: 'PRIVATE PROMPT',
      reviewFeedback: 'PRIVATE FEEDBACK',
      output: {
        ...base.output,
        source: 'PRIVATE SOURCE',
        questions: base.output.questions.map((q) => ({ ...q, student: 'PRIVATE STUDENT' })),
      },
    };
    const sanitized = parseArtifactState(
      { base: injected, reviewed: null, costUnknown: false, private: 'PRIVATE STATE' },
      'pool',
      expected,
    );
    expect(JSON.stringify(sanitized)).not.toContain('PRIVATE');
    expect(sanitized.base?.output.coverageSummary).toEqual(base.output.coverageSummary);
    expect(injected.prompt).toBe('PRIVATE PROMPT');
  });
  it('rejects cross-kind outputs, missing bases, altered counts and difficulty', () => {
    expect(() =>
      parseArtifactState(
        {
          base: { ...base, output: { conceptMapMarkdown: '## Sintesi\n\nMappa' } },
          reviewed: null,
          costUnknown: false,
        },
        'pool',
        expected,
      ),
    ).toThrow();
    expect(() =>
      parseArtifactState(
        { base: null, reviewed: { ...base, kind: 'pool_review' }, costUnknown: false },
        'pool',
        expected,
      ),
    ).toThrow();
    expect(() =>
      parseArtifactState({ base, reviewed: null, costUnknown: false }, 'pool', {
        ...expected,
        counts: { aperta: 1, chiusa_singola: 1, chiusa_multipla: 0 },
      }),
    ).toThrow();
    expect(() =>
      parseArtifactState({ base, reviewed: null, costUnknown: false }, 'pool', {
        ...expected,
        level: 'advanced',
      }),
    ).toThrow();
    expect(parseArtifactState(emptyArtifactState(), 'pool', expected)).toEqual(
      emptyArtifactState(),
    );
  });
  it('bounds raw checkpoint payload before restoring content', () => {
    expect(() =>
      parseArtifactState(
        { base, reviewed: null, costUnknown: false, private: 'x'.repeat(700001) },
        'pool',
        expected,
      ),
    ).toThrow();
  });
});
