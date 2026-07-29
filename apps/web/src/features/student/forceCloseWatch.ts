import { doc, onSnapshot } from 'firebase/firestore';
import type { Firestore, Unsubscribe } from 'firebase/firestore';
import type { SubmissionDoc } from '../../types/firestore.js';
import { submissionId } from './submissionsService.js';

/**
 * FORCE-SUBMIT-02 — osservazione della **propria** chiusura programmata.
 *
 * Un solo listener, su un solo documento — la propria submission, sul percorso
 * deterministico già noto. Nessun listener globale, nessuna query, nessun
 * polling, e nessun listener fuori dallo svolgimento: il chiamante lo apre
 * all'ingresso in `OnlineExamView` e lo chiude all'uscita.
 *
 * Le Security Rules ammettono già `get` sulla propria submission finché è
 * `draft`; quando la chiusura viene eseguita il documento diventa `submitted` e
 * la stessa regola smette di autorizzarlo. Il listener riceve allora un errore
 * di permesso: è il segnale che la sessione è finita, non un guasto — il
 * chiamante risolve leggendo la ricevuta.
 */

export interface ForceCloseRequest {
  requestId: string;
  /** Scadenza server-side, in millisecondi epoch. */
  deadlineMs: number;
}

/**
 * Estrae la richiesta di chiusura da una submission, se e solo se è coerente:
 * bozza, entrambi i marcatori presenti e ben formati. Un documento incompleto
 * o già consegnato non produce mai un banner.
 */
export function toForceCloseRequest(
  data: Partial<SubmissionDoc> | undefined,
): ForceCloseRequest | null {
  if (!data || data.status !== 'draft') return null;
  const requestId = data.forceCloseRequestId;
  const deadline = data.forceCloseDeadline;
  if (typeof requestId !== 'string' || requestId.length === 0) return null;
  const deadlineMs = timestampToMillis(deadline);
  if (deadlineMs === null) return null;
  return { requestId, deadlineMs };
}

/** Converte un Timestamp Firestore-like in millisecondi, o `null` se non lo è. */
export function timestampToMillis(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as { seconds?: unknown; nanoseconds?: unknown };
  if (typeof v.seconds !== 'number' || !Number.isFinite(v.seconds)) return null;
  const nanos =
    typeof v.nanoseconds === 'number' && Number.isFinite(v.nanoseconds) ? v.nanoseconds : 0;
  return v.seconds * 1000 + Math.floor(nanos / 1e6);
}

export interface WatchForceCloseHandlers {
  /** Richiesta corrente (o `null` quando non ce n'è nessuna). */
  onRequest: (request: ForceCloseRequest | null) => void;
  /**
   * Il documento non è più leggibile o non esiste più: dal punto di vista dello
   * studente la sessione è verosimilmente chiusa.
   */
  onUnavailable: () => void;
}

export function watchOwnForceClose(
  verificationId: string,
  studentUid: string,
  db: Firestore,
  handlers: WatchForceCloseHandlers,
): Unsubscribe {
  const ref = doc(db, 'submissions', submissionId(verificationId, studentUid));
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        handlers.onUnavailable();
        return;
      }
      const data = snap.data() as Partial<SubmissionDoc>;
      if (data.status !== 'draft') {
        handlers.onUnavailable();
        return;
      }
      handlers.onRequest(toForceCloseRequest(data));
    },
    () => {
      // Permesso negato = la bozza non è più tale: la chiusura è avvenuta.
      handlers.onUnavailable();
    },
  );
}

// ── Countdown ──────────────────────────────────────────────────────────────────

/**
 * Secondi mancanti alla scadenza, mai negativi. Derivato **dalla deadline
 * server-side** e dall'orologio corrente a ogni tick: un contatore che si
 * limita a decrementare divergerebbe dopo una sospensione della scheda o un
 * tick perso, e prometterebbe allo studente più tempo di quello reale.
 */
export function remainingSeconds(deadlineMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

/** `mm:ss` con due cifre, per il banner. */
export function formatRemaining(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(clamped / 60);
  const ss = clamped % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** Soglia oltre la quale il countdown è mostrato in rosso. */
export const FORCE_CLOSE_URGENT_SECONDS = 10;

export function isUrgent(seconds: number): boolean {
  return seconds <= FORCE_CLOSE_URGENT_SECONDS;
}
