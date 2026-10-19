import { validateStudyPlan, type StudyPlan } from '@schoolforge/lesson-contract';
import type { AiProposalQuestion } from '../pools/aiContentClient.js';
export interface StudyPractice {
  version: 1;
  sourceBody: string;
  plan: StudyPlan;
  questions: AiProposalQuestion[];
}
/** Strict bounded public contract: no pool IDs, scores, student answers or technical metadata. */
export function validateStudyPractice(raw: unknown, body: string): StudyPractice {
  if (!raw || typeof raw !== 'object') throw new Error('Esercitazione non valida.');
  const v = raw as StudyPractice;
  if (
    Object.keys(v).sort().join(',') !== 'plan,questions,sourceBody,version' ||
    v.version !== 1 ||
    v.sourceBody !== body ||
    !body.trim() ||
    new TextEncoder().encode(body).length > 200000 ||
    !Array.isArray(v.questions) ||
    v.questions.length < 3 ||
    v.questions.length > 12
  )
    throw new Error('Esercitazione assente o relativa a una versione diversa della lezione.');
  const plan = validateStudyPlan(v.plan, body, v.questions.length);
  const bounded = (s: unknown, cap: number) =>
    typeof s === 'string' && !!s.trim() && s.length <= cap;
  v.questions.forEach((q, index) => {
    if (
      !q ||
      q.order !== index ||
      !bounded(q.testo, 10000) ||
      !Number.isInteger(q.difficolta) ||
      q.difficolta < 1 ||
      q.difficolta > 5
    )
      throw new Error('Consegna non valida.');
    const expected =
      q.tipo === 'aperta'
        ? ['order', 'tipo', 'testo', 'difficolta', 'soluzione']
        : ['order', 'tipo', 'testo', 'difficolta', 'opzioni', 'soluzioneIndici'];
    if (Object.keys(q).sort().join(',') !== expected.sort().join(','))
      throw new Error('Campi esercizio non validi.');
    if (q.tipo === 'aperta') {
      if (!bounded(q.soluzione, 16000)) throw new Error('Soluzione mancante.');
    } else {
      if (
        !['chiusa_singola', 'chiusa_multipla'].includes(q.tipo) ||
        !Array.isArray(q.opzioni) ||
        q.opzioni.length < 2 ||
        q.opzioni.length > 8 ||
        q.opzioni.some((o) => !bounded(o, 3000)) ||
        new Set(q.opzioni).size !== q.opzioni.length ||
        !Array.isArray(q.soluzioneIndici) ||
        new Set(q.soluzioneIndici).size !== q.soluzioneIndici.length ||
        q.soluzioneIndici.some((i) => !Number.isInteger(i) || i < 0 || i >= q.opzioni.length) ||
        (q.tipo === 'chiusa_singola'
          ? q.soluzioneIndici.length !== 1
          : q.soluzioneIndici.length < 2 || q.soluzioneIndici.length >= q.opzioni.length)
      )
        throw new Error('Opzioni o soluzione non valide.');
    }
    if (plan.steps[index]?.stage === 'esempio' && q.tipo !== 'aperta')
      throw new Error('Esempio senza svolgimento.');
  });
  if (new TextEncoder().encode(JSON.stringify({ plan, questions: v.questions })).length > 100000)
    throw new Error('Esercitazione troppo grande.');
  return { version: 1, sourceBody: body, plan, questions: v.questions };
}
export function currentStudyPractice(raw: unknown, body: string): StudyPractice | null {
  try {
    return validateStudyPractice(raw, body);
  } catch {
    return null;
  }
}
export function practicePoolContext(practice: StudyPractice | null): string | undefined {
  if (!practice) return undefined;
  const unique = <T>(values: T[]): T[] => [
    ...new Map(values.map((value) => [JSON.stringify(value), value])).values(),
  ];
  // Source remains authoritative in the separate lessonSource field. Never send answers or hints.
  const objectives = unique(
    practice.plan.objectives.map(({ capability, method, prerequisites }) => ({
      capability,
      method,
      prerequisites,
    })),
  );
  const activities = practice.plan.steps.map((step) => ({
    objective: objectives.findIndex(
      (o) =>
        JSON.stringify(o) ===
        JSON.stringify(
          (({ capability, method, prerequisites }) => ({ capability, method, prerequisites }))(
            practice.plan.objectives[step.objectiveIndex]!,
          ),
        ),
    ),
    stage: step.stage,
    question: practice.questions[step.questionOrder]?.testo,
  }));
  const coverage = unique(
    practice.plan.plannedCoverage.map(({ objective, status }) => ({ objective, status })),
  );
  const fits = (value: unknown) => {
    const text = JSON.stringify(value);
    return new TextEncoder().encode(text).length <= 50000 ? text : null;
  };
  const full = fits({ objectives, coverage, activities: unique(activities) });
  if (full) return full;
  // Deterministic semantic fallback: retain every capability, method and activity stage/count,
  // instead of truncating stems or silently omitting the entire approved practice.
  const groups = unique(activities.map(({ objective, stage }) => ({ objective, stage })));
  const compact = fits({
    objectives,
    coverage,
    activities: groups.map((group) => ({
      ...group,
      count: activities.filter((a) => a.objective === group.objective && a.stage === group.stage)
        .length,
    })),
    representation: 'capabilities_methods_stages',
  });
  if (!compact)
    throw new Error(
      'Il contesto delle esercitazioni supera il limite: impossibile conservarne capacità e metodi.',
    );
  return compact;
}

