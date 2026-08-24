export declare const POOL_SCHEMA_VERSION: "schoolforge-pool/v2";
export type { ParsedPool, PoolDifficulty, PoolParseResult, PoolQuestion, PoolQuestionAperta, PoolQuestionChiusaMultipla, PoolQuestionChiusaSingola, PoolValidationError, QuestionOption, } from './types.js';
export { parsePool } from './parser.js';
export { serializePool } from './serializer.js';
export { DEFAULT_MAX_CHARACTERS, MIN_MAX_CHARACTERS, MAX_MAX_CHARACTERS, normalizeMaxCharacters, effectiveMaxCharacters, } from './maxCharacters.js';
/**
 * LESSON-MANUAL-01 / VE-04A — identità degli heading, condivisa fra il
 * renderer web e le Functions. Una sola implementazione: vedi `headingSlug.ts`.
 */
export { assignLessonHeadingSlugs, canonicalLessonHeadingText, lessonHeadingSlug, nextLessonHeadingSlug, type LessonHeadingRef, } from './headingSlug.js';
//# sourceMappingURL=index.d.ts.map