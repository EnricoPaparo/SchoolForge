import { parseAllDocuments, visit } from 'yaml';
import { decodeStructureImportFile } from './decodeStructureImportFile.js';
import type { StructureImportBytes } from './decodeStructureImportFile.js';
import type {
  StructureImportError,
  StructureImportFileKind,
  StructureImportResult,
} from './types.js';

/**
 * STRUCTURE-IMPORT-01 — fail-closed YAML reader
 * (structure-metadata-import-roadmap.md §5).
 *
 * This module answers exactly one question: *is this text a single, plain,
 * unambiguous YAML mapping?* It knows nothing about UDAs or lessons — the two
 * validators build on top of it. Everything the YAML spec allows but a metadata
 * file has no business using is rejected rather than resolved:
 *
 * - more than one document in the same file;
 * - duplicate keys (the last-wins behaviour would silently drop a field);
 * - anchors and aliases (a small file could expand into a huge object, and the
 *   teacher could not tell what was actually imported by reading it);
 * - explicit tags, including the standard `!!str` ones (nothing legitimate in
 *   these formats needs to override a type);
 * - a root that is not a mapping.
 *
 * The authoritative entry point is `parseStructureYaml`, which takes the
 * **original bytes**: extension, size limit and strict UTF-8 decoding all
 * happen before a single character is parsed (see `decodeStructureImportFile`).
 * `parseStructureYamlText` is the same parser over already-decoded text; it
 * exists for internal reuse and tests and must not be reached from the UI.
 *
 * Pure module: no Firebase, no React, no DOM, no network, no filesystem.
 */

function error(
  code: StructureImportError['code'],
  message: string,
  fileKind: StructureImportFileKind,
): StructureImportError {
  return { code, message, fileKind };
}

export interface ParseStructureYamlOptions {
  fileKind: StructureImportFileKind;
  /** When provided, its extension is validated before anything is decoded. */
  filename?: string;
}

/**
 * Authoritative entry point: original bytes in, plain root mapping out.
 * Extension, size limit and strict UTF-8 decoding are applied first; a single
 * problem rejects the whole file (contract §5).
 */
export function parseStructureYaml(
  bytes: StructureImportBytes,
  options: ParseStructureYamlOptions,
): StructureImportResult<Record<string, unknown>> {
  const decoded = decodeStructureImportFile(bytes, options);
  if (!decoded.ok) return decoded;
  return parseStructureYamlText(decoded.value, options.fileKind);
}

/**
 * The parser proper, over already-decoded text. Internal: the UI must go
 * through `parseStructureYaml` so that encoding is never assumed.
 */
export function parseStructureYamlText(
  text: string,
  fileKind: StructureImportFileKind,
): StructureImportResult<Record<string, unknown>> {
  if (text.trim().length === 0) {
    return { ok: false, error: error('empty_file', 'Il file è vuoto.', fileKind) };
  }

  let documents: ReturnType<typeof parseAllDocuments>;
  try {
    documents = parseAllDocuments(text, { uniqueKeys: true, merge: false });
  } catch {
    // The parser is not supposed to throw on malformed input (it collects
    // errors instead), but a thrown error must never surface as a crash.
    return {
      ok: false,
      error: error('malformed_yaml', 'Il file non è un YAML valido.', fileKind),
    };
  }

  if (documents.length === 0) {
    return { ok: false, error: error('empty_file', 'Il file è vuoto.', fileKind) };
  }
  if (documents.length > 1) {
    return {
      ok: false,
      error: error(
        'multiple_documents',
        'Il file contiene più documenti YAML: è ammesso un solo documento.',
        fileKind,
      ),
    };
  }

  // Named `yamlDoc`, not `document`: shadowing the DOM global in a module
  // that must never touch the DOM would be needlessly confusing.
  const yamlDoc = documents[0]!;
  const duplicateKey = yamlDoc.errors.some((issue) => issue.code === 'DUPLICATE_KEY');
  if (duplicateKey) {
    return {
      ok: false,
      error: error(
        'duplicate_key',
        'Il file contiene una chiave duplicata: ogni chiave deve comparire una sola volta.',
        fileKind,
      ),
    };
  }
  if (yamlDoc.errors.length > 0) {
    return {
      ok: false,
      error: error('malformed_yaml', 'Il file non è un YAML valido.', fileKind),
    };
  }

  if (yamlDoc.contents === null) {
    return { ok: false, error: error('empty_file', 'Il file è vuoto.', fileKind) };
  }

  let hasAnchorOrAlias = false;
  let hasTag = false;
  visit(yamlDoc, {
    Alias() {
      hasAnchorOrAlias = true;
    },
    Node(_key, node) {
      if (node.anchor) hasAnchorOrAlias = true;
      if (node.tag) hasTag = true;
    },
  });
  if (hasAnchorOrAlias) {
    return {
      ok: false,
      error: error(
        'alias_or_anchor',
        'Il file usa ancore o alias YAML: non sono ammessi.',
        fileKind,
      ),
    };
  }
  if (hasTag) {
    return {
      ok: false,
      error: error('custom_tag', 'Il file usa tag YAML espliciti: non sono ammessi.', fileKind),
    };
  }

  const root: unknown = yamlDoc.toJS();
  // A document marker with nothing under it (`---`) parses to an explicit null:
  // reported as an empty file, which is what the teacher actually has.
  if (root === null || root === undefined) {
    return { ok: false, error: error('empty_file', 'Il file è vuoto.', fileKind) };
  }
  if (typeof root !== 'object' || Array.isArray(root)) {
    return {
      ok: false,
      error: error(
        'invalid_root',
        'Il contenuto del file deve essere un oggetto YAML con le chiavi previste.',
        fileKind,
      ),
    };
  }

  return { ok: true, value: root as Record<string, unknown> };
}
