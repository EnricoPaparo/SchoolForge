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
import {
  validateVisualPlanProposalEnvelope,
  assertVisualPlanProposalMatchesRequest,
} from '../functions/lib/aiContentVisualPlanProposal.js';
import { estimateContentCost } from '../functions/lib/aiContentCost.js';
import { actualCostMicroUsd, normalizeUsageActual } from '../functions/lib/aiCorrectionCost.js';
import { DEFAULT_OPENAI_RETRY_POLICY } from '../functions/lib/openAiGrader.js';
import {
  createImageProvider,
  createOpenAiImageTransport,
} from '../functions/lib/aiVisualProvider.js';
import { estimateVisualCost, actualVisualCostMicroUsd } from '../functions/lib/aiVisualCore.js';

const subjects = [
  {
    id: 'visual-ram-ssd',
    subject:
      'Confronto visivo didattico fra una scheda RAM con chip e un SSD, affiancati sullo stesso piano: componenti reali distinti, senza testi, frecce o analogie. La scheda RAM conserva dati temporanei in uso, l’SSD conserva file senza alimentazione; non rappresentare l’SSD come parte della RAM.',
  },
  {
    id: 'visual-heat-spoon',
    subject:
      'Una tazza di acqua calda con un cucchiaino metallico immerso e il manico che sporge: illustrazione didattica realistica che mostri il percorso continuo del metallo dal liquido al manico; nessuna fiamma, nessun testo o simbolo inventato. Il trasferimento lungo il cucchiaino è conduzione, non movimento del metallo.',
  },
];
const execute =
  process.argv.includes('--execute-real-openai') &&
  process.argv.includes('--i-understand-this-costs-money');
if (!execute) {
  console.log(
    JSON.stringify({
      calls: 3,
      imageCalls: 2,
      planCalls: 1,
      maxGlobalCalls: 60,
      maxGlobalMicroUsd: 5_000_000,
    }),
  );
  process.exit(0);
}
const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'documentazione/evidenze/didactic-quality-dev-v1');
let calls = 0,
  spent = 0;
for (const name of readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'manifest.json')) {
  const record = JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
  if (record.id) {
    calls++;
    spent += record.actualCostMicroUsd ?? record.reservationCostMicroUsd ?? 0;
  }
}
writeFileSync(
  resolve(dir, 'visual-manifest.json'),
  JSON.stringify({ subjects, calls: 3, frozenBeforeCalls: true }, null, 2),
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
const retry = { ...DEFAULT_OPENAI_RETRY_POLICY, maxRetries: 0, attemptTimeoutMs: 180_000 };
function claim(id, reservationCostMicroUsd) {
  const path = resolve(dir, id + '.pending.json');
  if (existsSync(path)) throw Error('Uncertain visual attempt');
  if (calls >= 60 || spent + reservationCostMicroUsd > 5_000_000)
    throw Error('Global qualification cap reached');
  writeFileSync(path, JSON.stringify({ id, reservationCostMicroUsd }));
  calls++;
  return path;
}
const request = validateAiContentRequest({
  kind: 'visual_plan_proposal',
  requestId: randomUUID(),
  modelProfile: 'quality',
  titolo: 'RAM e SSD',
  sottotitolo: 'Funzioni diverse',
  difficolta: 'Base',
  concettiChiave: ['RAM', 'SSD', 'volatilità'],
  obiettivi: ['Distinguere memoria di lavoro e archiviazione'],
  udaTitle: 'Computer',
  udaContext: {
    title: 'Computer',
    descrizione: null,
    competenze: [],
    obiettivi: [],
    currentLessonPosition: 1,
    lessons: [{ position: 1, titolo: 'RAM e SSD', sottotitolo: 'Funzioni diverse' }],
  },
  lessonBody:
    '## Memoria di lavoro\n\nLa RAM mantiene i dati in uso dalla CPU e perde il contenuto senza alimentazione.\n\n## Archiviazione\n\nUn SSD conserva i file senza alimentazione. È un componente distinto dalla RAM.',
  quantity: { mode: 'auto', requested: null, ceiling: 2 },
});
const planId = 'visual-plan-ram-ssd';
const planPath = resolve(dir, planId + '.json');
if (!existsSync(planPath)) {
  const policy = resolveContentModelForRequest(request);
  const estimate = estimateContentCost(request, policy.model, policy.priceListVersion, 1);
  const pending = claim(planId, estimate.reservationCostMicroUsd);
  const provider = createContentProvider({
    mode: 'openai',
    openAiApiKey: key,
    runnerDeps: { policy: retry },
  });
  const result = await provider.generate(request, policy.model);
  if (result.status !== 'ok') throw Error('Visual plan failed');
  const usage = normalizeUsageActual(result.usage);
  if (!usage) throw Error('Unknown plan usage');
  const actual = actualCostMicroUsd(
    usage.inputTokens,
    usage.outputTokens,
    policy.priceListVersion,
    policy.model,
    usage,
  );
  if (actual === null) throw Error('Plan cost unknown');
  spent += actual;
  const record = {
    id: planId,
    request,
    policy,
    rawOutput: result.output,
    actualCostMicroUsd: actual,
    usage: result.usage,
  };
  writeFileSync(planPath, JSON.stringify(record, null, 2));
  unlinkSync(pending);
  record.output = validateVisualPlanProposalEnvelope(result.output, request.quantity.ceiling);
  assertVisualPlanProposalMatchesRequest(record.output, request.lessonBody);
  writeFileSync(planPath, JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ id: planId, calls, actualCostMicroUsd: actual }));
}
const savedPlan = JSON.parse(readFileSync(planPath, 'utf8'));
savedPlan.output = validateVisualPlanProposalEnvelope(
  savedPlan.rawOutput,
  request.quantity.ceiling,
);
assertVisualPlanProposalMatchesRequest(savedPlan.output, savedPlan.request.lessonBody);
writeFileSync(planPath, JSON.stringify(savedPlan, null, 2));
const imageProvider = createImageProvider(createOpenAiImageTransport(key), { policy: retry });
for (const fixture of subjects) {
  const path = resolve(dir, fixture.id + '.json');
  if (existsSync(path)) continue;
  const estimate = estimateVisualCost(fixture.subject, 'openai');
  const pending = claim(fixture.id, estimate.reservationCostMicroUsd);
  const outcome = await imageProvider.generate(fixture.subject);
  if (outcome.status !== 'success' || !outcome.usage) throw Error('Visual result not usable');
  const actual = actualVisualCostMicroUsd(outcome.usage);
  if (actual === null) throw Error('Visual cost unknown');
  spent += actual;
  writeFileSync(resolve(dir, fixture.id + '.webp'), outcome.bytes);
  writeFileSync(
    path,
    JSON.stringify(
      {
        id: fixture.id,
        ...fixture,
        usage: outcome.usage,
        actualCostMicroUsd: actual,
        image: fixture.id + '.webp',
      },
      null,
      2,
    ),
  );
  unlinkSync(pending);
  console.log(
    JSON.stringify({ id: fixture.id, calls, actualCostMicroUsd: actual, totalMicroUsd: spent }),
  );
}
