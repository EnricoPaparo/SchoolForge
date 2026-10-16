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
const text = { type: 'string' };
export const STUDY_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['objectives', 'steps', 'plannedCoverage'],
  properties: {
    plannedCoverage: {
      type: 'array',
      maxItems: 40,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['objective', 'status', 'sourceQuote'],
        properties: {
          objective: text,
          status: { type: 'string', enum: ['preparato', 'parziale', 'non_sviluppato'] },
          sourceQuote: { type: ['string', 'null'] },
        },
      },
    },
    objectives: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['capability', 'prerequisites', 'method', 'sourceQuote'],
        properties: { capability: text, prerequisites: text, method: text, sourceQuote: text },
      },
    },
    steps: {
      type: 'array',
      minItems: 3,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['questionOrder', 'objectiveIndex', 'stage', 'hints'],
        properties: {
          questionOrder: { type: 'integer', minimum: 0, maximum: 11 },
          objectiveIndex: { type: 'integer', minimum: 0, maximum: 3 },
          stage: { type: 'string', enum: ['esempio', 'guidato', 'autonomo', 'trasferimento'] },
          hints: { type: 'array', minItems: 2, maxItems: 3, items: text },
        },
      },
    },
  },
} as const;
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('Struttura didattica non valida.');
  return v as Record<string, unknown>;
}
function keys(v: Record<string, unknown>, expected: string[]): void {
  if (
    Object.keys(v).length !== expected.length ||
    Object.keys(v).some((k) => !expected.includes(k))
  )
    throw new Error('Campi didattici non validi.');
}
function string(v: unknown, max: number): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max)
    throw new Error('Testo didattico non valido.');
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
    throw new Error('Copertura pianificata non valida.');
  const plannedCoverage: StudyCoverage[] = root.plannedCoverage.map((raw) => {
    const c = object(raw);
    keys(c, ['objective', 'status', 'sourceQuote']);
    if (!['preparato', 'parziale', 'non_sviluppato'].includes(String(c.status)))
      throw new Error('Stato copertura non valido.');
    const quote = c.sourceQuote === null ? null : string(c.sourceQuote, 1200);
    if (
      c.status === 'non_sviluppato'
        ? quote !== null
        : !quote || quote.length < 20 || !source.includes(quote)
    )
      throw new Error('Evidenza copertura non valida.');
    return {
      objective: string(c.objective, 300),
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
    throw new Error('Obiettivi pianificati non coperti dal resoconto.');
  if (
    !Array.isArray(root.objectives) ||
    root.objectives.length < 1 ||
    root.objectives.length > 4 ||
    !Array.isArray(root.steps) ||
    root.steps.length !== questionCount ||
    questionCount < 3 ||
    questionCount > 12
  )
    throw new Error('Copertura esercitazione non valida.');
  const objectives = root.objectives.map((raw) => {
    const o = object(raw);
    keys(o, ['capability', 'prerequisites', 'method', 'sourceQuote']);
    const sourceQuote = string(o.sourceQuote, 1200);
    if (sourceQuote.length < 20 || !source.includes(sourceQuote))
      throw new Error('Riferimento assente dal corpo della lezione.');
    return {
      capability: string(o.capability, 500),
      prerequisites: string(o.prerequisites, 1000),
      method: string(o.method, 1500),
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
      throw new Error('Passo esercitazione non valido.');
    return {
      questionOrder: index,
      objectiveIndex: Number(s.objectiveIndex),
      stage: s.stage as StudyStage,
      hints: s.hints.map((h) => string(h, 1500)),
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
      throw new Error('Ogni obiettivo richiede esempio, guida e autonomia in ordine.');
  }
  return { objectives, steps, plannedCoverage };
}
