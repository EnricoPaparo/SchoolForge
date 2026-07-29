import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';
import type { SubmissionMonitorItem } from './submissionsMonitorService.js';
import type { CorrectionProgress } from '../corrections/correctionProgressService.js';

/**
 * FORCE-SUBMIT-02 — client tipizzato della callable
 * `scheduleForceCloseSubmissions` e derivazione **unica** dell'eleggibilità.
 *
 * Il docente invia soltanto la verifica e l'elenco degli studenti selezionati:
 * proprietario, id consegna, `requestId`, scadenza e stato sono derivati
 * server-side. La durata del preavviso non è negoziabile dal client.
 */

/** Preavviso concesso allo studente. Deve coincidere con la costante server. */
export const FORCE_CLOSE_GRACE_SECONDS = 60;

/** Tetto del batch, allineato al cap server-side. */
export const MAX_FORCE_CLOSE_BATCH = 60;

export interface ScheduleForceCloseRequest {
  verificationId: string;
  studentUids: string[];
}

export type ScheduleOutcome =
  | 'scheduled'
  | 'already_scheduled'
  | 'not_started'
  | 'already_submitted'
  | 'incoherent'
  | 'failed'
  /**
   * La programmazione è stata scritta ma la task non è stata accodata **e** la
   * pulizia non è riuscita: lo studente potrebbe vedere un banner che non porta
   * ad alcuna chiusura. Va mostrato come tale, mai confuso con un successo — ed
   * è **recuperabile**: basta ripetere «Chiudi consegne» sulla stessa riga.
   */
  | 'failed_cleanup';

export interface ScheduleForceCloseResponse {
  graceSeconds: number;
  results: { studentUid: string; outcome: ScheduleOutcome }[];
}

/** Crea il wrapper della callable su una `Functions` iniettata (testabile). */
export function createScheduleForceClose(
  functions: Functions,
): (req: ScheduleForceCloseRequest) => Promise<ScheduleForceCloseResponse> {
  const fn = httpsCallable<ScheduleForceCloseRequest, ScheduleForceCloseResponse>(
    functions,
    'scheduleForceCloseSubmissions',
  );
  return async (req) =>
    (
      await fn({
        verificationId: req.verificationId,
        studentUids: [...req.studentUids],
      })
    ).data;
}

/** Messaggio leggibile, senza dettagli sensibili, per un errore della callable. */
export function describeScheduleForceCloseError(err: unknown): string {
  const httpsCode = (err as { code?: string })?.code;
  if (httpsCode === 'functions/unauthenticated') return 'Sessione scaduta: accedi di nuovo.';
  if (httpsCode === 'functions/permission-denied')
    return 'Questa verifica non è di questo account.';
  if (httpsCode === 'functions/not-found') return 'Verifica non trovata. Aggiorna l’elenco.';
  if (httpsCode === 'functions/invalid-argument') return 'Selezione non valida. Riprova.';
  return 'Impossibile programmare la chiusura. Riprova.';
}

// ── Eleggibilità della selezione ───────────────────────────────────────────────

/**
 * Motivo per cui una riga selezionata **non** partecipa alla chiusura, oppure
 * `null` quando è eleggibile.
 *
 * Derivazione **unica**: toolbar desktop, menu mobile e dialog di conferma la
 * usano tutti, quindi il conteggio mostrato e ciò che viene realmente inviato
 * non possono divergere.
 */
export type ForceCloseExclusion = 'not_started' | 'already_submitted' | 'correction_started';

export interface ForceCloseCandidate {
  studentUid: string;
  studentName: string;
  item: Pick<SubmissionMonitorItem, 'status' | 'forceCloseDeadline'> | null | undefined;
  correction: Pick<CorrectionProgress, 'status'> | null | undefined;
}

export function forceCloseExclusionFor(candidate: ForceCloseCandidate): ForceCloseExclusion | null {
  // Nessuna consegna esiste: non si crea nulla per chi non ha iniziato.
  if (!candidate.item) return 'not_started';
  if (candidate.item.status !== 'draft') return 'already_submitted';
  // Una correzione esiste solo su una consegna già acquisita: con una bozza non
  // è un caso raggiungibile, ma la guardia resta esplicita e testabile.
  if (candidate.correction) return 'correction_started';
  /*
   * Una chiusura **già programmata** non è un'esclusione: ripetere l'operazione
   * è la procedura di **recupero** di una programmazione rimasta senza task
   * (`failed_cleanup`). Il server riaccoda la stessa richiesta con la stessa
   * scadenza, senza aprire una nuova finestra e senza riscrivere nulla.
   */
  return null;
}

/** La riga ha già una chiusura programmata: sarà un recupero, non una novità. */
export function isForceCloseRecovery(candidate: ForceCloseCandidate): boolean {
  return Boolean(candidate.item?.forceCloseDeadline);
}

export interface ForceClosePlan {
  /** Righe che verranno effettivamente programmate. */
  eligible: ForceCloseCandidate[];
  /** Righe escluse, con il motivo. */
  excluded: { candidate: ForceCloseCandidate; reason: ForceCloseExclusion }[];
}

/**
 * Partiziona la selezione. Una selezione mista è normale e non è un errore: le
 * righe non eleggibili sono semplicemente escluse, mai inviate.
 */
export function planForceClose(candidates: ForceCloseCandidate[]): ForceClosePlan {
  const eligible: ForceCloseCandidate[] = [];
  const excluded: ForceClosePlan['excluded'] = [];
  for (const candidate of candidates) {
    const reason = forceCloseExclusionFor(candidate);
    if (reason === null) eligible.push(candidate);
    else excluded.push({ candidate, reason });
  }
  return { eligible, excluded };
}

/** Spiegazione sintetica di un'esclusione, usata nel riepilogo di conferma. */
export function describeForceCloseExclusion(reason: ForceCloseExclusion): string {
  switch (reason) {
    case 'not_started':
      return 'Non iniziata';
    case 'already_submitted':
      return 'Già consegnata';
    case 'correction_started':
      return 'Correzione avviata';
  }
}

/** Etichetta leggibile di un esito restituito dalla callable. */
export function describeScheduleOutcome(outcome: ScheduleOutcome): string {
  switch (outcome) {
    case 'scheduled':
      return 'Programmate';
    case 'already_scheduled':
      return 'Già programmate (task ripristinata)';
    case 'not_started':
      return 'Non iniziate';
    case 'already_submitted':
      return 'Già consegnate';
    case 'incoherent':
      return 'Escluse';
    case 'failed':
      return 'Non riuscite';
    case 'failed_cleanup':
      return 'Non riuscite — ripeti l’operazione sulle stesse righe per ripristinarle';
  }
}

/** Raggruppa gli esiti per categoria, preservando l'ordine di presentazione. */
export const SCHEDULE_OUTCOME_ORDER: ScheduleOutcome[] = [
  'scheduled',
  'already_scheduled',
  'not_started',
  'already_submitted',
  'incoherent',
  'failed',
  'failed_cleanup',
];

export function groupScheduleOutcomes(
  response: ScheduleForceCloseResponse,
): { outcome: ScheduleOutcome; count: number }[] {
  const counts = new Map<ScheduleOutcome, number>();
  for (const row of response.results) {
    counts.set(row.outcome, (counts.get(row.outcome) ?? 0) + 1);
  }
  return SCHEDULE_OUTCOME_ORDER.filter((outcome) => (counts.get(outcome) ?? 0) > 0).map(
    (outcome) => ({ outcome, count: counts.get(outcome)! }),
  );
}
