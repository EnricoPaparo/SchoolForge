import { describe, expect, it, vi } from 'vitest';
import type { ContentProvider } from './aiContentProvider.js';
import {
  buildLessonManualQualityExecutionPlan,
  parseLessonManualQualityDataset,
  LESSON_MANUAL_SCENARIO_CATEGORIES,
  type LessonManualQualityDataset,
} from './lessonManualQualityBenchmark.js';
import {
  LESSON_MANUAL_CONFIRMATION,
  LESSON_MANUAL_COST_ACK_FLAG,
  LESSON_MANUAL_EXECUTE_FLAG,
  runLessonManualQualityCli,
  type LessonManualQualityCliDeps,
} from './lessonManualQualityCli.js';

function dataset(): LessonManualQualityDataset {
  return parseLessonManualQualityDataset({
    datasetVersion: 'lesson-manual-02-scenarios-v1',
    rubricVersion: 'lesson-manual-02-rubric-v1',
    generatedSamplesIncluded: false,
    primaryModelProfile: 'economy',
    scenarios: LESSON_MANUAL_SCENARIO_CATEGORIES.map((category, index) => ({
      id: `LM02-${String(index + 1).padStart(2, '0')}`,
      category,
      titolo: `Titolo ${index + 1}`,
      sottotitolo: null,
      difficolta: '2',
      concettiChiave: ['Concetto'],
      obiettivi: ['Obiettivo'],
      udaTitle: 'UDA test',
      udaContext: {
        title: 'UDA test',
        currentLessonPosition: 1,
        lessons: [{ position: 1, titolo: `Titolo ${index + 1}`, sottotitolo: null }],
      },
      depth: 'synthetic',
      teacherGuidance: null,
    })),
  });
}

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

function deps(overrides: Partial<LessonManualQualityCliDeps> = {}): LessonManualQualityCliDeps {
  const data = dataset();
  return {
    argv: [],
    getApiKey: vi.fn(() => 'secret'),
    stdinIsTTY: true,
    stdoutIsTTY: true,
    nodeMajorVersion: 22,
    loadDataset: vi.fn(async () => data),
    buildPlan: buildLessonManualQualityExecutionPlan,
    confirm: vi.fn(async () => LESSON_MANUAL_CONFIRMATION),
    createProvider: vi.fn(() => provider()),
    writeOutput: vi.fn(async () => 'lib/test-output'),
    now: () => new Date('2026-08-03T12:00:00.000Z'),
    log: vi.fn(),
    ...overrides,
  };
}

