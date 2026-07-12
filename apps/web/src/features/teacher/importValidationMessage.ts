import type { ValidationIssue } from '../repository/validation/types.js';

/**
 * Translates the first validation issue into a clean Italian message for the
 * import modal. Falls back to the raw issue message/path for codes without a
 * dedicated translation, keeping compatibility with older validation issues.
 *
 * Shared between the current "Corsi" view (`ProgramsView`) and the new
 * "Didattica" library (`DidatticaView`) so the two import flows surface
 * identical wording — no duplicated formatting logic.
 */
export function describeImportValidationError(issues: ValidationIssue[]): string {
  const first = issues[0];
  if (!first) return 'Validazione fallita: struttura ZIP non valida.';
  if (first.code === 'NO_UDAS') {
    return 'Validazione fallita: lo ZIP non contiene nessuna UDA valida. Verifica che ci sia almeno una cartella "uda-NN-slug/" con un file UDA conforme.';
  }
  if (first.code === 'MISSING_UDA_FILE') {
    return `Validazione fallita: struttura ZIP non conforme — la cartella "${first.path}" non contiene un file UDA valido (es. "uda-01-slug.md").`;
  }
  return `Validazione fallita: ${first.message} (${first.path})`;
}
