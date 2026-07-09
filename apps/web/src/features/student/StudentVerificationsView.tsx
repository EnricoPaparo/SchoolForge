import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth.js';
import { db } from '../../lib/firebase.js';
import {
  loadStudentVerifications,
  type StudentVerificationItem,
} from '../repository/verifications/studentVerificationsService.js';
import { downloadStudentPdfFromProjection } from '../repository/verifications/verificationPdf.js';
import styles from './StudentVerificationsView.module.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'no-class' }
  | { status: 'ok'; verifications: StudentVerificationItem[] };

/** it-IT date from a Firestore Timestamp-like value, or null if absent. */
function formatActivatedAt(ts: unknown): string | null {
  if (!ts || typeof ts !== 'object' || !('seconds' in ts)) return null;
  const date = new Date((ts as { seconds: number }).seconds * 1000);
  return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Read-only Verifiche section for the student portal (M3L-D). Reads only
 * publishedProjection (via studentVerificationsService) — never the parent
 * verification document, teacherSnapshot, config.questionRefs,
 * questionIndex, or a pool file. No online answers, no consegna, no
 * punteggio, no soluzioni: the only action is downloading a solution-free
 * PDF generated entirely in the browser.
 */
export function StudentVerificationsView() {
  const { user } = useAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);
  const [pdfErrors, setPdfErrors] = useState<Record<string, string>>({});

  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return;
    void load(uid);
  }, [uid]);

  async function load(uid: string) {
    setState({ status: 'loading' });
    try {
      const result = await loadStudentVerifications(uid, db);
      if (result.status === 'no-class') {
        setState({ status: 'no-class' });
      } else {
        setState({ status: 'ok', verifications: result.verifications });
      }
    } catch {
      setState({ status: 'error' });
    }
  }

  async function handleDownloadPdf(item: StudentVerificationItem) {
    setPdfErrors((prev) => ({ ...prev, [item.id]: '' }));
    setPdfLoadingId(item.id);
    try {
      await downloadStudentPdfFromProjection(item);
    } catch {
      setPdfErrors((prev) => ({
        ...prev,
        [item.id]: 'Impossibile generare il PDF della verifica.',
      }));
    } finally {
      setPdfLoadingId(null);
    }
  }

  if (state.status === 'loading') {
    return (
      <p aria-busy="true" className="state-loading">
        Caricamento…
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <p role="alert" className="text-error">
        Impossibile caricare le verifiche.
      </p>
    );
  }

  if (state.status === 'no-class') {
    return (
      <section aria-label="Verifiche" className={styles.container}>
        <p className="state-empty">
          Nessuna classe assegnata. Chiedi al tuo docente di assegnarti una classe per vedere le
          verifiche.
        </p>
      </section>
    );
  }

  const { verifications } = state;

  if (verifications.length === 0) {
    return (
      <section aria-label="Verifiche" className={styles.container}>
        <p className="state-empty">Nessuna verifica pubblicata per la tua classe.</p>
      </section>
    );
  }

  return (
    <section aria-label="Verifiche" className={styles.container}>
      <ul className={styles.list}>
        {verifications.map((item) => {
          const activatedLabel = formatActivatedAt(item.activatedAt);
          const pdfError = pdfErrors[item.id];

          return (
            <li key={item.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>{item.title}</h3>
                {item.className && <span className={styles.classBadge}>{item.className}</span>}
              </div>

              <dl className={styles.cardMeta}>
                {activatedLabel && (
                  <div className={styles.metaItem}>
                    <dt>Data</dt>
                    <dd>{activatedLabel}</dd>
                  </div>
                )}
                <div className={styles.metaItem}>
                  <dt>Domande</dt>
                  <dd>{item.questionCount}</dd>
                </div>
              </dl>

              <button
                type="button"
                className={styles.pdfBtn}
                disabled={pdfLoadingId === item.id}
                aria-label={`Scarica PDF — ${item.title}`}
                onClick={() => void handleDownloadPdf(item)}
              >
                {pdfLoadingId === item.id ? 'Generazione…' : 'Scarica PDF'}
              </button>

              {pdfError && (
                <p role="alert" className={`text-error ${styles.pdfError}`}>
                  {pdfError}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
