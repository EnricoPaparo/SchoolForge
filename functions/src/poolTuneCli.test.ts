import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createContentProvider } from './aiContentProvider.js';
import {
  DEFAULT_POOL_TUNE_OUTPUT_ROOT,
  POOL_TUNE_COST_ACK_FLAG,
  POOL_TUNE_EXECUTE_FLAG,
  loadPoolTuneResume,
  runPoolTuneCli,
  writePoolTuneCheckpoint,
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
    loadResume: vi.fn(async () => {
      throw new Error('La ripresa non era attesa in questo test.');
    }),
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
    const checkpoints: Parameters<PoolTuneCliDeps['writeOutput']>[0][] = [];
    const writeOutput = vi.fn(async (params: Parameters<PoolTuneCliDeps['writeOutput']>[0]) => {
      checkpoints.push({ ...params, samples: [...params.samples] });
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
    expect(writeOutput).toHaveBeenCalledTimes(10);
    expect(checkpoints.map((checkpoint) => checkpoint.samples.length)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 8,
    ]);
    expect(checkpoints.at(-1)?.status).toBe('complete');
    const samples = checkpoints.at(-1)?.samples ?? [];
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
  });

  it('tuning e holdout hanno conferme e conteggi distinti', async () => {
    for (const [phase, profile, phrase, calls] of [
      ['tuning', 'economy', 'ESEGUI 8 POOL TUNING REALI ECONOMY', 8],
      ['tuning', 'quality', 'ESEGUI 8 POOL TUNING REALI QUALITY', 8],
      ['holdout', 'quality', 'ESEGUI 4 POOL HOLDOUT REALI QUALITY', 4],
    ] as const) {
      const writeOutput = vi.fn(async () => 'C:/tmp/pool-report');
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
      expect(writeOutput.mock.calls.at(-1)?.[0]).toMatchObject({
        status: 'complete',
        samples: expect.arrayContaining([expect.any(Object)]),
      });
      expect(writeOutput.mock.calls.at(-1)?.[0].samples).toHaveLength(calls);
    }
  });

  it('conserva un checkpoint fallito immediatamente dopo ogni campione valido', async () => {
    const workingProvider = createContentProvider({ mode: 'mock' });
    let invocation = 0;
    const provider = {
      generate: vi.fn(async (...args: Parameters<typeof workingProvider.generate>) => {
        invocation += 1;
        if (invocation === 5) {
          return { status: 'error' as const, phase: 'invocation_unknown' as const };
        }
        return workingProvider.generate(...args);
      }),
    };
    const writeOutput = vi.fn(async () => 'C:/tmp/pool-partial');
    const options = deps({
      argv: [POOL_TUNE_EXECUTE_FLAG, POOL_TUNE_COST_ACK_FLAG],
      confirm: vi.fn(async () => 'ESEGUI 8 POOL PROFILE REALI'),
      createProvider: vi.fn(() => provider),
      writeOutput,
    });

    await expect(runPoolTuneCli(options)).rejects.toThrow(/Checkpoint conservato/);
    const last = writeOutput.mock.calls.at(-1)?.[0];
    expect(last).toMatchObject({
      status: 'failed',
      outputPath: 'C:/tmp/pool-partial',
      failure: {
        scenarioId: 'PT00-04',
        modelProfile: 'economy',
      },
    });
    expect(last?.samples).toHaveLength(4);
  });

  it('riprende il prefisso validato senza richiamare i campioni già salvati', async () => {
    const firstCheckpoints: Parameters<PoolTuneCliDeps['writeOutput']>[0][] = [];
    const firstWrite = vi.fn(async (params: Parameters<PoolTuneCliDeps['writeOutput']>[0]) => {
      firstCheckpoints.push({ ...params, samples: [...params.samples] });
      return 'C:/tmp/pool-first';
    });
    const first = deps({
      argv: [POOL_TUNE_EXECUTE_FLAG, POOL_TUNE_COST_ACK_FLAG],
      confirm: vi.fn(async () => 'ESEGUI 8 POOL PROFILE REALI'),
      writeOutput: firstWrite,
    });
    await runPoolTuneCli(first);
    const prefix = (firstCheckpoints.at(-1)?.samples ?? []).slice(0, 4);

    const provider = createContentProvider({ mode: 'mock' });
    const generate = vi.spyOn(provider, 'generate');
    const resumedCheckpoints: Parameters<PoolTuneCliDeps['writeOutput']>[0][] = [];
    const resumedWrite = vi.fn(async (params: Parameters<PoolTuneCliDeps['writeOutput']>[0]) => {
      resumedCheckpoints.push({ ...params, samples: [...params.samples] });
      return 'C:/tmp/pool-first';
    });
    const resumed = deps({
      argv: [POOL_TUNE_EXECUTE_FLAG, POOL_TUNE_COST_ACK_FLAG, '--resume-session=C:/tmp/pool-first'],
      confirm: vi.fn(async () => 'RIPRENDI 4 POOL PROFILE REALI'),
      createProvider: vi.fn(() => provider),
      loadResume: vi.fn(async () => ({
        outputPath: 'C:/tmp/pool-first',
        generatedAt: '2026-08-10T10:00:00.000Z',
        samples: prefix,
      })),
      writeOutput: resumedWrite,
    });

    await expect(runPoolTuneCli(resumed)).resolves.toBe('executed');
    expect(generate).toHaveBeenCalledTimes(4);
    expect(resumed.confirm).toHaveBeenCalledWith(
      expect.stringContaining('RIPRENDI 4 POOL PROFILE REALI'),
    );
    expect(resumedCheckpoints[0]?.samples).toHaveLength(5);
    expect(resumedCheckpoints.at(-1)?.samples).toHaveLength(8);
  });

  it('completa un checkpoint pieno rimasto running senza provider né nuova conferma', async () => {
    const completedSamples: Parameters<PoolTuneCliDeps['writeOutput']>[0]['samples'] = [];
    const seed = deps({
      argv: [POOL_TUNE_EXECUTE_FLAG, POOL_TUNE_COST_ACK_FLAG],
      confirm: vi.fn(async () => 'ESEGUI 8 POOL PROFILE REALI'),
      writeOutput: vi.fn(async (params: Parameters<PoolTuneCliDeps['writeOutput']>[0]) => {
        completedSamples.splice(0, completedSamples.length, ...params.samples);
        return 'C:/tmp/pool-full';
      }),
    });
    await runPoolTuneCli(seed);

    const writeOutput = vi.fn(async () => 'C:/tmp/pool-full');
    const resumed = deps({
      argv: [POOL_TUNE_EXECUTE_FLAG, POOL_TUNE_COST_ACK_FLAG, '--resume-session=C:/tmp/pool-full'],
      getApiKey: vi.fn(() => undefined),
      loadResume: vi.fn(async () => ({
        outputPath: 'C:/tmp/pool-full',
        generatedAt: '2026-08-10T10:00:00.000Z',
        samples: [...completedSamples],
      })),
      writeOutput,
    });

    await expect(runPoolTuneCli(resumed)).resolves.toBe('executed');
    expect(resumed.confirm).not.toHaveBeenCalled();
    expect(resumed.getApiKey).not.toHaveBeenCalled();
    expect(resumed.createProvider).not.toHaveBeenCalled();
    expect(writeOutput).toHaveBeenCalledOnce();
    expect(writeOutput).toHaveBeenCalledWith(expect.objectContaining({ status: 'complete' }));
  });

  it('non classifica un errore locale di checkpoint come errore provider', async () => {
    let write = 0;
    const writeOutput = vi.fn(async () => {
      write += 1;
      if (write === 2) throw new Error('disco non disponibile');
      return 'C:/tmp/pool-local-error';
    });
    const provider = createContentProvider({ mode: 'mock' });
    const generate = vi.spyOn(provider, 'generate');
    const options = deps({
      argv: [POOL_TUNE_EXECUTE_FLAG, POOL_TUNE_COST_ACK_FLAG],
      confirm: vi.fn(async () => 'ESEGUI 8 POOL PROFILE REALI'),
      createProvider: vi.fn(() => provider),
      writeOutput,
    });

    await expect(runPoolTuneCli(options)).rejects.toThrow(/checkpoint non confermato/);
    expect(generate).toHaveBeenCalledOnce();
    expect(writeOutput).toHaveBeenCalledTimes(2);
    expect(writeOutput.mock.calls[1]?.[0]).toMatchObject({ status: 'running', failure: null });
  });

  it('persiste e ricarica solo un prefisso canonico con costi coerenti', async () => {
    await mkdir(DEFAULT_POOL_TUNE_OUTPUT_ROOT, { recursive: true });
    const outputPath = await mkdtemp(resolve(DEFAULT_POOL_TUNE_OUTPUT_ROOT, 'pool-tune-test-'));
    try {
      const snapshots: Parameters<PoolTuneCliDeps['writeOutput']>[0][] = [];
      const seed = deps({
        argv: [POOL_TUNE_EXECUTE_FLAG, POOL_TUNE_COST_ACK_FLAG],
        confirm: vi.fn(async () => 'ESEGUI 8 POOL PROFILE REALI'),
        writeOutput: vi.fn(async (params: Parameters<PoolTuneCliDeps['writeOutput']>[0]) => {
          snapshots.push({ ...params, samples: [...params.samples] });
          return 'C:/tmp/seed';
        }),
      });
      await runPoolTuneCli(seed);
      const plan = buildPoolTuneExecutionPlan(dataset, 'profile_probe', 'quality');
      const samples = (snapshots.at(-1)?.samples ?? []).slice(0, 4);
      await writePoolTuneCheckpoint({
        dataset,
        plan,
        generatedAt: '2026-08-10T10:00:00.000Z',
        samples,
        outputPath,
        status: 'failed',
        failure: {
          scenarioId: 'PT00-04',
          modelProfile: 'economy',
          reason: 'PT00-04/economy: provider non disponibile (invocation_unknown).',
        },
      });

      await expect(
        loadPoolTuneResume({
          outputPath,
          dataset,
          plan,
          phase: 'profile_probe',
          modelProfile: 'quality',
        }),
      ).resolves.toMatchObject({
        outputPath,
        samples: expect.arrayContaining([expect.any(Object)]),
      });

      const proposalPath = resolve(outputPath, samples[0]?.fileName ?? 'missing.json');
      const proposal = JSON.parse(await readFile(proposalPath, 'utf8')) as Record<string, unknown>;
      proposal.extra = true;
      await writeFile(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`, 'utf8');
      await expect(
        loadPoolTuneResume({
          outputPath,
          dataset,
          plan,
          phase: 'profile_probe',
          modelProfile: 'quality',
        }),
      ).rejects.toThrow(/proprietà mancanti o non ammesse/);

      await writePoolTuneCheckpoint({
        dataset,
        plan,
        generatedAt: '2026-08-10T10:00:00.000Z',
        samples,
        outputPath,
        status: 'failed',
        failure: {
          scenarioId: 'PT00-04',
          modelProfile: 'economy',
          reason: 'PT00-04/economy: provider non disponibile (invocation_unknown).',
        },
      });
      const reportPath = resolve(outputPath, 'pool-tune-00-report.json');
      const report = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;
      report.totalActualCostMicroUsd = 1;
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      await expect(
        loadPoolTuneResume({
          outputPath,
          dataset,
          plan,
          phase: 'profile_probe',
          modelProfile: 'quality',
        }),
      ).rejects.toThrow(/costo totale/);
    } finally {
      await rm(outputPath, { recursive: true, force: true });
    }
  });

  it('rifiuta una sessione esterna alla directory di output', async () => {
    const plan = buildPoolTuneExecutionPlan(dataset, 'profile_probe', 'quality');
    await expect(
      loadPoolTuneResume({
        outputPath: resolve(DEFAULT_POOL_TUNE_OUTPUT_ROOT, '..', 'outside'),
        dataset,
        plan,
        phase: 'profile_probe',
        modelProfile: 'quality',
      }),
    ).rejects.toThrow(/directory figlia/);
  });
});
