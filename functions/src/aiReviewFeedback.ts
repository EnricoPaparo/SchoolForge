/** Accessory provider metadata. Never part of canonical stored content. */
export interface AiReviewFeedback {
  changes: string[];
}
export const REVIEW_CHANGES_SCHEMA = {
  type: 'array',
  maxItems: 3,
  items: { type: 'string', maxLength: 240 },
} as const;
export const REVIEW_CHANGES_INSTRUCTIONS =
  'reviewChanges: al massimo tre frasi brevi in italiano, testo piano, massimo 240 caratteri ciascuna, che descrivono soltanto interventi concretamente effettuati e il punto interessato. Non citare prompt o ragionamenti interni; niente valutazioni generiche di qualità. Se unchanged o sourceIssue, array vuoto. Il resoconto non è una prova di correttezza.';
export function splitReviewFeedback(raw: unknown): {
  output: unknown;
  feedback?: AiReviewFeedback;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { output: raw };
  const { reviewChanges, ...output } = raw as Record<string, unknown>;
  if (
    !Array.isArray(reviewChanges) ||
    reviewChanges.length > 3 ||
    reviewChanges.some(
      (item) =>
        typeof item !== 'string' ||
        !item.trim() ||
        item.length > 240 ||
        [...item].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ),
    )
  )
    return { output };
  return { output, feedback: { changes: reviewChanges.map((item: string) => item.trim()) } };
}
