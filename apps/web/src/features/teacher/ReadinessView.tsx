import type { LessonItem, ProgramItem, UdaItem } from '../repository/programs/programsService.js';
import { computeReadiness, type ReadinessStatus } from '../repository/readiness/readinessReport.js';
import styles from './ReadinessView.module.css';

type Props = {
  program: ProgramItem | null;
  udas: UdaItem[] | null;
  lessons: LessonItem[] | null;
};

function statusBadgeClass(status: ReadinessStatus): string {
  if (status === 'ok') return 'badge badge-ok';
  if (status === 'warning') return 'badge badge-warning';
  return 'badge badge-error';
}

function statusLabel(status: ReadinessStatus): string {
  if (status === 'ok') return 'Pronto';
  if (status === 'warning') return 'Attenzione';
  return 'Bloccato';
}

function checkIconClass(status: ReadinessStatus): string {
  if (status === 'ok') return styles.checkIconOk;
  if (status === 'warning') return styles.checkIconWarning;
  return styles.checkIconError;
}

function checkIconSymbol(status: ReadinessStatus): string {
  if (status === 'ok') return '✓';
  if (status === 'warning') return '⚠';
  return '✗';
}

export function ReadinessView({ program, udas, lessons }: Props) {
  if (udas == null || lessons == null) {
    return (
      <section aria-label="Dashboard di prontezza" className={styles.section}>
        <p aria-busy="true" className="state-loading">
          Caricamento dati prontezza…
        </p>
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
    <section aria-label="Dashboard di prontezza" className={styles.section}>
      <h3 className={styles.title}>Prontezza repository</h3>

      <div className={styles.overallRow}>
        <strong>Stato complessivo:</strong>
        <span className={statusBadgeClass(report.overallStatus)}>
          {statusLabel(report.overallStatus)}
        </span>
      </div>

      <ul aria-label="Capacità disponibili" className={styles.capList}>
        <li className={styles.capItem}>
          <span className={report.canConsultLessons ? styles.capOk : styles.capNo}>
            {report.canConsultLessons ? '✓' : '✗'}
          </span>
          Consultazione lezioni
        </li>
        <li className={styles.capItem}>
          <span className={report.canExportProgrammaSvolto ? styles.capOk : styles.capNo}>
            {report.canExportProgrammaSvolto ? '✓' : '✗'}
          </span>
          Export programma svolto
        </li>
        <li className={styles.capItem}>
          <span className={report.canGenerateVerifiche ? styles.capOk : styles.capNo}>
            {report.canGenerateVerifiche ? '✓' : '✗'}
          </span>
          Generazione verifiche
        </li>
      </ul>

      <ul aria-label="Controlli di prontezza" className={styles.checkList}>
        {report.checks.map((check) => (
          <li key={check.id} className={styles.checkItem}>
            <span className={`${styles.checkIcon} ${checkIconClass(check.status)}`}>
              {checkIconSymbol(check.status)}
            </span>
            <span className={styles.checkLabel}>{check.label}</span>
            {check.value !== undefined && (
              <span className={styles.checkValue}>({check.value})</span>
            )}
            {check.detail && <span className={styles.checkDetail}>: {check.detail}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
