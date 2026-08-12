import type { ChangeEvent } from 'react';
import styles from './StudentsView.module.css';

/**
 * Le due proprietà modificabili dalla card studente: **Classe** ed
 * **Etichetta**.
 *
 * Stanno insieme perché sono la stessa cosa dal punto di vista dell'interfaccia
 * — proprietà del record, non azioni discrete — e perché il loro layout è un
 * fatto congiunto: affiancate quando c'è spazio, incolonnate quando non ce n'è.
 * Tenerle in un componente a sé le rende anche **montabili da sole** nello smoke
 * visivo, che così misura i componenti reali e non una loro riproduzione.
 *
 * Nessun `labelId` compare a schermo: l'opzione porta il nome dell'etichetta, e
 * il valore tecnico resta nell'attributo `value`.
 */

export const NO_LABEL_TEXT = 'Nessuna etichetta';

export type StudentIdentityFieldsProps = {
  studentId: string;
  /** Nome leggibile, usato nelle etichette accessibili dei due controlli. */
  studentName: string;
  classes: { id: string; name: string }[];
  classId: string | null;
  classDisabled: boolean;
  onClassChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  /** Già ordinate: il componente non decide l'ordine, lo mostra. */
  labels: { labelId: string; name: string }[];
  /** `''` = nessuna etichetta. */
  labelValue: string;
  labelDisabled: boolean;
  labelError: string | null;
  onLabelChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  onLabelRetry: () => void;
};

export function StudentIdentityFields({
  studentId,
  studentName,
  classes,
  classId,
  classDisabled,
  onClassChange,
  labels,
  labelValue,
  labelDisabled,
  labelError,
  onLabelChange,
  onLabelRetry,
}: StudentIdentityFieldsProps) {
  const errorId = `student-label-error-${studentId}`;
  return (
    <div className={styles.identityFields}>
      {/*
       * UI-STUDENTI-CLASSI-01 — la classe resta modificabile direttamente dalla
       * card, non nel menu «…»: è una proprietà dello studente, non un'azione
       * discreta. Il click sulla select non apre né la card (che non ha
       * superficie apribile) né il menu.
       */}
      <div className={styles.classField}>
        <label className={styles.classLabel} htmlFor={`student-class-${studentId}`}>
          Classe
        </label>
        <select
          id={`student-class-${studentId}`}
          aria-label={`Classe di ${studentName}`}
          className={styles.classSelect}
          value={classId ?? ''}
          disabled={classDisabled}
          onChange={onClassChange}
        >
          <option value="">Nessuna classe</option>
          {classes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      {/*
       * VDIF-02 — l'etichetta è una proprietà dello studente esattamente come la
       * classe: stesso posto, stesso gesto, salvataggio immediato alla
       * selezione, busy circoscritto alla card.
       */}
      <div className={`${styles.classField} ${styles.labelField}`}>
        <label className={styles.classLabel} htmlFor={`student-label-${studentId}`}>
          Etichetta
        </label>
        <select
          id={`student-label-${studentId}`}
          aria-label={`Etichetta di ${studentName}`}
          className={styles.classSelect}
          value={labelValue}
          disabled={labelDisabled}
          aria-describedby={labelError ? errorId : undefined}
          aria-invalid={labelError ? true : undefined}
          onChange={onLabelChange}
        >
          <option value="">{NO_LABEL_TEXT}</option>
          {labels.map((label) => (
            <option key={label.labelId} value={label.labelId}>
              {label.name}
            </option>
          ))}
        </select>
        {labelError ? (
          <div className={styles.labelFieldFeedback}>
            <p className={styles.labelFieldError} id={errorId} role="alert">
              {labelError}
            </p>
            <button
              type="button"
              className={`btn-secondary ${styles.labelRetryButton}`}
              disabled={labelDisabled}
              onClick={onLabelRetry}
            >
              Riprova
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
