import { parse as parseYaml } from 'yaml';
import type { ZodIssue } from 'zod';
import { PoolFrontMatterSchema } from './schemas.js';
import type { ParsedPool, PoolParseResult, PoolQuestion, PoolValidationError } from './types.js';

function zodPathToField(path: (string | number)[]): string {
  return path.map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? p : `.${p}`)).join('');
}

function extractFrontMatter(content: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  return match ? match[1] : null;
}

function issueToError(
  issue: ZodIssue,
  fileName: string | null,
  domande: unknown[],
): PoolValidationError {
  const path = issue.path;
  let questionId: string | null = null;
  let questionIndex: number | null = null;

  if (path[0] === 'domande' && typeof path[1] === 'number') {
    questionIndex = path[1];
    const q = domande[questionIndex];
    if (
      q &&
      typeof q === 'object' &&
      'id' in q &&
      typeof (q as Record<string, unknown>).id === 'string'
    ) {
      questionId = (q as Record<string, unknown>).id as string;
    }
  }

  const field = zodPathToField(path);

  return { fileName, questionId, questionIndex, field, message: issue.message };
}

function validateCrossQuestion(
  domande: PoolQuestion[],
  fileName: string | null,
): PoolValidationError[] {
  const errors: PoolValidationError[] = [];
  const seen = new Map<string, number>();

  for (let i = 0; i < domande.length; i++) {
    const q = domande[i];

    // Duplicate id check
    if (seen.has(q.id)) {
      errors.push({
        fileName,
        questionId: q.id,
        questionIndex: i,
        field: 'domande[' + i + '].id',
        message: `Duplicate question id "${q.id}" (first seen at index ${seen.get(q.id)})`,
      });
    } else {
      seen.set(q.id, i);
    }

    // Validate soluzione references valid option ids for closed questions
    if (q.tipo === 'chiusa_singola' || q.tipo === 'chiusa_multipla') {
      const optionIds = new Set(q.opzioni.map((o) => o.id));

      for (const sol of q.soluzione) {
        if (!optionIds.has(sol)) {
          errors.push({
            fileName,
            questionId: q.id,
            questionIndex: i,
            field: 'domande[' + i + '].soluzione',
            message: `soluzione references unknown option id "${sol}"`,
          });
        }
      }

      // chiusa_multipla: soluzione must be < total options
      if (q.tipo === 'chiusa_multipla' && q.soluzione.length >= q.opzioni.length) {
        errors.push({
          fileName,
          questionId: q.id,
          questionIndex: i,
          field: 'domande[' + i + '].soluzione',
          message: `chiusa_multipla soluzione must have fewer items than opzioni (got ${q.soluzione.length} of ${q.opzioni.length})`,
        });
      }
    }
  }

  return errors;
}

export function parsePool(content: string, fileName?: string): PoolParseResult {
  const resolvedFileName = fileName ?? null;

  const frontMatterRaw = extractFrontMatter(content);
  if (frontMatterRaw === null) {
    // Try parsing the whole content as YAML (no front matter delimiters)
    return parseFrontMatterString(content, resolvedFileName);
  }

  return parseFrontMatterString(frontMatterRaw, resolvedFileName);
}

function parseFrontMatterString(yaml: string, fileName: string | null): PoolParseResult {
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch (e) {
    return {
      ok: false,
      errors: [
        {
          fileName,
          questionId: null,
          questionIndex: null,
          field: '',
          message: `YAML parse error: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
    };
  }

  const result = PoolFrontMatterSchema.safeParse(raw);

  if (!result.success) {
    const rawDomande =
      raw && typeof raw === 'object' && 'domande' in raw
        ? (((raw as Record<string, unknown>).domande as unknown[]) ?? [])
        : [];

    const errors: PoolValidationError[] = result.error.issues.map((issue) =>
      issueToError(issue, fileName, rawDomande),
    );

    return { ok: false, errors };
  }

  const { domande } = result.data;

  // Annotate maxPoints and cast to PoolQuestion
  const questions: PoolQuestion[] = domande.map((q) => ({
    ...q,
    maxPoints: q.difficolta * q.peso,
  })) as PoolQuestion[];

  const crossErrors = validateCrossQuestion(questions, fileName);
  if (crossErrors.length > 0) {
    return { ok: false, errors: crossErrors };
  }

  const pool: ParsedPool = {
    schema: 'schoolforge-pool/v1',
    domande: questions,
  };

  return { ok: true, pool };
}
