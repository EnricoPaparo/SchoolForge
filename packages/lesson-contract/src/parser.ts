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
  questions: unknown[],
): PoolValidationError {
  const path = issue.path;
  let questionId: string | null = null;
  let questionIndex: number | null = null;

  if (path[0] === 'questions' && typeof path[1] === 'number') {
    questionIndex = path[1];
    const q = questions[questionIndex];
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
  questions: PoolQuestion[],
  fileName: string | null,
): PoolValidationError[] {
  const errors: PoolValidationError[] = [];
  const seen = new Map<string, number>();

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];

    if (seen.has(q.id)) {
      errors.push({
        fileName,
        questionId: q.id,
        questionIndex: i,
        field: `questions[${i}].id`,
        message: `Duplicate question id "${q.id}" (first seen at index ${seen.get(q.id)})`,
      });
    } else {
      seen.set(q.id, i);
    }

    if (q.tipo === 'chiusa_singola' || q.tipo === 'chiusa_multipla') {
      const optionIds = new Set(q.opzioni.map((o) => o.id));

      for (const sol of q.soluzione) {
        if (!optionIds.has(sol)) {
          errors.push({
            fileName,
            questionId: q.id,
            questionIndex: i,
            field: `questions[${i}].soluzione`,
            message: `soluzione references unknown option id "${sol}"`,
          });
        }
      }

      if (q.tipo === 'chiusa_multipla' && q.soluzione.length >= q.opzioni.length) {
        errors.push({
          fileName,
          questionId: q.id,
          questionIndex: i,
          field: `questions[${i}].soluzione`,
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
  return parseFrontMatterString(frontMatterRaw ?? content, resolvedFileName);
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

  const contractErrors = validateRawContract(raw, fileName);
  if (contractErrors.length > 0) {
    return { ok: false, errors: contractErrors };
  }

  const result = PoolFrontMatterSchema.safeParse(raw);

  if (!result.success) {
    const rawQuestions =
      raw && typeof raw === 'object' && 'questions' in raw
        ? (((raw as Record<string, unknown>).questions as unknown[]) ?? [])
        : [];

    const errors: PoolValidationError[] = result.error.issues.map((issue) =>
      issueToError(issue, fileName, rawQuestions),
    );

    return { ok: false, errors };
  }

  const { questions } = result.data;

  const parsedQuestions: PoolQuestion[] = questions.map((q) => ({
    ...q,
    maxPoints: q.difficolta,
  })) as PoolQuestion[];

  const crossErrors = validateCrossQuestion(parsedQuestions, fileName);
  if (crossErrors.length > 0) {
    return { ok: false, errors: crossErrors };
  }

  const pool: ParsedPool = {
    schema: 'schoolforge-pool/v2',
    questions: parsedQuestions,
  };

  return { ok: true, pool };
}

function validateRawContract(raw: unknown, fileName: string | null): PoolValidationError[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [];
  }

  const record = raw as Record<string, unknown>;
  if (record.schema !== 'schoolforge-pool/v2') {
    return [
      {
        fileName,
        questionId: null,
        questionIndex: null,
        field: 'schema',
        message: 'Schema pool non supportato: atteso schoolforge-pool/v2.',
      },
    ];
  }

  if (!Array.isArray(record.questions)) {
    return [];
  }

  const errors: PoolValidationError[] = [];
  record.questions.forEach((question, questionIndex) => {
    if (!question || typeof question !== 'object' || Array.isArray(question)) {
      return;
    }

    const questionRecord = question as Record<string, unknown>;
    const questionId = typeof questionRecord.id === 'string' ? questionRecord.id : null;
    const makeError = (field: string, message: string): PoolValidationError => ({
      fileName,
      questionId,
      questionIndex,
      field: `questions[${questionIndex}].${field}`,
      message,
    });

    if ('peso' in questionRecord) {
      errors.push(
        makeError('peso', 'Il campo "peso" non è ammesso nel contratto schoolforge-pool/v2.'),
      );
    }
    if ('maxPoints' in questionRecord) {
      errors.push(
        makeError(
          'maxPoints',
          'Il campo "maxPoints" non è ammesso nel Markdown: è derivato da difficolta.',
        ),
      );
    }
    if (questionRecord.tipo !== 'aperta' && 'maxCharacters' in questionRecord) {
      errors.push(
        makeError('maxCharacters', 'maxCharacters è ammesso soltanto per le domande aperte.'),
      );
    }
  });

  return errors;
}