export interface CompletePoolContext {
  format: 'legacy' | 'compact';
  /** Undefined until the pool request is prepared; null means no practice context. */
  draftPractice?: string | null;
}
/** Preserve request bytes, while excluding arbitrary/private fields from browser checkpoints. */
export function parseCompletePoolContext(raw: unknown): CompletePoolContext {
  if (!raw || typeof raw !== 'object') throw new Error('Contesto pool non valido.');
  const value = raw as CompletePoolContext;
  if (!['legacy', 'compact'].includes(value.format))
    throw new Error('Formato contesto pool non valido.');
  const text = value.draftPractice;
  if (text === undefined || text === null)
    return { format: value.format, ...(text === null ? { draftPractice: null } : {}) };
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 50000)
    throw new Error('Contesto pool troppo grande.');
  const data: unknown = JSON.parse(text);
  const fields = (item: unknown, allowed: string[]) => {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      Object.keys(item).length !== allowed.length ||
      Object.keys(item).some((key) => !allowed.includes(key))
    )
      throw new Error('Campi contesto pool non validi.');
    return item as Record<string, unknown>;
  };
  const legacy = value.format === 'legacy';
  const fallback = !legacy && !!data && typeof data === 'object' && 'representation' in data;
  const root = fields(
    data,
    legacy
      ? ['objectives', 'activities']
      : ['objectives', 'activities', 'coverage', ...(fallback ? ['representation'] : [])],
  );
  if (
    !Array.isArray(root.objectives) ||
    !root.objectives.length ||
    root.objectives.length > 4 ||
    !Array.isArray(root.activities) ||
    !root.activities.length ||
    root.activities.length > 12
  )
    throw new Error('Struttura contesto pool non valida.');
  const textField = (v: unknown, cap: number) =>
    typeof v === 'string' && !!v.trim() && v.length <= cap;
  root.objectives.forEach((o) => {
    const objective = fields(o, [
      'capability',
      'method',
      'prerequisites',
      ...(legacy ? ['sourceQuote'] : []),
    ]);
    if (
      !textField(objective.capability, 500) ||
      !textField(objective.method, 1500) ||
      !textField(objective.prerequisites, 1000) ||
      (legacy && !textField(objective.sourceQuote, 1200))
    )
      throw new Error('Obiettivo contesto non valido.');
  });
  const objectiveCount = root.objectives.length;
  root.activities.forEach((a) => {
    const activity = fields(
      a,
      legacy
        ? ['capability', 'stage', 'question']
        : ['objective', 'stage', fallback ? 'count' : 'question'],
    );
    if (
      typeof activity.stage !== 'string' ||
      !['esempio', 'guidato', 'autonomo', 'trasferimento'].includes(activity.stage) ||
      (legacy
        ? !textField(activity.capability, 500)
        : !Number.isInteger(activity.objective) ||
          Number(activity.objective) < 0 ||
          Number(activity.objective) >= objectiveCount) ||
      (fallback
        ? !Number.isInteger(activity.count) ||
          Number(activity.count) < 1 ||
          Number(activity.count) > 12
        : !textField(activity.question, 10000))
    )
      throw new Error('Attività contesto non valida.');
  });
  if (fallback && root.representation !== 'capabilities_methods_stages')
    throw new Error('Rappresentazione contesto non valida.');
  if (!legacy) {
    if (!Array.isArray(root.coverage) || root.coverage.length > 40)
      throw new Error('Copertura contesto non valida.');
    root.coverage.forEach((c) => {
      const coverage = fields(c, ['objective', 'status']);
      if (
        !textField(coverage.objective, 300) ||
        typeof coverage.status !== 'string' ||
        !['preparato', 'parziale', 'non_sviluppato'].includes(coverage.status)
      )
        throw new Error('Copertura contesto non valida.');
    });
  }
  // Never serialize parsed data: original ordering/escaping is part of the request hash.
  return { format: value.format, draftPractice: text };
}

/** Cross-release recovery only: identical to the pre-compaction request representation. */
export function legacyPracticePoolContext(practice: StudyPractice): string {
  const context = JSON.stringify({
    objectives: practice.plan.objectives,
    activities: practice.plan.steps.map((s) => ({
      capability: practice.plan.objectives[s.objectiveIndex]?.capability,
      stage: s.stage,
      question: practice.questions[s.questionOrder]?.testo,
    })),
  });
  if (new TextEncoder().encode(context).length > 50000)
    throw Object.assign(
      new Error(
        'La sessione precedente ometteva il contesto: occorre riavviare esplicitamente la generazione.',
      ),
      { code: 'legacy_practice_context_overflow' },
    );
  return context;
}
