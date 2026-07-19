import { z } from 'zod';
import { DEFAULT_MAX_CHARACTERS, MAX_MAX_CHARACTERS } from './maxCharacters.js';

const Difficolta = z
  .number()
  .int('difficolta deve essere un numero intero')
  .min(1, 'difficolta deve essere compresa tra 1 e 5')
  .max(5, 'difficolta deve essere compresa tra 1 e 5');

const QuestionOptionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, 'option id must match [a-z0-9-]+'),
    testo: z.string().min(1, 'testo must not be empty'),
  })
  .strict();

const QuestionBaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'id must match [a-z0-9-]+'),
  difficolta: Difficolta,
  testo: z.string().min(1, 'testo must not be empty'),
});

const ApertaSchema = QuestionBaseSchema.extend({
  tipo: z.literal('aperta'),
  soluzione: z.string().min(1, 'soluzione must not be empty'),
  // Optional in V2 Markdown; always effective in parsed output.
  maxCharacters: z
    .number()
    .int('maxCharacters must be an integer')
    .min(1, 'maxCharacters must be at least 1')
    .max(MAX_MAX_CHARACTERS, `maxCharacters must be at most ${MAX_MAX_CHARACTERS}`)
    .default(DEFAULT_MAX_CHARACTERS),
}).strict();

const ChiusaSingolaSchema = QuestionBaseSchema.extend({
  tipo: z.literal('chiusa_singola'),
  opzioni: z
    .array(QuestionOptionSchema)
    .min(2, 'opzioni must have at least 2 items')
    .refine((opts) => new Set(opts.map((o) => o.id)).size === opts.length, {
      message: 'opzioni ids must be unique',
    }),
  soluzione: z.array(z.string()).length(1, 'chiusa_singola soluzione must have exactly 1 item'),
}).strict();

const ChiusaMultiplaSchema = QuestionBaseSchema.extend({
  tipo: z.literal('chiusa_multipla'),
  opzioni: z
    .array(QuestionOptionSchema)
    .min(2, 'opzioni must have at least 2 items')
    .refine((opts) => new Set(opts.map((o) => o.id)).size === opts.length, {
      message: 'opzioni ids must be unique',
    }),
  soluzione: z.array(z.string()).min(1, 'soluzione must have at least 1 item'),
}).strict();

export const QuestionSchema = z.discriminatedUnion('tipo', [
  ApertaSchema,
  ChiusaSingolaSchema,
  ChiusaMultiplaSchema,
]);

export const PoolFrontMatterSchema = z
  .object({
    schema: z.literal('schoolforge-pool/v2'),
    questions: z.array(QuestionSchema),
  })
  .strict();
