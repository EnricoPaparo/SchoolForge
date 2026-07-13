const UDA_DIR_PREFIX_RE = /^uda-\d+-/;

/**
 * Cleans a technical UDA directory name into a readable label: drops the
 * `uda-XX-` prefix, turns `-`/`_` runs into spaces, and applies a sober
 * capitalization of the first letter. Falls back to the raw dir if nothing
 * readable remains.
 */
function cleanUdaDir(dir: string): string {
  const withoutPrefix = dir.replace(UDA_DIR_PREFIX_RE, '');
  const spaced = withoutPrefix.replace(/[-_]+/g, ' ').trim();
  if (!spaced) return dir;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Resolves what to display for a UDA (EXP-01): the front matter `titolo` when
 * present, otherwise a readable label derived from the technical `dir`. The
 * `dir` stays the sort/order key everywhere — this only affects the label,
 * never a raw "uda-00-setup" string when a title is available.
 */
export function resolveUdaTitle(dir: string, titolo?: string | null): string {
  return titolo && titolo.trim() ? titolo.trim() : cleanUdaDir(dir);
}
