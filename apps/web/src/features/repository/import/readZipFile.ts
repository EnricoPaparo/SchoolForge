import JSZip from 'jszip';
import type { RawFile } from '../validation/types.js';

/**
 * Extracts a browser File (ZIP) into RawFile[] for use with importRepository.
 *
 * If the ZIP wraps all content inside a single top-level folder (the common
 * "zip a folder" pattern), that folder prefix is stripped so the resulting
 * paths look like "UDA-dir/filename.md".
 *
 * Only non-empty, non-directory entries are included.
 */
export async function readZipFile(file: File): Promise<RawFile[]> {
  const zip = await JSZip.loadAsync(file);

  const rawPaths = Object.keys(zip.files).filter((p) => !zip.files[p].dir);

  // Detect single wrapping folder: every file path starts with "folder-name/"
  const firstSegments = new Set(rawPaths.map((p) => p.split('/')[0]));
  const hasSingleTopLevelDir = firstSegments.size === 1 && rawPaths.every((p) => p.includes('/'));
  const prefix = hasSingleTopLevelDir ? `${[...firstSegments][0]}/` : '';

  const results: RawFile[] = [];

  await Promise.all(
    rawPaths.map(async (rawPath) => {
      const path = prefix ? rawPath.slice(prefix.length) : rawPath;
      if (!path) return;
      const content = await zip.files[rawPath].async('string');
      results.push({ path, content });
    }),
  );

  return results;
}
