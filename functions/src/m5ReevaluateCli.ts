import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPENAI_BENCHMARK_LUNA_MODEL } from './aiCorrectionCost.js';
import type { M5BenchmarkComparativeReport } from './m5BenchmarkComparison.js';
import { loadM5BenchmarkDataset, type M5BenchmarkDataset } from './m5BenchmarkHarness.js';
import {
  buildReevaluationReviewSummary,
  reevaluateComparativeReport,
  ReevaluationIncompatibleError,
  type ReevaluationOutcome,
  type ReevaluationReviewSummary,
} from './m5BenchmarkReevaluation.js';
import { benchmarkReportFileName } from './m5QualityBenchmarkCli.js';

/** File del report reale da rivalutare (Luna) e degli esiti derivati. */
export const M5_REEVAL_INPUT_FILE = benchmarkReportFileName(OPENAI_BENCHMARK_LUNA_MODEL);
export const M5_REEVAL_DERIVED_FILE = 'm5-quality-06-gpt-5.6-luna-reevaluated.json';
export const M5_REEVAL_SUMMARY_FILE = 'm5-quality-06-review-summary.json';

/** Comando da eseguire nel workspace che contiene il report reale Luna. */
export const M5_REEVAL_COMMAND =
  'pnpm --filter @schoolforge/functions benchmark:m5-quality:reevaluate';

export interface M5ReevaluateCliDeps {
  readReport: (fileName: string) => Promise<M5BenchmarkComparativeReport | null>;
  loadDataset: () => Promise<M5BenchmarkDataset>;
  writeDerived: (fileName: string, report: M5BenchmarkComparativeReport) => Promise<void>;
  writeSummary: (fileName: string, summary: ReevaluationReviewSummary) => Promise<void>;
  log: (message: string) => void;
}

export type M5ReevaluateCliResult =
  | { status: 'reevaluated'; outcome: ReevaluationOutcome; summary: ReevaluationReviewSummary }
  | { status: 'unavailable' };

/**
 * Rivaluta offline il report reale Luna contro il dataset aggiornato. Se il
 * report non è presente nel checkout, **non ricostruisce dati e non inventa il
 * verdetto**: dichiara `unavailable` e stampa il comando da eseguire nel
 * workspace che contiene il report. Nessuna rete, nessuna chiave, nessun
 * provider. Fail-closed sulla compatibilità (propaga
 * `ReevaluationIncompatibleError`).
 */
export async function runM5ReevaluateCli(
  deps: M5ReevaluateCliDeps,
): Promise<M5ReevaluateCliResult> {
  const report = await deps.readReport(M5_REEVAL_INPUT_FILE);
  if (!report) {
    deps.log(
      `Report reale Luna non presente (lib/${M5_REEVAL_INPUT_FILE}). Confronto non ricostruito: eseguire nel workspace che contiene il report:\n  ${M5_REEVAL_COMMAND}`,
    );
    return { status: 'unavailable' };
  }
  const dataset = await deps.loadDataset();
  const outcome = reevaluateComparativeReport(report, dataset);
  const summary = buildReevaluationReviewSummary(outcome);
  // Nuovo file derivato: il report originale non viene mai sovrascritto.
  await deps.writeDerived(M5_REEVAL_DERIVED_FILE, outcome.derived);
  await deps.writeSummary(M5_REEVAL_SUMMARY_FILE, summary);
  deps.log(
    `Rivalutazione offline completata (modello ${outcome.model}). Verdetto originale ${outcome.original.verdict} → derivato ${outcome.derived.verdict}. Report derivato: lib/${M5_REEVAL_DERIVED_FILE}; riepilogo revisione: lib/${M5_REEVAL_SUMMARY_FILE}. Gate G7 resta APERTO in attesa della revisione umana.`,
  );
  return { status: 'reevaluated', outcome, summary };
}

async function readLocalReport(fileName: string): Promise<M5BenchmarkComparativeReport | null> {
  try {
    return JSON.parse(
      await readFile(resolve('lib', fileName), 'utf8'),
    ) as M5BenchmarkComparativeReport;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  await runM5ReevaluateCli({
    readReport: readLocalReport,
    loadDataset: () => loadM5BenchmarkDataset(),
    writeDerived: async (fileName, report) => {
      await writeFile(resolve('lib', fileName), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    },
    writeSummary: async (fileName, summary) => {
      await writeFile(resolve('lib', fileName), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    },
    log: console.log,
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    if (error instanceof ReevaluationIncompatibleError) {
      console.error(`Rivalutazione rifiutata (${error.blockingField}): ${error.message}`);
    } else {
      console.error(error instanceof Error ? error.message : 'Rivalutazione non riuscita.');
    }
    process.exitCode = 1;
  });
}
