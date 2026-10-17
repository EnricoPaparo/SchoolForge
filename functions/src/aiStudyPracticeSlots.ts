import { type StudyStage } from '@schoolforge/lesson-contract';
import { AiContentError, type PoolRequest, type PoolReviewRequest } from './aiContentCore.js';
import { buildProviderStudyPlanSchema } from './aiStudyPracticeSource.js';

type PracticeRequest = PoolRequest | PoolReviewRequest;
type Schema = Record<string, unknown>;
interface Slot {
  name: string;
  objectiveIndex: number;
  stage: StudyStage;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  difficulty?: number;
}
export interface PracticeLayout {
  id: string;
  objectiveCount: number;
  slots: Slot[];
}
function invalid(constraint = 'practice_slot_shape'): never {
  throw Object.assign(
    new AiContentError('provider_invalid_output', 'Struttura delle attività non valida.'),
    { constraint },
  );
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) invalid();
}
function closed(properties: Record<string, unknown>) {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}
function slotName(index: number, objective: number, stage: StudyStage) {
  return `activity_${index}_${stage}_capability_${objective}`;
}
/** Layouts define the activity roles BEFORE content is generated. Never sort or relabel output. */
export function practiceLayouts(request: PracticeRequest): PracticeLayout[] {
  if (request.kind === 'pool_review') {
    if (!request.candidateStudyPlan) invalid('practice_layout');
    return [
      {
        id: 'review_candidate',
        objectiveCount: request.candidateStudyPlan.objectives.length,
        slots: request.candidateStudyPlan.steps.map((s, i) => ({
          name: slotName(i, s.objectiveIndex, s.stage),
          objectiveIndex: s.objectiveIndex,
          stage: s.stage,
          tipo: request.candidateQuestions[i]!.tipo,
          difficulty: request.candidateQuestions[i]!.difficolta,
        })),
      },
    ];
  }
  const total = Object.values(request.counts).reduce((a, b) => a + b, 0);
  const maximum = Math.min(4, Math.floor(total / 3), request.counts.aperta);
  const layouts: PracticeLayout[] = [];
  for (let n = 1; n <= maximum; n++) {
    const slots: Slot[] = [];
    const sizes = Array.from(
      { length: n },
      (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0),
    );
    let extraExamples = request.counts.aperta - n;
    const examples = sizes.map((size) => {
      const extra = Math.min(Math.max(0, Math.floor(size / 3) - 1), extraExamples);
      extraExamples -= extra;
      return 1 + extra;
    });
    for (let objective = 0; objective < n; objective++) {
      const size = sizes[objective]!,
        exampleCount = examples[objective]!,
        guidedCount = Math.floor((size - exampleCount) / 2);
      for (let j = 0; j < size; j++) {
        const stage: StudyStage =
          j < exampleCount ? 'esempio' : j < exampleCount + guidedCount ? 'guidato' : 'autonomo';
        slots.push({
          name: slotName(slots.length, objective, stage),
          objectiveIndex: objective,
          stage,
          tipo: 'aperta',
        });
      }
    }
    let open = request.counts.aperta - examples.reduce((a, b) => a + b, 0),
      single = request.counts.chiusa_singola;
    slots.forEach((slot) => {
      if (slot.stage === 'esempio') return;
      if (open > 0) {
        open--;
        return;
      }
      if (single > 0) {
        slot.tipo = 'chiusa_singola';
        single--;
      } else slot.tipo = 'chiusa_multipla';
    });
    layouts.push({ id: `capabilities_${n}`, objectiveCount: n, slots });
    // At most one optional terminal transfer: E/G/A remain mandatory before it.
    const terminalAutonomous = slots.filter(
      (s) => s.objectiveIndex === n - 1 && s.stage === 'autonomo',
    ).length;
    if (terminalAutonomous >= 2) {
      const transfer = slots.map((s) => ({ ...s }));
      const last = transfer[transfer.length - 1]!;
      last.stage = 'trasferimento';
      last.name = slotName(transfer.length - 1, last.objectiveIndex, last.stage);
      layouts.push({ id: `capabilities_${n}_transfer`, objectiveCount: n, slots: transfer });
    }
  }
  return layouts;
}
export function buildPracticeSlotsSchema(request: PracticeRequest, questionVariants: Schema[]) {
  const plan = buildProviderStudyPlanSchema(request);
  return {
    anyOf: [
      ...practiceLayouts(request).map((layout) =>
        closed({
          layout: { type: 'string', enum: [layout.id] },
          objectives: closed(
            Object.fromEntries(
              Array.from({ length: layout.objectiveCount }, (_, i) => [
                `capability_${i}`,
                plan.properties.objectives.items,
              ]),
            ),
          ),
          plannedCoverage: plan.properties.plannedCoverage,
          activities: closed(
            Object.fromEntries(
              layout.slots.map((slot) => {
                const variant = questionVariants.find((v) =>
                  (object(object(v.properties).tipo).enum as string[]).includes(slot.tipo),
                );
                if (!variant) invalid();
                const question =
                  slot.difficulty === undefined
                    ? variant
                    : {
                        ...variant,
                        properties: {
                          ...object(variant.properties),
                          difficolta: { type: 'integer', enum: [slot.difficulty] },
                        },
                      };
                return [
                  slot.name,
                  {
                    ...closed({ question, hints: plan.properties.steps.items.properties.hints }),
                    description: `Attività ${slot.stage} per capability_${slot.objectiveIndex}. Genera consegna, soluzione e aiuti per questo ruolo specifico.`,
                  },
                ];
              }),
            ),
          ),
        }),
      ),
      { type: 'null' },
    ],
  };
}
/** Fresh provider output only. Persisted v1 keeps its original ordinal/stage representation. */
export function materializePracticeSlots(output: unknown, request: PracticeRequest): unknown {
  const root = object(output);
  if (root.sourceInsufficient === true) {
    const { practice, ...rest } = root;
    void practice;
    return { ...rest, questions: [], studyPlan: null };
  }
  exact(root, [
    'sourceInsufficient',
    'practice',
    ...(request.kind === 'pool_review' ? ['reviewOutcome', 'issueCodes'] : []),
  ]);
  if (root.sourceInsufficient !== false) invalid();
  const raw = object(root.practice);
  exact(raw, ['layout', 'objectives', 'plannedCoverage', 'activities']);
  const layout = practiceLayouts(request).find((l) => l.id === raw.layout);
  if (!layout) invalid('practice_layout');
  const objectives = object(raw.objectives),
    activities = object(raw.activities);
  const objectiveKeys = Array.from({ length: layout.objectiveCount }, (_, i) => `capability_${i}`);
  exact(objectives, objectiveKeys);
  exact(
    activities,
    layout.slots.map((s) => s.name),
  );
  const questions: unknown[] = [],
    steps: unknown[] = [];
  layout.slots.forEach((slot, index) => {
    const activity = object(activities[slot.name]);
    exact(activity, ['question', 'hints']);
    const question = object(activity.question);
    if (
      question.tipo !== slot.tipo ||
      (slot.difficulty !== undefined && question.difficolta !== slot.difficulty)
    )
      invalid();
    questions.push(question);
    steps.push({
      questionOrder: index,
      objectiveIndex: slot.objectiveIndex,
      stage: slot.stage,
      hints: activity.hints,
    });
  });
  const { practice, ...rest } = root;
  void practice;
  return {
    ...rest,
    questions,
    studyPlan: {
      objectives: objectiveKeys.map((key) => objectives[key]),
      steps,
      plannedCoverage: raw.plannedCoverage,
    },
  };
}
/** Mock/test adapter: only an EXACT existing layout match is encodable; no repair or relabel. */
export function encodePracticeSlots(output: unknown, request: PracticeRequest): unknown {
  const root = object(output),
    plan = object(root.studyPlan);
  if (
    !Array.isArray(root.questions) ||
    !Array.isArray(plan.steps) ||
    !Array.isArray(plan.objectives)
  )
    invalid();
  const questions = root.questions;
  const layout = practiceLayouts(request).find(
    (l) =>
      l.objectiveCount === (plan.objectives as unknown[]).length &&
      l.slots.length === questions.length &&
      l.slots.every((slot, i) => {
        const step = object((plan.steps as unknown[])[i]);
        return (
          step.questionOrder === i &&
          step.objectiveIndex === slot.objectiveIndex &&
          step.stage === slot.stage &&
          object(questions[i]).tipo === slot.tipo
        );
      }),
  );
  if (!layout) invalid('practice_layout');
  const { studyPlan, questions: _questions, ...rest } = root;
  void studyPlan;
  void _questions;
  return {
    ...rest,
    sourceInsufficient: false,
    practice: {
      layout: layout.id,
      objectives: Object.fromEntries(
        (plan.objectives as unknown[]).map((o, i) => [`capability_${i}`, o]),
      ),
      plannedCoverage: plan.plannedCoverage,
      activities: Object.fromEntries(
        layout.slots.map((slot, i) => [
          slot.name,
          { question: questions[i], hints: object((plan.steps as unknown[])[i]).hints },
        ]),
      ),
    },
  };
}
export const PRACTICE_SLOT_INSTRUCTIONS =
  'Contratto attività: scegli un layout ammesso con soltanto capacità effettivamente preparate dalla fonte; il massimo non è obbligatorio. Restituisci practice con layout, objectives nominati capability_N, plannedCoverage e activities. Ogni slot activity_ORDINALE_STADIO_capability_N incorpora question (con consegna e soluzione) e hints. Genera contenuti appropriati al ruolo già indicato nello slot: esempio svolto aperto, esercizio guidato o prova autonoma; trasferimento soltanto se il metodo è già insegnato. Non restituire questions, studyPlan, steps, stage o objectiveIndex separati. Non spostare, duplicare o rinominare slot; non etichettare un esercizio autonomo come esempio. Il server materializza esattamente il layout scelto, senza riordinare contenuti. Se non puoi preparare una triade coerente con la fonte, sourceInsufficient=true e practice=null. Gli hints sono due o tre aiuti specifici e progressivi della domanda nello STESSO slot. I riferimenti sourceExcerptId e la copertura seguono il contratto delle evidenze.';
