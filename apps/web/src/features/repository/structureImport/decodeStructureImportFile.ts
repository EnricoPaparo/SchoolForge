import { STRUCTURE_IMPORT_EXTENSIONS, STRUCTURE_IMPORT_LIMITS } from './limits.js';
import type {
  StructureImportError,
  StructureImportFileKind,
  StructureImportResult,
} from './types.js';

/**
 * STRUCTURE-IMPORT-01 — byte-first loading of a metadata file.
 *
 * The authoritative path starts from the **original bytes**, never from text
 * somebody already decoded. `File.text()` and any other permissive decoding
 * replaces invalid UTF-8 with U+FFFD, which means a corrupted file would be
 * silently accepted and imported with mangled titles. So:
 *
 * 1. the extension is checked first (nothing is read otherwise);
 * 2. the size limit is measured on the **original bytes**, before decoding —
 *    decoding a 200 MB file just to find out it is too large is exactly what a
 *    limit is supposed to prevent;
 * 3. decoding uses `TextDecoder` in **fatal** mode, so a malformed or truncated
 *    sequence raises `invalid_encoding` instead of being repaired;
 * 4. a UTF-8 BOM, if present, is dropped — it is an encoding artefact, not
 *    content, and would otherwise turn the first key into an unknown property.
 *
 * STRUCTURE-IMPORT-02A/02B must therefore call `file.arrayBuffer()` and hand the
 * bytes to this function. `File.text()` is not an accepted source anywhere in
 * this package.
 *
 * `TextDecoder` is a pure platform primitive: no DOM, no network, no Firebase,
 * no timer.
 */

export type StructureImportBytes = Uint8Array | ArrayBuffer;

function error(
  code: StructureImportError['code'],
  message: string,
  fileKind: StructureImportFileKind,
): StructureImportError {
  return { code, message, fileKind };
}

/**
 * Accepts only `.yaml`/`.yml`. The check is on the name, not on the MIME type:
 * browsers report YAML inconsistently, and the extension is what the teacher
 * actually controls.
 */
export function hasAcceptedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return STRUCTURE_IMPORT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export interface DecodeStructureImportFileOptions {
  fileKind: StructureImportFileKind;
  /** When provided, its extension is validated before anything is decoded. */
  filename?: string;
}

function toUint8Array(bytes: StructureImportBytes): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/** UTF-8 BOM. Present in files saved by several Windows editors. */
const BOM = '﻿';

/**
 * Validates extension and size on the original bytes, then decodes strict
 * UTF-8. Returns the decoded text or the single blocking error.
 */
export function decodeStructureImportFile(
  bytes: StructureImportBytes,
  options: DecodeStructureImportFileOptions,
): StructureImportResult<string> {
  const { fileKind, filename } = options;

  if (filename !== undefined && !hasAcceptedExtension(filename)) {
    return {
      ok: false,
      error: error(
        'invalid_extension',
        'Sono accettati solo file YAML con estensione .yaml o .yml.',
        fileKind,
      ),
    };
  }

  const view = toUint8Array(bytes);

  // Measured on the original bytes, before decoding: this is the only measure
  // that matches what the teacher actually selected.
  if (view.byteLength > STRUCTURE_IMPORT_LIMITS.MAX_FILE_BYTES) {
    return {
      ok: false,
      error: error(
        'file_too_large',
        `Il file supera il limite di ${STRUCTURE_IMPORT_LIMITS.MAX_FILE_BYTES} byte.`,
        fileKind,
      ),
    };
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(view);
  } catch {
    return {
      ok: false,
      error: error(
        'invalid_encoding',
        'Il file non è codificato in UTF-8 valido: salvalo nuovamente in UTF-8 e riprova.',
        fileKind,
      ),
    };
  }

  return { ok: true, value: text.startsWith(BOM) ? text.slice(BOM.length) : text };
}
