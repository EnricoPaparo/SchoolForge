import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { OPENAI_PRODUCTION_MODEL } from './aiCorrectionCost.js';
import { buildM5BenchmarkComparativeReport } from './m5BenchmarkComparison.js';
import { loadM5BenchmarkDataset, runM5BenchmarkModes } from './m5BenchmarkHarness.js';
import { buildM5BenchmarkExecutionPlan } from './m5BenchmarkPlan.js';
import { createOpenAiSdkTransport, OpenAiGrader } from './openAiGrader.js';

const EXECUTE_FLAG = '--execute-real-openai';
const COST_ACK_FLAG = '--i-understand-this-costs-money';
const CONFIRMATION = 'ESEGUI BENCHMARK REALE';

async function main(): Promise<void> {
  const dataset = await loadM5BenchmarkDataset();
  const plan = buildM5BenchmarkExecutionPlan(dataset);
  console.log(JSON.stringify(plan, null, 2));

  const execute = process.argv.includes(EXECUTE_FLAG);
  if (!execute) {
    console.log('DRY-RUN: nessun provider costruito e nessuna chiamata di rete.');
    return;
  }
  if (!process.argv.includes(COST_ACK_FLAG)) {
    throw new Error(`Esecuzione negata: aggiungere anche ${COST_ACK_FLAG}.`);
  }
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('Esecuzione reale negata senza terminale interattivo.');
  }

  const prompt = createInterface({ input: stdin, output: stdout });
  const answer = await prompt.question(
    `Per confermare ${plan.plannedCalls} chiamate pianificate (fino a ${plan.maximumProviderAttempts} tentativi), digitare esattamente “${CONFIRMATION}”: `,
  );
  prompt.close();
  if (answer !== CONFIRMATION) throw new Error('Conferma non valida: benchmark annullato.');

  // Il secret viene letto soltanto dopo entrambi i flag e la conferma interattiva.
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY non disponibile: benchmark annullato.');
  const grader = new OpenAiGrader(OPENAI_PRODUCTION_MODEL, createOpenAiSdkTransport(apiKey));
  const reports = await runM5BenchmarkModes(dataset, grader, { repetitions: 3 });
  const comparison = buildM5BenchmarkComparativeReport(dataset, reports);
  const outputPath = resolve('lib', 'm5-quality-02-report.json');
  await writeFile(outputPath, `${JSON.stringify(comparison, null, 2)}\n`, 'utf8');
  console.log(`Report locale scritto in ${outputPath}. Nessun dato è stato scritto su Firestore.`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Benchmark non riuscito.');
  process.exitCode = 1;
});
