import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';

export const RETURN_TO_DRAFT_SUBMISSION_ERROR =
  'Elimina prima tutte le consegne associate alla verifica.';

export function createReturnVerificationToDraft(functions: Functions) {
  const callable = httpsCallable<{ verificationId: string }, { status: 'draft' }>(
    functions,
    'returnVerificationToDraft',
  );
  return async (verificationId: string): Promise<void> => {
    await callable({ verificationId });
  };
}

export function describeReturnToDraftError(error: unknown): string {
  const details = (error as { details?: { code?: string } })?.details;
  const message = (error as { message?: string })?.message ?? '';
  if (message.includes(RETURN_TO_DRAFT_SUBMISSION_ERROR)) return RETURN_TO_DRAFT_SUBMISSION_ERROR;
  if ((error as { code?: string })?.code === 'functions/unauthenticated') {
    return 'Sessione scaduta: accedi di nuovo.';
  }
  if ((error as { code?: string })?.code === 'functions/permission-denied') {
    return 'Questa verifica non è di questo account.';
  }
  if (details?.code === 'submissions_exist') return RETURN_TO_DRAFT_SUBMISSION_ERROR;
  return 'Impossibile riportare la verifica in bozza. Riprova.';
}
