import JSZip from 'jszip';
import type { RawFile } from '../validation/types.js';

/**
 * VE-03C — `visuals/` è escluso alla lettura, e non è una scelta estetica.
 *
 * L'export scrive i sidecar delle immagini in una directory di primo livello.
 * Per `validateImport` una directory di primo livello **è** una UDA: senza
 * questa esclusione un archivio esportato da SchoolForge, reimportato in
 * SchoolForge, verrebbe rifiutato con `MISSING_UDA_FILE` su una UDA che non
 * esiste. L'import deve ignorarli, non inciamparci.
 *
 * L'esclusione è anche la forma in cui è scritta la regola di sicurezza: i
 * binari e i manifest visuali non vengono **mai** importati, e nessun dato
 * visuale proveniente da un archivio è considerato autorevole. Una lezione
 * importata nasce senza immagine e può riceverne una generandola.
 */
const EXCLUDED_PREFIXES = ['__MACOSX/', 'visuals/'];
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
 * The wrapper is only stripped when at least one stripped path still has a
 * directory component — this prevents stripping the UDA directory itself when
 * the ZIP contains a single UDA (all stripped paths would become root files),
 * while still stripping a real program-level wrapper that mixes a root-level
 * file (e.g. programma.md, which naturally has no "/" once stripped) with one
 * or more UDA subdirectories.
 *
 * Filters out OS artefacts: __MACOSX/, .DS_Store, hidden files (leading dot),
 * empty paths, and empty content.
 */
export async function readZipFile(file: File): Promise<RawFile[]> {
  const zip = await JSZip.loadAsync(file);

  const rawPaths = Object.keys(zip.files).filter((p) => !zip.files[p].dir && !isExcluded(p));

  // Detect single wrapping folder: all paths share one top-level segment AND
  // stripping it leaves at least one path with a further "/" — i.e. we are
  // removing a true outer wrapper, not the UDA directory itself.
  const firstSegments = new Set(rawPaths.map((p) => p.split('/')[0]));
  const candidatePrefix = firstSegments.size === 1 ? `${[...firstSegments][0]}/` : '';
  const strippedPaths = candidatePrefix
    ? rawPaths.map((p) => p.slice(candidatePrefix.length))
    : rawPaths;
  const prefix =
    candidatePrefix && strippedPaths.some((p) => p.includes('/')) ? candidatePrefix : '';

  // Content is decompressed concurrently for speed, but the resulting array
  // must keep `rawPaths` order (the ZIP's own physical/central-directory
  // order — see `exportZip.ts`, which writes UDA/lesson entries in `order`
  // sequence): pushing into a shared array from inside each async callback
  // would let decompression timing decide the final order instead, silently
  // scrambling a teacher's RE-04 reorder on reimport. `Promise.all` always
  // preserves input order in its resolved array regardless of resolution
  // timing, so mapping to a (possibly null) result and filtering afterwards
  // keeps this order-safe.
  const results = await Promise.all(
    rawPaths.map(async (rawPath): Promise<RawFile | null> => {
      const path = prefix ? rawPath.slice(prefix.length) : rawPath;
      // Riesaminato **dopo** lo strip del wrapper: un archivio zippato come
      // cartella ha `Corso/visuals/x.json`, che supera il filtro iniziale e
      // diventa `visuals/x.json` solo qui. Controllarlo una volta sola
      // lascerebbe passare esattamente il caso più comune.
      if (!path || isHidden(path) || isExcluded(path)) return null;
      const content = await zip.files[rawPath].async('string');
      if (!content) return null;
      return { path, content };
    }),
  );

  return results.filter((r): r is RawFile => r !== null);
}
