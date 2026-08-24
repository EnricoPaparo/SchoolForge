import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { actualCostMicroUsd } from './aiCorrectionCost.js';
import { resolveContentModel } from './aiContentCore.js';
import { createContentProvider, type ContentProvider } from './aiContentProvider.js';
import {
  assertVisualProposalMatchesRequest,
  validateVisualProposalEnvelope,
  type VisualProposalOutput,
} from './aiContentVisualProposal.js';
import { AI_VISUAL_SERVER_CONFIG, actualVisualCostMicroUsd } from './aiVisualCore.js';
import { normalizeVisualWebp, type NormalizedVisual } from './aiVisualNormalizer.js';
import {
  createImageProvider,
  createOpenAiImageTransport,
  type ImageProvider,
} from './aiVisualProvider.js';
import { AI_VISUAL_NORMALIZER_VERSION } from './aiVisualCore.js';
import {
  buildVisualProposalRequest,
  buildVisualQualityExecutionPlan,
  loadVisualQualityDataset,
  selectVisualQualityScenarios,
  type VisualQualityDataset,
  type VisualQualityExecutionPlan,
  type VisualQualityScenario,
  type VisualQualitySplit,
} from './visualQualityBenchmark.js';

export const VISUAL_QUALITY_EXECUTE_FLAG = '--execute-real-openai';
export const VISUAL_QUALITY_COST_ACK_FLAG = '--i-understand-this-costs-money';
export const VISUAL_QUALITY_SPLIT_PREFIX = '--benchmark-split=';
export const VISUAL_QUALITY_RESUME_PREFIX = '--resume-session=';
export const DEFAULT_VISUAL_QUALITY_OUTPUT_ROOT = fileURLToPath(
  new URL('../lib/', import.meta.url),
);

export function visualQualityConfirmation(split: VisualQualitySplit, calls: number): string {
  return `ESEGUI FINO A ${calls} CHIAMATE VISUALI ${split.toUpperCase()} REALI`;
}

export interface VisualBenchmarkPhaseRecord {
  scenarioId: string;
  phase: 'proposal' | 'image';
  status: 'valid' | 'invalid' | 'failed' | 'skipped_none';
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  actualCostMicroUsd: number | null;
  priorBillingRisk: boolean;
  raw: unknown;
  validationError: string | null;
  proposal: VisualProposalOutput | null;
  image: {
    base64: string;
    width: number;
    height: number;
    byteLength: number;
    sha256: string;
    mimeType: 'image/webp';
    webpQuality: number;
    normalizationAttempts: number;
  } | null;
}

export interface VisualBenchmarkReport {
  reportVersion: 'visual-enrichment-05a-session-v1';
  status: 'running' | 'failed' | 'awaiting_review';
  verdict: null;
  datasetVersion: string;
  rubricVersion: string;
  visualConfig: typeof AI_VISUAL_SERVER_CONFIG;
  normalizerVersion: typeof AI_VISUAL_NORMALIZER_VERSION;
  split: VisualQualitySplit;
  plannedCalls: number;
  costUpperBoundMicroUsd: number;
  generatedAt: string;
  failure: string | null;
  records: VisualBenchmarkPhaseRecord[];
  totalActualCostMicroUsd: number | null;
  humanReview: null;
}

export interface VisualQualityCliDeps {
  argv: readonly string[];
  nodeMajorVersion: number;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  getApiKey: () => string | undefined;
  confirm: (prompt: string) => Promise<string>;
  loadDataset: () => Promise<VisualQualityDataset>;
  buildPlan: (
    dataset: VisualQualityDataset,
    split: VisualQualitySplit,
  ) => VisualQualityExecutionPlan;
  createProviders: (apiKey: string) => { proposal: ContentProvider; image: ImageProvider };
  normalize: (bytes: Uint8Array) => Promise<NormalizedVisual>;
  loadResume: (path: string) => Promise<VisualBenchmarkReport>;
  writeCheckpoint: (report: VisualBenchmarkReport, path: string | null) => Promise<string>;
  now: () => Date;
  monotonicMs: () => number;
  log: (message: string) => void;
}

function parseSplit(argv: readonly string[]): VisualQualitySplit {
  const values = argv.filter((arg) => arg.startsWith(VISUAL_QUALITY_SPLIT_PREFIX));
  if (values.length > 1) throw new Error('Specificare un solo split.');
  const value = values[0]?.slice(VISUAL_QUALITY_SPLIT_PREFIX.length) ?? 'tuning';
  if (value !== 'tuning' && value !== 'holdout') throw new Error('Split non supportato.');
  return value;
}

