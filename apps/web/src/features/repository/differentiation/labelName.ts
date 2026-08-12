/**
 * VDIF-01 — normalizzazione e validazione **pure** del nome di un'etichetta.
 *
 * Unica fonte per UI e servizio: né il dialog né il service ricalcolano queste
 * regole per conto proprio, altrimenti due percorsi divergono e il duplicato
 * accettato da uno viene rifiutato dall'altro.
 *
 * Il modulo è deliberatamente **senza Firebase, senza React e senza IO**: è
 * sincrono, deterministico e testabile da solo.
 *
 * ## Che cosa NON fa, ed è una scelta
 *
 * Nessuna correzione semantica, nessuna rimozione di accenti o apostrofi,
 * nessuna traslitterazione, nessuno stemming, nessuna sinonimia e — soprattutto
 * — **nessuna classificazione** del significato del nome. SchoolForge non deve
 * dedurre né certificare che cosa rappresenti un'etichetta: `nameKey` serve a
 * impedire che «Percorso A» e «percorso  a» diventino due etichette distinte,
 * non a interpretare il testo.
 */

/** Limite in **code point Unicode** del nome canonico. */
export const LABEL_NAME_MAX_CODE_POINTS = 40;

/** Limite in **byte UTF-8** del nome canonico. */
export const LABEL_NAME_MAX_BYTES = 120;

export type LabelNameErrorCode =
  | 'not_a_string'
  | 'empty'
  | 'control_characters'
  | 'too_many_code_points'
  | 'too_many_bytes';

export class LabelNameError extends Error {
  readonly code: LabelNameErrorCode;

  constructor(code: LabelNameErrorCode, message: string) {
    super(message);
    this.name = 'LabelNameError';
    this.code = code;
  }
}

const MESSAGES: Record<LabelNameErrorCode, string> = {
  not_a_string: 'Il nome dell’etichetta non è valido.',
  empty: 'Indica un nome per l’etichetta.',
  control_characters: 'Il nome dell’etichetta non può contenere caratteri di controllo.',
  too_many_code_points: `Il nome dell’etichetta non può superare ${LABEL_NAME_MAX_CODE_POINTS} caratteri.`,
  too_many_bytes: `Il nome dell’etichetta è troppo lungo (massimo ${LABEL_NAME_MAX_BYTES} byte).`,
};

function fail(code: LabelNameErrorCode): never {
  throw new LabelNameError(code, MESSAGES[code]);
}

/**
 * Numero di **code point**, non di unità UTF-16: `[...s].length` conta una
 * emoji fuori dal BMP come 1, mentre `s.length` la conterebbe 2. È il conteggio
 * che il docente percepisce guardando il campo.
 */
export function countCodePoints(value: string): number {
  return [...value].length;
}

/** Lunghezza in byte della codifica UTF-8. */
export function countUtf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Caratteri di controllo: C0 (`U+0000`–`U+001F`), DEL (`U+007F`) e C1
 * (`U+0080`–`U+009F`). Vietarli non è pedanteria: `U+0000` è il separatore
 * dell'identità di prenotazione (`buildLabelReservationInput`), quindi
 * ammetterlo nel nome renderebbe ambigua la concatenazione `ownerUid + NUL +
 * nameKey`.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * Forma **canonica** del nome, quella che viene mostrata e persistita.
 *
 * Trim esterno, collasso di ogni sequenza di spazi interni in un singolo
 * spazio, poi i limiti. Lo spazio "interno" comprende tab e a capo solo in
 * quanto già rifiutati come caratteri di controllo: qui `\s` viene ristretto
 * agli spazi veri per non trasformare in silenzio un input malformato in uno
 * valido.
 *
 * @throws {LabelNameError} con `code` leggibile dalla UI.
 */
export function normalizeLabelName(value: unknown): string {
  if (typeof value !== 'string') fail('not_a_string');
  if (CONTROL_CHARACTERS.test(value)) fail('control_characters');

  // Spazi Unicode "orizzontali" collassati; il trim usa lo standard di JS.
  const canonical = value
    .trim()
    .replace(/[\u0020\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g, ' ');

  if (canonical.length === 0) fail('empty');
  if (countCodePoints(canonical) > LABEL_NAME_MAX_CODE_POINTS) fail('too_many_code_points');
  if (countUtf8Bytes(canonical) > LABEL_NAME_MAX_BYTES) fail('too_many_bytes');
  return canonical;
}

/** `true` se il valore produce un nome canonico valido. Non lancia. */
export function isValidLabelName(value: unknown): boolean {
  try {
    normalizeLabelName(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Chiave di confronto derivata **solo** dal nome già canonico.
 *
 * `NFKC` prima, minuscolo con locale italiano poi: l'ordine conta, perché la
 * composizione può cambiare quali code point esistono e quindi che cosa il
 * lowercase incontra. Il locale è esplicito per non dipendere da quello del
 * browser — con `it` la «I» resta «i», mentre un locale turco produrrebbe «ı» e
 * due docenti vedrebbero unicità diverse sullo stesso nome.
 *
 * Accenti e apostrofi **restano**: «Però» e «Pero» sono nomi diversi, ed è il
 * docente a decidere se lo sono anche per lui.
 */
export function computeNameKey(canonicalName: string): string {
  return canonicalName.normalize('NFKC').toLocaleLowerCase('it');
}

/**
 * Input dell'hash di prenotazione: `ownerUid + U+0000 + nameKey`.
 *
 * Il separatore è un carattere che né un `ownerUid` né un `nameKey` valido
 * possono contenere, quindi due coppie diverse non possono produrre la stessa
 * stringa per concatenazione (`ab` + `c` e `a` + `bc` restano distinguibili).
 */
export function buildLabelReservationInput(ownerUid: string, nameKey: string): string {
  return `${ownerUid}\u0000${nameKey}`;
}
