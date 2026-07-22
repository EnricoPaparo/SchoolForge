import JSZip from 'jszip';
import type { RawFile } from '../validation/types.js';
import type { ReadUdaZipResult, UdaArchiveError, UdaArchiveErrorCode } from './types.js';
import { UDA_ARCHIVE_LIMITS, utf8ByteLength } from './limits.js';

const EXCLUDED_PREFIXES = ['__MACOSX/'];
const EXCLUDED_NAMES = ['.DS_Store'];
/** Only lesson/UDA Markdown and pool companions are allowed logical files. */
const ALLOWED_EXTENSION_RE = /\.md$/;
const CANONICAL_UDA_ARCHIVE_RE = /^uda-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.zip$/i;

function err(code: UdaArchiveErrorCode, message: string, path?: string): ReadUdaZipResult {
  const error: UdaArchiveError = path ? { code, message, path } : { code, message };
  return { ok: false, error };
}

function isExcluded(rawPath: string): boolean {
  if (EXCLUDED_PREFIXES.some((p) => rawPath.startsWith(p))) return true;
  const filename = rawPath.split('/').at(-1) ?? '';
  return EXCLUDED_NAMES.includes(filename);
}

function isHidden(path: string): boolean {
  return path.split('/').some((seg) => seg.startsWith('.'));
}

/**
 * Rejects any raw ZIP entry name that could escape the import root or is
 * otherwise ambiguous: absolute paths, backslashes, Windows drive letters,
 * NUL/control chars, percent-encoding, and `.`/`..`/empty path segments
 * (uda-import-contract §6.2). Applied to the *raw* entry name, before any
 * wrapper stripping and before decompression — the archive is never extracted
 * to the filesystem.
 */
export function isUnsafeRawPath(rawPath: string): boolean {
  if (rawPath.length === 0) return true;
  if (rawPath.startsWith('/')) return true;
  if (rawPath.includes('\\')) return true;
  if (/^[a-zA-Z]:/.test(rawPath)) return true;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(rawPath)) return true;
  if (rawPath.includes('%')) return true;
  const segments = rawPath.replace(/\/+$/, '').split('/');
  return segments.some((seg) => seg === '' || seg === '.' || seg === '..');
}

/** Symlink entries are rejected via the ZIP unix mode bits (S_IFLNK = 0o120000). */
function isSymlink(entry: JSZip.JSZipObject): boolean {
  const perm = (entry as unknown as { unixPermissions?: number | null }).unixPermissions;
  return typeof perm === 'number' && (perm & 0o170000) === 0o120000;
}

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

/**
 * Some authoring workflows export `uda-NN-slug.zip` while keeping the single
 * internal UDA folder/file as `uda-slug`. When the slugs match exactly, use
 * the canonical archive name as the logical UDA directory and filename. This
 * is a one-to-one in-memory mapping: unrelated internal names stay untouched
 * and are rejected later by the structural validator.
 */
function canonicalizeUdaPathFromArchive(path: string, archiveName: string): string {
  if (!CANONICAL_UDA_ARCHIVE_RE.test(archiveName)) return path;

  const canonicalDir = archiveName.replace(/\.zip$/i, '');
  const legacyDir = canonicalDir.replace(/^uda-\d{2}-/i, 'uda-');
  if (legacyDir === canonicalDir || !path.startsWith(`${legacyDir}/`)) return path;

  const relativePath = path.slice(legacyDir.length + 1);
  const canonicalFilename =
    relativePath === `${legacyDir}.md` ? `${canonicalDir}.md` : relativePath;
  return `${canonicalDir}/${canonicalFilename}`;
}

/**
 * Reads a browser ZIP into `RawFile[]` for the "Importa UDA" flow, applying the
 * full security + size contract (uda-import-contract §6) *before* anything is
 * written or uploaded. Never extracts to the filesystem. On any violation it
 * returns a typed `UdaArchiveError` (no throw) so the UI/tests can act on a
 * stable code.
 *
 * Structural "which files belong to the UDA" checks (single UDA folder, no root
 * files, orphan pools, lesson/pool metadata, per-limits counts) live in
 * `validateUdaArchive`; this layer covers archive-level safety and byte limits.
 */
