import { LESSON_METADATA_SCHEMA, STRUCTURE_IMPORT_LIMITS } from './limits.js';
import { parseStructureYamlText } from './parseStructureYaml.js';
import { decodeStructureImportFile } from './decodeStructureImportFile.js';
import type { StructureImportBytes } from './decodeStructureImportFile.js';
import { assertClosedKeySet, readStringField, readStringListField } from './entryFields.js';
import { assertNoTitleCollisions, readRootEnvelope } from './validateStructureRoot.js';
import type { NormalizedLessonMetadata, StructureImportResult } from './types.js';

/**
 * STRUCTURE-IMPORT-01 — validator of the lesson metadata file
 * (structure-metadata-import-roadmap.md §4).
 *
 * Same fail-closed reasoning as the UDA validator. The destination UDA is the
 * one the teacher has open: the file carries no id, no path and no reference to
 * it, so nothing in it can redirect the import elsewhere.
 *
 * Pure module: no I/O.
 */

/** The only keys a lesson entry may carry. */
export const LESSON_ENTRY_KEYS = [
  'titolo',
  'sottotitolo',
  'difficolta',
  'concettiChiave',
  'obiettivi',
] as const;

/**
 * Explicitly rejected keys. The content-bearing ones matter most: a structural
 * import creates lessons with an empty body on purpose, and silently ignoring a
 * `body:` the teacher wrote would be the worst possible outcome.
 */
export const LESSON_FORBIDDEN_KEYS = [
  'body',
  'content',
  'contenuto',
  'corpo',
  'markdown',
  'md',
  'html',
  'testo',
  'pool',
  'domande',
  'questions',
  'soluzione',
  'soluzioni',
  'solutions',
  'risposte',
  'id',
  'lessonId',
  'publicLessonId',
  'udaId',
  'udaDir',
  'filename',
  'path',
  'slug',
  'order',
  'ordine',
  'storageRef',
  'poolStorageRef',
  'poolStatus',
  'questionCount',
] as const;

export interface ValidateLessonMetadataOptions {
  /** Original filename, when available — only its extension is checked. */
  filename?: string;
  /** Titles already present in the destination UDA, for the collision check. */
  existingTitles?: readonly string[];
}

/**
 * Parses and validates a lesson metadata file, returning the normalized entries
 * in file order (which is also the append order).
 */
export function validateLessonMetadataFile(
  bytes: StructureImportBytes,
  options: ValidateLessonMetadataOptions = {},
): StructureImportResult<NormalizedLessonMetadata[]> {
  const decoded = decodeStructureImportFile(bytes, {
    fileKind: 'lesson',
    ...(options.filename === undefined ? {} : { filename: options.filename }),
  });
  if (!decoded.ok) return decoded;
  return validateLessonMetadataFileText(decoded.value, options);
}

/**
 * The validator proper, over already-decoded text. Internal: the UI must go
 * through the byte-first entry point above, so that a file with invalid UTF-8
 * can never be silently repaired into something importable.
 */
export function validateLessonMetadataFileText(
  text: string,
  options: ValidateLessonMetadataOptions = {},
): StructureImportResult<NormalizedLessonMetadata[]> {
  const parsed = parseStructureYamlText(text, 'lesson');
  if (!parsed.ok) return parsed;

  const envelope = readRootEnvelope(parsed.value, {
    fileKind: 'lesson',
    schema: LESSON_METADATA_SCHEMA,
    listKey: 'lessons',
    minEntries: STRUCTURE_IMPORT_LIMITS.MIN_LESSONS,
    maxEntries: STRUCTURE_IMPORT_LIMITS.MAX_LESSONS,
  });
  if (!envelope.ok) return envelope;

  return normalizeLessonEntries(envelope.value, options);
}

/**
 * Normalizzazione voce per voce, condivisa fra formato YAML e formato semplice.
 * Vedi `normalizeUdaEntries`: il contratto didattico ha una sola
 * implementazione, indipendente dalla sintassi di ingresso.
 */
export function normalizeLessonEntries(
  entries: readonly Record<string, unknown>[],
  options: ValidateLessonMetadataOptions = {},
): StructureImportResult<NormalizedLessonMetadata[]> {
  const lessons: NormalizedLessonMetadata[] = [];

  for (const [index, entry] of entries.entries()) {
    const closed = assertClosedKeySet(entry, LESSON_ENTRY_KEYS, LESSON_FORBIDDEN_KEYS, {
      fileKind: 'lesson',
      index,
    });
    if (closed) return { ok: false, error: closed };

    const titolo = readStringField(entry['titolo'], {
      fileKind: 'lesson',
      index,
      field: 'titolo',
    });
    if (!titolo.ok) return titolo;

    // Optional, and an explicitly blank subtitle is normalized to `null`: the
    // canonical front matter omits empty fields anyway, so an empty string and
    // an absent key must not produce two different lessons (contract §4).
    const sottotitolo = readStringField(
      entry['sottotitolo'],
      { fileKind: 'lesson', index, field: 'sottotitolo' },
      { optional: true, blankAsNull: true },
    );
    if (!sottotitolo.ok) return sottotitolo;

    const difficolta = readStringField(
      entry['difficolta'],
      { fileKind: 'lesson', index, field: 'difficolta' },
      { maxLength: STRUCTURE_IMPORT_LIMITS.MAX_DIFFICULTY_LENGTH },
    );
    if (!difficolta.ok) return difficolta;

    const concettiChiave = readStringListField(entry['concettiChiave'], {
      fileKind: 'lesson',
      index,
      field: 'concettiChiave',
    });
    if (!concettiChiave.ok) return concettiChiave;

    const obiettivi = readStringListField(entry['obiettivi'], {
      fileKind: 'lesson',
      index,
      field: 'obiettivi',
    });
    if (!obiettivi.ok) return obiettivi;

    lessons.push({
      titolo: titolo.value!,
      sottotitolo: sottotitolo.value,
      difficolta: difficolta.value!,
      concettiChiave: concettiChiave.value,
      obiettivi: obiettivi.value,
    });
  }

  const collision = assertNoTitleCollisions(
    lessons.map((lesson) => lesson.titolo),
    options.existingTitles ?? [],
    'lesson',
  );
  if (collision) return { ok: false, error: collision };

  return { ok: true, value: lessons };
}
