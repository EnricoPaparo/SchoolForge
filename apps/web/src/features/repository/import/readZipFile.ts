import JSZip from 'jszip';
import type { RawFile } from '../validation/types.js';

const EXCLUDED_PREFIXES = ['__MACOSX/'];
const EXCLUDED_NAMES = ['.DS_Store'];

function isExcluded(rawPath: string): boolean {
  if (EXCLUDED_PREFIXES.some((p) => rawPath.startsWith(p))) return true;
  const filename = rawPath.split('/').at(-1) ?? '';
  if (EXCLUDED_NAMES.includes(filename)) return true;
  return false;
}

function isHidden(path: string): boolean {
  return path.split('/').some((seg) => seg.startsWith('.'));
}

/**
 * Extracts a browser File (ZIP) into RawFile[] for use with importRepository.
 *
 * If the ZIP wraps all content inside a single top-level folder (the common
 * "zip a folder" OS pattern), that folder prefix is stripped so the resulting
 * paths look like "UDA-dir/filename.md".
 *
 * The wrapper is only stripped when the stripped paths still have at least one
 * directory component — this prevents stripping the UDA directory itself when
 * the ZIP contains a single UDA.
 *
 * Filters out OS artefacts: __MACOSX/, .DS_Store, hidden files (leading dot),
 * empty paths, and empty content.
 */
export async function readZipFile(file: File): Promise<RawFile[]> {
  const zip = await JSZip.loadAsync(file);

  const rawPaths = Object.keys(zip.files).filter((p) => !zip.files[p].dir && !isExcluded(p));

  // Detect single wrapping folder: all paths share one top-level segment AND
  // stripping it leaves paths that still have at least one more "/" — i.e. we
  // are removing a true outer wrapper, not the UDA directory itself.
  const firstSegments = new Set(rawPaths.map((p) => p.split('/')[0]));
  const candidatePrefix = firstSegments.size === 1 ? `${[...firstSegments][0]}/` : '';
  const strippedPaths = candidatePrefix
    ? rawPaths.map((p) => p.slice(candidatePrefix.length))
    : rawPaths;
  const prefix =
    candidatePrefix && strippedPaths.every((p) => p.includes('/')) ? candidatePrefix : '';

  const results: RawFile[] = [];

  await Promise.all(
    rawPaths.map(async (rawPath) => {
      const path = prefix ? rawPath.slice(prefix.length) : rawPath;
      if (!path || isHidden(path)) return;
      const content = await zip.files[rawPath].async('string');
      if (!content) return;
      results.push({ path, content });
    }),
  );

  return results;
}
