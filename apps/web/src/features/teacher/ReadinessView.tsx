import type { LessonItem, ProgramItem, UdaItem } from '../repository/programs/programsService.js';
import { computeReadiness, type ReadinessStatus } from '../repository/readiness/readinessReport.js';

type Props = {
  program: ProgramItem | null;
  udas: UdaItem[] | null;
  lessons: LessonItem[] | null;
};

function statusIcon(status: ReadinessStatus): string {
  if (status === 'ok') return '✓';
  if (status === 'warning') return '⚠';
  return '✗';
}

function statusLabel(status: ReadinessStatus): string {
  if (status === 'ok') return 'Pronto';
  if (status === 'warning') return 'Attenzione';
  return 'Bloccato';
}

export function ReadinessView({ program, udas, lessons }: Props) {
  if (udas == null || lessons == null) {
    return (
      <section aria-label="Dashboard di prontezza">
        <p aria-busy="true">Caricamento dati prontezza…</p>
      </section>
    );
  }

  const hasActiveImport = program?.activeImportId != null;
  const report = computeReadiness({
    program,
    udas,
    lessons,
    hasActiveImport,
  });

  return (
    <section aria-label="Dashboard di prontezza">
      <h3>Prontezza repository</h3>
      <p>
        <strong>Stato complessivo:</strong> {statusIcon(report.overallStatus)}{' '}
        {statusLabel(report.overallStatus)}
      </p>
      <ul aria-label="Capacità disponibili">
        <li>Consultazione lezioni: {report.canConsultLessons ? '✓' : '✗'}</li>
        <li>Export programma svolto: {report.canExportProgrammaSvolto ? '✓' : '✗'}</li>
        <li>Generazione verifiche: {report.canGenerateVerifiche ? '✓' : '✗'}</li>
      </ul>
      <ul aria-label="Controlli di prontezza">
        {report.checks.map((check) => (
          <li key={check.id}>
            {statusIcon(check.status)} {check.label}
            {check.value !== undefined && <span> ({check.value})</span>}
            {check.detail && <span>: {check.detail}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