function parseResume(argv: readonly string[]): string | null {
  const values = argv.filter((arg) => arg.startsWith(VISUAL_QUALITY_RESUME_PREFIX));
  if (values.length > 1) throw new Error('Specificare una sola sessione da riprendere.');
  if (values.length === 0) return null;
  const path = values[0]!.slice(VISUAL_QUALITY_RESUME_PREFIX.length).trim();
  if (!path) throw new Error('Percorso resume vuoto.');
  return path;
}

function usage(value: number | undefined): number | null {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

function completedKey(record: VisualBenchmarkPhaseRecord): string {
  return `${record.scenarioId}:${record.phase}`;
}

function reportCost(records: readonly VisualBenchmarkPhaseRecord[]): number | null {
  if (
    records.some(
      (record) =>
        record.priorBillingRisk ||
        (record.status !== 'skipped_none' && record.actualCostMicroUsd === null),
    )
  )
    return null;
  return records.reduce((sum, record) => sum + (record.actualCostMicroUsd ?? 0), 0);
}

function sameClosedValue(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      Array.isArray(expected) &&
      actual.length === expected.length &&
      actual.every((value, index) => sameClosedValue(value, expected[index]))
    );
  }
  if (
    typeof actual !== 'object' ||
    actual === null ||
    typeof expected !== 'object' ||
    expected === null
  )
    return false;
  const actualRecord = actual as Record<string, unknown>;
  const expectedRecord = expected as Record<string, unknown>;
  const actualKeys = Object.keys(actualRecord).sort();
  const expectedKeys = Object.keys(expectedRecord).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every(
      (key, index) =>
        key === expectedKeys[index] && sameClosedValue(actualRecord[key], expectedRecord[key]),
    )
  );
}

function assertResumeCompatible(
  report: VisualBenchmarkReport,
  dataset: VisualQualityDataset,
  plan: VisualQualityExecutionPlan,
  split: VisualQualitySplit,
): void {
  if (
    report.reportVersion !== 'visual-enrichment-05a-session-v1' ||
    report.datasetVersion !== dataset.datasetVersion ||
    report.rubricVersion !== dataset.rubricVersion ||
    report.split !== split ||
    (report.status !== 'running' && report.status !== 'failed') ||
    report.verdict !== null ||
    report.humanReview !== null ||
    report.plannedCalls !== plan.maximumProviderCalls ||
    report.costUpperBoundMicroUsd !== plan.costUpperBoundMicroUsd ||
    report.normalizerVersion !== AI_VISUAL_NORMALIZER_VERSION ||
    !sameClosedValue(report.visualConfig, AI_VISUAL_SERVER_CONFIG) ||
    !Array.isArray(report.records)
  ) {
    throw new Error('Checkpoint incompatibile, mutato o già finalizzato.');
  }
}

async function runProposal(params: {
  provider: ContentProvider;
  scenario: VisualQualityScenario;
  monotonicMs: () => number;
}): Promise<VisualBenchmarkPhaseRecord> {
  const request = buildVisualProposalRequest(params.scenario);
  const { model, priceListVersion } = resolveContentModel('quality');
  const start = params.monotonicMs();
  const outcome = await params.provider.generate(request, model);
  const durationMs = Math.max(0, params.monotonicMs() - start);
  if (outcome.status !== 'ok') {
    return {
      scenarioId: params.scenario.id,
      phase: 'proposal',
      status: 'failed',
      durationMs,
      inputTokens: null,
      outputTokens: null,
      actualCostMicroUsd: null,
      priorBillingRisk: outcome.phase === 'invocation_unknown',
      raw: outcome,
      validationError: `provider_${outcome.phase}`,
      proposal: null,
      image: null,
    };
  }
  const inputTokens = usage(outcome.usage?.inputTokens);
  const outputTokens = usage(outcome.usage?.outputTokens);
  const cost = !outcome.metered
    ? 0
    : !outcome.priorBillingRisk && inputTokens !== null && outputTokens !== null
      ? actualCostMicroUsd(inputTokens, outputTokens, priceListVersion, model)
      : null;
  try {
    const proposal = assertVisualProposalMatchesRequest(
      validateVisualProposalEnvelope(outcome.output),
      params.scenario.lessonBody,
    );
    return {
      scenarioId: params.scenario.id,
      phase: 'proposal',
      status: 'valid',
      durationMs,
      inputTokens,
      outputTokens,
      actualCostMicroUsd: cost,
      priorBillingRisk: outcome.priorBillingRisk,
      raw: outcome.output,
      validationError: null,
      proposal,
      image: null,
    };
  } catch (error) {
    return {
      scenarioId: params.scenario.id,
      phase: 'proposal',
      status: 'invalid',
      durationMs,
      inputTokens,
      outputTokens,
      actualCostMicroUsd: cost,
      priorBillingRisk: outcome.priorBillingRisk,
      raw: outcome.output,
      validationError: error instanceof Error ? error.message : 'output non valido',
      proposal: null,
      image: null,
    };
  }
}

