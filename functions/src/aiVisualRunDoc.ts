import { Timestamp } from 'firebase-admin/firestore';
import { MAX_VISUAL_BYTES, VISUAL_STYLE_VERSION } from './aiContentVisualProposal.js';
import { AI_CONTENT_RUN_TTL_MS, timestampToMillis } from './aiContentCore.js';
import {
  AI_VISUAL_CONTRACT_VERSION,
  AI_VISUAL_SERVER_CONFIG,
  AiVisualError,
  decodeVisualDataUri,
  inspectWebp,
  isCanonicalVisualStagingRef,
  sha256Hex,
} from './aiVisualCore.js';

export { AI_CONTENT_RUN_TTL_MS };

export type AiVisualRunStatus = 'reserved' | 'pending' | 'completed' | 'failed';

export interface StoredAiVisualImage {
  dataUri: string;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  mimeType: 'image/webp';
  styleVersion: typeof VISUAL_STYLE_VERSION;
  webpQuality: number;
  normalizationAttempts: number;
}

export interface StoredAiVisualBudget {
  monthKey: string;
  reservationKey: string;
  estimatedInputTokens: number;
  reservedInputTokens: number;
  expectedOutputTokens: number;
  estimatedCostMicroUsd: number;
  reservedCostMicroUsd: number;
  actualInputTokens: number | null;
  actualOutputTokens: number | null;
  actualCostMicroUsd: number | null;
  settledCostMicroUsd: number | null;
}

export interface StoredAiVisualRun {
  contractVersion: typeof AI_VISUAL_CONTRACT_VERSION;
  status: AiVisualRunStatus;
  inputHash: string;
  config: typeof AI_VISUAL_SERVER_CONFIG;
  leaseExecutionId: string;
  leaseExpiresAtMs: number;
  budget: StoredAiVisualBudget;
  image: StoredAiVisualImage | null;
  stagingRef: string;
  createdAtMs: number;
  updatedAtMs: number;
  expireAtMs: number;
}

const TOP_KEYS = [
  'budget',
  'config',
  'contractVersion',
  'createdAt',
  'expireAt',
  'image',
  'inputHash',
  'leaseExecutionId',
  'leaseExpiresAt',
  'stagingRef',
  'status',
  'updatedAt',
] as const;
const BUDGET_KEYS = [
  'actualCostMicroUsd',
  'actualInputTokens',
  'actualOutputTokens',
  'estimatedCostMicroUsd',
  'estimatedInputTokens',
  'expectedOutputTokens',
  'monthKey',
  'reservationKey',
  'reservedCostMicroUsd',
  'reservedInputTokens',
  'settledCostMicroUsd',
] as const;
const IMAGE_KEYS = [
  'byteLength',
  'dataUri',
  'height',
  'mimeType',
  'normalizationAttempts',
  'sha256',
  'styleVersion',
  'webpQuality',
  'width',
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}

export function hasExactRecursiveValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, index) => hasExactRecursiveValue(actual[index], value))
    );
  }
  if (isObject(expected)) {
    if (!isObject(actual)) return false;
    const expectedKeys = Object.keys(expected);
    return (
      hasExactKeys(actual, expectedKeys) &&
      expectedKeys.every((key) => hasExactRecursiveValue(actual[key], expected[key]))
    );
  }
  return typeof actual === typeof expected && Object.is(actual, expected);
}

export function isExactAiVisualServerConfig(
  value: unknown,
): value is typeof AI_VISUAL_SERVER_CONFIG {
  return hasExactRecursiveValue(value, AI_VISUAL_SERVER_CONFIG);
}
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value);
}

function parseBudget(value: unknown): StoredAiVisualBudget | null {
  if (!isObject(value) || !hasExactKeys(value, BUDGET_KEYS)) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value.monthKey))) return null;
  if (typeof value.reservationKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.reservationKey)) {
    return null;
  }
  for (const key of [
    'estimatedInputTokens',
    'reservedInputTokens',
    'expectedOutputTokens',
    'estimatedCostMicroUsd',
    'reservedCostMicroUsd',
  ] as const) {
    if (!isNonNegativeInteger(value[key])) return null;
  }
  for (const key of [
    'actualInputTokens',
    'actualOutputTokens',
    'actualCostMicroUsd',
    'settledCostMicroUsd',
  ] as const) {
    if (!isNullableNonNegativeInteger(value[key])) return null;
  }
  if (
    value.settledCostMicroUsd !== null &&
    (value.settledCostMicroUsd as number) > (value.reservedCostMicroUsd as number)
  ) {
    return null;
  }
  return value as unknown as StoredAiVisualBudget;
}

