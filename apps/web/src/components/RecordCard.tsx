import { useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import styles from './RecordCard.module.css';

export type RecordCardMetric = {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  interactive?: boolean;
};

export type RecordCardDetail = {
  label: string;
  value: string;
  title?: string;
};

export type RecordCardProgress = {
  label: string;
  value: number;
  text: string;
};

export type RecordCardActionLayout =
  | 'corner'
  | 'grid'
  | 'footer'
  | 'verification'
  | 'student-verification';

export type RecordCardProps = {
  title: string;
  recordLabel: string;
  /**
   * UI-VERIFICHE-06B — qualificatore mostrato **prima** del titolo, separato da
   * `·` (es. la data «02/02/2026»). Opt-in e omesso interamente quando assente:
   * la testata non mostra mai un separatore iniziale o un placeholder inventato.
   */
  titlePrefix?: string;
  /**
   * UI-VERIFICHE-05 — qualificatore secondario mostrato sulla **stessa riga
   * semantica** del titolo, separato da `·` (es. «8 domande»). Opt-in: le card
   * che non lo passano restano identiche.
   */
  titleMeta?: string;
  /**
   * UI-VERIFICHE-05 — riga unica e sobria di metadati (es.
   * «3AInf · 2026/2027 · AI Basics»), alternativa compatta a `details`. Opt-in.
   */
  metaLine?: string;
  openLabel?: string;
  onOpen?: () => void;
  defaultCue?: string;
  details?: RecordCardDetail[];
  metrics: RecordCardMetric[];
  progress?: RecordCardProgress;
  statusControl?: ReactNode;
  actions?: ReactNode;
  errors?: ReactNode;
  actionLayout?: RecordCardActionLayout;
  accentProgressOnInteraction?: boolean;
};

/**
 * Presentational record surface shared by courses and verifications. Domain
 * data and mutations remain in their views. The optional full-card button and
 * every internal control are siblings, avoiding nested interactive markup.
 */
export function RecordCard({
  title,
  recordLabel,
  titlePrefix,
  titleMeta,
  metaLine,
  openLabel,
  onOpen,
  defaultCue,
  details = [],
  metrics,
  progress,
  statusControl,
  actions,
  errors,
  actionLayout = 'corner',
  accentProgressOnInteraction = false,
}: RecordCardProps) {
  const initialCue = defaultCue ?? '';
  const [interactionCue, setInteractionCue] = useState(initialCue);
  const hasOpenSurface = Boolean(openLabel && onOpen);

  function cueFromTarget(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null;
    const action = target.closest<HTMLElement>('[data-record-card-cue]');
    const cue = action?.dataset.recordCardCue?.trim();
    return cue || null;
  }

  function handleActionPointerOver(event: PointerEvent<HTMLElement>) {
    const cue = cueFromTarget(event.target);
    if (cue) setInteractionCue(cue);
  }

  function handleActionFocus(event: FocusEvent<HTMLElement>) {
    const cue = cueFromTarget(event.target);
    if (cue) setInteractionCue(cue);
  }

  function handleActionBlur(event: FocusEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setInteractionCue(initialCue);
  }

  const layoutClass =
    actionLayout === 'grid'
      ? styles.cardActionsGrid
      : actionLayout === 'footer'
        ? styles.cardActionsFooter
        : actionLayout === 'verification'
          ? styles.cardActionsVerification
          : actionLayout === 'student-verification'
            ? styles.cardActionsStudentVerification
            : '';
  const progressAccentClass = accentProgressOnInteraction ? styles.progressAccent : '';
  /**
   * Solo la variante verifica **docente** promuove la CTA a fascia autonoma:
   * le altre card (corso, verifica studente) mantengono la CTA dentro
   * `identity`, quindi il loro markup e il loro layout non cambiano.
   */
  const cueOutsideIdentity = actionLayout === 'verification';
  /**
   * UI-VERIFICHE-06A follow-up — contratto CTA **opt-in ed esplicito**, non più
   * affidato all'ordine delle regole CSS. Ogni card dichiara quale superficie
   * fa comparire la CTA:
   * - `ctaFollowsCard`: hover su qualunque punto della card (corso, verifica
   *   studente) — comportamento storico, invariato;
   * - `ctaFollowsSurface`: solo hover sulla superficie apribile (verifica
   *   docente), così passare sul pulsante «Azioni» non promette l'apertura.
   *
   * Le due classi sono mutuamente esclusive e ognuna ha la propria regola: non
   * esiste alcun selettore generico che le sovrascriva a valle.
   */
  const ctaScopeClass = cueOutsideIdentity ? styles.ctaFollowsSurface : styles.ctaFollowsCard;

  return (
    <article
      className={`${styles.card} ${layoutClass} ${ctaScopeClass} ${progressAccentClass}`}
      role="listitem"
      aria-label={`${recordLabel} ${title}`}
      onClick={(event) => {
        if (!onOpen || !(event.target instanceof Element)) return;
        if (event.target.closest('button')) return;
        onOpen();
      }}
      onPointerOver={handleActionPointerOver}
      onPointerLeave={() => setInteractionCue(initialCue)}
      onFocus={handleActionFocus}
      onBlur={handleActionBlur}
    >
      <span className={styles.accent} aria-hidden="true" />
      {hasOpenSurface && (
        <button
          type="button"
          className={styles.openSurface}
          aria-label={openLabel}
          onClick={(event) => {
            event.stopPropagation();
            onOpen?.();
          }}
        />
      )}

      <div className={styles.content}>
        <header className={styles.identity}>
          {/*
           * Titolo e qualificatore restano nello **stesso** elemento di
           * intestazione, così «Reti · 8 domande» è una sola riga semantica e
           * va a capo in modo ordinato quando serve.
           */}
          <h3 className={styles.title}>
            {titlePrefix && (
              <>
                <span className={styles.titleMeta}>{titlePrefix}</span>
                <span className={styles.titleSeparator} aria-hidden="true">
                  {' · '}
                </span>
              </>
            )}
            {title}
            {titleMeta && (
              <>
                <span className={styles.titleSeparator} aria-hidden="true">
                  {' · '}
                </span>
                <span className={styles.titleMeta}>{titleMeta}</span>
              </>
            )}
          </h3>
          {metaLine && <p className={styles.metaLine}>{metaLine}</p>}
          {details.length > 0 && (
            <div className={styles.details}>
              {details.map((detail) => (
                <span key={`${detail.label}:${detail.value}`} title={detail.title}>
                  <strong>{detail.label}</strong> {detail.value}
                </span>
              ))}
            </div>
          )}
          {/* Nel layout verifica docente la CTA è una fascia autonoma (sotto la
              riga metadati su desktop, ultima fascia su mobile). */}
          {interactionCue && !cueOutsideIdentity && (
            <span className={styles.openCta} aria-hidden="true">
              {interactionCue}
            </span>
          )}
        </header>

        {interactionCue && cueOutsideIdentity && (
          <span className={`${styles.openCta} ${styles.openCtaBand}`} aria-hidden="true">
            {interactionCue}
          </span>
        )}

        <dl className={styles.metrics}>
          {metrics.map((metric) => (
            <div
              className={`${styles.metric} ${metric.interactive ? styles.metricInteractive : ''}`}
              key={metric.label}
              data-metric-label={metric.label}
            >
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

      {statusControl && <div className={styles.statusControl}>{statusControl}</div>}
      {actions && <div className={styles.actions}>{actions}</div>}
      {errors && <div className={styles.errors}>{errors}</div>}
    </article>
  );
}
