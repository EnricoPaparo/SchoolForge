import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPENAI_BENCHMARK_CANDIDATE_MODEL, OPENAI_PRODUCTION_MODEL } from './aiCorrectionCost.js';
import type { M5BenchmarkComparativeReport } from './m5BenchmarkComparison.js';
import {
  buildM5ModelComparisonSynthesis,
  type M5ModelComparisonSynthesis,
} from './m5BenchmarkModelComparison.js';
import { benchmarkReportFileName } from './m5QualityBenchmarkCli.js';

export const M5_MODEL_COMPARISON_OUTPUT_FILE = 'm5-quality-05-model-comparison.json';

export interface M5ModelComparisonCliDeps {
  /** Legge un report comparativo locale per modello, o `null` se assente. */
  readReport: (model: string) => Promise<M5BenchmarkComparativeReport | null>;
  writeSynthesis: (synthesis: M5ModelComparisonSynthesis) => Promise<void>;
  log: (message: string) => void;
}

/**
 * Genera la sintesi comparativa fra baseline (nano) e candidato (mini). Se manca
 * anche solo uno dei due report locali, dichiara il confronto non disponibile
 * senza inventare dati.
 */
export async function runM5ModelComparisonCli(
  deps: M5ModelComparisonCliDeps,
): Promise<M5ModelComparisonSynthesis> {
  const [baseline, candidate] = await Promise.all([
    deps.readReport(OPENAI_PRODUCTION_MODEL),
    deps.readReport(OPENAI_BENCHMARK_CANDIDATE_MODEL),
  ]);
  const synthesis = buildM5ModelComparisonSynthesis(baseline, candidate);
  await deps.writeSynthesis(synthesis);
  if (synthesis.available) {
    deps.log(
      `Sintesi comparativa scritta in lib/${M5_MODEL_COMPARISON_OUTPUT_FILE} (baseline ${synthesis.baseline.model} vs candidato ${synthesis.candidate.model}).`,
    );
  } else {
    deps.log(`Confronto non disponibile: mancano i report [${synthesis.missing.join(', ')}].`);
  }
  return synthesis;
}

async function readLocalReport(model: string): Promise<M5BenchmarkComparativeReport | null> {
  const path = resolve('lib', benchmarkReportFileName(model));
  try {
    return JSON.parse(await readFile(path, 'utf8')) as M5BenchmarkComparativeReport;
  } catch {
    // File assente o illeggibile ⇒ report non disponibile (nessuna invenzione).
    return null;
  }
}

async function main(): Promise<void> {
  await runM5ModelComparisonCli({
    readReport: readLocalReport,
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
