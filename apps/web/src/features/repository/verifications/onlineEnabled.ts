/**
 * Verifications created before M3-full have no `onlineEnabled` field.
 * Treat anything other than the literal `true` as `false` — the safe default.
 */
export function normalizeOnlineEnabled(value: unknown): boolean {
  return value === true;
}
