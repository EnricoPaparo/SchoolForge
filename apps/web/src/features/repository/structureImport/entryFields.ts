import { STRUCTURE_IMPORT_LIMITS } from './limits.js';
import type {
  StructureImportError,
  StructureImportErrorCode,
  StructureImportFileKind,
  StructureImportResult,
} from './types.js';

/**
 * STRUCTURE-IMPORT-01 — field-level rules shared by the two validators.
 *
 * Both formats enforce the same shape of rule (closed key set, non-empty
 * trimmed strings, bounded lists, bounded lengths), so the rules live here once
 * and each validator only declares *which* keys it accepts. Normalization is
 * strictly an outer `trim()`: nothing is truncated, completed or invented.
 *
 * Pure module: no I/O of any kind.
 */

export interface FieldLocation {
  fileKind: StructureImportFileKind;
  /** Zero-based index of the entry inside its list. */
  index: number;
  field: string;
}

export function fieldError(
  code: StructureImportErrorCode,
  message: string,
  location: FieldLocation,
): StructureImportError {
  return {
    code,
    message,
    fileKind: location.fileKind,
    index: location.index,
    field: location.field,
  };
}

/** Human-readable position, e.g. «UDA 3» / «lezione 3» (one-based for the teacher). */
export function entryLabel(fileKind: StructureImportFileKind, index: number): string {
  return fileKind === 'uda' ? `UDA ${index + 1}` : `lezione ${index + 1}`;
}

/**
 * Rejects any key outside `allowed`. `forbidden` keys get a dedicated code and
 * message: they are the ones a teacher might plausibly try (a lesson body, a
 * pool, an id) and deserve an explicit «this import carries no content» answer
 * rather than a generic «unknown property».
 */
export function assertClosedKeySet(
  value: Record<string, unknown>,
  allowed: readonly string[],
  forbidden: readonly string[],
  location: Omit<FieldLocation, 'field'>,
): StructureImportError | null {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    const normalized = key.toLowerCase();
    if (forbidden.some((entry) => entry.toLowerCase() === normalized)) {
      return fieldError(
        'forbidden_property',
        `La proprietà «${key}» non è ammessa in ${entryLabel(location.fileKind, location.index)}: questo file contiene solo metadati, mai contenuti, pool, soluzioni o identificatori tecnici.`,
        { ...location, field: key },
      );
    }
    return fieldError(
      'unknown_property',
      `La proprietà «${key}» non è prevista in ${entryLabel(location.fileKind, location.index)}.`,
      { ...location, field: key },
    );
  }
  return null;
}

/** A plain object, i.e. not an array, not null, not a scalar. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface StringFieldOptions {
  maxLength?: number;
  /** When true, an absent/`null` key yields `null` instead of an error. */
  optional?: boolean;
  /**
   * When true (optional fields only), a present-but-blank string is normalized
   * to `null` instead of being rejected.
   */
  blankAsNull?: boolean;
}

/**
 * Validates and normalizes one string field. A non-string (array, object,
 * number, boolean) is always an error: YAML would happily coerce, and a silent
 * coercion is exactly what a fail-closed contract must not do.
 */
export function readStringField(
  value: unknown,
  location: FieldLocation,
  options: StringFieldOptions = {},
): StructureImportResult<string | null> {
  const maxLength = options.maxLength ?? STRUCTURE_IMPORT_LIMITS.MAX_TEXT_LENGTH;
  const label = entryLabel(location.fileKind, location.index);

  if (value === undefined || value === null) {
    if (options.optional) return { ok: true, value: null };
    return {
      ok: false,
      error: fieldError(
        'missing_field',
        `Il campo «${location.field}» è obbligatorio in ${label}.`,
        location,
      ),
    };
  }

  if (typeof value !== 'string') {
    return {
      ok: false,
      error: fieldError(
        'invalid_type',
        `Il campo «${location.field}» di ${label} deve essere una stringa.`,
        location,
      ),
    };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    if (options.optional && options.blankAsNull) return { ok: true, value: null };
    return {
      ok: false,
      error: fieldError(
        'empty_value',
        `Il campo «${location.field}» di ${label} non può essere vuoto.`,
        location,
      ),
    };
  }

  if (trimmed.length > maxLength) {
    return {
      ok: false,
      error: fieldError(
        'value_too_long',
        `Il campo «${location.field}» di ${label} supera ${maxLength} caratteri.`,
        location,
      ),
    };
  }

  return { ok: true, value: trimmed };
}

/**
 * Validates and normalizes a list of strings: present, an actual array, within
 * the item-count bounds, with every item a non-empty string within the length
 * bound. The item index is reported as `campo[i]` so the teacher can find it.
 */
export function readStringListField(
  value: unknown,
  location: FieldLocation,
): StructureImportResult<string[]> {
  const label = entryLabel(location.fileKind, location.index);
  const { MIN_LIST_ITEMS, MAX_LIST_ITEMS, MAX_TEXT_LENGTH } = STRUCTURE_IMPORT_LIMITS;

  if (value === undefined || value === null) {
    return {
      ok: false,
      error: fieldError(
        'missing_field',
        `Il campo «${location.field}» è obbligatorio in ${label}.`,
        location,
      ),
    };
  }

  if (!Array.isArray(value)) {
    return {
      ok: false,
      error: fieldError(
        'invalid_type',
        `Il campo «${location.field}» di ${label} deve essere un elenco.`,
        location,
      ),
    };
  }

  if (value.length < MIN_LIST_ITEMS) {
    return {
      ok: false,
      error: fieldError(
        'too_few_items',
        `Il campo «${location.field}» di ${label} deve contenere almeno ${MIN_LIST_ITEMS} elemento.`,
        location,
      ),
    };
  }

  if (value.length > MAX_LIST_ITEMS) {
    return {
      ok: false,
      error: fieldError(
        'too_many_items',
        `Il campo «${location.field}» di ${label} supera ${MAX_LIST_ITEMS} elementi.`,
        location,
      ),
    };
  }

  const items: string[] = [];
  for (const [itemIndex, item] of value.entries()) {
    const itemLocation: FieldLocation = {
      ...location,
      field: `${location.field}[${itemIndex}]`,
    };
    if (typeof item !== 'string') {
      return {
        ok: false,
        error: fieldError(
          'invalid_type',
          `L'elemento ${itemIndex + 1} di «${location.field}» in ${label} deve essere una stringa.`,
          itemLocation,
        ),
      };
    }
    const trimmed = item.trim();
    if (!trimmed) {
      return {
        ok: false,
        error: fieldError(
          'empty_value',
          `L'elemento ${itemIndex + 1} di «${location.field}» in ${label} non può essere vuoto.`,
          itemLocation,
        ),
      };
    }
    if (trimmed.length > MAX_TEXT_LENGTH) {
      return {
        ok: false,
        error: fieldError(
          'value_too_long',
          `L'elemento ${itemIndex + 1} di «${location.field}» in ${label} supera ${MAX_TEXT_LENGTH} caratteri.`,
          itemLocation,
        ),
      };
    }
    items.push(trimmed);
  }

  return { ok: true, value: items };
}

/**
 * Stable comparison key for a title: outer trim, Unicode NFC (so two visually
 * identical accented titles written with different code points match) and
 * Italian lowercasing. Used **only** for comparison — the stored text keeps its
 * original casing and characters, trimmed and nothing more.
 */
export function titleComparisonKey(titolo: string): string {
  return titolo.trim().normalize('NFC').toLocaleLowerCase('it');
}
