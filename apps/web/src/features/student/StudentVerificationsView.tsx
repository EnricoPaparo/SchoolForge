import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth.js';
import { db } from '../../lib/firebase.js';
import {
  loadStudentVerifications,
  type StudentVerificationItem,
} from '../repository/verifications/studentVerificationsService.js';
import { downloadStudentPdfFromProjection } from '../repository/verifications/verificationPdf.js';
import type { SubmissionDoc, SubmissionReceiptDoc } from '../../types/firestore.js';
import { loadReceipt, loadSubmission, startSubmission } from './submissionsService.js';
import { requestFullscreenBestEffort } from './examDeterrence.js';
import { OnlineExamView } from './OnlineExamView.js';
import { ConfirmationView } from './ConfirmationView.js';
import styles from './StudentVerificationsView.module.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'no-class' }
  | { status: 'ok'; verifications: StudentVerificationItem[] };

/** Per-item online status, checked lazily (receipt first, then draft) only for onlineEnabled items. */
type OnlineStatus =
  | { kind: 'checking' }
  | { kind: 'receipt'; receipt: SubmissionReceiptDoc }
  | { kind: 'draft' }
  | { kind: 'none' };

type ViewState =
  | { mode: 'list' }
  | { mode: 'exam'; item: StudentVerificationItem; submission: SubmissionDoc }
  | { mode: 'confirmation'; item: StudentVerificationItem; receipt: SubmissionReceiptDoc };