export async function readUdaZip(file: File): Promise<ReadUdaZipResult> {
  if (!/\.zip$/i.test(file.name)) {
    return err(
      'not_a_zip',
      'Il file non è uno ZIP UDA valido. Controlla struttura, nomi e contenuti.',
    );
  }
  if (file.size > UDA_ARCHIVE_LIMITS.MAX_COMPRESSED_BYTES) {
    return err('zip_too_large', 'Lo ZIP supera il limite di 10 MB.');
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    return err(
      'not_a_zip',
      'Il file non è uno ZIP UDA valido. Controlla struttura, nomi e contenuti.',
    );
  }

  const allEntries = Object.entries(zip.files);

  // Security pass on RAW names first (before excluding OS artefacts or
  // stripping the wrapper): traversal and symlinks are rejected outright.
  for (const [rawPath, entry] of allEntries) {
    if (isExcluded(rawPath)) continue;
    if (isSymlink(entry)) {
      return err('symlink', 'Lo ZIP contiene un collegamento simbolico non ammesso.', rawPath);
    }
    if (isUnsafeRawPath(rawPath)) {
      return err('unsafe_path', 'Lo ZIP contiene un percorso non sicuro o ambiguo.', rawPath);
    }
  }

  const rawPaths = allEntries.filter(([p, entry]) => !entry.dir && !isExcluded(p)).map(([p]) => p);

  // Single-wrapper detection identical in spirit to the program importer: strip
  // one common top-level folder only when doing so still leaves a directory
  // component (i.e. it is a true outer wrapper, not the UDA folder itself).
  const firstSegments = new Set(rawPaths.map((p) => p.split('/')[0]));
  const candidatePrefix = firstSegments.size === 1 ? `${[...firstSegments][0]}/` : '';
  const strippedPaths = candidatePrefix
    ? rawPaths.map((p) => p.slice(candidatePrefix.length))
    : rawPaths;
  const prefix =
    candidatePrefix && strippedPaths.some((p) => p.includes('/')) ? candidatePrefix : '';

  const seen = new Map<string, string>();
  const files: RawFile[] = [];
  let totalDecompressedBytes = 0;

  for (const rawPath of rawPaths) {
    const unwrappedPath = prefix ? rawPath.slice(prefix.length) : rawPath;
    const path = canonicalizeUdaPathFromArchive(unwrappedPath, file.name);
    if (!path || isHidden(path)) continue;

    if (!ALLOWED_EXTENSION_RE.test(path)) {
      return err('unexpected_file', `Il file "${path}" non è ammesso in uno ZIP UDA.`, path);
    }

    // Case-insensitive duplicate detection (also catches a wrapper collision).
    const key = path.toLowerCase();
    if (seen.has(key)) {
      return err('duplicate_entry', `Voce duplicata nello ZIP: "${path}".`, path);
    }
    seen.set(key, path);

    let content: string;
    try {
      content = stripBom(await zip.files[rawPath].async('string'));
    } catch {
      return err('encrypted_or_unreadable', 'Una voce dello ZIP è cifrata o illeggibile.', path);
    }

    const bytes = utf8ByteLength(content);
    if (bytes > UDA_ARCHIVE_LIMITS.MAX_SINGLE_FILE_BYTES) {
      return err('file_too_large', `Il file "${path}" supera il limite di 700.000 byte.`, path);
    }
    totalDecompressedBytes += bytes;
    if (totalDecompressedBytes > UDA_ARCHIVE_LIMITS.MAX_TOTAL_DECOMPRESSED_BYTES) {
      return err('content_too_large', 'Il contenuto decompresso supera il limite di 8 MB.');
    }

    files.push({ path, content });
    if (files.length > UDA_ARCHIVE_LIMITS.MAX_LOGICAL_FILES) {
      return err('too_many_files', 'Lo ZIP contiene troppi file rispetto al limite consentito.');
    }
  }

  if (files.length === 0) {
    return err('no_lessons', 'Lo ZIP deve contenere una UDA con almeno una lezione.');
  }

  return { ok: true, files, compressedBytes: file.size, totalDecompressedBytes };
}
