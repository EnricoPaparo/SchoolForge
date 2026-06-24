export const POOL_SCHEMA_VERSION = 'schoolforge-pool/v1' as const;

export type {
  ParsedPool,
  PoolParseResult,
  PoolQuestion,
  PoolQuestionAperta,
  PoolQuestionChiusaMultipla,
  PoolQuestionChiusaSingola,
  PoolValidationError,
  QuestionOption,
} from './types.js';

export { parsePool } from './parser.js';
