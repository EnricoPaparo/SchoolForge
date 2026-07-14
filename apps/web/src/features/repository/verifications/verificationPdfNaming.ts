/**
 * Pure filename-building helpers for the student verification PDF. Kept
 * free of any jsPDF dependency so they can be unit tested directly.
 *
 * Naming scheme:
 *   docente:  aaaammgg-classe-titoloverifica.pdf
 *   studente: aaaammgg-classe-titoloverifica-NomeStudente-CognomeStudente.pdf
 *
 * `aaaammgg` is the date of download/generation, never a stored value.
 * `classe` falls back to "senza-classe" when the verification has none.
 * The student name segment comes from Google `displayName` (the caller is
 * responsible for an email fallback if `displayName` is absent) — when it
 * can't be split into nome/cognome (a single word), the sanitized name is
 * used as one single trailing segment instead of two.
 */

export function sanitizeForFilename(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function formatDateForFilename(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/**
 * First word as nome, the rest joined as cognome. `cognome` is null when
 * the name has only one word — "not separable into nome/cognome".
 */
function splitFullName(fullName: string): { nome: string; cognome: string | null } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { nome: parts[0] ?? '', cognome: null };
  return { nome: parts[0], cognome: parts.slice(1).join(' ') };
}

export function buildVerificationPdfFilename(params: {
  title: string;
  className: string | null;
  /** Present only for a real student download — absent/null for the docente preview. */
  studentName?: string | null;
  /** Injectable for tests; defaults to the current date. */
  date?: Date;
}): string {
  const date = params.date ?? new Date();
  const classSlug = params.className?.trim()
    ? sanitizeForFilename(params.className)
    : 'senza-classe';
  const titleSlug = sanitizeForFilename(params.title) || 'verifica';
  const base = `${formatDateForFilename(date)}-${classSlug}-${titleSlug}`;

  const studentName = params.studentName?.trim();
  if (!studentName) return `${base}.pdf`;

  const { nome, cognome } = splitFullName(studentName);
  const nomeSlug = sanitizeForFilename(nome);
  if (!cognome) return `${base}-${nomeSlug}.pdf`;
  return `${base}-${nomeSlug}-${sanitizeForFilename(cognome)}.pdf`;
}
