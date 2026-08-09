/**
 * CONCEPT-MAP-02 (review fix) — coerenza **identitaria** fra un `LessonDoc` e la
 * sua proiezione `publicLessons`.
 *
 * Il problema che questo modulo risolve: verificare `ownerUid`, `importId` e
 * `programId` non dimostra che la proiezione letta sia quella di **quella**
 * lezione. Due lezioni dello stesso corso, dello stesso import e dello stesso
 * docente superano tutti e tre i controlli, quindi passando l'id pubblico della
 * lezione B mentre si modifica la lezione A la copia privata finirebbe su A e
 * quella pubblica su B — senza che nulla lo segnali.
 *
 * La correzione è cambiare la fonte dell'id: **non è autorevole quello ricevuto
 * dal chiamante**, ma quello derivato dal `LessonDoc` con `resolvePublicLessonId`.
 * L'id ricevuto viene solo **confrontato**, e un disallineamento ferma tutto
 * prima della seconda lettura.
 *
 * Modulo **puro**: nessun Firebase, nessuna lettura, nessun errore lanciato. I
 * servizi traducono l'esito nei propri messaggi leggibili — così salvataggio e
 * cambio svolta non possono divergere su che cosa considerano coerente.
 */

import type { LessonDoc, PublicLessonDoc } from '../../../types/firestore.js';
import { resolvePublicLessonId } from './publicLessonId.js';

/** Motivi di rifiuto, esaustivi e traducibili in messaggi dai chiamanti. */
export type LessonProjectionIdentityFailure =
  | 'lesson_missing'
  | 'owner_mismatch'
  | 'import_mismatch'
  | 'public_lesson_id_mismatch'
  | 'projection_missing'
  | 'projection_owner_mismatch'
  | 'projection_import_mismatch'
  | 'projection_program_mismatch'
  | 'projection_identity_mismatch';

export type LessonGateResult =
  | { ok: true; publicLessonId: string }
  | { ok: false; failure: LessonProjectionIdentityFailure };

export type ProjectionGateResult =
  | { ok: true }
  | { ok: false; failure: LessonProjectionIdentityFailure };

/**
 * Campi identitari confrontati fra documento tecnico e proiezione. Sono scelti
 * perché **stabili** e già presenti su entrambi: cambiano solo con un riordino o
 * una rinomina, che riscrivono comunque entrambi i documenti insieme. Non è un
 * controllo di uguaglianza integrale — titolo e metadati didattici possono
 * legittimamente divergere fra una scrittura e l'altra — ma di **identità**.
 */
const IDENTITY_FIELDS = ['udaDir', 'path', 'filename'] as const;

/**
 * Primo cancello, **prima** della lettura della proiezione: verifica che il
 * `LessonDoc` esista e appartenga a questo docente e a questo import, poi
 * deriva l'id pubblico atteso e lo confronta con quello ricevuto.
 *
 * L'id derivato è l'unico usato per costruire il riferimento: quello del
 * chiamante non viene mai propagato, solo confrontato. Se non coincide, la
 * seconda lettura non viene nemmeno effettuata — il rifiuto costa una lettura,
 * non due, e non produce alcuna scrittura.
 *
 * Legacy: `resolvePublicLessonId` restituisce il `publicLessonId` memorizzato
 * quando c'è, altrimenti il `lessonId` nudo. Nessun tentativo a catena su due
 * id, nessuna query per «trovare» la proiezione.
 */
export function checkLessonBeforeProjection(params: {
  lesson: LessonDoc | null;
  lessonId: string;
  /** Id proposto dal chiamante: confrontato, mai considerato autorevole. */
  requestedPublicLessonId?: string | null;
  ownerUid: string;
  importId: string;
}): LessonGateResult {
  const { lesson, lessonId, requestedPublicLessonId, ownerUid, importId } = params;
  if (!lesson) return { ok: false, failure: 'lesson_missing' };
  if (lesson.ownerUid !== ownerUid) return { ok: false, failure: 'owner_mismatch' };
  if (lesson.importId !== importId) return { ok: false, failure: 'import_mismatch' };

  const publicLessonId = resolvePublicLessonId(lesson, lessonId);
  if (
    requestedPublicLessonId !== undefined &&
    requestedPublicLessonId !== null &&
    requestedPublicLessonId !== publicLessonId
  ) {
    return { ok: false, failure: 'public_lesson_id_mismatch' };
  }
  return { ok: true, publicLessonId };
}

/**
 * Secondo cancello, dopo la lettura della proiezione **derivata**: appartenenza
 * (owner, import, corso) e identità (`udaDir`, `path`, `filename`).
 *
 * L'id corretto da solo non basterebbe se il documento all'indirizzo atteso
 * fosse un'altra cosa: qui si verifica che il contenuto corrisponda alla lezione
 * di partenza, non solo che l'indirizzo torni.
 */
export function checkProjectionMatchesLesson(params: {
  lesson: LessonDoc;
  publicLesson: PublicLessonDoc | null;
  programId: string;
  importId: string;
  ownerUid: string;
}): ProjectionGateResult {
  const { lesson, publicLesson, programId, importId, ownerUid } = params;
  if (!publicLesson) return { ok: false, failure: 'projection_missing' };
  if (publicLesson.ownerUid !== ownerUid) {
    return { ok: false, failure: 'projection_owner_mismatch' };
  }
  if (publicLesson.importId !== importId) {
    return { ok: false, failure: 'projection_import_mismatch' };
  }
  if (publicLesson.programId !== programId) {
    return { ok: false, failure: 'projection_program_mismatch' };
  }
  for (const field of IDENTITY_FIELDS) {
    if (publicLesson[field] !== lesson[field]) {
      return { ok: false, failure: 'projection_identity_mismatch' };
    }
  }
  return { ok: true };
}

/** Messaggi condivisi: un solo contratto, un solo vocabolario. */
export const LESSON_PROJECTION_IDENTITY_MESSAGES: Readonly<
  Record<LessonProjectionIdentityFailure, string>
> = {
  lesson_missing: 'La lezione non esiste.',
  owner_mismatch: 'La lezione non appartiene a questo utente.',
  import_mismatch: 'La lezione non appartiene a questa importazione.',
  public_lesson_id_mismatch: 'La proiezione indicata non corrisponde a questa lezione.',
  projection_missing: 'La proiezione della lezione non esiste.',
  projection_owner_mismatch: 'La proiezione non appartiene a questo utente.',
  projection_import_mismatch: 'La proiezione non appartiene a questa importazione.',
  projection_program_mismatch: 'La proiezione non appartiene a questo corso.',
  projection_identity_mismatch: 'La proiezione non corrisponde a questa lezione.',
};

export function identityFailureMessage(failure: LessonProjectionIdentityFailure): string {
  return LESSON_PROJECTION_IDENTITY_MESSAGES[failure];
}
