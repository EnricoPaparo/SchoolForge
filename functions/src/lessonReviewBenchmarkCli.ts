import { readdir, mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createContentProvider } from './aiContentProvider.js';
import { validateLessonReviewProposal } from './aiContentValidation.js';
import {
  buildLessonReviewPlan,
  LESSON_REVIEW_PROFILES,
  LESSON_REVIEW_SPLITS,
  loadLessonReviewManifest,
  type LessonReviewSplit,
} from './lessonReviewBenchmark.js';
import { DEFAULT_OPENAI_RETRY_POLICY, type OpenAiTransport } from './openAiGrader.js';
import type { ModelProfile } from './aiCorrectionModelProfile.js';

export const EXECUTE = '--execute-real-openai';
export const ACK = '--i-understand-this-costs-money';
export const BENCHMARK_RETRY_POLICY = { ...DEFAULT_OPENAI_RETRY_POLICY, maxRetries: 0 } as const;

export interface LessonReviewCliArgs {
  manifestPath: string;
  outputPath: string | null;
  split: LessonReviewSplit;
  profile: ModelProfile;
  executeReal: boolean;
}

export function parseLessonReviewCliArgs(args: string[]): LessonReviewCliArgs {
  const seen = new Set<string>();
  let manifestPath: string | null = null;
  let outputPath: string | null = null;
  let split: LessonReviewSplit | null = null;
  let profile: ModelProfile | null = null;
  let executeReal = false;
  let acknowledged = false;
  for (const arg of args) {
    const name = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
    if (seen.has(name)) throw new Error(`Flag duplicato: ${name}.`);
    seen.add(name);
    if (arg.startsWith('--manifest=')) manifestPath = arg.slice('--manifest='.length);
    else if (arg.startsWith('--output=')) outputPath = arg.slice('--output='.length);
    else if (arg.startsWith('--split=')) {
      const value = arg.slice('--split='.length);
      if (!LESSON_REVIEW_SPLITS.includes(value as LessonReviewSplit))
        throw new Error('Split non valido.');
      split = value as LessonReviewSplit;
    } else if (arg.startsWith('--profile=')) {
      const value = arg.slice('--profile='.length);
      if (!LESSON_REVIEW_PROFILES.includes(value as ModelProfile))
        throw new Error('Profilo non valido.');
      profile = value as ModelProfile;
    } else if (arg === EXECUTE) executeReal = true;
    else if (arg === ACK) acknowledged = true;
    else throw new Error(`Flag sconosciuto: ${arg}.`);
  }
  if (!manifestPath) throw new Error('Specificare --manifest=<manifest JSON>.');
  if (!split) throw new Error('Specificare --split=tuning|holdout.');
  if (!profile) throw new Error('Specificare --profile=economy|quality.');
  if (executeReal !== acknowledged)
    throw new Error('I due flag di autorizzazione reale devono comparire insieme.');
  if (!executeReal && outputPath) throw new Error('--output è ammesso soltanto in modalità reale.');
  return { manifestPath, outputPath, split, profile, executeReal };
}

export function assertNode22(version = process.versions.node): void {
  if (!/^22\./.test(version))
    throw new Error(`Node.js 22 richiesto; versione corrente: ${version}.`);
}

export function createLessonReviewBenchmarkProvider(params: {
  openAiApiKey?: string;
  transport?: OpenAiTransport;
}) {
  return createContentProvider({
    mode: 'openai',
    ...(params.openAiApiKey ? { openAiApiKey: params.openAiApiKey } : {}),
    ...(params.transport ? { transport: params.transport } : {}),
    runnerDeps: { policy: BENCHMARK_RETRY_POLICY },
  });
}

export async function prepareOutputDirectory(path: string): Promise<void> {
  try {
    const info = await stat(path);
    if (!info.isDirectory()) throw new Error('Il path di output non è una directory.');
    if ((await readdir(path)).length > 0) throw new Error('La directory di output non è vuota.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(path, { recursive: true });
  }
}

export async function runLessonReviewBenchmarkCli(args = process.argv.slice(2)): Promise<void> {
  assertNode22();
  const parsed = parseLessonReviewCliArgs(args);
  const manifest = await loadLessonReviewManifest(resolve(parsed.manifestPath));
  const plan = buildLessonReviewPlan(manifest, { split: parsed.split, profile: parsed.profile });
  const printablePlan = {
    ...plan,
    samples: plan.samples.map(({ request: _request, ...sample }) => sample),
  };
  console.log(JSON.stringify(printablePlan, null, 2));
  if (!parsed.executeReal) {
    console.log('DRY-RUN: nessuna API key letta e nessuna chiamata provider.');
    return;
  }
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error('Esecuzione reale negata: serve un terminale interattivo.');
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY assente.');
  const outputDirectory = resolve(
    parsed.outputPath ?? `lesson-review-${parsed.profile}-${parsed.split}`,
  );
  await prepareOutputDirectory(outputDirectory);
  const rl = createInterface({ input: stdin, output: stdout });
  const phrase = `ESEGUI ${plan.plannedCalls} REVISIONI REALI FINO A ${plan.costUpperBoundMicroUsd} MICROUSD`;
  const answer = await rl.question(`Scrivi ${phrase}: `);
  rl.close();
  if (answer !== phrase) throw new Error('Conferma non valida.');
  const provider = createLessonReviewBenchmarkProvider({ openAiApiKey: key });
  const results: Array<Record<string, unknown>> = [];
  for (const sample of plan.samples) {
    const outcome = await provider.generate(sample.request, sample.model);
    if (outcome.status !== 'ok') throw new Error(`${sample.id}: chiamata fallita.`);
    const reviewed = validateLessonReviewProposal(outcome.output);
    const record = {
      id: sample.id,
      manifestHash: plan.manifestHash,
      promptContractVersion: plan.promptContractVersion,
      model: sample.model,
      priceListVersion: sample.priceListVersion,
      inputHash: sample.inputHash,
      reviewed,
      usage: outcome.usage,
    };
    await writeFile(
      resolve(outputDirectory, `${sample.id}.json`),
      JSON.stringify(record, null, 2),
      { encoding: 'utf8', flag: 'wx' },
    );
    results.push(record);
  }
  await writeFile(
    resolve(outputDirectory, 'report.json'),
    JSON.stringify({ ...printablePlan, results }, null, 2),
    { encoding: 'utf8', flag: 'wx' },
  );
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await runLessonReviewBenchmarkCli();
