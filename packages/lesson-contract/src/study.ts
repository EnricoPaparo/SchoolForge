/** Additive study contract. Source quotations are evidence, not proof of pedagogical validity. */
export interface StudyObjective {
  capability: string;
  prerequisites: string;
  method: string;
  sourceQuote: string;
}
export type StudyStage = 'esempio' | 'guidato' | 'autonomo' | 'trasferimento';
export interface StudyStep {
  questionOrder: number;
  objectiveIndex: number;
  stage: StudyStage;
  hints: string[];
}
export interface StudyCoverage {
  objective: string;
  status: 'preparato' | 'parziale' | 'non_sviluppato';
  sourceQuote: string | null;
}
export interface StudyPlan {
  objectives: StudyObjective[];
  steps: StudyStep[];
  plannedCoverage: StudyCoverage[];
}
export const STUDY_TEXT_LIMITS = {
  capability: 500,
  prerequisites: 1000,
  method: 1500,
  quoteMin: 20,
  quoteMax: 1200,
  hint: 1500,
  plannedObjective: 300,
} as const;
export const STUDY_PLAN_CONSTRAINTS = [
  'shape',
  'keys',
  'coverage_count',
  'coverage_status',
  'coverage_evidence',
  'coverage_objectives',
  'objective_count',
  'step_count',
  'capability_text',
  'prerequisites_text',
  'method_text',
  'quote_text',
  'quote_not_found',
  'step_reference',
  'hint_text',
  'progression',
] as const;
export type StudyPlanConstraint = (typeof STUDY_PLAN_CONSTRAINTS)[number];
/** No source text, ordinals or arbitrary provider data are attached to this error. */
export class StudyPlanValidationError extends Error {
  constructor(
    readonly constraint: StudyPlanConstraint,
    message: string,
  ) {
    super(message);
  }
}
const boundedText = (max: number, min = 1) => ({
  type: 'string',
  minLength: min,
  maxLength: max,
  pattern: '\\S',
});
const quoteSchema = boundedText(STUDY_TEXT_LIMITS.quoteMax, STUDY_TEXT_LIMITS.quoteMin);
export function buildStudyPlanSchema(
  questionCount?: number,
  plannedObjectives?: readonly string[],
  openQuestionCount?: number,
) {
  const planned = plannedObjectives === undefined ? undefined : [...new Set(plannedObjectives)];
  const maximumObjectives =
    questionCount === undefined
      ? 4
      : Math.min(4, Math.floor(questionCount / 3), openQuestionCount ?? 4);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['objectives', 'steps', 'plannedCoverage'],
    properties: {
      plannedCoverage: {
        type: 'array',
        minItems: planned?.length ?? 0,
        maxItems: planned?.length ?? 40,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['objective', 'status', 'sourceQuote'],
          properties: {
            objective: {
              ...boundedText(STUDY_TEXT_LIMITS.plannedObjective),
              ...(planned?.length ? { enum: planned } : {}),
            },
            status: { type: 'string', enum: ['preparato', 'parziale', 'non_sviluppato'] },
            sourceQuote: { anyOf: [quoteSchema, { type: 'null' }] },
          },
        },
      },
      objectives: {
        type: 'array',
        minItems: 1,
        maxItems: maximumObjectives,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['capability', 'prerequisites', 'method', 'sourceQuote'],
          properties: {
            capability: boundedText(STUDY_TEXT_LIMITS.capability),
            prerequisites: boundedText(STUDY_TEXT_LIMITS.prerequisites),
            method: boundedText(STUDY_TEXT_LIMITS.method),
            sourceQuote: quoteSchema,
          },
        },
      },
      steps: {
        type: 'array',
        minItems: questionCount ?? 3,
        maxItems: questionCount ?? 12,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['questionOrder', 'objectiveIndex', 'stage', 'hints'],
          properties: {
            questionOrder: { type: 'integer', minimum: 0, maximum: (questionCount ?? 12) - 1 },
            objectiveIndex: { type: 'integer', minimum: 0, maximum: maximumObjectives - 1 },
            stage: { type: 'string', enum: ['esempio', 'guidato', 'autonomo', 'trasferimento'] },
            hints: {
              type: 'array',
              minItems: 2,
              maxItems: 3,
              items: boundedText(STUDY_TEXT_LIMITS.hint),
            },
          },
        },
      },
    },
  };
}
/** General contract; provider generation uses the request-specific builder. */
export const STUDY_PLAN_SCHEMA = buildStudyPlanSchema();
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new StudyPlanValidationError('shape', 'Struttura didattica non valida.');
  return v as Record<string, unknown>;
}
function keys(v: Record<string, unknown>, expected: string[]): void {
  if (
    Object.keys(v).length !== expected.length ||
    Object.keys(v).some((k) => !expected.includes(k))
  )
    throw new StudyPlanValidationError('keys', 'Campi didattici non validi.');
}
function string(
  v: unknown,
  max: number,
  constraint: StudyPlanConstraint = 'shape',
  min = 1,
): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max || v.length < min)
    throw new StudyPlanValidationError(constraint, 'Testo didattico non valido.');
  return v;
}
export function validateStudyPlan(
  value: unknown,
  source: string,
  questionCount: number,
  plannedObjectives?: readonly string[],
): StudyPlan {
  const root = object(value);
  keys(root, ['objectives', 'steps', 'plannedCoverage']);
  if (!Array.isArray(root.plannedCoverage) || root.plannedCoverage.length > 40)
    throw new StudyPlanValidationError('coverage_count', 'Copertura pianificata non valida.');
  const plannedCoverage: StudyCoverage[] = root.plannedCoverage.map((raw) => {
    const c = object(raw);
    keys(c, ['objective', 'status', 'sourceQuote']);
    if (!['preparato', 'parziale', 'non_sviluppato'].includes(String(c.status)))
      throw new StudyPlanValidationError('coverage_status', 'Stato copertura non valido.');
    const quote =
      c.sourceQuote === null
        ? null
        : string(c.sourceQuote, STUDY_TEXT_LIMITS.quoteMax, 'coverage_evidence');
    if (
      c.status === 'non_sviluppato'
        ? quote !== null
        : !quote || quote.length < STUDY_TEXT_LIMITS.quoteMin || !source.includes(quote)
    )
      throw new StudyPlanValidationError('coverage_evidence', 'Evidenza copertura non valida.');
    return {
      objective: string(c.objective, STUDY_TEXT_LIMITS.plannedObjective, 'coverage_objectives'),
      status: c.status as StudyCoverage['status'],
      sourceQuote: quote,
    };
  });
  if (
    new Set(plannedCoverage.map((c) => c.objective)).size !== plannedCoverage.length ||
    (plannedObjectives &&
      (plannedCoverage.length !== new Set(plannedObjectives).size ||
        [...new Set(plannedObjectives)].some(
          (o) => !plannedCoverage.some((c) => c.objective === o),
        )))
  )
    throw new StudyPlanValidationError(
      'coverage_objectives',
      'Obiettivi pianificati non coperti dal resoconto.',
    );
  if (
    questionCount < 3 ||
    questionCount > 12 ||
    !Array.isArray(root.steps) ||
    root.steps.length !== questionCount
  )
    throw new StudyPlanValidationError('step_count', 'Copertura esercitazione non valida.');
  if (
    !Array.isArray(root.objectives) ||
    root.objectives.length < 1 ||
    root.objectives.length > Math.min(4, Math.floor(questionCount / 3))
  )
    throw new StudyPlanValidationError(
      'objective_count',
      'Numero di capacita non compatibile con la progressione.',
    );
  const objectives = root.objectives.map((raw) => {
    const o = object(raw);
    keys(o, ['capability', 'prerequisites', 'method', 'sourceQuote']);
    const sourceQuote = string(
      o.sourceQuote,
      STUDY_TEXT_LIMITS.quoteMax,
      'quote_text',
      STUDY_TEXT_LIMITS.quoteMin,
    );
    if (!source.includes(sourceQuote))
      throw new StudyPlanValidationError(
        'quote_not_found',
        'Riferimento assente dal corpo della lezione.',
      );
    return {
      capability: string(o.capability, STUDY_TEXT_LIMITS.capability, 'capability_text'),
      prerequisites: string(o.prerequisites, STUDY_TEXT_LIMITS.prerequisites, 'prerequisites_text'),
      method: string(o.method, STUDY_TEXT_LIMITS.method, 'method_text'),
      sourceQuote,
    };
  });
  const stages: StudyStage[] = ['esempio', 'guidato', 'autonomo', 'trasferimento'];
  const steps = root.steps.map((raw, index) => {
    const s = object(raw);
    keys(s, ['questionOrder', 'objectiveIndex', 'stage', 'hints']);
    if (
      s.questionOrder !== index ||
      !Number.isInteger(s.objectiveIndex) ||
      Number(s.objectiveIndex) < 0 ||
      Number(s.objectiveIndex) >= objectives.length ||
      !stages.includes(s.stage as StudyStage) ||
      !Array.isArray(s.hints) ||
      s.hints.length < 2 ||
      s.hints.length > 3
    )
      throw new StudyPlanValidationError('step_reference', 'Passo esercitazione non valido.');
    return {
      questionOrder: index,
      objectiveIndex: Number(s.objectiveIndex),
      stage: s.stage as StudyStage,
      hints: s.hints.map((h) => string(h, STUDY_TEXT_LIMITS.hint, 'hint_text')),
    };
  });
  for (let i = 0; i < objectives.length; i++) {
    const progression = steps
      .filter((s) => s.objectiveIndex === i)
      .map((s) => stages.indexOf(s.stage));
    if (
      ![0, 1, 2].every((s) => progression.includes(s)) ||
      progression.some((s, j) => j > 0 && s < progression[j - 1]!)
    )
      throw new StudyPlanValidationError(
        'progression',
        'Ogni obiettivo richiede esempio, guida e autonomia in ordine.',
      );
  }
  return { objectives, steps, plannedCoverage };
}

