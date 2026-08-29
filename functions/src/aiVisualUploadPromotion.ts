/** MULTI-VISUAL-UPLOAD-01A — contratti puri della promozione upload. */

import { timestampToMillis } from './aiContentCore.js';
import { assertCanonicalStorageRef } from './aiContentVisualProposal.js';
import {
  AiVisualMultiError,
  VISUAL_UPLOAD_PROMOTION_CONTRACT_VERSION,
  VISUAL_UPLOAD_PROMOTION_RECOVERY_CONTRACT_VERSION,
  asRecord,
  assertExactKeys,
  isSha256Hex,
  isUuidV4,
} from './aiVisualMultiCore.js';
import { isCanonicalVisualUploadStagingRef } from './aiVisualUploadCore.js';
import { isValidDocumentIdInput } from './firestoreDocumentId.js';

export type VisualUploadPromotionMode =
  | { mode: 'add' }
  | { mode: 'replace'; replaceAssetId: string };

export interface VisualUploadPromoteInput {
  requestId: string;
  promotionRequestId: string;
  mode: VisualUploadPromotionMode;
}

const INPUT_KEYS = ['requestId', 'promotionRequestId', 'mode'] as const;

function invalid(message: string): never {
  throw new AiVisualMultiError('invalid_input', message);
}

function isCanonicalVisualStorageRef(value: unknown, assetId: string): value is string {
  try {
    return assertCanonicalStorageRef(value, assetId) === value;
  } catch {
    return false;
  }
}

export function validateVisualUploadPromoteInput(value: unknown): VisualUploadPromoteInput {
  const root = asRecord(value, 'Richiesta di promozione upload non valida.');
  assertExactKeys(root, INPUT_KEYS, 'Richiesta di promozione upload');
  if (!isUuidV4(root.requestId)) invalid('requestId non valido.');
  if (!isUuidV4(root.promotionRequestId)) invalid('promotionRequestId non valido.');
  const mode = asRecord(root.mode, 'Modalità di promozione non valida.');
  if (mode.mode === 'add') {
    assertExactKeys(mode, ['mode'], 'Modalità add');
    return {
      requestId: root.requestId,
      promotionRequestId: root.promotionRequestId,
      mode: { mode: 'add' },
    };
  }
  if (mode.mode === 'replace') {
    assertExactKeys(mode, ['mode', 'replaceAssetId'], 'Modalità replace');
    if (!isUuidV4(mode.replaceAssetId)) invalid('replaceAssetId non valido.');
    return {
      requestId: root.requestId,
      promotionRequestId: root.promotionRequestId,
      mode: { mode: 'replace', replaceAssetId: mode.replaceAssetId },
    };
  }
  invalid('Modalità di promozione non valida.');
}

export interface StoredVisualUploadPromotion {
  contractVersion: typeof VISUAL_UPLOAD_PROMOTION_CONTRACT_VERSION;
  ownerUid: string;
  opaqueUploadRunId: string;
  promotionRequestId: string;
  mode: 'add' | 'replace';
  replacedAssetId: string | null;
  assetId: string;
  storageRef: string;
  createdAt: unknown;
}

const PROMOTION_KEYS = [
  'contractVersion',
  'ownerUid',
  'opaqueUploadRunId',
  'promotionRequestId',
  'mode',
  'replacedAssetId',
  'assetId',
  'storageRef',
  'createdAt',
] as const;

export function validateStoredVisualUploadPromotion(value: unknown): StoredVisualUploadPromotion {
  const root = asRecord(value, 'Promozione upload non valida.', 'corrupted_state');
  assertExactKeys(root, PROMOTION_KEYS, 'Promozione upload', 'corrupted_state');
  if (
    root.contractVersion !== VISUAL_UPLOAD_PROMOTION_CONTRACT_VERSION ||
    !isValidDocumentIdInput(root.ownerUid) ||
    !isSha256Hex(root.opaqueUploadRunId) ||
    !isUuidV4(root.promotionRequestId) ||
    !isUuidV4(root.assetId) ||
    !isCanonicalVisualStorageRef(root.storageRef, root.assetId) ||
    root.storageRef.split('/')[1] !== root.ownerUid ||
    timestampToMillis(root.createdAt) === null
  )
    throw new AiVisualMultiError('corrupted_state', 'Identità della promozione upload non valida.');
  if (root.mode === 'add') {
    if (root.replacedAssetId !== null)
      throw new AiVisualMultiError('corrupted_state', 'Promozione add incoerente.');
  } else if (root.mode === 'replace') {
    if (!isUuidV4(root.replacedAssetId))
      throw new AiVisualMultiError('corrupted_state', 'Promozione replace incoerente.');
  } else throw new AiVisualMultiError('corrupted_state', 'Modalità della promozione non valida.');
  return root as unknown as StoredVisualUploadPromotion;
}

