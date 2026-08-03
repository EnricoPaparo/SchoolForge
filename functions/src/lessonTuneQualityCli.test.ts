import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ContentProvider } from './aiContentProvider.js';
import {
  buildLessonTuneExecutionPlan,
  loadLessonTuneDataset,
  type LessonTuneDataset,
} from './lessonTuneQualityBenchmark.js';
import {
  LESSON_TUNE_COST_ACK_FLAG,
  LESSON_TUNE_EXECUTE_FLAG,
  runLessonTuneCli,
  type LessonTuneCliDeps,
} from './lessonTuneQualityCli.js';

let data: LessonTuneDataset;

beforeAll(async () => {
  data = await loadLessonTuneDataset();
});

function provider(): ContentProvider {
  return {
    generate: vi.fn(async (request) => ({
      status: 'ok' as const,
      output: { body: `## ${request.kind === 'lesson' ? request.titolo : 'Errore'}\n\nTest.` },
      usage: { inputTokens: 100, outputTokens: 200 },
      metered: true,
      priorBillingRisk: false,
    })),
  };
}

function deps(overrides: Partial<LessonTuneCliDeps> = {}): LessonTuneCliDeps {
  return {
    argv: [],
    getApiKey: vi.fn(() => 'secret'),
    stdinIsTTY: true,
    stdoutIsTTY: true,
    nodeMajorVersion: 22,
    loadDataset: vi.fn(async () => data),
    buildPlan: vi.fn(buildLessonTuneExecutionPlan),
    confirm: vi.fn(async () => 'ESEGUI 8 LEZIONI TUNING REALI'),
    createProvider: vi.fn(() => provider()),
    writeOutput: vi.fn(async () => 'lib/test-output'),
    now: () => new Date('2026-08-03T12:00:00.000Z'),
    log: vi.fn(),
    ...overrides,
  };
}

describe('LESSON-TUNE-01 CLI', () => {
  it('mostra il piano completo in dry-run senza leggere la chiave', async () => {
    const d = deps();
    await expect(runLessonTuneCli(d)).resolves.toBe('dry-run');
    expect(d.buildPlan).toHaveBeenCalledWith(data, 'all');
    expect(d.getApiKey).not.toHaveBeenCalled();
    expect(d.createProvider).not.toHaveBeenCalled();
    expect(d.writeOutput).not.toHaveBeenCalled();
  });

  it('rifiuta esecuzione reale senza split esplicito prima della chiave', async () => {
    const d = deps({ argv: [LESSON_TUNE_EXECUTE_FLAG, LESSON_TUNE_COST_ACK_FLAG] });
    await expect(runLessonTuneCli(d)).rejects.toThrow(/scegliere esplicitamente/);
    expect(d.getApiKey).not.toHaveBeenCalled();
  });

  it('rifiuta split e flag sconosciuti', async () => {
    const split = deps({ argv: ['--benchmark-split=all'] });
    await expect(runLessonTuneCli(split)).rejects.toThrow(/Split benchmark/);
    const unknown = deps({ argv: ['--benchmark-model=quality'] });
    await expect(runLessonTuneCli(unknown)).rejects.toThrow(/Flag non supportato/);
  });

  it('genera soltanto gli otto scenari tuning con conferma dedicata', async () => {
    const contentProvider = provider();
    const d = deps({
      argv: ['--benchmark-split=tuning', LESSON_TUNE_EXECUTE_FLAG, LESSON_TUNE_COST_ACK_FLAG],
      createProvider: vi.fn(() => contentProvider),
    });
    await expect(runLessonTuneCli(d)).resolves.toBe('executed');
    expect(contentProvider.generate).toHaveBeenCalledTimes(8);
    const params = vi.mocked(d.writeOutput).mock.calls[0]?.[0];
    expect(params?.split).toBe('tuning');
    expect(params?.samples).toHaveLength(8);
    expect(params?.samples.every((sample) => sample.split === 'tuning')).toBe(true);
  });

  it('protegge lo split holdout con una frase distinta', async () => {
    const wrong = deps({
      argv: ['--benchmark-split=holdout', LESSON_TUNE_EXECUTE_FLAG, LESSON_TUNE_COST_ACK_FLAG],
    });
    await expect(runLessonTuneCli(wrong)).rejects.toThrow(/Conferma non valida/);
    expect(wrong.getApiKey).not.toHaveBeenCalled();

    const contentProvider = provider();
    const valid = deps({
      argv: ['--benchmark-split=holdout', LESSON_TUNE_EXECUTE_FLAG, LESSON_TUNE_COST_ACK_FLAG],
      confirm: vi.fn(async () => 'ESEGUI 4 LEZIONI HOLDOUT REALI'),
      createProvider: vi.fn(() => contentProvider),
    });
    await expect(runLessonTuneCli(valid)).resolves.toBe('executed');
    expect(contentProvider.generate).toHaveBeenCalledTimes(4);
  });

  it('mantiene Node 22, TTY e chiave come precondizioni fail-closed', async () => {
    const wrongNode = deps({
      argv: ['--benchmark-split=tuning', LESSON_TUNE_EXECUTE_FLAG, LESSON_TUNE_COST_ACK_FLAG],
      nodeMajorVersion: 24,
    });
    await expect(runLessonTuneCli(wrongNode)).rejects.toThrow(/Node 22/);
    expect(wrongNode.getApiKey).not.toHaveBeenCalled();

    const noTty = deps({
      argv: ['--benchmark-split=tuning', LESSON_TUNE_EXECUTE_FLAG, LESSON_TUNE_COST_ACK_FLAG],
      stdinIsTTY: false,
    });
    await expect(runLessonTuneCli(noTty)).rejects.toThrow(/terminale interattivo/);
    expect(noTty.getApiKey).not.toHaveBeenCalled();
  });
});
