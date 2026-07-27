import type { ReactNode } from 'react';
import styles from './CourseRecordCard.module.css';

export type CourseRecordMetric = {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
};

export type CourseRecordDetail = {
  label: string;
  value: string;
  title?: string;
};

type CourseRecordProgress = {
  label: string;
  value: number;
  text: string;
};

type CourseRecordCardProps = {
  title: string;
  openLabel: string;
  onOpen: () => void;
  details?: CourseRecordDetail[];
  metrics: CourseRecordMetric[];
  progress?: CourseRecordProgress;
  actions?: ReactNode;
};

/**
 * Shared, presentational course record surface. Data loading and mutations stay
 * in the role-specific views; the full-card button is a sibling of the action
 * controls, so the markup never nests interactive elements.
 */
export function CourseRecordCard({
  title,
  openLabel,
  onOpen,
  details = [],
  metrics,
  progress,
  actions,
}: CourseRecordCardProps) {
  return (
    <article className={styles.card} role="listitem" aria-label={`Corso ${title}`}>
      <span className={styles.accent} aria-hidden="true" />
      <button
        type="button"
        className={styles.openSurface}
        aria-label={openLabel}
        title={openLabel}
        onClick={onOpen}
      />

      <div className={styles.content}>
        <header className={styles.identity}>
          <h3 className={styles.title}>{title}</h3>
          {details.length > 0 && (
            <div className={styles.details}>
              {details.map((detail) => (
                <span key={detail.label} title={detail.title}>
                  <strong>{detail.label}</strong> {detail.value}
                </span>
              ))}
            </div>
          )}
          <span className={styles.openCta} aria-hidden="true">
            Apri programma →
          </span>
        </header>

        <dl className={styles.metrics}>
          {metrics.map((metric) => (
            <div className={styles.metric} key={metric.label}>
              {metric.icon && (
                <span className={styles.metricIcon} aria-hidden="true">
                  {metric.icon}
                </span>
              )}
              <dt>{metric.label}</dt>
              <dd>{metric.value}</dd>
            </div>
          ))}
        </dl>

        {progress && (
          <div className={styles.progress}>
            <div className={styles.progressText}>
              <span>{progress.label}</span>
              <strong>{progress.text}</strong>
            </div>
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-label={progress.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.value}
            >
              <span className={styles.progressFill} style={{ width: `${progress.value}%` }} />
            </div>
          </div>
        )}
      </div>

      {actions && <div className={styles.actions}>{actions}</div>}
    </article>
  );
}
