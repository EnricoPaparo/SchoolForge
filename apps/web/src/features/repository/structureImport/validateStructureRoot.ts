import { titleComparisonKey } from './entryFields.js';
import type {
  StructureImportError,
  StructureImportFileKind,
  StructureImportResult,
} from './types.js';

/**
 * STRUCTURE-IMPORT-01 — envelope rules shared by both formats: a closed root
 * (`schema` + the entry list, nothing else), an exact schema identifier and a
 * bounded list of plain-object entries.
 *
 * Pure module: no I/O.
 */

export interface RootEnvelopeSpec {
  fileKind: StructureImportFileKind;
  /** The only accepted `schema` value. */
  schema: string;
  /** The only other accepted root key, e.g. `udas` or `lessons`. */
  listKey: string;
  minEntries: number;
  maxEntries: number;
}

function rootError(
  code: StructureImportError['code'],
  message: string,
  fileKind: StructureImportFileKind,
  field?: string,
): StructureImportError {
  return field === undefined ? { code, message, fileKind } : { code, message, fileKind, field };
}

/**
 * Validates the root object and returns the raw entry list, still unvalidated
 * entry-by-entry but guaranteed to be an array of plain objects of an
 * acceptable length.
 */
export function readRootEnvelope(
  root: Record<string, unknown>,
  spec: RootEnvelopeSpec,
): StructureImportResult<Record<string, unknown>[]> {
  const { fileKind, schema, listKey, minEntries, maxEntries } = spec;

  for (const key of Object.keys(root)) {
    if (key === 'schema' || key === listKey) continue;
    return {
      ok: false,
      error: rootError(
        'unknown_property',
        `La proprietà «${key}» non è prevista alla radice del file.`,
        fileKind,
        key,
      ),
    };
  }

  const declaredSchema = root['schema'];
  if (declaredSchema === undefined || declaredSchema === null) {
    return {
      ok: false,
      error: rootError(
        'missing_schema',
        `Il file deve dichiarare «schema: ${schema}».`,
        fileKind,
        'schema',
      ),
    };
  }
  if (typeof declaredSchema !== 'string' || declaredSchema.trim() !== schema) {
    return {
      ok: false,
      error: rootError(
        'unknown_schema',
        `Schema non riconosciuto: è atteso «${schema}».`,
        fileKind,
        'schema',
      ),
    };
  }

  const rawList = root[listKey];
  if (rawList === undefined || rawList === null) {
    return {
      ok: false,
      error: rootError(
        'missing_field',
        `Il file deve contenere l'elenco «${listKey}».`,
        fileKind,
        listKey,
      ),
    };
  }
  if (!Array.isArray(rawList)) {
    return {
      ok: false,
      error: rootError('invalid_type', `«${listKey}» deve essere un elenco.`, fileKind, listKey),
    };
  }
  if (rawList.length < minEntries) {
    return {
      ok: false,
      error: rootError(
        'too_few_items',
        `Il file deve contenere almeno ${minEntries} elemento in «${listKey}».`,
        fileKind,
        listKey,
      ),
    };
  }
  if (rawList.length > maxEntries) {
    return {
      ok: false,
      error: rootError(
        'too_many_items',
        `Il file supera il limite di ${maxEntries} elementi in «${listKey}».`,
        fileKind,
        listKey,
      ),
    };
  }

  const entries: Record<string, unknown>[] = [];
  for (const [index, entry] of rawList.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return {
        ok: false,
        error: {
          code: 'invalid_type',
          message: `L'elemento ${index + 1} di «${listKey}» deve essere un oggetto con i campi previsti.`,
          fileKind,
          index,
          field: listKey,
        },
      };
    }
    entries.push(entry as Record<string, unknown>);
  }

  return { ok: true, value: entries };
}

/**
 * Rejects two entries whose titles match after trim + case-insensitive
 * comparison, and any entry whose title already exists in the destination.
 * Append-only means no rename, no `_2` suffix, no merge: a collision stops the
 * whole file.
 */
export function assertNoTitleCollisions(
  titles: readonly string[],
  existingTitles: readonly string[],
  fileKind: StructureImportFileKind,
): StructureImportError | null {
  const existing = new Set(existingTitles.map((title) => titleComparisonKey(title)));
  const seen = new Set<string>();

  for (const [index, titolo] of titles.entries()) {
    const key = titleComparisonKey(titolo);
    if (seen.has(key)) {
      return {
        code: 'duplicate_title',
        message: `Il titolo «${titolo}» compare più volte nel file: i titoli devono essere distinti.`,
        fileKind,
        index,
        field: 'titolo',
      };
    }
    if (existing.has(key)) {
      return {
        code: 'duplicate_title_in_destination',
        message: `Il titolo «${titolo}» esiste già nella destinazione: l'importazione non sovrascrive e non rinomina.`,
        fileKind,
        index,
        field: 'titolo',
      };
    }
    seen.add(key);
  }

  return null;
}
