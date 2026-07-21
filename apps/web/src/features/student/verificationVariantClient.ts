import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';

/**
 * VEX-01B — client tipizzato della callable `assignVerificationVariant`.
 *
 * Al primo avvio di una verifica in modalità `equivalent_variants` lo studente
 * chiama questa callable, che assegna in modo **idempotente** una variante e
 * restituisce **solo** le domande assegnate, senza soluzioni né alternative non
 * assegnate. Il client invia esclusivamente l'ID della verifica; nessun testo,
 * soluzione o dato sensibile. La risposta rispecchia il contratto del gateway
 * (`functions/src/verificationVariantGatewayCore.ts`).
 *
 * VEX-01B **non** collega ancora questo client a `OnlineExamView`: lo
 * svolgimento studente end-to-end è VEX-02. Qui c'è solo il contratto tipizzato,
 * pronto per essere consumato.
 */

export interface AssignVariantRequest {
  verificationId: string;
}

export interface AssignedQuestion {
  order: number;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  maxPoints: number;
  testo: string;
  /** Solo per chiusa_singola / chiusa_multipla; id + testo, mai marcatori di soluzione. */
  opzioni?: { id: string; testo: string }[];
  /** Solo `aperta`, se impostato; ogni domanda conserva il proprio limite. */
  maxCharacters?: number;
}

export interface AssignVariantResponse {
  distributionMode: 'equivalent_variants';
  /** order (0-based) assegnati: comuni + una alternativa per gruppo, ascendenti. */
  assignedQuestionOrders: number[];
  /** Domande assegnate sanitizzate, ordinate per `order`. Nessuna soluzione. */
  questions: AssignedQuestion[];
}

/** Crea il wrapper della callable su una `Functions` iniettata (testabile). */
export function createAssignVerificationVariant(
  functions: Functions,
): (req: AssignVariantRequest) => Promise<AssignVariantResponse> {
  const fn = httpsCallable<AssignVariantRequest, AssignVariantResponse>(
    functions,
    'assignVerificationVariant',
  );
  return async (req) => (await fn({ verificationId: req.verificationId })).data;
}

/**
 * Messaggio leggibile per un errore della callable, senza esporre dettagli
 * sensibili. Riconosce i codici stabili del gateway VEX.
 */
export function describeAssignVariantError(err: unknown): string {
  const code = (err as { details?: { code?: string } })?.details?.code;
  const httpsCode = (err as { code?: string })?.code;
  if (code === 'unauthenticated' || httpsCode === 'functions/unauthenticated') {
    return 'Sessione scaduta: accedi di nuovo.';
  }
  if (code === 'permission_denied' || httpsCode === 'functions/permission-denied') {
    return 'Questa verifica non è disponibile per il tuo account.';
  }
  if (code === 'not_found' || httpsCode === 'functions/not-found') {
    return 'Verifica non trovata.';
  }
  if (code === 'invalid_input' || httpsCode === 'functions/invalid-argument') {
    return 'Richiesta non valida. Riprova.';
  }
  if (httpsCode === 'functions/failed-precondition') {
    return 'La verifica non è al momento avviabile.';
  }
  return 'Impossibile avviare la verifica. Riprova.';
}
