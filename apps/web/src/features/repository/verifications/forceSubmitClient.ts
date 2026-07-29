import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';
import type { SubmissionMonitorItem } from './submissionsMonitorService.js';
import type { CorrectionProgress } from '../corrections/correctionProgressService.js';

/**
 * FORCE-SUBMIT-01 — client tipizzato della callable `forceSubmitSubmission`.
 *
 * Il docente invia **soltanto** la coppia (verifica, studente): `ownerUid`,
 * `submissionId`, codice consegna, timestamp, stato e `forcedByTeacher` sono
 * derivati server-side dai documenti canonici e dall'identità autenticata.
 */

export interface ForceSubmitRequest {
  verificationId: string;
  studentUid: string;
}

export interface ForceSubmitResponse {
  /**
   * `submitted`: la bozza è stata acquisita e chiusa ora (o lo era già stata da
   * questa stessa operazione — il replay è idempotente).
   * `already_submitted`: lo studente aveva già consegnato normalmente; nulla è
   * stato modificato.
   */
  status: 'submitted' | 'already_submitted';
}

/** Crea il wrapper della callable su una `Functions` iniettata (testabile). */
export function createForceSubmitSubmission(
  functions: Functions,
): (req: ForceSubmitRequest) => Promise<ForceSubmitResponse> {
  const fn = httpsCallable<ForceSubmitRequest, ForceSubmitResponse>(
    functions,
    'forceSubmitSubmission',
  );
  return async (req) =>
    (await fn({ verificationId: req.verificationId, studentUid: req.studentUid })).data;
}

/** Messaggio leggibile, senza dettagli sensibili, per un errore della callable. */
export function describeForceSubmitError(err: unknown): string {
  const code = (err as { details?: { code?: string } })?.details?.code;
  const httpsCode = (err as { code?: string })?.code;
  if (code === 'unauthenticated' || httpsCode === 'functions/unauthenticated') {
    return 'Sessione scaduta: accedi di nuovo.';
  }
  if (code === 'permission_denied' || httpsCode === 'functions/permission-denied') {
    return 'Questa verifica non è di questo account.';
  }
  if (code === 'not_found' || httpsCode === 'functions/not-found') {
    return 'Nessuna consegna da chiudere per questo studente.';
  }
  if (code === 'invalid_input' || httpsCode === 'functions/invalid-argument') {
    return 'Richiesta non valida. Riprova.';
  }
  if (httpsCode === 'functions/failed-precondition') {
    return 'La consegna non è più in bozza. Aggiorna l’elenco.';
  }
  return 'Impossibile chiudere la consegna. Riprova.';
}

/**
 * Motivo per cui «Chiudi e consegna» non è disponibile per una riga, oppure
 * `null` quando l'azione è eseguibile.
 *
 * **Unica** derivazione dello stato enabled/disabled: la tabella desktop e il
 * menu della card mobile la usano entrambe, così non possono divergere.
 */
export type ForceSubmitBlockedReason =
  | 'not_started'
  | 'already_submitted'
  | 'correction_started'
  | 'busy';

export interface ForceSubmitAvailabilityInput {
  /** Riga del monitor consegne; `null`/assente quando lo studente non ha iniziato. */
  item: Pick<SubmissionMonitorItem, 'status'> | null | undefined;
  /** Progresso correzione già in memoria per questo studente. */
  correction: Pick<CorrectionProgress, 'status'> | null | undefined;
  /** Una chiusura è già in corso su questa riga (guardia anti-doppio-click). */
  busy: boolean;
}

export function forceSubmitBlockedReason(
  input: ForceSubmitAvailabilityInput,
): ForceSubmitBlockedReason | null {
  if (input.busy) return 'busy';
  // Nessuna consegna esiste: non si crea nulla per chi non ha iniziato.
  if (!input.item) return 'not_started';
  if (input.item.status !== 'draft') return 'already_submitted';
  // Una correzione esiste solo su una consegna già acquisita: con una bozza non
  // è un caso raggiungibile, ma la guardia resta esplicita e testabile.
  if (input.correction) return 'correction_started';
  return null;
}

/** Spiegazione accessibile del motivo per cui l'azione è disabilitata. */
export function describeForceSubmitBlocked(reason: ForceSubmitBlockedReason): string {
  switch (reason) {
    case 'not_started':
      return 'Lo studente non ha ancora iniziato la verifica.';
    case 'already_submitted':
      return 'La verifica è già stata consegnata.';
    case 'correction_started':
      return 'La correzione è già stata avviata.';
    case 'busy':
      return 'Chiusura in corso…';
  }
}
