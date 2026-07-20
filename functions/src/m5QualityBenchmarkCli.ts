import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PRICE_LIST_VERSION,
  OPENAI_BENCHMARK_CANDIDATE_MODEL,
  OPENAI_BENCHMARK_CANDIDATE_PRICE_LIST_VERSION,
  OPENAI_BENCHMARK_LUNA_MODEL,
  OPENAI_BENCHMARK_LUNA_PRICE_LIST_VERSION,
  OPENAI_PRODUCTION_MODEL,
} from './aiCorrectionCost.js';
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

/** Prefisso del flag di override modello, usabile solo dalla CLI di benchmark. */
export const M5_BENCHMARK_MODEL_FLAG = '--benchmark-model';

/**
 * M5-QUALITY-05 — modello benchmark selezionato con il relativo listino.
 * Il listino è **derivato** dall'allowlist chiusa, mai fornito dal chiamante.
 */
export interface BenchmarkModelSelection {
  model: string;
  priceListVersion: string;
}

/**
 * Allowlist **chiusa** dei modelli accettati dalla CLI di benchmark, ciascuno
 * mappato al proprio listino versionato. Nessun altro modello è ammesso e non
 * esiste alcun fallback automatico: baseline nano vs candidati mini e Luna.
 */
export const M5_BENCHMARK_ALLOWED_MODELS: Readonly<Record<string, string>> = {
  [OPENAI_PRODUCTION_MODEL]: DEFAULT_PRICE_LIST_VERSION,
  [OPENAI_BENCHMARK_CANDIDATE_MODEL]: OPENAI_BENCHMARK_CANDIDATE_PRICE_LIST_VERSION,
  [OPENAI_BENCHMARK_LUNA_MODEL]: OPENAI_BENCHMARK_LUNA_PRICE_LIST_VERSION,
};

/**
 * Risolve il modello benchmark da `argv` in modo **fail-closed**: assenza del
 * flag ⇒ baseline nano di produzione; flag presente ⇒ solo un valore
 * dell'allowlist (nano o mini). Un modello diverso, un valore vuoto o un flag
 * ripetuto termina con errore leggibile — prima di leggere la chiave o toccare
 * la rete. Non legge `settings/aiConfig`, non modifica `OPENAI_PRODUCTION_MODEL`
 * e non persiste nulla.
 */
export function resolveBenchmarkModelSelection(argv: readonly string[]): BenchmarkModelSelection {
  const prefix = `${M5_BENCHMARK_MODEL_FLAG}=`;
  const matches = argv.filter((arg) => arg === M5_BENCHMARK_MODEL_FLAG || arg.startsWith(prefix));
  if (matches.length === 0) {
    return { model: OPENAI_PRODUCTION_MODEL, priceListVersion: DEFAULT_PRICE_LIST_VERSION };
  }
  if (matches.length > 1) {
    throw new Error(`Specificare ${M5_BENCHMARK_MODEL_FLAG} una sola volta.`);
  }
  const raw = matches[0]!;
  if (!raw.startsWith(prefix)) {
    throw new Error(`Usare la forma ${M5_BENCHMARK_MODEL_FLAG}=<modello>.`);
  }
  const model = raw.slice(prefix.length).trim();
  const priceListVersion = M5_BENCHMARK_ALLOWED_MODELS[model];
  if (!priceListVersion) {
    const allowed = Object.keys(M5_BENCHMARK_ALLOWED_MODELS).join(', ');
    throw new Error(`Modello benchmark non consentito. Valori ammessi: ${allowed}.`);
  }
  return { model, priceListVersion };
}

/** Nome file report locale, distinto per modello per evitare sovrascritture. */
export function benchmarkReportFileName(model: string): string {
  return `m5-quality-05-${model}-report.json`;
}

export interface M5QualityBenchmarkCliDeps {
  argv: readonly string[];
  getApiKey: () => string | undefined;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  loadDataset: () => Promise<M5BenchmarkDataset>;
  buildPlan: (
    dataset: M5BenchmarkDataset,
    selection: BenchmarkModelSelection,
  ) => M5BenchmarkExecutionPlan;
  confirm: (prompt: string) => Promise<string>;
  createGrader: (apiKey: string, selection: BenchmarkModelSelection) => AiGrader;
  runModes: (dataset: M5BenchmarkDataset, grader: AiGrader) => Promise<M5BenchmarkModeReports>;
  buildComparison: (
    dataset: M5BenchmarkDataset,
    reports: M5BenchmarkModeReports,
    selection: BenchmarkModelSelection,
  ) => M5BenchmarkComparativeReport;
  writeReport: (
    report: M5BenchmarkComparativeReport,
    selection: BenchmarkModelSelection,
  ) => Promise<void>;
  log: (message: string) => void;
}

export type M5QualityBenchmarkCliResult = 'dry-run' | 'executed';

/**
 * CLI iniettabile e testabile. Il modello è risolto fail-closed **per primo**;
 * il provider viene costruito soltanto dopo due flag, TTY, conferma esatta e
 * presenza della chiave. Il dry-run non legge né usa la chiave e non crea
 * trasporti.
 */
export async function runM5QualityBenchmarkCli(
  deps: M5QualityBenchmarkCliDeps,
): Promise<M5QualityBenchmarkCliResult> {
  // Fail-closed prima di qualunque I/O, chiave o rete: un modello non ammesso
  // termina qui.
  const selection = resolveBenchmarkModelSelection(deps.argv);

  const dataset = await deps.loadDataset();
  const plan = deps.buildPlan(dataset, selection);
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
    `Per confermare ${plan.plannedCalls} chiamate pianificate (fino a ${plan.maximumProviderAttempts} tentativi) sul modello ${selection.model}, digitare esattamente “${M5_BENCHMARK_CONFIRMATION}”: `,
  );
  if (answer !== M5_BENCHMARK_CONFIRMATION) {
    throw new Error('Conferma non valida: benchmark annullato.');
  }

  const apiKey = deps.getApiKey()?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY non disponibile: benchmark annullato.');
  const grader = deps.createGrader(apiKey, selection);
  const reports = await deps.runModes(dataset, grader);
  const comparison = deps.buildComparison(dataset, reports, selection);
  await deps.writeReport(comparison, selection);
  deps.log(
    `Report locale scritto in lib/${benchmarkReportFileName(selection.model)}. Nessun dato è stato scritto su Firestore.`,
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
    buildPlan: (dataset, selection) =>
      buildM5BenchmarkExecutionPlan(dataset, {
        model: selection.model,
        priceListVersion: selection.priceListVersion,
      }),
    confirm: defaultConfirmation,
    createGrader: (apiKey, selection) =>
      new OpenAiGrader(selection.model, createOpenAiSdkTransport(apiKey)),
    runModes: (dataset, grader) => runM5BenchmarkModes(dataset, grader, { repetitions: 3 }),
    buildComparison: (dataset, reports, selection) =>
      buildM5BenchmarkComparativeReport(dataset, reports, selection.priceListVersion),
    writeReport: async (report, selection) => {
      const outputPath = resolve('lib', benchmarkReportFileName(selection.model));
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
