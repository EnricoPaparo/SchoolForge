/**
 * VISUAL-ENRICHMENT-03A — identità della lezione, lato server.
 *
 * Bind e promozione hanno bisogno di sapere **di quale lezione** si parla, e di
 * saperlo senza credere al chiamante. Questo modulo è il cancello: date le due
 * letture (documento tecnico e proiezione), decide se sono coerenti fra loro e
 * restituisce i soli valori autorevoli — `publicLessonId`, `udaDir`, il corpo
 * salvato e lo stato di svolgimento.
 *
 * **Duplicazione dichiarata.** Il gemello di questo cancello è
 * `lessonProjectionIdentity.ts` in `apps/web`, che Functions non può importare.
 * Il vocabolario dei rifiuti è tenuto deliberatamente identico dove i due
 * coincidono, così una divergenza si vede leggendo e non solo debuggando.
 *
 * Modulo **puro**: nessun Firebase, nessuna lettura, nessuna eccezione. Chi
 * chiama traduce l'esito nell'errore tipizzato del proprio contesto.
 */

/**
 * Perché la fonte del corpo è la proiezione e non lo Storage privato.
 *
 * L'ancora di un'immagine è uno slug di heading, e deve risolversi contro **il
 * testo che viene davvero renderizzato**: quello è `PublicLessonDoc.content`,
 * già separato dal front matter e tenuto in sincronia da ogni percorso di
 * scrittura del corpo. Il file su Storage contiene anche il front matter, i cui
 * delimitatori `---` verrebbero letti come sottolineatura setext e produrrebbero
 * un heading fantasma: ancorare a quello significherebbe ancorare a qualcosa che
 * in pagina non esiste.
 *
 * Conseguenza accettata e voluta: una proiezione legacy senza `content` non
 * consente il bind. Non si ripara nulla in automatico — una lezione non
 * migrata semplicemente non è arricchibile finché non lo è.
 */

export type VisualLessonBindingFailure =
  | 'lesson_missing'
  | 'owner_mismatch'
  | 'import_mismatch'
  | 'uda_dir_missing'
  | 'projection_missing'
  | 'projection_owner_mismatch'
  | 'projection_import_mismatch'
  | 'projection_program_mismatch'
  | 'projection_identity_mismatch'
  | 'projection_content_missing';

/** Campi identitari confrontati fra documento tecnico e proiezione. */
const IDENTITY_FIELDS = ['udaDir', 'path', 'filename'] as const;

export interface VisualLessonSnapshot {
  ownerUid?: unknown;
  importId?: unknown;
  udaDir?: unknown;
  path?: unknown;
  filename?: unknown;
  publicLessonId?: unknown;
  completed?: unknown;
}

export interface VisualPublicLessonSnapshot {
  ownerUid?: unknown;
  programId?: unknown;
  importId?: unknown;
  udaDir?: unknown;
  path?: unknown;
  filename?: unknown;
  content?: unknown;
  completed?: unknown;
}

export type VisualLessonGate =
  | { ok: true; publicLessonId: string; udaDir: string }
  | { ok: false; failure: VisualLessonBindingFailure };

export type VisualProjectionGate =
  | { ok: true; body: string; completed: boolean }
  | { ok: false; failure: VisualLessonBindingFailure };

/**
 * Id della proiezione, **derivato** dal documento tecnico.
 *
 * Legacy: le lezioni importate prima di HARD-02B-1 non hanno `publicLessonId` e
 * la loro proiezione vive sotto il `lessonId` nudo. Nessun tentativo a catena,
 * nessuna query di ricerca: o l'id memorizzato o quello nudo.
 */
export function resolveVisualPublicLessonId(
  lesson: VisualLessonSnapshot,
  lessonId: string,
): string {
  const stored = lesson.publicLessonId;
  return typeof stored === 'string' && stored.length > 0 ? stored : lessonId;
}

/**
 * Primo cancello, prima di leggere la proiezione: esistenza, appartenenza e
 * derivazione dell'id pubblico.
 *
 * `udaDir` è richiesto qui e non più tardi perché è un **segmento di path**: è
 * ciò che colloca il blob canonico nel repository del docente, e una lezione
 * senza `udaDir` non ha una posizione dove mettere l'immagine.
 */
export function checkLessonForVisual(params: {
  lesson: VisualLessonSnapshot | null;
  lessonId: string;
  ownerUid: string;
  importId: string;
}): VisualLessonGate {
  const { lesson, lessonId, ownerUid, importId } = params;
  if (!lesson) return { ok: false, failure: 'lesson_missing' };
  if (lesson.ownerUid !== ownerUid) return { ok: false, failure: 'owner_mismatch' };
  if (lesson.importId !== importId) return { ok: false, failure: 'import_mismatch' };

  const udaDir = lesson.udaDir;
  if (
    typeof udaDir !== 'string' ||
    udaDir.length === 0 ||
    udaDir !== udaDir.trim() ||
    udaDir.includes('/') ||
    udaDir === '.' ||
    udaDir === '..'
  ) {
    return { ok: false, failure: 'uda_dir_missing' };
  }
  return { ok: true, publicLessonId: resolveVisualPublicLessonId(lesson, lessonId), udaDir };
}

/**
 * Secondo cancello, sulla proiezione letta all'indirizzo **derivato**:
 * appartenenza, identità e disponibilità del corpo.
 *
 * `completed` è letto qui, dalla proiezione **e** dal documento tecnico, e i due
 * devono coincidere: è lo stato che decide se l'immagine sarà visibile allo
 * studente, e leggerlo da una sola parte significherebbe fidarsi di una
 * sincronizzazione invece di verificarla.
 */
export function checkProjectionForVisual(params: {
  lesson: VisualLessonSnapshot;
  publicLesson: VisualPublicLessonSnapshot | null;
  programId: string;
  importId: string;
  ownerUid: string;
}): VisualProjectionGate {
  const { lesson, publicLesson, programId, importId, ownerUid } = params;
  if (!publicLesson) return { ok: false, failure: 'projection_missing' };
  if (publicLesson.ownerUid !== ownerUid)
    return { ok: false, failure: 'projection_owner_mismatch' };
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
  const body = publicLesson.content;
  if (typeof body !== 'string' || body.length === 0) {
    return { ok: false, failure: 'projection_content_missing' };
  }
  // `completed` assente vale `false` su entrambi: è così che i documenti legacy
  // sono nati, e trattarlo come «sconosciuto» bloccherebbe lezioni valide.
  const completed = lesson.completed === true;
  if (completed !== (publicLesson.completed === true)) {
    return { ok: false, failure: 'projection_identity_mismatch' };
  }
  return { ok: true, body, completed };
}

/** Messaggi leggibili, in un unico posto, così bind e promozione non divergono. */
export function describeVisualBindingFailure(failure: VisualLessonBindingFailure): string {
  switch (failure) {
    case 'lesson_missing':
      return 'La lezione non esiste.';
    case 'owner_mismatch':
    case 'projection_owner_mismatch':
      return 'La lezione appartiene a un altro docente.';
    case 'import_mismatch':
    case 'projection_import_mismatch':
      return 'La lezione non appartiene a questo import.';
    case 'projection_program_mismatch':
      return 'La lezione non appartiene a questo corso.';
    case 'uda_dir_missing':
      return 'La lezione non ha una UDA valida.';
    case 'projection_missing':
      return 'La proiezione della lezione non esiste.';
    case 'projection_identity_mismatch':
      return 'La proiezione non corrisponde alla lezione.';
    case 'projection_content_missing':
      return 'Il corpo della lezione non è disponibile nella proiezione.';
  }
}
