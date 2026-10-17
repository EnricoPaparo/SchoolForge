import { buildStudyPlanSchema } from '@schoolforge/lesson-contract';
import { AiContentError, type PoolRequest } from './aiContentCore.js';

export function practiceSourceExcerpts(source: string): string[] {
  if (source.length < 20)
    throw new AiContentError(
      'invalid_input',
      'La fonte deve contenere almeno 20 caratteri per documentare le capacità.',
    );
  const excerpts: string[] = [];
  for (let start = 0; start < source.length; ) {
    let end = Math.min(start + 1100, source.length);
    if (end < source.length && /[\uD800-\uDBFF]/.test(source[end - 1]!)) end--;
    const part = source.slice(start, end);
    if (part.length < 20 && excerpts.length) excerpts[excerpts.length - 1] += part;
    else excerpts.push(part);
    start = end;
  }
  return excerpts;
}
export function practiceSourcePrompt(source: string): string {
  return practiceSourceExcerpts(source)
    .map((text, id) => `<<<ESTRATTO ${id}>>>\n${text}\n<<<FINE_ESTRATTO ${id}>>>`)
    .join('\n');
}
export function buildProviderStudyPlanSchema(
  request: Pick<PoolRequest, 'counts' | 'plannedObjectives' | 'lessonSource'>,
) {
  const total = Object.values(request.counts).reduce((a, b) => a + b, 0);
  const base = buildStudyPlanSchema(total, request.plannedObjectives ?? [], request.counts.aperta);
  const reference = {
    type: 'integer',
    enum: practiceSourceExcerpts(request.lessonSource).map((_, id) => id),
  };
  const objective = base.properties.objectives.items;
  const { sourceQuote: _quote, ...objectiveProperties } = objective.properties;
  void _quote;
  const coverage = base.properties.plannedCoverage.items;
  const {
    sourceQuote: _coverageQuote,
    status: _status,
    ...coverageProperties
  } = coverage.properties;
  void _coverageQuote;
  void _status;
  return {
    ...base,
    properties: {
      ...base.properties,
      objectives: {
        ...base.properties.objectives,
        items: {
          ...objective,
          required: objective.required.map((k) => (k === 'sourceQuote' ? 'sourceExcerptId' : k)),
          properties: { ...objectiveProperties, sourceExcerptId: reference },
        },
      },
      plannedCoverage: {
        ...base.properties.plannedCoverage,
        items: {
          anyOf: [
            {
              ...coverage,
              required: ['objective', 'status', 'sourceExcerptId'],
              properties: {
                ...coverageProperties,
                status: { type: 'string', enum: ['preparato', 'parziale'] },
                sourceExcerptId: reference,
              },
            },
            {
              ...coverage,
              required: ['objective', 'status', 'sourceExcerptId'],
              properties: {
                ...coverageProperties,
                status: { type: 'string', enum: ['non_sviluppato'] },
                sourceExcerptId: { type: 'null' },
              },
            },
          ],
        },
      },
    },
  };
}
function invalid(constraint: string): never {
  throw Object.assign(
    new AiContentError('provider_invalid_output', 'Riferimenti didattici non validi.'),
    { constraint },
  );
}
/** Only invoked on fresh provider output. Stored canonical v1 outputs never pass here. */
export function resolvePracticeSourceReferences(output: unknown, source: string): unknown {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return output;
  const root = output as Record<string, unknown>;
  if (root.sourceInsufficient === true) return output;
  if (!root.studyPlan || typeof root.studyPlan !== 'object' || Array.isArray(root.studyPlan))
    invalid('source_reference_shape');
  const plan = root.studyPlan as Record<string, unknown>;
  const excerpts = practiceSourceExcerpts(source);
  function resolve(raw: unknown, coverage: boolean): Record<string, unknown> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('source_reference_shape');
    const item = raw as Record<string, unknown>;
    if ('sourceQuote' in item || !('sourceExcerptId' in item)) invalid('source_reference_shape');
    const { sourceExcerptId, ...rest } = item;
    if (coverage && item.status === 'non_sviluppato') {
      if (sourceExcerptId !== null) invalid('coverage_reference_status');
      return { ...rest, sourceQuote: null };
    }
    if (sourceExcerptId === null) invalid('coverage_reference_status');
    if (
      !Number.isInteger(sourceExcerptId) ||
      typeof sourceExcerptId !== 'number' ||
      !excerpts[sourceExcerptId]
    )
      invalid('source_reference_unknown');
    return { ...rest, sourceQuote: excerpts[sourceExcerptId] };
  }
  if (!Array.isArray(plan.objectives) || !Array.isArray(plan.plannedCoverage))
    invalid('source_reference_shape');
  return {
    ...root,
    studyPlan: {
      ...plan,
      objectives: plan.objectives.map((o) => resolve(o, false)),
      plannedCoverage: plan.plannedCoverage.map((o) => resolve(o, true)),
    },
  };
}