describe('LESSON-MANUAL-03 CLI', () => {
  it('è dry-run di default e non legge chiave, provider o writer', async () => {
    const d = deps();
    await expect(runLessonManualQualityCli(d)).resolves.toBe('dry-run');
    expect(d.getApiKey).not.toHaveBeenCalled();
    expect(d.createProvider).not.toHaveBeenCalled();
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.writeOutput).not.toHaveBeenCalled();
  });

  it('rifiuta flag sconosciuti prima di caricare il dataset o leggere la chiave', async () => {
    const d = deps({ argv: ['--benchmark-model=quality'] });
    await expect(runLessonManualQualityCli(d)).rejects.toThrow(/Flag non supportato/);
    expect(d.loadDataset).not.toHaveBeenCalled();
    expect(d.getApiKey).not.toHaveBeenCalled();
  });

  it('richiede ack costo, TTY e frase esatta prima della chiave', async () => {
    const withoutAck = deps({ argv: [LESSON_MANUAL_EXECUTE_FLAG] });
    await expect(runLessonManualQualityCli(withoutAck)).rejects.toThrow(/aggiungere anche/);
    expect(withoutAck.getApiKey).not.toHaveBeenCalled();

    const wrongNode = deps({
      argv: [LESSON_MANUAL_EXECUTE_FLAG, LESSON_MANUAL_COST_ACK_FLAG],
      nodeMajorVersion: 24,
    });
    await expect(runLessonManualQualityCli(wrongNode)).rejects.toThrow(/Node 22/);
    expect(wrongNode.getApiKey).not.toHaveBeenCalled();

    const noTty = deps({
      argv: [LESSON_MANUAL_EXECUTE_FLAG, LESSON_MANUAL_COST_ACK_FLAG],
      stdinIsTTY: false,
    });
    await expect(runLessonManualQualityCli(noTty)).rejects.toThrow(/terminale interattivo/);
    expect(noTty.getApiKey).not.toHaveBeenCalled();

    const wrongPhrase = deps({
      argv: [LESSON_MANUAL_EXECUTE_FLAG, LESSON_MANUAL_COST_ACK_FLAG],
      confirm: vi.fn(async () => 'NO'),
    });
    await expect(runLessonManualQualityCli(wrongPhrase)).rejects.toThrow(/Conferma non valida/);
    expect(wrongPhrase.getApiKey).not.toHaveBeenCalled();
  });

  it('rifiuta la chiave assente senza costruire il provider', async () => {
    const d = deps({
      argv: [LESSON_MANUAL_EXECUTE_FLAG, LESSON_MANUAL_COST_ACK_FLAG],
      getApiKey: vi.fn(() => undefined),
    });
    await expect(runLessonManualQualityCli(d)).rejects.toThrow(/OPENAI_API_KEY/);
    expect(d.createProvider).not.toHaveBeenCalled();
  });

  it('genera sei campioni validati e scrive una sola volta dopo il lotto completo', async () => {
    const contentProvider = provider();
    const d = deps({
      argv: [LESSON_MANUAL_EXECUTE_FLAG, LESSON_MANUAL_COST_ACK_FLAG],
      createProvider: vi.fn(() => contentProvider),
    });
    await expect(runLessonManualQualityCli(d)).resolves.toBe('executed');
    expect(contentProvider.generate).toHaveBeenCalledTimes(6);
    expect(d.writeOutput).toHaveBeenCalledTimes(1);
    const params = vi.mocked(d.writeOutput).mock.calls[0]?.[0];
    expect(params?.samples).toHaveLength(6);
    expect(params?.samples.every((sample) => sample.body.startsWith('## Titolo'))).toBe(true);
    expect(params?.samples.every((sample) => sample.actualCostMicroUsd !== null)).toBe(true);
  });

  it('si ferma su output invalido e non scrive un report parziale', async () => {
    const invalidProvider: ContentProvider = {
      generate: vi.fn(async () => ({
        status: 'ok' as const,
        output: { body: '' },
        usage: { inputTokens: 1, outputTokens: 1 },
        metered: true,
        priorBillingRisk: false,
      })),
    };
    const d = deps({
      argv: [LESSON_MANUAL_EXECUTE_FLAG, LESSON_MANUAL_COST_ACK_FLAG],
      createProvider: vi.fn(() => invalidProvider),
    });
    await expect(runLessonManualQualityCli(d)).rejects.toThrow(/Corpo della lezione/);
    expect(invalidProvider.generate).toHaveBeenCalledTimes(1);
    expect(d.writeOutput).not.toHaveBeenCalled();
  });

  it('non presenta un costo effettivo quando esiste billing risk precedente', async () => {
    const riskyProvider: ContentProvider = {
      generate: vi.fn(async (request) => ({
        status: 'ok' as const,
        output: { body: `## ${request.kind === 'lesson' ? request.titolo : 'Errore'}` },
        usage: { inputTokens: 100, outputTokens: 200 },
        metered: true,
        priorBillingRisk: true,
      })),
    };
    const d = deps({
      argv: [LESSON_MANUAL_EXECUTE_FLAG, LESSON_MANUAL_COST_ACK_FLAG],
      createProvider: vi.fn(() => riskyProvider),
    });
    await runLessonManualQualityCli(d);
    const params = vi.mocked(d.writeOutput).mock.calls[0]?.[0];
    expect(params?.samples.every((sample) => sample.actualCostMicroUsd === null)).toBe(true);
    expect(params?.samples.every((sample) => sample.priorBillingRisk)).toBe(true);
  });
});
