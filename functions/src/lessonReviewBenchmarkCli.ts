import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createContentProvider } from './aiContentProvider.js';
import { validateLessonReviewProposal } from './aiContentValidation.js';
import { buildLessonReviewPlan, loadLessonReviewManifest } from './lessonReviewBenchmark.js';

export const EXECUTE = '--execute-real-openai';
export const ACK = '--i-understand-this-costs-money';
const manifestArg = process.argv.slice(2).find((arg) => arg.startsWith('--manifest='));
const outputArg = process.argv.slice(2).find((arg) => arg.startsWith('--output='));
if (!manifestArg) throw new Error('Specificare --manifest=<file JSON con output base congelati>.');
const plan = buildLessonReviewPlan(await loadLessonReviewManifest(resolve(manifestArg.slice(11))));
console.log(
  JSON.stringify(
    { ...plan, samples: plan.samples.map(({ request: _request, ...sample }) => sample) },
    null,
    2,
  ),
);

if (!process.argv.includes(EXECUTE)) {
  console.log('DRY-RUN: nessuna API key letta e nessuna chiamata provider.');
} else {
  if (!process.argv.includes(ACK) || !stdin.isTTY || !stdout.isTTY) {
    throw new Error('Esecuzione reale negata: servono flag costo e terminale interattivo.');
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY assente.');
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`Scrivi ESEGUI ${plan.plannedCalls} REVISIONI REALI: `);
  rl.close();
  if (answer !== `ESEGUI ${plan.plannedCalls} REVISIONI REALI`)
    throw new Error('Conferma non valida.');
  const provider = createContentProvider({ mode: 'openai', openAiApiKey: key });
  const dir = resolve(outputArg?.slice(9) || 'lesson-review-benchmark-output');
  await mkdir(dir, { recursive: true });
  for (const sample of plan.samples) {
    const outcome = await provider.generate(sample.request, sample.model);
    if (outcome.status !== 'ok') throw new Error(`${sample.id}: chiamata fallita.`);
    const reviewed = validateLessonReviewProposal(outcome.output);
    await writeFile(
      resolve(dir, `${sample.id}.json`),
      JSON.stringify({ id: sample.id, reviewed, usage: outcome.usage }, null, 2),
      'utf8',
    );
  }
}
