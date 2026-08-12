import type {
  DifferentiatedChoice,
  DifferentiatedQuestionConfig,
  VerificationDifferentiationConfig,
} from '../../../types/firestore.js';

export class DifferentiationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DifferentiationConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
  );
}

function parseChoice(value: unknown): DifferentiatedChoice {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new DifferentiationConfigError('Una scelta differenziata non è valida.');
  }
  if (value.kind === 'base' || value.kind === 'none') {
    if (!hasOnlyKeys(value, ['kind'])) {
      throw new DifferentiationConfigError('Una scelta differenziata contiene proprietà inattese.');
    }
    return { kind: value.kind };
  }
  if (value.kind === 'alternative') {
    if (
      !hasOnlyKeys(value, ['kind', 'questionIndexEntryId']) ||
      typeof value.questionIndexEntryId !== 'string' ||
      value.questionIndexEntryId.trim() !== value.questionIndexEntryId ||
      value.questionIndexEntryId.length === 0
    ) {
      throw new DifferentiationConfigError('Il riferimento alla domanda alternativa non è valido.');
    }
    return { kind: 'alternative', questionIndexEntryId: value.questionIndexEntryId };
  }
  throw new DifferentiationConfigError('Il tipo di scelta differenziata non è riconosciuto.');
}

/** Parser chiuso e fail-closed del contratto persistito VDIF-03. */
export function parseDifferentiationConfig(
  value: unknown,
): VerificationDifferentiationConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !hasOnlyKeys(value, ['questions', 'version']) || value.version !== 1) {
    throw new DifferentiationConfigError('La configurazione delle varianti non è valida.');
  }
  if (!Array.isArray(value.questions)) {
    throw new DifferentiationConfigError("L'elenco delle domande differenziate non è valido.");
  }

  const bases = new Set<string>();
  const alternativesByLabel = new Map<string, Set<string>>();
  const questions: DifferentiatedQuestionConfig[] = value.questions.map((raw) => {
    if (!isRecord(raw) || !hasOnlyKeys(raw, ['baseQuestionIndexEntryId', 'choices'])) {
      throw new DifferentiationConfigError('Una domanda differenziata non è valida.');
    }
    const base = raw.baseQuestionIndexEntryId;
    if (typeof base !== 'string' || base.length === 0 || base.trim() !== base || bases.has(base)) {
      throw new DifferentiationConfigError('La domanda base è assente o duplicata.');
    }
    bases.add(base);
    if (!isRecord(raw.choices)) {
      throw new DifferentiationConfigError('Le scelte per etichetta non sono valide.');
    }
    const choices: Record<string, DifferentiatedChoice> = {};
    for (const [labelId, choice] of Object.entries(raw.choices)) {
      if (labelId.length === 0 || labelId.trim() !== labelId) {
        throw new DifferentiationConfigError("L'identificativo di un'etichetta non è valido.");
      }
      choices[labelId] = parseChoice(choice);
      const parsed = choices[labelId]!;
      if (parsed.kind === 'alternative') {
        const used = alternativesByLabel.get(labelId) ?? new Set<string>();
        if (used.has(parsed.questionIndexEntryId)) {
          throw new DifferentiationConfigError(
            'La stessa alternativa non può essere riutilizzata per la stessa etichetta.',
          );
        }
        used.add(parsed.questionIndexEntryId);
        alternativesByLabel.set(labelId, used);
      }
    }
    if (!Object.values(choices).some((choice) => choice.kind !== 'base')) {
      throw new DifferentiationConfigError(
        'Le configurazioni che usano soltanto la domanda base devono essere omesse.',
      );
    }
    return { baseQuestionIndexEntryId: base, choices };
  });

  if (questions.length === 0) {
    throw new DifferentiationConfigError('Una configurazione vuota deve essere omessa.');
  }
  return { version: 1, questions };
}

export function referencedDifferentiationLabelIds(
  config: VerificationDifferentiationConfig | undefined,
): Set<string> {
  return new Set(config?.questions.flatMap((question) => Object.keys(question.choices)) ?? []);
}

export function variantCountForBase(
  config: VerificationDifferentiationConfig | undefined,
  baseQuestionIndexEntryId: string,
): number {
  const question = config?.questions.find(
    (item) => item.baseQuestionIndexEntryId === baseQuestionIndexEntryId,
  );
  return question
    ? Object.values(question.choices).filter((choice) => choice.kind !== 'base').length
    : 0;
}

export function reconcileDifferentiationWithSelection(
  config: VerificationDifferentiationConfig | undefined,
  selectedIds: ReadonlySet<string>,
): { config: VerificationDifferentiationConfig | undefined; removedQuestions: number } {
  if (!config) return { config: undefined, removedQuestions: 0 };
  const questions = config.questions.filter((item) =>
    selectedIds.has(item.baseQuestionIndexEntryId),
  );
  return {
    config: questions.length > 0 ? { version: 1, questions } : undefined,
    removedQuestions: config.questions.length - questions.length,
  };
}

export function setDifferentiatedQuestion(
  config: VerificationDifferentiationConfig | undefined,
  baseQuestionIndexEntryId: string,
  choices: Record<string, DifferentiatedChoice>,
): VerificationDifferentiationConfig | undefined {
  const remaining =
    config?.questions.filter(
      (item) => item.baseQuestionIndexEntryId !== baseQuestionIndexEntryId,
    ) ?? [];
  // `base` è il default implicito: non persisterlo evita che un'etichetta non
  // realmente usata muova `draftUsageCount` e ne impedisca l'eliminazione.
  const nonBaseChoices = Object.fromEntries(
    Object.entries(choices).filter(([, choice]) => choice.kind !== 'base'),
  );
  const hasVariant = Object.keys(nonBaseChoices).length > 0;
  const questions = hasVariant
    ? [...remaining, { baseQuestionIndexEntryId, choices: nonBaseChoices }]
    : remaining;
  return questions.length > 0 ? { version: 1, questions } : undefined;
}