function parseImage(value: unknown): StoredAiVisualImage | null {
  if (!isObject(value) || !hasExactKeys(value, IMAGE_KEYS)) return null;
  if (
    value.mimeType !== 'image/webp' ||
    value.styleVersion !== VISUAL_STYLE_VERSION ||
    !isNonNegativeInteger(value.width) ||
    value.width === 0 ||
    !isNonNegativeInteger(value.height) ||
    value.height === 0 ||
    !isNonNegativeInteger(value.byteLength) ||
    value.byteLength === 0 ||
    value.byteLength > MAX_VISUAL_BYTES ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !isNonNegativeInteger(value.webpQuality) ||
    value.webpQuality < 1 ||
    value.webpQuality > 100 ||
    !isNonNegativeInteger(value.normalizationAttempts) ||
    value.normalizationAttempts < 1
  ) {
    return null;
  }
  try {
    const bytes = decodeVisualDataUri(value.dataUri);
    const inspection = inspectWebp(bytes);
    if (
      bytes.length !== value.byteLength ||
      sha256Hex(bytes) !== value.sha256 ||
      inspection.width !== value.width ||
      inspection.height !== value.height ||
      inspection.width > AI_VISUAL_SERVER_CONFIG.maxLongEdge ||
      inspection.height > AI_VISUAL_SERVER_CONFIG.maxLongEdge ||
      inspection.animated ||
      inspection.hasMetadata
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return value as unknown as StoredAiVisualImage;
}

export function serializeVisualRun(run: StoredAiVisualRun): Record<string, unknown> {
  return {
    contractVersion: run.contractVersion,
    status: run.status,
    inputHash: run.inputHash,
    config: run.config,
    leaseExecutionId: run.leaseExecutionId,
    leaseExpiresAt: Timestamp.fromMillis(run.leaseExpiresAtMs),
    budget: run.budget,
    image: run.image,
    stagingRef: run.stagingRef,
    createdAt: Timestamp.fromMillis(run.createdAtMs),
    updatedAt: Timestamp.fromMillis(run.updatedAtMs),
    expireAt: Timestamp.fromMillis(run.expireAtMs),
  };
}

export function parseVisualRunDocument(
  data: unknown,
  opaqueRunId: string,
): StoredAiVisualRun | null {
  if (!isObject(data) || !hasExactKeys(data, TOP_KEYS)) return null;
  if (data.contractVersion !== AI_VISUAL_CONTRACT_VERSION) return null;
  if (!['reserved', 'pending', 'completed', 'failed'].includes(String(data.status))) return null;
  if (typeof data.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.inputHash)) return null;
  if (!isExactAiVisualServerConfig(data.config)) return null;
  if (typeof data.leaseExecutionId !== 'string' || data.leaseExecutionId.length === 0) return null;
  if (!isCanonicalVisualStagingRef(data.stagingRef, opaqueRunId)) return null;

  const leaseExpiresAtMs = timestampToMillis(data.leaseExpiresAt);
  const createdAtMs = timestampToMillis(data.createdAt);
  const updatedAtMs = timestampToMillis(data.updatedAt);
  const expireAtMs = timestampToMillis(data.expireAt);
  const budget = parseBudget(data.budget);
  if (
    leaseExpiresAtMs === null ||
    createdAtMs === null ||
    updatedAtMs === null ||
    expireAtMs === null ||
    expireAtMs !== createdAtMs + AI_CONTENT_RUN_TTL_MS ||
    !budget
  ) {
    return null;
  }

  const status = data.status as AiVisualRunStatus;
  const image = data.image === null ? null : parseImage(data.image);
  if ((status === 'completed') !== (image !== null)) return null;
  if (status === 'completed' && budget.settledCostMicroUsd === null) return null;
  if (status === 'failed' && budget.settledCostMicroUsd === null) return null;
  if ((status === 'reserved' || status === 'pending') && budget.settledCostMicroUsd !== null) {
    return null;
  }
  return {
    contractVersion: AI_VISUAL_CONTRACT_VERSION,
    status,
    inputHash: data.inputHash,
    config: AI_VISUAL_SERVER_CONFIG,
    leaseExecutionId: data.leaseExecutionId,
    leaseExpiresAtMs,
    budget,
    image,
    stagingRef: data.stagingRef,
    createdAtMs,
    updatedAtMs,
    expireAtMs,
  };
}

export function assertReplayableVisualRun(
  data: unknown,
  opaqueRunId: string,
): StoredAiVisualRun & { status: 'completed'; image: StoredAiVisualImage } {
  const run = parseVisualRunDocument(data, opaqueRunId);
  if (!run || run.status !== 'completed' || !run.image) {
    throw new AiVisualError('corrupted_state', 'Il run visuale non è riproducibile.');
  }
  return run as StoredAiVisualRun & { status: 'completed'; image: StoredAiVisualImage };
}
