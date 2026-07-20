import { describe, expect, it } from 'vitest';
import {
  canDeleteRepositoryTarget,
  findRepositoryDeleteBlockers,
  type VerificationForRepositoryGuard,
} from '../repositoryEditorGuards.js';

function verification(
  id: string,
  overrides: Partial<VerificationForRepositoryGuard['config']> = {},
): VerificationForRepositoryGuard {
  return {
    id,
    status: 'draft',
    config: {
      title: `Verifica ${id}`,
      classId: null,
      programId: 'program-a',
      importId: 'import-a',
      questionRefs: [
        {
          questionIndexEntryId: `${id}-q1`,
          questionLocalId: 'q1',
          udaDir: 'uda-01-reti',
          lessonFilename: 'lezione-001-http.md',
          poolStorageRef: 'repository/owner/imports/import-a/uda-01-reti/lezione-001-http.pool.md',
          tipo: 'aperta',
          difficolta: 1,
          maxPoints: 1,
        },
      ],
      ...overrides,
    },
  };
}

describe('findRepositoryDeleteBlockers', () => {
  it('blocks UDA deletion when a verification references any lesson in that UDA', () => {
    const blockers = findRepositoryDeleteBlockers(
      { kind: 'uda', programId: 'program-a', importId: 'import-a', udaDir: 'uda-01-reti' },
      [verification('v1')],
    );

    expect(blockers).toEqual([{ verificationId: 'v1', title: 'Verifica v1', status: 'draft' }]);
  });

  it('blocks lesson deletion only for the exact UDA + lesson filename', () => {
    const blockers = findRepositoryDeleteBlockers(
      {
        kind: 'lesson',
        programId: 'program-a',
        importId: 'import-a',
        udaDir: 'uda-01-reti',
        lessonFilename: 'lezione-001-http.md',
      },
      [verification('v1')],
    );

    expect(blockers).toHaveLength(1);
  });

  it('does not block when program/import or lesson do not match', () => {
    const verifications = [
      verification('other-program', { programId: 'program-b' }),
      verification('other-import', { importId: 'import-b' }),
      verification('other-lesson', {
        questionRefs: [
          {
            ...verification('base').config.questionRefs[0],
            lessonFilename: 'lezione-002-dns.md',
          },
        ],
      }),
    ];

    expect(
      canDeleteRepositoryTarget(
        {
          kind: 'lesson',
          programId: 'program-a',
          importId: 'import-a',
          udaDir: 'uda-01-reti',
          lessonFilename: 'lezione-001-http.md',
        },
        verifications,
      ),
    ).toBe(true);
  });

  it('blocks draft, active and closed verifications alike', () => {
    const blockers = findRepositoryDeleteBlockers(
      { kind: 'uda', programId: 'program-a', importId: 'import-a', udaDir: 'uda-01-reti' },
      [
        { ...verification('draft'), status: 'draft' },
        { ...verification('active'), status: 'active' },
        { ...verification('closed'), status: 'closed' },
      ],
    );

    expect(blockers.map((b) => b.status)).toEqual(['draft', 'active', 'closed']);
  });
});