async function runImage(params: {
  provider: ImageProvider;
  normalize: (bytes: Uint8Array) => Promise<NormalizedVisual>;
  scenarioId: string;
  proposal: Extract<VisualProposalOutput, { decision: 'image' }>;
  monotonicMs: () => number;
}): Promise<VisualBenchmarkPhaseRecord> {
  const start = params.monotonicMs();
  const outcome = await params.provider.generate(params.proposal.subject);
  const durationMs = Math.max(0, params.monotonicMs() - start);
  if (outcome.status !== 'success') {
    return {
      scenarioId: params.scenarioId,
      phase: 'image',
      status: outcome.status === 'billed_unusable' ? 'invalid' : 'failed',
      durationMs,
      inputTokens: outcome.status === 'billed_unusable' ? usage(outcome.usage?.inputTokens) : null,
      outputTokens:
        outcome.status === 'billed_unusable' ? usage(outcome.usage?.outputTokens) : null,
      actualCostMicroUsd:
        outcome.status === 'billed_unusable' && !outcome.priorBillingRisk && outcome.usage
          ? actualVisualCostMicroUsd(outcome.usage)
          : null,
      priorBillingRisk:
        outcome.status === 'billed_unusable'
          ? outcome.priorBillingRisk
          : outcome.status === 'invocation_unknown',
      raw: outcome,
      validationError: `provider_${outcome.status}`,
      proposal: null,
      image: null,
    };
  }
  const inputTokens = usage(outcome.usage?.inputTokens);
  const outputTokens = usage(outcome.usage?.outputTokens);
  const actualCost = !outcome.metered
    ? 0
    : !outcome.priorBillingRisk && outcome.usage
      ? actualVisualCostMicroUsd(outcome.usage)
      : null;
  try {
    const normalized = await params.normalize(outcome.bytes);
    return {
      scenarioId: params.scenarioId,
      phase: 'image',
      status: 'valid',
      durationMs,
      inputTokens,
      outputTokens,
      actualCostMicroUsd: actualCost,
      priorBillingRisk: outcome.priorBillingRisk,
      raw: { base64: outcome.bytes.toString('base64') },
      validationError: null,
      proposal: null,
      image: {
        base64: normalized.bytes.toString('base64'),
        width: normalized.width,
        height: normalized.height,
        byteLength: normalized.byteLength,
        sha256: normalized.sha256,
        mimeType: normalized.mimeType,
        webpQuality: normalized.webpQuality,
        normalizationAttempts: normalized.normalizationAttempts,
      },
    };
  } catch (error) {
    return {
      scenarioId: params.scenarioId,
      phase: 'image',
      status: 'invalid',
      durationMs,
      inputTokens,
      outputTokens,
      actualCostMicroUsd: actualCost,
      priorBillingRisk: outcome.priorBillingRisk,
      raw: { base64: outcome.bytes.toString('base64') },
      validationError: error instanceof Error ? error.message : 'byte non validi',
      proposal: null,
      image: null,
    };
  }
}

