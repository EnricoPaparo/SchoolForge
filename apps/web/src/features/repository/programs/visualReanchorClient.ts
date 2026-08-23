import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';

/**
 * VE-04A — client del riancoraggio.
 *
 * Manda **solo** ciò che il docente ha davvero scelto: quale lezione e quale
 * heading. Lo slug lo calcola il server dal corpo autorevole, e questa è la
 * ragione per cui non compare qui: mandarlo permetterebbe di ancorare a un
 * identificatore che nel corpo non esiste, aggirando l'unico controllo che
 * conta.
 */
export interface VisualReanchorRequest {
  programId: string;
  importId: string;
  lessonId: string;
  anchorHeadingText: string;
}

export interface VisualReanchorResult {
  status: 'reanchored' | 'replayed';
  headingSlug: string;
}

export function createVisualReanchorClient(functions: Functions) {
  const reanchor = httpsCallable<VisualReanchorRequest, VisualReanchorResult>(
    functions,
    'aiVisualReanchor',
  );

  return async function reanchorLessonVisual(
    request: VisualReanchorRequest,
  ): Promise<VisualReanchorResult> {
    const { data } = await reanchor(request);
    if (
      typeof data !== 'object' ||
      data === null ||
      (data.status !== 'reanchored' && data.status !== 'replayed') ||
      typeof data.headingSlug !== 'string' ||
      data.headingSlug.length === 0
    ) {
      throw new Error('Risposta del riancoraggio non valida.');
    }
    return { status: data.status, headingSlug: data.headingSlug };
  };
}
