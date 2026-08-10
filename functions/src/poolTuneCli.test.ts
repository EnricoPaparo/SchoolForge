import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createContentProvider } from './aiContentProvider.js';
import {
  POOL_TUNE_COST_ACK_FLAG,
  POOL_TUNE_EXECUTE_FLAG,
  runPoolTuneCli,
  type PoolTuneCliDeps,
} from './poolTuneCli.js';
import {
  buildPoolTuneExecutionPlan,
  loadPoolTuneDataset,
  type PoolTuneDataset,
} from './poolTuneBenchmark.js';

let dataset: PoolTuneDataset;

beforeAll(async () => {
  dataset = await loadPoolTuneDataset();
});

function deps(overrides: Partial<PoolTuneCliDeps> = {}): PoolTuneCliDeps {
  return {
    argv: [],
    getApiKey: vi.fn(() => 'key-that-must-not-be-read-in-dry-run'),
    stdinIsTTY: true,
    stdoutIsTTY: true,
    nodeMajorVersion: 22,
    loadDataset: vi.fn(async () => dataset),
    buildPlan: buildPoolTuneExecutionPlan,
    confirm: vi.fn(async () => 'NO'),
    createProvider: vi.fn(() => createContentProvider({ mode: 'mock' })),
    writeOutput: vi.fn(async () => 'C:/tmp/pool-report'),
    now: () => new Date('2026-08-10T10:00:00.000Z'),
    log: vi.fn(),
    ...overrides,
  };
}

describe('POOL-TUNE-00 — runner fail-closed', () => {
  it('default è dry-run del profile probe e non legge la API key', async () => {
    const options = deps();
    await expect(runPoolTuneCli(options)).resolves.toBe('dry-run');
    expect(options.getApiKey).not.toHaveBeenCalled();
    expect(options.createProvider).not.toHaveBeenCalled();
    expect(options.confirm).not.toHaveBeenCalled();
    expect(options.writeOutput).not.toHaveBeenCalled();
    const output = vi.mocked(options.log).mock.calls.flat().join('\n');
    expect(output).toContain('DRY-RUN');
    expect(output).toContain('aigen-prompt-01-pool-v1');
    expect(output).not.toContain('lesson-depth-01-candidate-e-v1');
  });

  it('rifiuta flag sconosciuti prima di qualunque lettura', async () => {
    const options = deps({ argv: ['--surprise'] });
    await expect(runPoolTuneCli(options)).rejects.toThrow(/Flag non supportato/);
    expect(options.loadDataset).not.toHaveBeenCalled();
  });

  it('il profile probe non accetta un profilo singolo', async () => {
    const options = deps({ argv: ['--benchmark-model-profile=economy'] });
    await expect(runPoolTuneCli(options)).rejects.toThrow(/confronta già economy e quality/);
    expect(options.loadDataset).not.toHaveBeenCalled();
  });

  it('rifiuta esecuzione senza presa d’atto del costo prima della API key', async () => {
    const options = deps({ argv: [POOL_TUNE_EXECUTE_FLAG] });
    await expect(runPoolTuneCli(options)).rejects.toThrow(POOL_TUNE_COST_ACK_FLAG);
    expect(options.getApiKey).not.toHaveBeenCalled();
    expect(options.confirm).not.toHaveBeenCalled();
  });

  it('rifiuta Node diverso da 22 e terminale non interattivo', async () => {
    const argv = [POOL_TUNE_EXECUTE_FLAG, POOL_TUNE_COST_ACK_FLAG];
    const wrongNode = deps({ argv, nodeMajorVersion: 24 });
    await expect(runPoolTuneCli(wrongNode)).rejects.toThrow(/Node 22/);
    expect(wrongNode.getApiKey).not.toHaveBeenCalled();

    const noTty = deps({ argv, stdinIsTTY: false });
    await expect(runPoolTuneCli(noTty)).rejects.toThrow(/terminale interattivo/);
    expect(noTty.getApiKey).not.toHaveBeenCalled();
  });

  it('richiede la frase esatta e non legge la chiave se è sbagliata', async () => {
    const options = deps({
      argv: [POOL_TUNE_EXECUTE_FLAG, POOL_TUNE_COST_ACK_FLAG],
      confirm: vi.fn(async () => 'quasi'),
    });
    await expect(runPoolTuneCli(options)).rejects.toThrow(/Conferma non valida/);
    expect(options.confirm).toHaveBeenCalledWith(
      expect.stringContaining('ESEGUI 8 POOL PROFILE REALI'),
    );
    expect(options.getApiKey).not.toHaveBeenCalled();
  });

  it('rifiuta chiave assente dopo la conferma esatta', async () => {
    const options = deps({
      argv: [POOL_TUNE_EXECUTE_FLAG, POOL_TUNE_COST_ACK_FLAG],
      confirm: vi.fn(async () => 'ESEGUI 8 POOL PROFILE REALI'),
      getApiKey: vi.fn(() => undefined),
    });
    await expect(runPoolTuneCli(options)).rejects.toThrow(/OPENAI_API_KEY/);
    expect(options.createProvider).not.toHaveBeenCalled();
  });

  it('esegue il probe locale col provider mock e conserva otto output separati', async () => {
    const writeOutput = vi.fn(async ({ samples }) => {
      expect(samples).toHaveLength(8);
      expect(samples.map((sample) => sample.modelProfile)).toEqual([
        'economy',
        'quality',
        'economy',
        'quality',
        'economy',
        'quality',
        'economy',
        'quality',
      ]);
      expect(new Set(samples.map((sample) => sample.fileName)).size).toBe(8);
      expect(samples.every((sample) => sample.proposal.questions.length >= 6)).toBe(true);
      return 'C:/tmp/pool-report';
    });
    const options = deps({
      argv: [POOL_TUNE_EXECUTE_FLAG, POOL_TUNE_COST_ACK_FLAG],
      confirm: vi.fn(async () => 'ESEGUI 8 POOL PROFILE REALI'),
      getApiKey: vi.fn(() => 'test-key'),
      writeOutput,
    });
    await expect(runPoolTuneCli(options)).resolves.toBe('executed');
    expect(options.createProvider).toHaveBeenCalledTimes(1);
    expect(writeOutput).toHaveBeenCalledTimes(1);
  });

  it('tuning e holdout hanno conferme e conteggi distinti', async () => {
    for (const [phase, profile, phrase, calls] of [
      ['tuning', 'economy', 'ESEGUI 8 POOL TUNING REALI ECONOMY', 8],
      ['tuning', 'quality', 'ESEGUI 8 POOL TUNING REALI QUALITY', 8],
      ['holdout', 'quality', 'ESEGUI 4 POOL HOLDOUT REALI QUALITY', 4],
    ] as const) {
      const writeOutput = vi.fn(async ({ samples }) => {
        expect(samples).toHaveLength(calls);
        return 'C:/tmp/pool-report';
      });
      const options = deps({
        argv: [
          POOL_TUNE_EXECUTE_FLAG,
          POOL_TUNE_COST_ACK_FLAG,
          `--benchmark-phase=${phase}`,
          `--benchmark-model-profile=${profile}`,
        ],
        confirm: vi.fn(async () => phrase),
        getApiKey: vi.fn(() => 'test-key'),
        writeOutput,
      });
      await expect(runPoolTuneCli(options)).resolves.toBe('executed');
      expect(options.confirm).toHaveBeenCalledWith(expect.stringContaining(phrase));
    }
  });
});
