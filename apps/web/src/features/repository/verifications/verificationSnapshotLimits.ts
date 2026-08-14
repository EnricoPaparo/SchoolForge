import type { VerificationTeacherQuestionSnapshot } from '../../../types/firestore.js';

/**
 * Conservative, centralized ceiling on the serialized size of
 * `teacherSnapshot.questions` (PERF-SEC follow-up to the immutable teacher
 * snapshot fix). Firestore's hard limit is 1 MiB (1_048_576 bytes) per
 * *document*, and `teacherSnapshot` is only one field among several on the
 * `verifications/{id}` document (`config` — including the full
 * `questionRefs` array — plus `teacherSnapshot`'s own non-`questions`
 * fields). `JSON.stringify` byte length also understates Firestore's actual
 * wire encoding (repeated field-name/type overhead per map entry), so this
 * threshold is set well below the hard limit rather than close to it:
 * roughly two-thirds of 1 MiB, leaving a wide margin for everything else on
 * the same document and for encoding overhead this estimate doesn't
 * capture.
 */
export const TEACHER_SNAPSHOT_QUESTIONS_MAX_BYTES = 700_000;

/**
 * VDIF-04 — soglia sul documento **intero** che viene scritto, non sul solo
 * array delle domande.
 *
 * Il controllo storico misurava `questions[]` perché era l'unica parte che
 * cresceva. Con la differenziazione crescono anche `differentiation`
 * (una scelta per etichetta per domanda) e `labelAssignments` (una coppia di
 * stringhe per studente): due strutture piccole, ma che vivono sullo **stesso**
 * documento e concorrono allo stesso limite Firestore. Misurare solo le domande
 * significherebbe passare il controllo e poi fallire la scrittura — cioè
 * scoprire il problema dopo aver deciso di attivare.
 *
 * La soglia resta conservativa: 850 kB sul serializzato di ciò che si scrive,
 * contro il limite reale di 1 MiB, così resta margine per l'overhead di
 * codifica che `JSON.stringify` non cattura.
 */
export const VERIFICATION_DOCUMENT_MAX_BYTES = 850_000;

/** Pure byte-size estimate of the serialized snapshot questions array. */
export function estimateTeacherSnapshotQuestionsBytes(
  questions: VerificationTeacherQuestionSnapshot[],
): number {
  return new TextEncoder().encode(JSON.stringify(questions)).length;
}

/** Stima pura dei byte serializzati di una struttura qualunque. */
export function estimateSerializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Throws a readable error when `questions` would serialize beyond
 * `TEACHER_SNAPSHOT_QUESTIONS_MAX_BYTES`. Called before opening the
 * activation transaction — a size failure must never leave a verification
 * partially activated.
 */
export function assertTeacherSnapshotQuestionsWithinLimit(
  questions: VerificationTeacherQuestionSnapshot[],
): void {
  const bytes = estimateTeacherSnapshotQuestionsBytes(questions);
  if (bytes > TEACHER_SNAPSHOT_QUESTIONS_MAX_BYTES) {
    throw new Error(
      `Impossibile attivare: lo snapshot delle domande è troppo grande (${bytes} byte, ` +
        `limite ${TEACHER_SNAPSHOT_QUESTIONS_MAX_BYTES} byte). Riduci il numero o la ` +
        'lunghezza delle domande selezionate.',
    );
  }
}

/**
 * G16b — snapshot docente e proiezione pubblica **interi** entro il limite
 * conservativo. Chiamata prima di aprire la transazione, come il controllo
 * sulle sole domande: un fallimento di dimensione non deve mai lasciare una
 * verifica attivata a metà.
 */
export function assertActivationPayloadWithinLimit(payload: {
  teacherSnapshot: unknown;
  publishedProjection: unknown;
}): void {
  for (const [label, value] of [
    ['lo snapshot della verifica', payload.teacherSnapshot],
    ['la proiezione pubblica', payload.publishedProjection],
  ] as const) {
    const bytes = estimateSerializedBytes(value);
    if (bytes > VERIFICATION_DOCUMENT_MAX_BYTES) {
      throw new Error(
        `Impossibile attivare: ${label} è troppo grande per essere congelata ` +
          `(${bytes} byte, limite ${VERIFICATION_DOCUMENT_MAX_BYTES} byte). Riduci il numero ` +
          'o la lunghezza delle domande selezionate.',
      );
    }
  }
}
