import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface FieldOverride {
  collectionGroup?: string;
  fieldPath?: string;
  ttl?: boolean;
  indexes?: Array<{ order?: string; queryScope?: string }>;
}

const indexesPath = resolve(process.cwd(), '../../firestore.indexes.json');
const config = JSON.parse(readFileSync(indexesPath, 'utf8')) as {
  fieldOverrides?: FieldOverride[];
};

describe('firestore.indexes.json', () => {
  it('declares the collection-group index required by program notes cleanup', () => {
    const override = config.fieldOverrides?.find(
      (item) => item.collectionGroup === 'lessonNoteIndexes' && item.fieldPath === 'programId',
    );

    expect(override?.indexes).toContainEqual({
      order: 'ASCENDING',
      queryScope: 'COLLECTION_GROUP',
    });
  });

  it('keeps the aiCorrectionRuns TTL policy in source control', () => {
    const override = config.fieldOverrides?.find(
      (item) => item.collectionGroup === 'aiCorrectionRuns' && item.fieldPath === 'expireAt',
    );

    expect(override?.ttl).toBe(true);
  });
});
