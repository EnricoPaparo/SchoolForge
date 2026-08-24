import { parse as parseYaml } from 'yaml';
import { PoolFrontMatterSchema } from './schemas.js';
function zodPathToField(path) {
    return path.map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? p : `.${p}`)).join('');
}
function extractFrontMatter(content) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    return match ? match[1] : null;
}
function issueToError(issue, fileName, questions) {
    const path = issue.path;
    let questionId = null;
    let questionIndex = null;
    if (path[0] === 'questions' && typeof path[1] === 'number') {
        questionIndex = path[1];
        const q = questions[questionIndex];
        if (q &&
            typeof q === 'object' &&
            'id' in q &&
            typeof q.id === 'string') {
            questionId = q.id;
        }
    }
    const field = zodPathToField(path);
    return { fileName, questionId, questionIndex, field, message: issue.message };
}
function validateCrossQuestion(questions, fileName) {
    const errors = [];
    const seen = new Map();
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
        }
        else {
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
export function parsePool(content, fileName) {
    const resolvedFileName = fileName ?? null;
    const frontMatterRaw = extractFrontMatter(content);
    return parseFrontMatterString(frontMatterRaw ?? content, resolvedFileName);
}
function parseFrontMatterString(yaml, fileName) {
    let raw;
    try {
        raw = parseYaml(yaml);
    }
    catch (e) {
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
        const rawQuestions = raw && typeof raw === 'object' && 'questions' in raw
            ? (raw.questions ?? [])
            : [];
        const errors = result.error.issues.map((issue) => issueToError(issue, fileName, rawQuestions));
        return { ok: false, errors };
    }
    const { questions } = result.data;
    const parsedQuestions = questions.map((q) => ({
        ...q,
        maxPoints: q.difficolta,
    }));
    const crossErrors = validateCrossQuestion(parsedQuestions, fileName);
    if (crossErrors.length > 0) {
        return { ok: false, errors: crossErrors };
    }
    const pool = {
        schema: 'schoolforge-pool/v2',
        questions: parsedQuestions,
    };
    return { ok: true, pool };
}
function validateRawContract(raw, fileName) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return [];
    }
    const record = raw;
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
    const errors = [];
    record.questions.forEach((question, questionIndex) => {
        if (!question || typeof question !== 'object' || Array.isArray(question)) {
            return;
        }
        const questionRecord = question;
        const questionId = typeof questionRecord.id === 'string' ? questionRecord.id : null;
        const makeError = (field, message) => ({
            fileName,
            questionId,
            questionIndex,
            field: `questions[${questionIndex}].${field}`,
            message,
        });
        if ('peso' in questionRecord) {
            errors.push(makeError('peso', 'Il campo "peso" non è ammesso nel contratto schoolforge-pool/v2.'));
        }
        if ('maxPoints' in questionRecord) {
            errors.push(makeError('maxPoints', 'Il campo "maxPoints" non è ammesso nel Markdown: è derivato da difficolta.'));
        }
        if (questionRecord.tipo !== 'aperta' && 'maxCharacters' in questionRecord) {
            errors.push(makeError('maxCharacters', 'maxCharacters è ammesso soltanto per le domande aperte.'));
        }
    });
    return errors;
}
