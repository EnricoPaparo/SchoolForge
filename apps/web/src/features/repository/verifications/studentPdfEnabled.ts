/**
 * Verifications created before M3F-09 have no `studentPdfEnabled` field.
 * Treat anything other than the literal `true` as `false` — the safe,
 * fail-closed default, same reasoning as `normalizeOnlineEnabled`.
 */
export function normalizeStudentPdfEnabled(value: unknown): boolean {
  return value === true;
}