export async function runVisualQualityCli(
  deps: VisualQualityCliDeps,
): Promise<'dry-run' | 'executed'> {
  const split = parseSplit(deps.argv);
  const dataset = await deps.loadDataset();
  const plan = deps.buildPlan(dataset, split);
  const real =
    deps.argv.includes(VISUAL_QUALITY_EXECUTE_FLAG) &&
    deps.argv.includes(VISUAL_QUALITY_COST_ACK_FLAG);
  deps.log(JSON.stringify({ ...plan, dryRun: !real }, null, 2));
  if (!real) return 'dry-run';
  if (deps.nodeMajorVersion !== 22)
    throw new Error('Node 22 è obbligatorio per il benchmark reale.');
  if (!deps.stdinIsTTY || !deps.stdoutIsTTY) throw new Error('TTY interattiva obbligatoria.');

  const resumePath = parseResume(deps.argv);
  const report: VisualBenchmarkReport = resumePath
    ? await deps.loadResume(resumePath)
    : {
        reportVersion: 'visual-enrichment-05a-session-v1',
        status: 'running',
        verdict: null,
        datasetVersion: dataset.datasetVersion,
        rubricVersion: dataset.rubricVersion,
        visualConfig: AI_VISUAL_SERVER_CONFIG,
        normalizerVersion: AI_VISUAL_NORMALIZER_VERSION,
        split,
        plannedCalls: plan.maximumProviderCalls,
        costUpperBoundMicroUsd: plan.costUpperBoundMicroUsd,
        generatedAt: deps.now().toISOString(),
        failure: null,
        records: [],
        totalActualCostMicroUsd: 0,
        humanReview: null,
      };
  if (resumePath) assertResumeCompatible(report, dataset, plan, split);
  const done = new Set(report.records.map(completedKey));
  const scenarios = selectVisualQualityScenarios(dataset, split);
  let remaining = 0;
  for (const scenario of scenarios) {
    if (!done.has(`${scenario.id}:proposal`)) remaining += 1;
    const previous = report.records.find(
      (record) => record.scenarioId === scenario.id && record.phase === 'proposal',
    );
    if ((!previous || previous.proposal?.decision === 'image') && !done.has(`${scenario.id}:image`))
      remaining += 1;
  }
  if (remaining > 0) {
    const phrase = visualQualityConfirmation(split, remaining);
    const answer = await deps.confirm(
      `Per confermare fino a ${remaining} chiamate provider residue, digitare esattamente “${phrase}”: `,
    );
    if (answer !== phrase) throw new Error('Conferma non valida: benchmark annullato.');
  }
  const apiKey = deps.getApiKey();
  if (!apiKey?.trim()) throw new Error('OPENAI_API_KEY assente: nessuna chiamata eseguita.');
  const providers = deps.createProviders(apiKey.trim());
  let outputPath = resumePath;
  try {
    for (const scenario of scenarios) {
      let proposalRecord = report.records.find(
        (record) => record.scenarioId === scenario.id && record.phase === 'proposal',
      );
      if (!proposalRecord) {
        proposalRecord = await runProposal({
          provider: providers.proposal,
          scenario,
          monotonicMs: deps.monotonicMs,
        });
        report.records.push(proposalRecord);
        report.totalActualCostMicroUsd = reportCost(report.records);
        outputPath = await deps.writeCheckpoint(report, outputPath);
      }
      if (proposalRecord.status !== 'valid' || !proposalRecord.proposal) continue;
      if (proposalRecord.proposal.decision === 'none') {
        if (!done.has(`${scenario.id}:image`)) {
          report.records.push({
            scenarioId: scenario.id,
            phase: 'image',
            status: 'skipped_none',
            durationMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            actualCostMicroUsd: 0,
            priorBillingRisk: false,
            raw: null,
            validationError: null,
            proposal: null,
            image: null,
          });
          outputPath = await deps.writeCheckpoint(report, outputPath);
        }
        continue;
      }
      if (
        !report.records.some(
          (record) => record.scenarioId === scenario.id && record.phase === 'image',
        )
      ) {
        report.records.push(
          await runImage({
            provider: providers.image,
            normalize: deps.normalize,
            scenarioId: scenario.id,
            proposal: proposalRecord.proposal,
            monotonicMs: deps.monotonicMs,
          }),
        );
        report.totalActualCostMicroUsd = reportCost(report.records);
        outputPath = await deps.writeCheckpoint(report, outputPath);
      }
    }
    report.status = 'awaiting_review';
    report.totalActualCostMicroUsd = reportCost(report.records);
    await deps.writeCheckpoint(report, outputPath);
    return 'executed';
  } catch (error) {
    report.status = 'failed';
    report.failure = error instanceof Error ? error.message : 'errore non classificato';
    await deps.writeCheckpoint(report, outputPath);
    throw error;
  }
}

async function atomicWrite(
  report: VisualBenchmarkReport,
  existingPath: string | null,
): Promise<string> {
  const root = DEFAULT_VISUAL_QUALITY_OUTPUT_ROOT;
  await mkdir(root, { recursive: true });
  const path =
    existingPath ??
    resolve(
      root,
      `visual-enrichment-05a-${report.split}-${report.generatedAt.replace(/[:.]/g, '-')}.json`,
    );
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, path);
  return path;
}

async function confirmDefault(prompt: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

export function defaultVisualQualityCliDeps(argv = process.argv.slice(2)): VisualQualityCliDeps {
  return {
    argv,
    nodeMajorVersion: Number.parseInt(process.versions.node.split('.')[0] ?? '', 10),
    stdinIsTTY: Boolean(stdin.isTTY),
    stdoutIsTTY: Boolean(stdout.isTTY),
    getApiKey: () => process.env.OPENAI_API_KEY,
    confirm: confirmDefault,
    loadDataset: () => loadVisualQualityDataset(),
    buildPlan: buildVisualQualityExecutionPlan,
    createProviders: (apiKey) => ({
      proposal: createContentProvider({ mode: 'openai', openAiApiKey: apiKey }),
      image: createImageProvider(createOpenAiImageTransport(apiKey)),
    }),
    normalize: normalizeVisualWebp,
    loadResume: async (path) => JSON.parse(await readFile(path, 'utf8')) as VisualBenchmarkReport,
    writeCheckpoint: atomicWrite,
    now: () => new Date(),
    monotonicMs: () => performance.now(),
    log: (message) => stdout.write(`${message}\n`),
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void runVisualQualityCli(defaultVisualQualityCliDeps()).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
