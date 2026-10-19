/** Impronta locale anti-stale, non usata come garanzia crittografica. */
export function fingerprintCompleteLessonBody(body: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < body.length; index += 1) {
    const code = body.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return `${body.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}