/** it-IT date from a Firestore Timestamp-like value, or null if absent. */
function formatActivatedAt(ts: unknown): string | null {
  if (!ts || typeof ts !== 'object' || !('seconds' in ts)) return null;
  const date = new Date((ts as { seconds: number }).seconds * 1000);
  return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Verifiche section for the student portal. Read-only for paper
 * verifications (M3L-D: "Scarica PDF" from publishedProjection, never the
 * parent verification document). For `onlineEnabled` verifications (M3F-04)
 * it additionally offers "Svolgi online"/"Riprendi bozza", checking the
 * receipt first and only then (if absent) the submission — a submitted exam
 * never causes the answer form to be shown again, on this load or after a
 * refresh.
 */
export function StudentVerificationsView() {
  const { user } = useAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);
  const [pdfErrors, setPdfErrors] = useState<Record<string, string>>({});
  const [onlineStatus, setOnlineStatus] = useState<Record<string, OnlineStatus>>({});
  const [startErrors, setStartErrors] = useState<Record<string, string>>({});
  const [view, setView] = useState<ViewState>({ mode: 'list' });

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
        return;
      }
      setState({ status: 'ok', verifications: result.verifications });
      void refreshOnlineStatuses(uid, result.verifications);
    } catch {
      setState({ status: 'error' });
    }
  }

  /** Receipt first, submission only if absent — never both reads when unneeded. */
  async function checkOnlineStatus(
    uid: string,
    item: StudentVerificationItem,
  ): Promise<OnlineStatus> {
    const receipt = await loadReceipt(item.id, uid, db);
    if (receipt) return { kind: 'receipt', receipt };
    const submission = await loadSubmission(item.id, uid, db);
    if (submission && submission.status === 'draft') return { kind: 'draft' };
    return { kind: 'none' };
  }

  async function refreshOnlineStatuses(uid: string, verifications: StudentVerificationItem[]) {
    const onlineItems = verifications.filter((item) => item.onlineEnabled);
    for (const item of onlineItems) {
      setOnlineStatus((prev) => ({ ...prev, [item.id]: { kind: 'checking' } }));
      try {
        const status = await checkOnlineStatus(uid, item);
        setOnlineStatus((prev) => ({ ...prev, [item.id]: status }));
      } catch {
        setOnlineStatus((prev) => ({ ...prev, [item.id]: { kind: 'none' } }));
      }
    }
  }

  async function handleDownloadPdf(item: StudentVerificationItem) {
    setPdfErrors((prev) => ({ ...prev, [item.id]: '' }));
    setPdfLoadingId(item.id);
    try {
      await downloadStudentPdfFromProjection(item, {
        displayName: user?.displayName ?? null,
        email: user?.email ?? null,
      });
    } catch {
      setPdfErrors((prev) => ({
        ...prev,
        [item.id]: 'Impossibile generare il PDF della verifica.',
      }));
    } finally {
      setPdfLoadingId(null);
    }
  }

  /** "Svolgi online" / "Riprendi bozza" — fullscreen must be requested synchronously from this click. */
  async function handleStartOrResume(item: StudentVerificationItem) {
    if (!uid) return;
    requestFullscreenBestEffort();
    setStartErrors((prev) => ({ ...prev, [item.id]: '' }));
    try {
      await startSubmission(
        {
          verificationId: item.id,
          studentUid: uid,
          ownerUid: item.ownerUid,
          verificationTitle: item.title,
          className: item.className,
        },
        db,
      );
      const submission = await loadSubmission(item.id, uid, db);
      if (!submission) {
        setStartErrors((prev) => ({
          ...prev,
          [item.id]: 'Impossibile avviare la verifica online. Riprova.',
        }));
        return;
      }
      if (submission.status !== 'draft') {
        // Already submitted between the list load and this click (e.g. another tab) — show the receipt instead.
        const receipt = await loadReceipt(item.id, uid, db);
        if (receipt) {
          setView({ mode: 'confirmation', item, receipt });
          return;
        }
      }
      setView({ mode: 'exam', item, submission });
    } catch {
      setStartErrors((prev) => ({
        ...prev,
        [item.id]: 'Impossibile avviare la verifica online: verifica chiusa o disabilitata.',
      }));
    }
  }

  function handleShowReceipt(item: StudentVerificationItem, receipt: SubmissionReceiptDoc) {
    setView({ mode: 'confirmation', item, receipt });
  }

  function handleExitExam() {
    setView({ mode: 'list' });
    if (uid && state.status === 'ok') void refreshOnlineStatuses(uid, state.verifications);
  }

  function handleSubmitted(item: StudentVerificationItem, receipt: SubmissionReceiptDoc) {
    setOnlineStatus((prev) => ({ ...prev, [item.id]: { kind: 'receipt', receipt } }));
    setView({ mode: 'confirmation', item, receipt });
  }

  function handleBackToListFromConfirmation() {
    setView({ mode: 'list' });
  }

  if (view.mode === 'exam') {
    return (
      <OnlineExamView
        verificationId={view.item.id}
        title={view.item.title}
        className={view.item.className}
        ownerUid={view.item.ownerUid}
        studentUid={uid ?? ''}
        questions={view.item.questions}
        submission={view.submission}
        onExit={handleExitExam}
        onSubmitted={(receipt) => handleSubmitted(view.item, receipt)}
      />
    );
  }

  if (view.mode === 'confirmation') {
    return (
      <ConfirmationView receipt={view.receipt} onBackToList={handleBackToListFromConfirmation} />
    );
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
          const startError = startErrors[item.id];
          const status = onlineStatus[item.id];

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

              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={styles.pdfBtn}
                  disabled={pdfLoadingId === item.id}
                  aria-label={`Scarica PDF — ${item.title}`}
                  onClick={() => void handleDownloadPdf(item)}
                >
                  {pdfLoadingId === item.id ? 'Generazione…' : 'Scarica PDF'}
                </button>

                {item.onlineEnabled && status?.kind === 'receipt' && (
                  <button
                    type="button"
                    className={styles.receiptBtn}
                    onClick={() => handleShowReceipt(item, status.receipt)}
                  >
                    Consegnata — Codice: {status.receipt.deliveryCode}
                  </button>
                )}

                {item.onlineEnabled && status?.kind === 'draft' && (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => void handleStartOrResume(item)}
                  >
                    Riprendi bozza
                  </button>
                )}

                {item.onlineEnabled && (status?.kind === 'none' || status === undefined) && (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={status === undefined}
                    onClick={() => void handleStartOrResume(item)}
                  >
                    Svolgi online
                  </button>
                )}
              </div>

              {pdfError && (
                <p role="alert" className={`text-error ${styles.pdfError}`}>
                  {pdfError}
                </p>
              )}
              {startError && (
                <p role="alert" className={`text-error ${styles.pdfError}`}>
                  {startError}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
