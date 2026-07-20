import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { OPENAI_PRODUCTION_MODEL } from './aiCorrectionCost.js';
import type { AiGrader } from './aiCorrectionGatewayCore.js';
import {
  buildM5BenchmarkComparativeReport,
  type M5BenchmarkComparativeReport,
} from './m5BenchmarkComparison.js';
import {
  loadM5BenchmarkDataset,
  runM5BenchmarkModes,
  type M5BenchmarkDataset,
  type M5BenchmarkModeReports,
} from './m5BenchmarkHarness.js';
import { buildM5BenchmarkExecutionPlan, type M5BenchmarkExecutionPlan } from './m5BenchmarkPlan.js';
import { createOpenAiSdkTransport, OpenAiGrader } from './openAiGrader.js';

export const M5_BENCHMARK_EXECUTE_FLAG = '--execute-real-openai';
export const M5_BENCHMARK_COST_ACK_FLAG = '--i-understand-this-costs-money';
export const M5_BENCHMARK_CONFIRMATION = 'ESEGUI BENCHMARK REALE';

export interface M5QualityBenchmarkCliDeps {
  argv: readonly string[];
  getApiKey: () => string | undefined;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  loadDataset: () => Promise<M5BenchmarkDataset>;
  buildPlan: (dataset: M5BenchmarkDataset) => M5BenchmarkExecutionPlan;
  confirm: (prompt: string) => Promise<string>;
  createGrader: (apiKey: string) => AiGrader;
  runModes: (dataset: M5BenchmarkDataset, grader: AiGrader) => Promise<M5BenchmarkModeReports>;
  buildComparison: (
    dataset: M5BenchmarkDataset,
    reports: M5BenchmarkModeReports,
  ) => M5BenchmarkComparativeReport;
  writeReport: (report: M5BenchmarkComparativeReport) => Promise<void>;
  log: (message: string) => void;
}

export type M5QualityBenchmarkCliResult = 'dry-run' | 'executed';

/**
 * CLI iniettabile e testabile. Il provider viene costruito soltanto dopo due
 * flag, TTY, conferma esatta e presenza della chiave; il dry-run non legge né
 * usa la chiave e non crea trasporti.
 */
export async function runM5QualityBenchmarkCli(
  deps: M5QualityBenchmarkCliDeps,
): Promise<M5QualityBenchmarkCliResult> {
  const dataset = await deps.loadDataset();
  const plan = deps.buildPlan(dataset);
  deps.log(JSON.stringify(plan, null, 2));

  if (!deps.argv.includes(M5_BENCHMARK_EXECUTE_FLAG)) {
    deps.log('DRY-RUN: nessun provider costruito e nessuna chiamata di rete.');
    return 'dry-run';
  }
  if (!deps.argv.includes(M5_BENCHMARK_COST_ACK_FLAG)) {
    throw new Error(`Esecuzione negata: aggiungere anche ${M5_BENCHMARK_COST_ACK_FLAG}.`);
  }
  if (!deps.stdinIsTTY || !deps.stdoutIsTTY) {
    throw new Error('Esecuzione reale negata senza terminale interattivo.');
  }
  const answer = await deps.confirm(
    `Per confermare ${plan.plannedCalls} chiamate pianificate (fino a ${plan.maximumProviderAttempts} tentativi), digitare esattamente “${M5_BENCHMARK_CONFIRMATION}”: `,
  );
  if (answer !== M5_BENCHMARK_CONFIRMATION) {
    throw new Error('Conferma non valida: benchmark annullato.');
  }

  const apiKey = deps.getApiKey()?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY non disponibile: benchmark annullato.');
  const grader = deps.createGrader(apiKey);
  const reports = await deps.runModes(dataset, grader);
  const comparison = deps.buildComparison(dataset, reports);
  await deps.writeReport(comparison);
  deps.log(
    'Report locale scritto in lib/m5-quality-02-report.json. Nessun dato è stato scritto su Firestore.',
  );
  return 'executed';
}

async function defaultConfirmation(promptText: string): Promise<string> {
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    return await prompt.question(promptText);
  } finally {
    prompt.close();
  }
}

async function main(): Promise<void> {
  await runM5QualityBenchmarkCli({
    argv: process.argv,
    getApiKey: () => process.env.OPENAI_API_KEY,
    stdinIsTTY: Boolean(stdin.isTTY),
    stdoutIsTTY: Boolean(stdout.isTTY),
    loadDataset: () => loadM5BenchmarkDataset(),
    buildPlan: (dataset) => buildM5BenchmarkExecutionPlan(dataset),
    confirm: defaultConfirmation,
    createGrader: (apiKey) =>
      new OpenAiGrader(OPENAI_PRODUCTION_MODEL, createOpenAiSdkTransport(apiKey)),
    runModes: (dataset, grader) => runM5BenchmarkModes(dataset, grader, { repetitions: 3 }),
    buildComparison: buildM5BenchmarkComparativeReport,
    writeReport: async (report) => {
      const outputPath = resolve('lib', 'm5-quality-02-report.json');
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    },
    log: console.log,
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Benchmark non riuscito.');
    process.exitCode = 1;
  });
}
