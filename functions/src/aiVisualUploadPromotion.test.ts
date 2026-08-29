import { Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  validateStoredVisualUploadPromotion,
  validateStoredVisualUploadPromotionRecovery,
  validateVisualUploadPromoteInput,
} from './aiVisualUploadPromotion.js';
import {
  VISUAL_UPLOAD_PROMOTION_CONTRACT_VERSION,
  VISUAL_UPLOAD_PROMOTION_RECOVERY_CONTRACT_VERSION,
} from './aiVisualMultiCore.js';

const REQUEST = '123e4567-e89b-42d3-a456-426614174000';
const PROMOTION = '123e4567-e89b-42d3-b456-426614174001';
const ASSET = '123e4567-e89b-42d3-8456-426614174002';
const RUN = 'a'.repeat(64);
const STORAGE = `repository/owner/import/uda/visuals/${ASSET}.webp`;

describe('visual upload promotion closed contracts', () => {
  it('mantiene run, promozione e recovery server-only nelle Rules', () => {
    const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
    for (const collection of [
      'visualUploadRuns',
      'visualUploadPromotions',
      'visualUploadPromotionRecoveries',
    ]) {
      expect(rules).toMatch(
        new RegExp(
          `match /${collection}/\\{document=\\*\\*\\} \\{\\s*allow read, write: if false;`,
        ),
      );
    }
  });

  it('accetta esclusivamente add o replace chiusi', () => {
    expect(
      validateVisualUploadPromoteInput({
        requestId: REQUEST,
        promotionRequestId: PROMOTION,
        mode: { mode: 'add' },
      }),
    ).toEqual({ requestId: REQUEST, promotionRequestId: PROMOTION, mode: { mode: 'add' } });
    expect(() =>
      validateVisualUploadPromoteInput({
        requestId: REQUEST,
        promotionRequestId: PROMOTION,
        mode: { mode: 'add', replaceAssetId: ASSET },
      }),
    ).toThrow(/chiavi non ammesse/);
    expect(() =>
      validateVisualUploadPromoteInput({
        requestId: REQUEST,
        promotionRequestId: PROMOTION,
        mode: { mode: 'replace' },
      }),
    ).toThrow();
  });

  it('valida fail-closed registro e recovery, inclusa appartenenza staging', () => {
    const now = Timestamp.fromMillis(1_000);
    expect(
      validateStoredVisualUploadPromotion({
        contractVersion: VISUAL_UPLOAD_PROMOTION_CONTRACT_VERSION,
        ownerUid: 'owner',
        opaqueUploadRunId: RUN,
        promotionRequestId: PROMOTION,
        mode: 'add',
        replacedAssetId: null,
        assetId: ASSET,
        storageRef: STORAGE,
        createdAt: now,
      }).assetId,
    ).toBe(ASSET);
    const recovery = {
      contractVersion: VISUAL_UPLOAD_PROMOTION_RECOVERY_CONTRACT_VERSION,
      ownerUid: 'owner',
      opaqueUploadRunId: RUN,
      promotionRequestId: PROMOTION,
      mode: 'add',
      replacedAssetId: null,
      assetId: ASSET,
      storageRef: STORAGE,
      stagingRef: `staging/owner/${RUN}.webp`,
      supersededStorageRef: null,
      status: 'prepared',
      createdAt: now,
      updatedAt: now,
      expireAt: Timestamp.fromMillis(2_000),
    };
    expect(validateStoredVisualUploadPromotionRecovery(recovery).status).toBe('prepared');
    expect(() =>
      validateStoredVisualUploadPromotionRecovery({
        ...recovery,
        stagingRef: `staging/other/${RUN}.webp`,
      }),
    ).toThrow(/recovery upload non valida/i);
    expect(() => validateStoredVisualUploadPromotionRecovery({ ...recovery, extra: true })).toThrow(
      /chiavi non ammesse/,
    );
    expect(() =>
      validateStoredVisualUploadPromotionRecovery({
        ...recovery,
        storageRef: `repository/other/import/uda/visuals/${ASSET}.webp`,
      }),
    ).toThrow(/identità del recovery/i);
    expect(() =>
      validateStoredVisualUploadPromotion({
        contractVersion: VISUAL_UPLOAD_PROMOTION_CONTRACT_VERSION,
        ownerUid: 'owner',
        opaqueUploadRunId: RUN,
        promotionRequestId: PROMOTION,
        mode: 'add',
        replacedAssetId: null,
        assetId: ASSET,
        storageRef: `repository/other/import/uda/visuals/${ASSET}.webp`,
        createdAt: now,
      }),
    ).toThrow(/identità della promozione/i);
  });
});
