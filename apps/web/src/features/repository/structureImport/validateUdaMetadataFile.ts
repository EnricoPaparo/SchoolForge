import { STRUCTURE_IMPORT_LIMITS, UDA_METADATA_SCHEMA } from './limits.js';
import { parseStructureYaml } from './parseStructureYaml.js';
import { assertClosedKeySet, readStringField, readStringListField } from './entryFields.js';
import { assertNoTitleCollisions, readRootEnvelope } from './validateStructureRoot.js';
import type { NormalizedUdaMetadata, StructureImportResult } from './types.js';

/**
 * STRUCTURE-IMPORT-01 — validator of the UDA metadata file
 * (structure-metadata-import-roadmap.md §3).
 *
 * Fail-closed by construction: the key set is closed at both levels, every
 * field is checked before anything is normalized, and a single problem rejects
 * the whole file. The output carries only didactic metadata — no technical
 * name, no id, no order: those belong to the planner, which derives them from
 * the destination.
 *
 * Pure module: no I/O.
 */

/** The only keys a UDA entry may carry. */
export const UDA_ENTRY_KEYS = ['titolo', 'descrizione', 'competenze', 'obiettivi'] as const;

/**
 * Keys that get an explicit «this file carries no content» error instead of a
 * generic «unknown property»: the ones a teacher might reasonably try after
 * seeing the ZIP import, plus every technical name the system alone assigns.
 */
export const UDA_FORBIDDEN_KEYS = [
  'body',
  'content',
  'contenuto',
  'markdown',
  'html',
  'lezioni',
  'lessons',
  'pool',
  'domande',
  'questions',
  'soluzioni',
  'solutions',
  'id',
  'udaId',
  'dir',
  'filename',
  'path',
  'slug',
  'order',
  'ordine',
  'storageRef',
  'storageBasePath',
  'lessonCount',
] as const;

export interface ValidateUdaMetadataOptions {
  /** Original filename, when available — only its extension is checked. */
  filename?: string;
  /** Titles already present in the destination import, for the collision check. */
  existingTitles?: readonly string[];
}

/**
 * Parses and validates a UDA metadata file, returning the normalized entries in
 * file order (which is also the append order).
 */
export function validateUdaMetadataFile(
  text: string,
  options: ValidateUdaMetadataOptions = {},
): StructureImportResult<NormalizedUdaMetadata[]> {
  const parsed = parseStructureYaml(text, {
    fileKind: 'uda',
    ...(options.filename === undefined ? {} : { filename: options.filename }),
  });
  if (!parsed.ok) return parsed;

  const envelope = readRootEnvelope(parsed.value, {
    fileKind: 'uda',
    schema: UDA_METADATA_SCHEMA,
    listKey: 'udas',
    minEntries: STRUCTURE_IMPORT_LIMITS.MIN_UDAS,
    maxEntries: STRUCTURE_IMPORT_LIMITS.MAX_UDAS,
  });
  if (!envelope.ok) return envelope;

  const udas: NormalizedUdaMetadata[] = [];

  for (const [index, entry] of envelope.value.entries()) {
    const closed = assertClosedKeySet(entry, UDA_ENTRY_KEYS, UDA_FORBIDDEN_KEYS, {
      fileKind: 'uda',
      index,
    });
    if (closed) return { ok: false, error: closed };

    const titolo = readStringField(entry['titolo'], {
      fileKind: 'uda',
      index,
      field: 'titolo',
    });
    if (!titolo.ok) return titolo;

    // Absent → null. Present but blank is an error, not a silent null: the
    // teacher wrote something and deserves to know it was not usable.
    const descrizione = readStringField(
      entry['descrizione'],
      { fileKind: 'uda', index, field: 'descrizione' },
      { optional: true },
    );
    if (!descrizione.ok) return descrizione;

    const competenze = readStringListField(entry['competenze'], {
      fileKind: 'uda',
      index,
      field: 'competenze',
    });
    if (!competenze.ok) return competenze;

    const obiettivi = readStringListField(entry['obiettivi'], {
      fileKind: 'uda',
      index,
      field: 'obiettivi',
    });
    if (!obiettivi.ok) return obiettivi;

    udas.push({
      titolo: titolo.value!,
      descrizione: descrizione.value,
      competenze: competenze.value,
      obiettivi: obiettivi.value,
    });
  }

  const collision = assertNoTitleCollisions(
    udas.map((uda) => uda.titolo),
    options.existingTitles ?? [],
    'uda',
  );
  if (collision) return { ok: false, error: collision };

  return { ok: true, value: udas };
}
