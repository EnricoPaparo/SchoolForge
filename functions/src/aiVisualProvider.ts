import OpenAI from 'openai';
import sharp from 'sharp';
import {
  AI_VISUAL_BACKGROUND,
  AI_VISUAL_MODEL,
  AI_VISUAL_N,
  AI_VISUAL_OUTPUT_FORMAT,
  AI_VISUAL_QUALITY,
  AI_VISUAL_SIZE,
  buildSchoolForgeSketchPrompt,
  decodeStrictBase64,
} from './aiVisualCore.js';
import {
  ATTEMPT_HARD_ABORT_MARGIN_MS,
  DEFAULT_OPENAI_RETRY_POLICY,
  abortableSleep,
  normalizeTransportError,
} from './openAiGrader.js';
import { decideRetry, type RetryPolicy } from './openAiRetryPolicy.js';

export interface ImageProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ImageApiRequest {
  model: typeof AI_VISUAL_MODEL;
  prompt: string;
  n: typeof AI_VISUAL_N;
  size: typeof AI_VISUAL_SIZE;
  quality: typeof AI_VISUAL_QUALITY;
  output_format: typeof AI_VISUAL_OUTPUT_FORMAT;
  background: typeof AI_VISUAL_BACKGROUND;
}

export interface ImageApiResponse {
  data: ReadonlyArray<{ b64_json?: unknown }> | undefined;
  usage?: { input_tokens?: unknown; output_tokens?: unknown } | undefined;
}

export interface ImageApiTransport {
  generate(
    request: ImageApiRequest,
    options: { timeoutMs: number; signal: AbortSignal },
  ): Promise<ImageApiResponse>;
}

export type ImageProviderOutcome =
  | {
      status: 'success';
      bytes: Buffer;
      usage: ImageProviderUsage | null;
      priorBillingRisk: boolean;
      metered: boolean;
    }
  | {
      status: 'billed_unusable';
      usage: ImageProviderUsage | null;
      priorBillingRisk: boolean;
    }
  | { status: 'pre_invocation' }
  | { status: 'invocation_unknown' };

export interface ImageProvider {
  generate(subject: string): Promise<ImageProviderOutcome>;
}

export interface ImageProviderDeps {
  policy?: RetryPolicy;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

function normalizeUsage(value: ImageApiResponse['usage']): ImageProviderUsage | null {
  if (
    !value ||
    !Number.isInteger(value.input_tokens) ||
    (value.input_tokens as number) < 0 ||
    !Number.isInteger(value.output_tokens) ||
    (value.output_tokens as number) < 0
  ) {
    return null;
  }
  return {
    inputTokens: value.input_tokens as number,
    outputTokens: value.output_tokens as number,
  };
}

export function buildImageApiRequest(subject: string): ImageApiRequest {
  return {
    model: AI_VISUAL_MODEL,
    prompt: buildSchoolForgeSketchPrompt(subject),
    n: AI_VISUAL_N,
    size: AI_VISUAL_SIZE,
    quality: AI_VISUAL_QUALITY,
    output_format: AI_VISUAL_OUTPUT_FORMAT,
    background: AI_VISUAL_BACKGROUND,
  };
}

export function createImageProvider(
  transport: ImageApiTransport,
  deps: ImageProviderDeps = {},
): ImageProvider {
  const policy = deps.policy ?? DEFAULT_OPENAI_RETRY_POLICY;
  const sleep = deps.sleep ?? abortableSleep;
  const random = deps.random ?? Math.random;

  return {
    async generate(subject): Promise<ImageProviderOutcome> {
      let priorBillingRisk = false;
      for (let attemptIndex = 0; ; attemptIndex += 1) {
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          policy.attemptTimeoutMs + ATTEMPT_HARD_ABORT_MARGIN_MS,
        );
        try {
          const response = await transport.generate(buildImageApiRequest(subject), {
            timeoutMs: policy.attemptTimeoutMs,
            signal: controller.signal,
          });
          const usage = normalizeUsage(response.usage);
          if (!Array.isArray(response.data) || response.data.length !== 1) {
            return { status: 'billed_unusable', usage, priorBillingRisk };
          }
          try {
            const bytes = decodeStrictBase64(response.data[0]?.b64_json);
            return { status: 'success', bytes, usage, priorBillingRisk, metered: true };
          } catch {
            return { status: 'billed_unusable', usage, priorBillingRisk };
          }
        } catch (error) {
          const classified = normalizeTransportError(error);
          if (classified.billingRisk) priorBillingRisk = true;
          const decision = decideRetry({
            error: classified,
            attemptIndex,
            policy,
            remainingMs: Number.POSITIVE_INFINITY,
            random,
          });
          if (!decision.retry) {
            return priorBillingRisk
              ? { status: 'invocation_unknown' }
              : { status: 'pre_invocation' };
          }
          try {
            await sleep(decision.delayMs);
          } catch {
            return priorBillingRisk
              ? { status: 'invocation_unknown' }
              : { status: 'pre_invocation' };
          }
        } finally {
          clearTimeout(timer);
        }
      }
    },
  };
}

export function createOpenAiImageTransport(apiKey: string): ImageApiTransport {
  const client = new OpenAI({ apiKey, maxRetries: 0 });
  return {
    async generate(request, options) {
      const response = await client.images.generate(request, {
        timeout: options.timeoutMs,
        maxRetries: 0,
        signal: options.signal,
      });
      return { data: response.data, usage: response.usage };
    },
  };
}

/** Mock runtime deterministico: nessuna rete, nessun secret, costo sempre zero. */
export function createDeterministicMockImageProvider(): ImageProvider {
  let fixture: Promise<Buffer> | null = null;
  return {
    async generate() {
      fixture ??= sharp({
        create: {
          width: 96,
          height: 96,
          channels: 3,
          background: { r: 242, g: 249, b: 250 },
        },
      })
        .composite([
          {
            input: Buffer.from(
              '<svg width="96" height="96"><path d="M16 67 Q48 18 80 67" fill="none" stroke="#169FB2" stroke-width="5"/><circle cx="48" cy="48" r="7" fill="#F28C28"/></svg>',
            ),
          },
        ])
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
      return {
        status: 'success',
        bytes: await fixture,
        usage: null,
        priorBillingRisk: false,
        metered: false,
      };
    },
  };
}
