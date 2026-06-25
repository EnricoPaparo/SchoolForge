import type { LessonItem, ProgramItem, UdaItem } from '../programs/programsService.js';

export type ReadinessStatus = 'ok' | 'warning' | 'blocker';

export type ReadinessCheck = {
  id: string;
  label: string;
  status: ReadinessStatus;
  value?: string | number;
  detail?: string;
};

export type ReadinessReport = {
  overallStatus: ReadinessStatus;
  canConsultLessons: boolean;
  canExportProgrammaSvolto: boolean;
  canGenerateVerifiche: boolean;
  checks: ReadinessCheck[];
};

function worstStatus(statuses: ReadinessStatus[]): ReadinessStatus {
  if (statuses.includes('blocker')) return 'blocker';
  if (statuses.includes('warning')) return 'warning';
  return 'ok';
}

export function computeReadiness(input: {
  program: ProgramItem | null;
  udas: UdaItem[];
  lessons: LessonItem[];
  hasActiveImport: boolean;
}): ReadinessReport {
  const { hasActiveImport, udas, lessons } = input;
  const checks: ReadinessCheck[] = [];

  // Import attivo
  if (!hasActiveImport) {
    checks.push({
      id: 'active-import',
      label: 'Import attivo',
      status: 'blocker',
      detail: 'Nessun import attivo',
    });
  } else {
    checks.push({ id: 'active-import', label: 'Import attivo', status: 'ok' });
  }

  // Lezioni
  if (lessons.length === 0) {
    checks.push({
      id: 'lessons',
      label: 'Lezioni importate',
      status: 'blocker',
      value: 0,
      detail: 'Nessuna lezione importata',
    });
  } else {
    checks.push({
      id: 'lessons',
      label: 'Lezioni importate',
      status: 'ok',
      value: lessons.length,
    });
  }

  // UDA
  if (udas.length === 0) {
    checks.push({
      id: 'udas',
      label: 'UDA',
      status: 'blocker',
      value: 0,
      detail: 'Nessuna UDA',
    });
  } else {
    checks.push({ id: 'udas', label: 'UDA', status: 'ok', value: udas.length });
  }

  // Pool validi
  const validPoolLessons = lessons.filter((l) => l.poolStatus === 'valid');
  if (validPoolLessons.length === 0 && lessons.length > 0) {
    checks.push({
      id: 'valid-pool',
      label: 'Pool validi',
      status: 'warning',
      value: 0,
      detail: 'Nessun pool valido (verifiche non disponibili)',
    });
  } else if (validPoolLessons.length > 0) {
    checks.push({
      id: 'valid-pool',
      label: 'Pool validi',
      status: 'ok',
      value: validPoolLessons.length,
    });
  }

  // Pool non validi
  const invalidPoolLessons = lessons.filter((l) => l.poolStatus === 'invalid');
  if (invalidPoolLessons.length > 0) {
    checks.push({
      id: 'invalid-pool',
      label: 'Pool non validi',
      status: 'warning',
      value: invalidPoolLessons.length,
      detail: 'Pool non validi presenti',
    });
  }

  // Domande eleggibili
  const lessonsWithQuestions = lessons.filter((l) => (l.questionCount ?? 0) > 0);
  if (lessonsWithQuestions.length === 0 && lessons.length > 0) {
    checks.push({
      id: 'eligible-questions',
      label: 'Domande eleggibili',
      status: 'warning',
      value: 0,
      detail: 'Nessuna domanda eleggibile',
    });
  } else if (lessonsWithQuestions.length > 0) {
    checks.push({
      id: 'eligible-questions',
      label: 'Domande eleggibili',
      status: 'ok',
      value: lessonsWithQuestions.length,
    });
  }

  // Lezioni svolte
  const completedLessons = lessons.filter((l) => l.completed);
  if (completedLessons.length === 0 && lessons.length > 0) {
    checks.push({
      id: 'completed-lessons',
      label: 'Lezioni svolte',
      status: 'warning',
      value: 0,
      detail: 'Nessuna lezione svolta (programma svolto non disponibile)',
    });
  } else if (completedLessons.length > 0) {
    checks.push({
      id: 'completed-lessons',
      label: 'Lezioni svolte',
      status: 'ok',
      value: completedLessons.length,
    });
  }

  const overallStatus = worstStatus(checks.map((c) => c.status));

  const hasImportBlocker = !hasActiveImport;
  const hasLessonsBlocker = lessons.length === 0;

  const canConsultLessons = !hasImportBlocker && !hasLessonsBlocker;
  const canExportProgrammaSvolto = completedLessons.length > 0;
  const canGenerateVerifiche =
    validPoolLessons.length > 0 &&
    lessons.some((l) => l.poolStatus === 'valid' && (l.questionCount ?? 0) > 0);

  return {
    overallStatus,
    canConsultLessons,
    canExportProgrammaSvolto,
    canGenerateVerifiche,
    checks,
  };
}
