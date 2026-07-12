import type { CorrectionReturnDoc } from '../../../types/firestore.js';

/**
 * Conservative, centralized ceiling on the serialized size of a
 * `correctionReturns/{submissionId}` document — same reasoning and margin
 * as `TEACHER_SNAPSHOT_QUESTIONS_MAX_BYTES`
 * (`verificationSnapshotLimits.ts`): Firestore's hard limit is 1 MiB
 * (1_048_576 bytes) per *document*, and `JSON.stringify` byte length
 * understates Firestore's actual wire encoding (repeated field-name/type
 * overhead per map entry), so this threshold is set well below the hard
 * limit rather than close to it.
 */
export const CORRECTION_RETURN_MAX_BYTES = 700_000;

/** Pure byte-size estimate of the serialized self-sufficient projection. */
export function estimateCorrectionReturnBytes(
  doc: Pick<CorrectionReturnDoc, 'questions' | 'generalFeedback'>,
): number {
  return new TextEncoder().encode(JSON.stringify(doc)).length;
}

/**
 * Throws a readable error when the projection would serialize beyond
 * `CORRECTION_RETURN_MAX_BYTES`. Called before writing `correctionReturns`
 * (on return, and again whenever solutions are revealed, since that grows
 * the document further) — a size failure must never leave a partial or
 * silently truncated projection. Text, answers and feedback are never
 * truncated to fit: the docente must shorten them instead.
 */
export function assertCorrectionReturnWithinLimit(
  doc: Pick<CorrectionReturnDoc, 'questions' | 'generalFeedback'>,
): void {
  const bytes = estimateCorrectionReturnBytes(doc);
  if (bytes > CORRECTION_RETURN_MAX_BYTES) {
    throw new Error(
      `Impossibile restituire: la proiezione per lo studente è troppo grande ` +
        `(${bytes} byte, limite ${CORRECTION_RETURN_MAX_BYTES} byte). Riduci la ` +
        'lunghezza di feedback o testi coinvolti — nessun troncamento automatico.',
    );
  }
}
