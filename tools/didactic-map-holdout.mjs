import { readFileSync, readdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { createContentProvider } from '../functions/lib/aiContentProvider.js';
import {
  validateAiContentRequest,
  resolveContentModelForRequest,
} from '../functions/lib/aiContentCore.js';
import { composeConceptMapMarkdown } from '../functions/lib/aiContentConceptMap.js';
import { validateMapReview } from '../functions/lib/aiContentDidacticReview.js';
import { estimateContentCost } from '../functions/lib/aiContentCost.js';
import { actualCostMicroUsd, normalizeUsageActual } from '../functions/lib/aiCorrectionCost.js';
import { DEFAULT_OPENAI_RETRY_POLICY } from '../functions/lib/openAiGrader.js';

const cases = [
  {
    id: 'ram',
    source:
      '## RAM e SSD\n\nLa RAM conserva temporaneamente i dati e le istruzioni usati dalla CPU: senza alimentazione perde il contenuto. Un SSD conserva i file senza alimentazione. La maggiore capacità di un SSD non lo rende equivalente alla RAM: hanno funzioni diverse.',
    summary:
      'La RAM mantiene temporaneamente dati e istruzioni in uso dalla CPU, ma perde il contenuto senza alimentazione. L’SSD conserva i file anche a computer spento. Capacità e funzione non sono equivalenti: una memoria più capiente non sostituisce automaticamente l’altra.',
    diagram:
      'RAM -> contiene -> dati in uso\nRAM -> senza alimentazione -> perde dati\nSSD -> senza alimentazione -> conserva file',
    fault: 'RAM -> senza alimentazione -> conserva dati',
  },
  {
    id: 'density',
    source:
      '## Densità\n\nLa densità è il rapporto fra massa e volume: ρ=m/V. Per m=100 g e V=20 cm³, ρ=5 g/cm³. Per un materiale omogeneo, alla stessa temperatura e pressione, la densità non dipende dalla quantità. Aumentare soltanto la massa senza specificare il volume non basta per dedurre una variazione di densità.',
    summary:
      'La densità collega massa e volume tramite ρ=m/V: 100 g distribuiti in 20 cm³ corrispondono a 5 g/cm³. Per un materiale omogeneo alle stesse condizioni di temperatura e pressione, resta indipendente dalla quantità. La massa da sola non permette di dedurne una variazione, perché occorre conoscere anche il volume.',
    diagram:
      'Massa e volume -> rapporto m/V -> densità\n100 g / 20 cm³ -> uguale a -> 5 g/cm³\nDensità -> dipende da -> materiale e condizioni',
    fault: 'Densità -> cresce sempre con -> massa',
  },
];
const execute =
  process.argv.includes('--execute-real-openai') &&
  process.argv.includes('--i-understand-this-costs-money');
if (!execute) {
  console.log(
    JSON.stringify({
      calls: 4,
      promptVersion: 'concept_map_review-v3',
      split: 'holdout',
      maxGlobalCalls: 60,
      maxGlobalMicroUsd: 5_000_000,
      retries: 0,
    }),
  );
  process.exit(0);
}
const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'documentazione/evidenze/didactic-quality-dev-v1');
writeFileSync(
  resolve(dir, 'map-holdout-manifest.json'),
  JSON.stringify(
    {
      cases,
      version: 'concept_map_review-v3',
      calls: 4,
      split: 'holdout',
      frozenBeforeCalls: true,
    },
    null,
    2,
  ),
);
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
  throw Error('Configured credential unavailable');
}
const provider = createContentProvider({
  mode: 'openai',
  openAiApiKey: key,
  runnerDeps: {
    policy: { ...DEFAULT_OPENAI_RETRY_POLICY, maxRetries: 0, attemptTimeoutMs: 180_000 },
  },
});
let calls = 0,
  spent = 0;
for (const name of readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'manifest.json')) {
  const record = JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
  if (record.id) {
    calls++;
    spent += record.actualCostMicroUsd ?? record.reservationCostMicroUsd ?? 0;
  }
}
for (const scenario of cases)
  for (const faulty of [false, true]) {
    const id = `holdout-${scenario.id}-${faulty ? 'fault' : 'healthy'}-map-v3`;
    const path = resolve(dir, id + '.json');
    const pending = resolve(dir, id + '.pending.json');
    if (existsSync(path)) continue;
    if (existsSync(pending)) throw Error('Uncertain previous holdout');
    const candidateMarkdown = composeConceptMapMarkdown({
      summaryMarkdown: scenario.summary,
      diagram: faulty ? scenario.fault : scenario.diagram,
    });
    const request = validateAiContentRequest({
      kind: 'concept_map_review',
      requestId: randomUUID(),
      modelProfile: 'quality',
      lessonBody: scenario.source,
      candidateMarkdown,
    });
    const policy = resolveContentModelForRequest(request);
    const estimate = estimateContentCost(request, policy.model, policy.priceListVersion, 1);
    if (calls >= 60 || spent + estimate.reservationCostMicroUsd > 5_000_000)
      throw Error('Global qualification cap reached');
    writeFileSync(
      pending,
      JSON.stringify({ id, reservationCostMicroUsd: estimate.reservationCostMicroUsd }),
    );
    calls++;
    const outcome = await provider.generate(request, policy.model);
    if (outcome.status !== 'ok') throw Error('Holdout provider failed');
    const usage = normalizeUsageActual(outcome.usage);
    if (!usage) throw Error('Unknown usage');
    const actual = actualCostMicroUsd(
      usage.inputTokens,
      usage.outputTokens,
      policy.priceListVersion,
      policy.model,
      usage,
    );
    if (actual === null) throw Error('Unknown cost');
    spent += actual;
    const record = {
      id,
      request,
      policy,
      promptVersion: 'concept_map_review-v3',
      split: 'holdout',
      faulty,
      rawOutput: outcome.output,
      actualCostMicroUsd: actual,
      usage: outcome.usage,
    };
    writeFileSync(path, JSON.stringify(record, null, 2));
    unlinkSync(pending);
    record.output = validateMapReview(outcome.output, request);
    writeFileSync(path, JSON.stringify(record, null, 2));
    console.log(
      JSON.stringify({
        id,
        outcome: record.output.reviewOutcome,
        sourceIssue: record.output.sourceIssue,
        calls,
        totalMicroUsd: spent,
      }),
    );
  }