export interface StoredVisualUploadPromotionRecovery {
  contractVersion: typeof VISUAL_UPLOAD_PROMOTION_RECOVERY_CONTRACT_VERSION;
  ownerUid: string;
  opaqueUploadRunId: string;
  promotionRequestId: string;
  mode: 'add' | 'replace';
  replacedAssetId: string | null;
  assetId: string;
  storageRef: string;
  stagingRef: string;
  supersededStorageRef: string | null;
  status: 'prepared' | 'committed';
  createdAt: unknown;
  updatedAt: unknown;
  expireAt: unknown;
}

const RECOVERY_KEYS = [
  'contractVersion',
  'ownerUid',
  'opaqueUploadRunId',
  'promotionRequestId',
  'mode',
  'replacedAssetId',
  'assetId',
  'storageRef',
  'stagingRef',
  'supersededStorageRef',
  'status',
  'createdAt',
  'updatedAt',
  'expireAt',
] as const;

export function validateStoredVisualUploadPromotionRecovery(
  value: unknown,
): StoredVisualUploadPromotionRecovery {
  const root = asRecord(value, 'Recovery promozione upload non valido.', 'corrupted_state');
  assertExactKeys(root, RECOVERY_KEYS, 'Recovery promozione upload', 'corrupted_state');
  if (
    root.contractVersion !== VISUAL_UPLOAD_PROMOTION_RECOVERY_CONTRACT_VERSION ||
    !isValidDocumentIdInput(root.ownerUid) ||
    !isSha256Hex(root.opaqueUploadRunId) ||
    !isUuidV4(root.promotionRequestId) ||
    !isUuidV4(root.assetId) ||
    !isCanonicalVisualStorageRef(root.storageRef, root.assetId) ||
    root.storageRef.split('/')[1] !== root.ownerUid ||
    typeof root.stagingRef !== 'string' ||
    !isCanonicalVisualUploadStagingRef(root.stagingRef, root.opaqueUploadRunId) ||
    root.stagingRef.split('/')[1] !== root.ownerUid ||
    !['prepared', 'committed'].includes(root.status as string)
  )
    throw new AiVisualMultiError('corrupted_state', 'Identità del recovery upload non valida.');
  if (root.mode === 'add') {
    if (root.replacedAssetId !== null)
      throw new AiVisualMultiError('corrupted_state', 'Recovery add incoerente.');
  } else if (root.mode === 'replace') {
    if (!isUuidV4(root.replacedAssetId))
      throw new AiVisualMultiError('corrupted_state', 'Recovery replace incoerente.');
  } else throw new AiVisualMultiError('corrupted_state', 'Modalità recovery non valida.');
  if (
    root.supersededStorageRef !== null &&
    (!isUuidV4(root.replacedAssetId) ||
      !isCanonicalVisualStorageRef(root.supersededStorageRef, root.replacedAssetId))
  ) {
    throw new AiVisualMultiError('corrupted_state', 'Path superseded del recovery non valido.');
  }
  if (
    root.supersededStorageRef !== null &&
    root.supersededStorageRef.split('/')[1] !== root.ownerUid
  ) {
    throw new AiVisualMultiError('corrupted_state', 'Owner del path superseded non valido.');
  }
  const created = timestampToMillis(root.createdAt);
  const updated = timestampToMillis(root.updatedAt);
  const expire = timestampToMillis(root.expireAt);
  if (
    created === null ||
    updated === null ||
    expire === null ||
    created > updated ||
    updated > expire
  ) {
    throw new AiVisualMultiError('corrupted_state', 'Timestamp del recovery upload non validi.');
  }
  return root as unknown as StoredVisualUploadPromotionRecovery;
}
