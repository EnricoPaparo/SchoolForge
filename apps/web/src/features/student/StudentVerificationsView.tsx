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
import {
  clearActiveSessionHint,
  findActiveDraftSession,
  writeActiveSessionHint,
} from './examSessionService.js';
import { OnlineExamView } from './OnlineExamView.js';
import { ConfirmationView } from './ConfirmationView.js';
import { StudentCorrectionView } from './StudentCorrectionView.js';
import {
  loadStudentCorrectionReturns,
  type StudentCorrectionReturnItem,
} from './studentCorrectionReturnsService.js';
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
  | { kind: 'none' }
  | { kind: 'error' };

type ViewState =
  | { mode: 'list' }
  | { mode: 'exam'; item: StudentVerificationItem; submission: SubmissionDoc }
  | { mode: 'confirmation'; receipt: SubmissionReceiptDoc }
  | { mode: 'correction'; submissionId: string; data: StudentCorrectionReturnItem };

/** it-IT date from a Firestore Timestamp-like value, or null if absent. */
function formatActivatedAt(ts: unknown): string | null {
  if (!ts || typeof ts !== 'object' || !('seconds' in ts)) return null;
  const date = new Date((ts as { seconds: number }).seconds * 1000);
  return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Remembers only the verificationId of the exam just submitted — never
 * answers or any personal data — so a page refresh lands back on
 * ConfirmationView instead of the list (M3F-04 §8). Cleared once the
 * student explicitly chooses "Torna alle verifiche". sessionStorage can be
 * unavailable (private browsing, disabled storage); every call is a no-op
 * on failure rather than breaking the flow.
 */
const LAST_SUBMITTED_KEY = 'schoolforge:lastSubmittedVerificationId';

function readLastSubmittedId(): string | null {
  try {
    return sessionStorage.getItem(LAST_SUBMITTED_KEY);
  } catch {
    return null;
  }
}

function writeLastSubmittedId(verificationId: string): void {
  try {
    sessionStorage.setItem(LAST_SUBMITTED_KEY, verificationId);
  } catch {
    // Non-fatal — the in-memory view state still shows the confirmation now.
  }
}

function clearLastSubmittedId(): void {
  try {
    sessionStorage.removeItem(LAST_SUBMITTED_KEY);
  } catch {
    // Non-fatal.
  }
}

/**
 * Verifiche section for the student portal. Read-only for paper
 * verifications (M3L-D: "Scarica PDF" from publishedProjection, never the
 * parent verification document) — shown only when `studentPdfEnabled ==
 * true` (M3F-09), entirely independent of `onlineEnabled`: a verification
 * can offer PDF only, online only, both, or neither. For `onlineEnabled`
 * verifications (M3F-04)
 * it additionally offers "Svolgi online"/"Riprendi bozza", checking the
 * receipt first and only then (if absent) the submission — a submitted exam
 * never causes the answer form to be shown again, on this load or after a
 * refresh.
 */
type StudentVerificationsViewProps = {
  /**
   * Reports whether an online exam is currently being taken (`view.mode ===
   * 'exam'`), so `StudentShell` can hide the Lezioni/Verifiche nav for the
   * duration of the session (D-M3F-15). Optional so this component keeps
   * working standalone/in tests that don't care about the shell nav.
   */
  onSessionActiveChange?: (active: boolean) => void;
  /**
   * Modalità verifica (M3F-07) currently applies to the student's own
   * class. Shown as a discreet notice on the list view only — never on top
   * of an in-progress/confirmed exam, which stays fully available
   * regardless (an online exam already underway is never interrupted).
   */
  examModeActive?: boolean;
};

export function StudentVerificationsView({
  onSessionActiveChange,
  examModeActive = false,
}: StudentVerificationsViewProps) {
  const { user } = useAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);
  const [pdfErrors, setPdfErrors] = useState<Record<string, string>>({});
  const [onlineStatus, setOnlineStatus] = useState<Record<string, OnlineStatus>>({});
  const [startErrors, setStartErrors] = useState<Record<string, string>>({});
  const [view, setView] = useState<ViewState>({ mode: 'list' });
  /** Keyed by submissionId (`${verificationId}_${uid}`) — loaded once alongside the list, never via a listener. */
  const [correctionReturns, setCorrectionReturns] = useState<
    Record<string, StudentCorrectionReturnItem>
  >({});

  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return;
    void load(uid);
  }, [uid]);

  // A draft submission is a mandatory session (D-M3F-14): the parent shell
  // must know about it for as long as it's shown, not just at the moment it
  // starts, so a resume-on-refresh (below) hides the nav exactly like a
  // manually started one.
  useEffect(() => {
    onSessionActiveChange?.(view.mode === 'exam');
  }, [view.mode, onSessionActiveChange]);

  async function load(uid: string) {
    setState({ status: 'loading' });

    const pendingId = readLastSubmittedId();
    if (pendingId) {
      try {
        const receipt = await loadReceipt(pendingId, uid, db);
        if (receipt) {
          setView({ mode: 'confirmation', receipt });
        } else {
          // Stale/foreign value (e.g. a previous student on a shared
          // browser profile) — drop it and fall through to the list.
          clearLastSubmittedId();
        }
      } catch {
        // Non-fatal — fall through to the normal list load below.
      }
    }

    try {
      const result = await loadStudentVerifications(uid, db);
      if (result.status === 'no-class') {
        setState({ status: 'no-class' });
        return;
      }
      setState({ status: 'ok', verifications: result.verifications });

      // Mandatory session resume (D-M3F-14): a draft submission takes over
      // immediately, before the list is ever shown — no click required.
      const onlineItems = result.verifications.filter((item) => item.onlineEnabled);
      const activeDraft = await findActiveDraftSession(uid, onlineItems, db);
      if (activeDraft) {
        setView({ mode: 'exam', item: activeDraft.item, submission: activeDraft.submission });
        return;
      }

      void refreshOnlineStatuses(uid, result.verifications);
      void loadCorrectionReturns(uid);
    } catch {
      setState({ status: 'error' });
    }
  }

  /**
   * Loaded once alongside the list, in parallel with the online-status
   * checks above — a single query (`loadStudentCorrectionReturns`), never
   * one read per verification. A failure here is non-fatal: the list still
   * renders, simply without any "Vedi correzione" badge, rather than
   * failing the whole page load over a secondary read.
   */
  async function loadCorrectionReturns(uid: string) {
    try {
      const items = await loadStudentCorrectionReturns(uid, db);
      const byId: Record<string, StudentCorrectionReturnItem> = {};
      for (const item of items) byId[item.submissionId] = item;
      setCorrectionReturns(byId);
    } catch {
      // Non-fatal — see doc comment above.
    }
  }

  /**
   * Receipt first, submission only if absent — never both reads when
   * unneeded. A failed check resolves to 'error', never 'none': the two
   * must stay distinguishable so a genuine load failure is never rendered
   * as an inviting "Svolgi online" button.
   */
  async function checkOnlineStatus(
    uid: string,
    item: StudentVerificationItem,
  ): Promise<OnlineStatus> {
    try {
      const receipt = await loadReceipt(item.id, uid, db);
      if (receipt) return { kind: 'receipt', receipt };
      const submission = await loadSubmission(item.id, uid, db);
      if (submission && submission.status === 'draft') return { kind: 'draft' };
      return { kind: 'none' };
    } catch {
      return { kind: 'error' };
    }
  }

  /**
   * Checks every onlineEnabled verification in parallel (Promise.all across
   * items — independent reads, no reason to serialize them) while each
   * item's own receipt->submission check stays sequential internally. State
   * is applied in two batched updates (all "checking" placeholders, then all
   * resolved statuses) rather than one setState per item, to avoid a long
   * render cascade as results trickle in one at a time.
   */
  async function refreshOnlineStatuses(uid: string, verifications: StudentVerificationItem[]) {
    const onlineItems = verifications.filter((item) => item.onlineEnabled);
    if (onlineItems.length === 0) return;

    setOnlineStatus((prev) => {
      const next = { ...prev };
      for (const item of onlineItems) next[item.id] = { kind: 'checking' };
      return next;
    });

    const results = await Promise.all(
      onlineItems.map(
        async (item): Promise<readonly [string, OnlineStatus]> => [
          item.id,
          await checkOnlineStatus(uid, item),
        ],
      ),
    );

    setOnlineStatus((prev) => {
      const next = { ...prev };
      for (const [id, status] of results) next[id] = status;
      return next;
    });
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
          setView({ mode: 'confirmation', receipt });
          return;
        }
      }
      writeActiveSessionHint(item.id);
      setView({ mode: 'exam', item, submission });
    } catch {
      setStartErrors((prev) => ({
        ...prev,
        [item.id]: 'Impossibile avviare la verifica online: verifica chiusa o disabilitata.',
      }));
    }
  }

  function handleShowReceipt(receipt: SubmissionReceiptDoc) {
    setView({ mode: 'confirmation', receipt });
  }

  function handleSubmitted(item: StudentVerificationItem, receipt: SubmissionReceiptDoc) {
    setOnlineStatus((prev) => ({ ...prev, [item.id]: { kind: 'receipt', receipt } }));
    clearActiveSessionHint();
    writeLastSubmittedId(item.id);
    setView({ mode: 'confirmation', receipt });
  }

  function handleBackToListFromConfirmation() {
    clearLastSubmittedId();
    setView({ mode: 'list' });
  }

  function handleShowCorrection(submissionId: string, data: StudentCorrectionReturnItem) {
    setView({ mode: 'correction', submissionId, data });
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
        onSubmitted={(receipt) => handleSubmitted(view.item, receipt)}
      />
    );
  }

  if (view.mode === 'confirmation') {
    return (
      <ConfirmationView receipt={view.receipt} onBackToList={handleBackToListFromConfirmation} />
    );
  }

  if (view.mode === 'correction') {
    return (
      <StudentCorrectionView
        submissionId={view.submissionId}
        initialData={view.data}
        db={db}
        onBack={() => setView({ mode: 'list' })}
      />
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

  const examModeBanner = examModeActive && (
    <p role="status" className={styles.examModeBanner}>
      Modalità verifica attiva: le lezioni sono temporaneamente non disponibili.
    </p>
  );

  if (state.status === 'no-class') {
    return (
      <section aria-label="Verifiche" className={styles.container}>
        {examModeBanner}
        <p className="state-empty">
          Nessuna classe assegnata. Chiedi al tuo docente di assegnarti una classe per vedere le
          verifiche.
        </p>
      </section>
    );
  }

  const verifications = state.verifications;

  /**
   * "Correzioni restituite" is built directly from `correctionReturns` —
   * never by filtering `verifications` — because the return projection is
   * deliberately self-sufficient (own title/className/totals, see
   * `types/firestore.ts`) and must stay reachable even once the underlying
   * verification is closed, hidden, or otherwise dropped from
   * `loadStudentVerifications`'s public list. `returnedSubmissionIds` is
   * then used the other way around: to exclude those same submissions from
   * "Consegne effettuate"/"Verifiche disponibili" so a verification never
   * appears twice.
   */
  const returnedItems = Object.values(correctionReturns);
  const returnedSubmissionIds = new Set(returnedItems.map((item) => item.submissionId));

  const availableItems: StudentVerificationItem[] = [];
  const submittedItems: StudentVerificationItem[] = [];
  for (const item of verifications) {
    const submissionId = `${item.id}_${uid ?? ''}`;
    if (returnedSubmissionIds.has(submissionId)) continue;
    const status = onlineStatus[item.id];
    if (item.onlineEnabled && status?.kind === 'receipt') {
      submittedItems.push(item);
    } else {
      availableItems.push(item);
    }
  }

  if (verifications.length === 0 && returnedItems.length === 0) {
    return (
      <section aria-label="Verifiche" className={styles.container}>
        {examModeBanner}
        <p className="state-empty">Nessuna verifica pubblicata per la tua classe.</p>
      </section>
    );
  }

  function renderCorrectionCard(item: StudentCorrectionReturnItem) {
    const returnedLabel = formatActivatedAt(item.returnedAt);
    return (
      <li key={item.submissionId} className={styles.card}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>{item.verificationTitle}</h3>
          {item.className && <span className={styles.classBadge}>{item.className}</span>}
        </div>

        <dl className={styles.cardMeta}>
          {returnedLabel && (
            <div className={styles.metaItem}>
              <dt>Restituita</dt>
              <dd>{returnedLabel}</dd>
            </div>
          )}
          <div className={styles.metaItem}>
            <dt>Punteggio</dt>
            <dd>
              {item.totalPoints}/{item.maxPoints}
              {item.percentage !== null ? ` (${item.percentage}%)` : ''}
            </dd>
          </div>
        </dl>

        <div className={styles.cardActions}>
          <button
            type="button"
            className={styles.correctionBtn}
            aria-label={`Vedi correzione — ${item.verificationTitle}`}
            onClick={() => handleShowCorrection(item.submissionId, item)}
          >
            Vedi correzione
          </button>
        </div>
      </li>
    );
  }

  function renderCard(item: StudentVerificationItem) {
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
          {item.studentPdfEnabled && (
            <button
              type="button"
              className={styles.pdfBtn}
              disabled={pdfLoadingId === item.id}
              aria-label={`Scarica PDF — ${item.title}`}
              onClick={() => void handleDownloadPdf(item)}
            >
              {pdfLoadingId === item.id ? 'Generazione…' : 'Scarica PDF'}
            </button>
          )}

          {item.onlineEnabled && status?.kind === 'receipt' && (
            <button
              type="button"
              className={styles.receiptBtn}
              onClick={() => handleShowReceipt(status.receipt)}
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

          {item.onlineEnabled &&
            (status === undefined || status.kind === 'none' || status.kind === 'checking') && (
              <button
                type="button"
                className="btn-primary"
                disabled={status === undefined || status.kind === 'checking'}
                onClick={() => void handleStartOrResume(item)}
              >
                Svolgi online
              </button>
            )}
        </div>

        {item.onlineEnabled && status?.kind === 'error' && (
          <p role="alert" className={`text-error ${styles.pdfError}`}>
            Impossibile verificare lo stato della verifica online. Riprova più tardi.
          </p>
        )}
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
  }

  return (
    <section aria-label="Verifiche" className={styles.container}>
      {examModeBanner}

      {returnedItems.length > 0 && (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>Correzioni restituite</h3>
          <ul className={styles.list}>{returnedItems.map(renderCorrectionCard)}</ul>
        </div>
      )}

      {submittedItems.length > 0 && (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>Consegne effettuate</h3>
          <ul className={styles.list}>{submittedItems.map(renderCard)}</ul>
        </div>
      )}

      {availableItems.length > 0 && (
        <div className={styles.group}>
          {(returnedItems.length > 0 || submittedItems.length > 0) && (
            <h3 className={styles.groupTitle}>Verifiche disponibili</h3>
          )}
          <ul className={styles.list}>{availableItems.map(renderCard)}</ul>
        </div>
      )}
    </section>
  );
}
