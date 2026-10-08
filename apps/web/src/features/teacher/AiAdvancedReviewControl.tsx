import type { AiReviewFeedback } from '../repository/pools/aiContentClient.js';
import { AiReviewFeedbackInfo } from './AiReviewFeedbackInfo.js';
import type { AiLessonReviewGenerateResult } from '../repository/pools/aiContentClient.js';
import styles from './AiAdvancedReviewControl.module.css';

export function AiAdvancedReviewControl({
  id,
  checked,
  onChange,
  description,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description: string;
}) {
  const descriptionId = `${id}-description`;

  return (
    <div className={styles.control}>
      <div className={styles.header}>
        <span className={styles.title}>Revisione avanzata</span>
        <div className={styles.switchGroup}>
          <span className={styles.switchState} aria-hidden="true">
            {checked ? 'Attiva' : 'Disattivata'}
          </span>
          <button
            id={id}
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label="Revisione avanzata"
            aria-describedby={descriptionId}
            className={`${styles.switch} ${checked ? styles.switchOn : ''}`}
            onClick={() => onChange(!checked)}
          >
            <span className={styles.switchThumb} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p id={descriptionId} className={styles.description}>
        {description}
      </p>
    </div>
  );
}

export function AiAdvancedReviewResult({
  result,
  status,
  feedback,
  replayed,
}: {
  feedback?: AiReviewFeedback;
  replayed?: boolean;
  result: AiLessonReviewGenerateResult | null;
  status?: 'disabled' | 'improved' | 'unchanged';
}) {
  const resolvedStatus = status ?? result?.output.reviewOutcome ?? 'disabled';
  if (resolvedStatus === 'disabled') {
    return (
      <div
        className={`${styles.result} ${styles.resultSkipped}`}
        role="status"
        aria-label="Stato revisione didattica"
      >
        <span className={styles.resultBadge}>Revisione non richiesta</span>
        <span>Il contenuto non è stato sottoposto al revisore didattico.</span>
      </div>
    );
  }

  const improved = resolvedStatus === 'improved';
  return (
    <div
      className={`${styles.result} ${styles.resultCompleted}`}
      role="status"
      aria-label="Stato revisione didattica"
    >
      <div className={styles.header}>
        <span className={styles.resultBadge}>✓ Revisione didattica completata</span>
        <AiReviewFeedbackInfo
          key={JSON.stringify([
            resolvedStatus,
            feedback ?? result?.reviewFeedback,
            replayed ?? result?.replayed,
          ])}
          status={resolvedStatus}
          feedback={feedback ?? result?.reviewFeedback}
          replayed={replayed ?? result?.replayed}
        />
      </div>
      <span>
        {improved
          ? 'Il revisore ha controllato e migliorato il contenuto.'
          : 'Il revisore ha controllato il contenuto e non ha rilevato modifiche necessarie.'}
      </span>
    </div>
  );
}

export function AiAdvancedReviewFailure() {
  return (
    <div
      className={`${styles.result} ${styles.resultFailed}`}
      role="status"
      aria-label="Stato revisione didattica"
    >
      <span className={styles.resultBadge}>Revisione didattica non completata</span>
      <span>
        Il contenuto non è stato presentato come revisionato. Puoi riprovare soltanto questa fase.
      </span>
    </div>
  );
}