export interface PoolCoverageSummary {
  coveredCapabilities: string[];
  gaps: string[];
  advancedOrdinals: number[];
}
export const POOL_COVERAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['coveredCapabilities', 'gaps', 'advancedOrdinals'],
  properties: {
    coveredCapabilities: { type: 'array', maxItems: 40, items: { type: 'string' } },
    gaps: { type: 'array', maxItems: 40, items: { type: 'string' } },
    advancedOrdinals: {
      type: 'array',
      maxItems: 30,
      items: { type: 'integer', minimum: 0, maximum: 29 },
    },
  },
} as const;
export function validatePoolCoverage(value: unknown, questionCount: number): PoolCoverageSummary {
  const v = object(value);
  keys(v, ['coveredCapabilities', 'gaps', 'advancedOrdinals']);
  const list = (raw: unknown): string[] => {
    if (!Array.isArray(raw) || raw.length > 40) throw new Error('Riepilogo copertura non valido.');
    return raw.map((s) => string(s, 500));
  };
  if (
    !Array.isArray(v.advancedOrdinals) ||
    v.advancedOrdinals.length > 30 ||
    new Set(v.advancedOrdinals).size !== v.advancedOrdinals.length ||
    v.advancedOrdinals.some(
      (i) => !Number.isInteger(i) || Number(i) < 0 || Number(i) >= questionCount,
    )
  )
    throw new Error('Richieste avanzate non valide.');
  return {
    coveredCapabilities: list(v.coveredCapabilities),
    gaps: list(v.gaps),
    advancedOrdinals: v.advancedOrdinals as number[],
  };
}
