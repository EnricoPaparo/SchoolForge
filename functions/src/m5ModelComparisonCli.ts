import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PRICE_LIST_VERSION,
  OPENAI_BENCHMARK_CANDIDATE_MODEL,
  OPENAI_PRODUCTION_MODEL,
} from './aiCorrectionCost.js';
import type { M5BenchmarkComparativeReport } from './m5BenchmarkComparison.js';
import {
  assessBaselineCompatibility,
  buildM5ModelComparisonSynthesis,
  type BaselineExpectations,
  type M5ModelComparisonSynthesis,
} from './m5BenchmarkModelComparison.js';
import { benchmarkReportFileName } from './m5QualityBenchmarkCli.js';
import { OPENAI_GRADING_CONTRACT_VERSION } from './openAiGrader.js';

export const M5_MODEL_COMPARISON_OUTPUT_FILE = 'm5-quality-05-model-comparison.json';

/**
 * Report reale nano già prodotto da M5-QUALITY-02/04, accettato come baseline
 * **solo se** supera il controllo di compatibilità (stesso dataset, modello,
 * listino e versione del contratto di valutazione). Evita di ripetere 36
 * chiamate nano quando il report esistente è ancora valido.
 */
export const LEGACY_NANO_BASELINE_FILE = 'm5-quality-02-report.json';

/** Attese per riusare un report come baseline nano del confronto corrente. */
export function nanoBaselineExpectations(): BaselineExpectations {
  return {
    model: OPENAI_PRODUCTION_MODEL,
    priceListVersion: DEFAULT_PRICE_LIST_VERSION,
    promptContractVersion: OPENAI_GRADING_CONTRACT_VERSION,
    datasetVersion: 'm5-benchmark-dataset-v1',
  };
}

export interface M5ModelComparisonCliDeps {
  /** Legge un report comparativo locale per nome file, o `null` se assente. */
  readReportFile: (fileName: string) => Promise<M5BenchmarkComparativeReport | null>;
  writeSynthesis: (synthesis: M5ModelComparisonSynthesis) => Promise<void>;
  log: (message: string) => void;
}

/**
 * Sceglie il report baseline nano tra i candidati (prima il report per-modello
 * di M5-QUALITY-05, poi il report reale legacy M5-QUALITY-02/04), riusando il
 * primo **compatibile**. Un candidato presente ma incompatibile viene scartato
 * spiegando il campo che impedisce il riuso, senza modificarne i dati.
 */
async function resolveNanoBaseline(
  deps: M5ModelComparisonCliDeps,
): Promise<{ report: M5BenchmarkComparativeReport | null; source: string | null }> {
  const expectations = nanoBaselineExpectations();
  const candidates = [benchmarkReportFileName(OPENAI_PRODUCTION_MODEL), LEGACY_NANO_BASELINE_FILE];
  for (const fileName of candidates) {
    const report = await deps.readReportFile(fileName);
    if (!report) continue;
    const compatibility = assessBaselineCompatibility(report, expectations);
    if (compatibility.compatible) {
      deps.log(`Baseline nano: riuso il report reale ${fileName} (compatibile).`);
      return { report, source: fileName };
    }
    deps.log(`Baseline nano: ${fileName} presente ma non riusabile — ${compatibility.detail}`);
  }
  return { report: null, source: null };
}

/**
 * Genera la sintesi comparativa fra baseline (nano) e candidato (mini). Se manca
 * un report compatibile per uno dei due, dichiara il confronto non disponibile
 * senza inventare dati.
 */
export async function runM5ModelComparisonCli(
  deps: M5ModelComparisonCliDeps,
): Promise<M5ModelComparisonSynthesis> {
  const [{ report: baseline, source }, candidate] = await Promise.all([
    resolveNanoBaseline(deps),
    deps.readReportFile(benchmarkReportFileName(OPENAI_BENCHMARK_CANDIDATE_MODEL)),
  ]);
  const synthesis = buildM5ModelComparisonSynthesis(baseline, candidate);
  await deps.writeSynthesis(synthesis);
  if (synthesis.available) {
    deps.log(
      `Sintesi comparativa scritta in lib/${M5_MODEL_COMPARISON_OUTPUT_FILE} (baseline ${synthesis.baseline.model} da ${source ?? 'sconosciuto'} vs candidato ${synthesis.candidate.model}).`,
    );
  } else {
    deps.log(`Confronto non disponibile: mancano i report [${synthesis.missing.join(', ')}].`);
  }
  return synthesis;
}

async function readLocalReport(fileName: string): Promise<M5BenchmarkComparativeReport | null> {
  const path = resolve('lib', fileName);
  try {
    return JSON.parse(await readFile(path, 'utf8')) as M5BenchmarkComparativeReport;
  } catch {
    // File assente o illeggibile ⇒ report non disponibile (nessuna invenzione).
    return null;
  }
}

async function main(): Promise<void> {
  await runM5ModelComparisonCli({
    readReportFile: readLocalReport,
    writeSynthesis: async (synthesis) => {
      const outputPath = resolve('lib', M5_MODEL_COMPARISON_OUTPUT_FILE);
      await writeFile(outputPath, `${JSON.stringify(synthesis, null, 2)}\n`, 'utf8');
    },
    log: console.log,
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Sintesi comparativa non riuscita.');
    process.exitCode = 1;
  });
}
