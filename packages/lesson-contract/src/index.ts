export const POOL_SCHEMA_VERSION = 'schoolforge-pool/v2' as const;

export type {
  ParsedPool,
  PoolDifficulty,
  PoolParseResult,
  PoolQuestion,
  PoolQuestionAperta,
  PoolQuestionChiusaMultipla,
  PoolQuestionChiusaSingola,
  PoolValidationError,
  QuestionOption,
} from './types.js';

export { parsePool } from './parser.js';
export { serializePool } from './serializer.js';
export {
  DEFAULT_MAX_CHARACTERS,
  MIN_MAX_CHARACTERS,
  MAX_MAX_CHARACTERS,
  normalizeMaxCharacters,
  effectiveMaxCharacters,
} from './maxCharacters.js';
