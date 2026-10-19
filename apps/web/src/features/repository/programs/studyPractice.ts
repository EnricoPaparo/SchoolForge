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
