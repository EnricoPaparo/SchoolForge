import { describe, expect, it, vi } from 'vitest';
import type { AiGrader } from './aiCorrectionGatewayCore.js';
import {
  loadM5BenchmarkDataset,
  runM5Benchmark,
  runM5BenchmarkModes,
} from './m5BenchmarkHarness.js';

describe('M5 benchmark harness', () => {
  it('loads the synthetic groups and runs one deterministic call per submission', async () => {
    const dataset = await loadM5BenchmarkDataset();
    const grade = vi.fn(async (input) => ({
      requestId: input.requestId,
      results: input.questions.map((question) => ({
        order: question.order,
        points: 0,
        feedback: 'Feedback sintetico del fake.',
      })),
      generalFeedback: 'Feedback generale sintetico del fake.',
      usage: { tokens: 10, inputTokens: 8, outputTokens: 2 },
    }));
    const grader = { id: 'fake', model: 'fake-model', grade } satisfies AiGrader;
    let tick = 0;
    const report = await runM5Benchmark(dataset, grader, { now: () => tick++ * 5 });

    expect(grade).toHaveBeenCalledTimes(dataset.benchmarkSubmissions.length);
    expect(report.submissions).toHaveLength(4);
    expect(report.submissions.every((submission) => submission.latencyMs === 5)).toBe(true);
    expect(report.submissions.every((submission) => !submission.outputInvalid)).toBe(true);
    expect(report.submissions.map((submission) => submission.providerCaseIds)).toEqual(
      dataset.benchmarkSubmissions.map((submission) => submission.providerCaseIds),
    );
    for (const call of grade.mock.calls) {
      expect(call[0].questions.length).toBeGreaterThanOrEqual(3);
      expect(call[0].questions.length).toBeLessThanOrEqual(5);
    }
  });

  it('records invalid output without exposing raw errors or changing expected ranges', async () => {
    const dataset = await loadM5BenchmarkDataset();
    const expectedRanges = dataset.providerCases.map((item) => [
      item.id,
      item.expectedMinPoints,
      item.expectedMaxPoints,
    ]);
    const grader: AiGrader = {
      id: 'failing-fake',
      grade: vi.fn(async () => {
        throw new Error('raw provider output must not enter the report');
      }),
    };
    const report = await runM5Benchmark(dataset, grader, { now: () => 0 });
    expect(report.submissions.every((submission) => submission.outputInvalid)).toBe(true);
    expect(JSON.stringify(report)).not.toContain('raw provider output');
    expect(
      dataset.providerCases.map((item) => [
        item.id,
        item.expectedMinPoints,
        item.expectedMaxPoints,
      ]),
    ).toEqual(expectedRanges);
  });

  it('marks incomplete grader output as invalid even when the grader does not throw', async () => {
    const dataset = await loadM5BenchmarkDataset();
    const grader: AiGrader = {
      id: 'incomplete-fake',
      grade: vi.fn(async (input) => ({
        requestId: input.requestId,
        results: [],
        generalFeedback: 'Output intenzionalmente incompleto.',
      })),
    };
    const report = await runM5Benchmark(dataset, grader, { now: () => 0 });
    expect(report.submissions.every((submission) => submission.outputInvalid)).toBe(true);
  });

  it('runs the identical synthetic submissions in all three grading modes without network', async () => {
    const dataset = await loadM5BenchmarkDataset();
    const grade = vi.fn(async (input) => ({
      requestId: input.requestId,
      results: input.questions.map((question) => ({
        order: question.order,
        points: 0,
        feedback: 'Fixture deterministica senza rete.',
      })),
      generalFeedback: 'Feedback generale fixture.',
    }));
    const reports = await runM5BenchmarkModes(dataset, { id: 'fake', grade }, { repetitions: 2 });

    expect(grade).toHaveBeenCalledTimes(dataset.benchmarkSubmissions.length * 3 * 2);
    expect(Object.keys(reports)).toEqual(['compassionate', 'balanced', 'rigorous']);
    for (const mode of ['compassionate', 'balanced', 'rigorous'] as const) {
      expect(reports[mode]).toHaveLength(2);
      expect(reports[mode].every((report) => report.gradingMode === mode)).toBe(true);
    }

    const normalizedInputs = grade.mock.calls.map(([input]) => ({
      mode: input.gradingMode,
      questions: input.questions,
      context: input.submissionContext,
    }));
    const balanced = normalizedInputs.filter((item) => item.mode === 'balanced');
    for (const mode of ['compassionate', 'rigorous'] as const) {
      expect(
        normalizedInputs
          .filter((item) => item.mode === mode)
          .map(({ questions, context }) => ({ questions, context })),
      ).toEqual(balanced.map(({ questions, context }) => ({ questions, context })));
    }
  });
});
