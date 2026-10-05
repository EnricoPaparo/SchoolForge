/** Synthetic-only qualification. Explicit flags, bounded spend, no automatic retry. */
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import console from 'node:console';
import { createContentProvider } from '../functions/lib/aiContentProvider.js';
import {
  validateAiContentRequest,
  resolveContentModelForRequest,
} from '../functions/lib/aiContentCore.js';
import { validatePoolProposal } from '../functions/lib/aiContentValidation.js';
import { validateAndComposeConceptMap } from '../functions/lib/aiContentConceptMap.js';
import { estimateContentCost } from '../functions/lib/aiContentCost.js';
import { actualCostMicroUsd, normalizeUsageActual } from '../functions/lib/aiCorrectionCost.js';
import { DEFAULT_OPENAI_RETRY_POLICY } from '../functions/lib/openAiGrader.js';
import { validatePoolReview, validateMapReview } from '../functions/lib/aiContentDidacticReview.js';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'documentazione/evidenze/didactic-quality-dev-v1');
const sources = ['PT00-01', 'PT00-04', 'PT00-05', 'PT00-06'];
const execute =
  process.argv.includes('--execute-real-openai') &&
  process.argv.includes('--i-understand-this-costs-money');
const manifest = {
  version: 1,
  sources,
  profiles: ['economy', 'quality'],
  contentCalls: 41,
  correctionCallsPlanned: 12,
  visualCallsPlanned: 3,
  maxTotalCalls: 56,
  maxCostMicroUsd: 5_000_000,
  retries: 0,
  syntheticOnly: true,
};
if (!execute) {
  console.log(JSON.stringify(manifest));
  process.exit(0);
}
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
let key;
try {
  key = execFileSync(
    process.execPath,
    [
      resolve(root, 'node_modules/firebase-tools/lib/bin/firebase.js'),
      'functions:secrets:access',
      'OPENAI_API_KEY',
      '--project',
      'schoolforge-dev',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
} catch {
  throw new Error('Configured credential unavailable');
}
if (!key.startsWith('sk-')) throw new Error('Configured credential unavailable');
const provider = createContentProvider({
  mode: 'openai',
  openAiApiKey: key,
  runnerDeps: {
    policy: { ...DEFAULT_OPENAI_RETRY_POLICY, maxRetries: 0, attemptTimeoutMs: 180_000 },
  },
});
let calls = 0;
let spent = 0;
for (const file of readdirSync(output).filter(
  (name) => name.endsWith('.json') && name !== 'manifest.json',
)) {
  const saved = JSON.parse(readFileSync(resolve(output, file), 'utf8'));
  if (saved.id) {
    calls++;
    spent += saved.actualCostMicroUsd ?? saved.reservationCostMicroUsd ?? 0;
  }
}
async function run(id, input, validate) {
  const path = resolve(output, `${id}.json`);
  if (existsSync(path)) {
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    if (!saved.output) saved.output = validate(saved.rawOutput, saved.request);
    return saved;
  }
  const request = validateAiContentRequest(input);
  const policy = resolveContentModelForRequest(request);
  const estimate = estimateContentCost(request, policy.model, policy.priceListVersion, 1);
  if (
    spent + estimate.reservationCostMicroUsd > manifest.maxCostMicroUsd ||
    calls >= manifest.contentCalls
  )
    throw new Error('Benchmark cap reached');
  const start = Date.now();
  calls++;
  const pendingPath = resolve(output, `${id}.pending.json`);
  if (existsSync(pendingPath)) throw new Error(`Uncertain previous attempt: ${id}`);
  writeFileSync(
    pendingPath,
    JSON.stringify({
      id,
      request,
      policy,
      reservationCostMicroUsd: estimate.reservationCostMicroUsd,
    }),
  );
  const outcome = await provider.generate(request, policy.model);
  if (outcome.status !== 'ok') {
    writeFileSync(
      pendingPath,
      JSON.stringify({
        id,
        reservationCostMicroUsd: estimate.reservationCostMicroUsd,
        status: outcome.status,
        phase: outcome.phase,
        reason: outcome.reason ?? null,
      }),
    );
    throw new Error(`Provider stopped: ${id}`);
  }
  const priceUsage = normalizeUsageActual(outcome.usage);
  const actual = priceUsage
    ? actualCostMicroUsd(
        priceUsage.inputTokens,
        priceUsage.outputTokens,
        policy.priceListVersion,
        policy.model,
        priceUsage,
      )
    : null;
  if (actual === null) throw new Error('Uncertain usage: stopped');
  spent += actual;
  const record = {
    id,
    request,
    policy,
    rawOutput: outcome.output,
    usage: outcome.usage,
    actualCostMicroUsd: actual,
    durationMs: Date.now() - start,
  };
  writeFileSync(path, JSON.stringify(record, null, 2));
  unlinkSync(pendingPath);
  const validated = validate(outcome.output, request);
  record.output = validated;
  writeFileSync(path, JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ id, calls, actualCostMicroUsd: actual, totalMicroUsd: spent }));
  return record;
}
for (const id of sources) {
  const lessonSource = readFileSync(
    resolve(root, `documentazione/evidenze/pool-tune-00-sources/${id}.md`),
    'utf8',
  );
  for (const modelProfile of manifest.profiles) {
    const base = {
      kind: 'pool',
      requestId: randomUUID(),
      modelProfile,
      level: 'balanced',
      counts: { aperta: 2, chiusa_singola: 1, chiusa_multipla: 1 },
      lessonSource,
      existingPoolQuestionCount: 0,
    };
    const pool = await run(`${id}-${modelProfile}-pool`, base, (out, r) =>
      validatePoolProposal(out, r.counts, r.level),
    );
    await run(
      `${id}-${modelProfile}-pool-review`,
      {
        ...base,
        kind: 'pool_review',
        requestId: randomUUID(),
        candidateQuestions: pool.output.questions,
      },
      validatePoolReview,
    );
    const mapBase = {
      kind: 'concept_map',
      requestId: randomUUID(),
      modelProfile,
      lessonBody: lessonSource,
    };
    const map = await run(`${id}-${modelProfile}-map`, mapBase, validateAndComposeConceptMap);
    await run(
      `${id}-${modelProfile}-map-review-v2`,
      {
        ...mapBase,
        kind: 'concept_map_review',
        requestId: randomUUID(),
        candidateMarkdown: map.output.conceptMapMarkdown,
      },
      validateMapReview,
    );
    if (modelProfile === 'quality') {
      const bad = JSON.parse(JSON.stringify(pool.output.questions));
      bad.find((question) => question.tipo === 'aperta').soluzione =
        'Non occorre motivare: qualunque risposta è corretta.';
      await run(
        `${id}-pool-fault`,
        { ...base, kind: 'pool_review', requestId: randomUUID(), candidateQuestions: bad },
        validatePoolReview,
      );
      const corrupted = map.output.conceptMapMarkdown.replace(
        '## Sintesi',
        '## Sintesi\n\nTutti i fenomeni descritti hanno sempre la stessa causa e sono equivalenti.',
      );
      await run(
        `${id}-map-fault`,
        {
          ...mapBase,
          kind: 'concept_map_review',
          requestId: randomUUID(),
          candidateMarkdown: corrupted,
        },
        validateMapReview,
      );
    }
  }
}
console.log(JSON.stringify({ status: 'content_completed', calls, spentMicroUsd: spent }));
