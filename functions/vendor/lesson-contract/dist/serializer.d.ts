import type { ParsedPool } from './types.js';
/**
 * Serializes a parsed pool to the canonical `.pool.md` V2 format.
 *
 * `maxPoints` is derived from `difficolta` and is never written. The effective
 * default for `maxCharacters` is omitted, while a custom open-answer limit is
 * preserved. Output is deterministic and parseable by `parsePool`.
 */
export declare function serializePool(pool: ParsedPool): string;
//# sourceMappingURL=serializer.d.ts.map