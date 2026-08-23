/**
 * VISUAL-ENRICHMENT-04A — riancoraggio, cioè spostare l'ancora e nient'altro.
 *
 * **Perché è un'operazione a sé.** Quando il docente riscrive una lezione, la
 * sezione a cui l'immagine era ancorata può sparire. L'immagine resta valida —
 * è la stessa, approvata, coi suoi byte — ma non sa più dove stare, e finisce
 * in fondo. Rigenerarla per rimetterla al posto giusto significherebbe pagare
 * un provider per riprodurre qualcosa che si ha già.
 *
 * Il contratto è quindi deliberatamente **minuscolo**: cambia `anchor`, non
 * tocca nient'altro. `assetId`, `storageRef`, `sha256`, `byteLength`,
 * dimensioni, `mimeType`, `styleVersion`, `sourceBodyHash`, `approvedAt`,
 * `caption` e `altText` restano quelli. In particolare `approvedAt` non si
 * muove: il docente non ha approvato una nuova immagine, ha spostato quella che
 * aveva già approvato.
 *
 * **Nessun byte viene letto o scritto.** Non si tocca Storage e non si tocca
 * `publicLessonVisuals`: i byte sono identici a prima, e riscriverli
 * significherebbe pagare per non cambiare nulla.
 *
 * Modulo puro: nessun Firebase, nessun I/O.
 */

import { MAX_VISUAL_ANCHOR_HEADING_CHARS, codePointLength } from './aiContentVisualProposal.js';
import { AiVisualError } from './aiVisualCore.js';
import { isValidDocumentIdInput } from './firestoreDocumentId.js';
import type { LessonVisualPrivateManifest } from './aiVisualManifest.js';

export interface VisualReanchorInput {
  programId: string;
  importId: string;
  lessonId: string;
  /** Testo dell'heading scelto dal docente. Lo slug lo calcola il server. */
  anchorHeadingText: string;
}

const REANCHOR_KEYS = ['programId', 'importId', 'lessonId', 'anchorHeadingText'] as const;

function invalidInput(message: string): never {
  throw new AiVisualError('invalid_input', message);
}

/**
 * Input **chiuso**: quattro chiavi, nessuna in più.
 *
 * Ciò che è deliberatamente assente è più importante di ciò che c'è. Il client
 * non manda `ownerUid`, `publicLessonId`, `assetId`, `storageRef`, lo slug né
 * il manifest: li deriva o li rilegge il server. Accettare lo **slug** sarebbe
 * il caso più insidioso — sembrerebbe un dettaglio tecnico innocuo, e invece
 * permetterebbe di ancorare l'immagine a un identificatore che nel corpo non
 * esiste, aggirando l'unico controllo che conta.
 */
export function validateVisualReanchorInput(value: unknown): VisualReanchorInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidInput('Payload mancante o non valido.');
  }
  const root = value as Record<string, unknown>;
  const keys = Object.keys(root).sort();
  const expected = [...REANCHOR_KEYS].sort();
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    invalidInput('Il payload contiene proprietà non ammesse.');
  }

  for (const key of ['programId', 'importId', 'lessonId'] as const) {
    if (!isValidDocumentIdInput(root[key])) invalidInput(`${key} non valido.`);
  }

  const anchorHeadingText = root.anchorHeadingText;
  if (
    typeof anchorHeadingText !== 'string' ||
    anchorHeadingText.length === 0 ||
    anchorHeadingText !== anchorHeadingText.trim() ||
    codePointLength(anchorHeadingText) > MAX_VISUAL_ANCHOR_HEADING_CHARS
  ) {
    invalidInput('Heading di ancoraggio non valido.');
  }

  return {
    programId: root.programId as string,
    importId: root.importId as string,
    lessonId: root.lessonId as string,
    anchorHeadingText,
  };
}

/**
 * Compone il manifest riancorato a partire da quello corrente.
 *
 * Lo spread è deliberato e va letto come una promessa: tutto ciò che c'era
 * resta, e cambia soltanto `anchor`. Se un giorno il manifest guadagnasse un
 * campo nuovo, questa funzione lo conserverebbe senza doverlo sapere — mentre
 * ricostruire il manifest campo per campo avrebbe silenziosamente perso quello
 * che nessuno si è ricordato di ricopiare.
 */
export function composeReanchoredManifest(params: {
  current: LessonVisualPrivateManifest;
  anchor: { headingSlug: string; headingText: string };
}): LessonVisualPrivateManifest {
  const { current, anchor } = params;
  return {
    ...current,
    anchor: {
      headingSlug: anchor.headingSlug,
      headingText: anchor.headingText,
      placement: 'after-heading',
    },
  };
}

/**
 * `true` quando l'ancora richiesta è **già** quella corrente.
 *
 * È il caso del replay: una risposta persa, un doppio clic, un retry. Deve
 * costare zero scritture e zero audit — riscrivere lo stesso valore
 * produrrebbe una traccia che racconta un'operazione che non è avvenuta.
 */
export function isSameAnchor(
  current: LessonVisualPrivateManifest,
  anchor: { headingSlug: string; headingText: string },
): boolean {
  return (
    current.anchor.headingSlug === anchor.headingSlug &&
    current.anchor.headingText === anchor.headingText &&
    current.anchor.placement === 'after-heading'
  );
}

/** Ciò che il manifest riancorato non deve **mai** cambiare. */
export const REANCHOR_IMMUTABLE_KEYS = [
  'assetId',
  'storageRef',
  'caption',
  'altText',
  'width',
  'height',
  'byteLength',
  'sha256',
  'mimeType',
  'styleVersion',
  'sourceBodyHash',
  'approvedAt',
] as const;
