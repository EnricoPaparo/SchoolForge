import { useEffect, useRef, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import { DialogShell } from '../../components/DialogShell.js';
import type { loadVerificationLessonOutcomes } from '../repository/outcomes/verificationLessonOutcomesService.js';
import type { VerificationLessonOutcomesReport } from '../repository/outcomes/verificationLessonOutcomes.js';
import styles from './VerificationOutcomesDialog.module.css';

// Il dialog resta importabile senza inizializzare l'adapter Firebase globale.
// Il service reale viene caricato soltanto quando il docente apre «Esiti»;
// nei test il caricatore iniettato non attraversa affatto quel confine runtime.
const defaultLoadReport: typeof loadVerificationLessonOutcomes = async (input) => {
  const service = await import('../repository/outcomes/verificationLessonOutcomesService.js');
  return service.loadVerificationLessonOutcomes(input);
};

export type VerificationOutcomesDialogProps = {
  verificationId: string;
  verificationTitle: string;
  ownerUid: string;
  db: Firestore;
  onClose: () => void;
  loadReport?: typeof loadVerificationLessonOutcomes;
};

function masteryLabel(value: number): string {
  return `${value}%`;
}

/**
 * ESITI-01 — superficie owner-only e di sola lettura. Il caricamento parte
 * esclusivamente all'apertura; chiudere il dialog invalida il risultato in
 * volo senza listener, polling o aggiornamenti dopo lo smontaggio.
 */
export function VerificationOutcomesDialog({
  verificationId,
  verificationTitle,
  ownerUid,
  db,
  onClose,
  loadReport = defaultLoadReport,
}: VerificationOutcomesDialogProps) {
  const introRef = useRef<HTMLParagraphElement>(null);
  const [report, setReport] = useState<VerificationLessonOutcomesReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    setReport(null);
    loadReport({ verificationId, ownerUid, db })
      .then((value) => {
        if (current) setReport(value);
      })
      .catch((reason: unknown) => {
        if (!current) return;
        setError(
          reason instanceof Error ? reason.message : 'Non è stato possibile calcolare gli esiti.',
        );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [db, loadReport, ownerUid, verificationId]);

  return (
    <DialogShell
      title={`Esiti — ${verificationTitle}`}
      onCancel={onClose}
      variant="wide-scroll"
      initialFocusRef={introRef}
    >
      <p ref={introRef} tabIndex={-1} className={styles.intro}>
        Padronanza media per UDA e lezione, ordinata dalle aree più deboli.
      </p>

      {loading && (
        <p role="status" className={styles.state}>
          Calcolo degli esiti…
        </p>
      )}
      {error && (
        <p role="alert" className={`text-error ${styles.state}`}>
          {error}
        </p>
      )}
      {report && (
        <>
          <section className={styles.coverage} aria-label="Copertura delle correzioni">
            <span className={styles.coverageValue}>
              {report.finalizedCorrections}/{report.submittedCount}
            </span>
            <span>
              correzioni definitive
              {report.finalizedCorrections < report.submittedCount
                ? ' — i valori cambieranno completando le correzioni'
                : ' — copertura completa'}
            </span>
          </section>

          {report.udas.length === 0 ? (
            <p className={styles.empty}>Non ci sono ancora correzioni definitive da aggregare.</p>
          ) : (
            <div className={styles.scroll}>
              <div className={styles.udaList} aria-label="Esiti per UDA e lezione">
                {report.udas.map((uda) => (
                  <section key={uda.udaDir} className={styles.udaCard}>
                    <header className={styles.udaHeader}>
                      <div className={styles.udaIdentity}>
                        <span className={styles.udaTag}>UDA</span>
                        <h4>{uda.udaTitle}</h4>
                      </div>
                      <div className={styles.udaMastery}>
                        <span>Padronanza</span>
                        <strong>{masteryLabel(uda.masteryPercentage)}</strong>
                      </div>
                    </header>
                    <ul className={styles.lessonList}>
                      {uda.lessons.map((lesson) => (
                        <li
                          key={`${lesson.udaDir}/${lesson.lessonFilename}`}
                          className={styles.lessonRow}
                        >
                          <div className={styles.lessonTitle}>{lesson.lessonTitle}</div>
                          <div className={styles.metric}>
                            <span>Padronanza</span>
                            <strong>{masteryLabel(lesson.masteryPercentage)}</strong>
                          </div>
                          <div className={styles.metric}>
                            <span>Domande</span>
                            <strong>{lesson.questionCount}</strong>
                          </div>
                          <div className={styles.metric}>
                            <span>Valutazioni</span>
                            <strong>{lesson.evaluationCount}</strong>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className={styles.actions}>
        <button type="button" onClick={onClose}>
          Chiudi
        </button>
      </div>
    </DialogShell>
  );
}
