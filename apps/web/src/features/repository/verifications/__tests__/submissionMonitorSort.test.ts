import { describe, expect, it } from 'vitest';
import {
  sortSubmissionMonitorRows,
  type SubmissionMonitorRow,
  type SubmissionMonitorSortKey,
} from '../submissionMonitorSort.js';

function row(
  studentUid: string,
  studentName: string,
  overrides: Partial<NonNullable<SubmissionMonitorRow['item']>> = {},
): SubmissionMonitorRow {
  return {
    studentUid,
    studentName,
    stateLabel: overrides.correctionStatus ?? 'Non iniziata',
    item: {
      studentUid,
      status: 'submitted',
      lastSavedAt: null as never,
      submittedAt: null,
      deliveryCode: null,
      correctionStatus: 'submitted',
      correctionSummary: null,
      attentionEventsCount: 0,
      attentionEvents: [],
      ...overrides,
    },
  };
}

const rows: SubmissionMonitorRow[] = [
  row('b', 'Bruno', {
    correctionStatus: 'completed',
    correctionSummary: { totalPoints: 8, maxPoints: 10, percentage: 80 },
    submittedAt: { seconds: 20, nanoseconds: 0 } as never,
    attentionEventsCount: 3,
  }),
  row('a', 'Anna', {
    correctionStatus: 'in_progress',
    correctionSummary: { totalPoints: 4.25, maxPoints: 10, percentage: 43 },
    submittedAt: { seconds: 10, nanoseconds: 0 } as never,
    attentionEventsCount: 1,
  }),
  { studentUid: 'c', studentName: 'Carla', stateLabel: 'Non iniziata', item: null },
];

describe('sortSubmissionMonitorRows', () => {
  it('sorts every supported key in both directions without mutating the source', () => {
    const original = [...rows];
    const expectations: Record<SubmissionMonitorSortKey, [string[], string[]]> = {
      student: [
        ['Anna', 'Bruno', 'Carla'],
        ['Carla', 'Bruno', 'Anna'],
      ],
      status: [
        ['Bruno', 'Anna', 'Carla'],
        ['Carla', 'Anna', 'Bruno'],
      ],
      score: [
        ['Anna', 'Bruno', 'Carla'],
        ['Bruno', 'Anna', 'Carla'],
      ],
      percentage: [
        ['Anna', 'Bruno', 'Carla'],
        ['Bruno', 'Anna', 'Carla'],
      ],
      submittedAt: [
        ['Anna', 'Bruno', 'Carla'],
        ['Bruno', 'Anna', 'Carla'],
      ],
      events: [
        ['Carla', 'Anna', 'Bruno'],
        ['Bruno', 'Anna', 'Carla'],
      ],
    };

    for (const key of Object.keys(expectations) as SubmissionMonitorSortKey[]) {
      expect(
        sortSubmissionMonitorRows(rows, { key, direction: 'asc' }).map((r) => r.studentName),
      ).toEqual(expectations[key][0]);
      expect(
        sortSubmissionMonitorRows(rows, { key, direction: 'desc' }).map((r) => r.studentName),
      ).toEqual(expectations[key][1]);
    }
    expect(rows).toEqual(original);
  });

  it('uses the student name as a deterministic tie-breaker', () => {
    const tied = [row('z', 'Zeno'), row('a', 'Ada')];
    expect(
      sortSubmissionMonitorRows(tied, { key: 'events', direction: 'desc' }).map(
        (r) => r.studentName,
      ),
    ).toEqual(['Ada', 'Zeno']);
  });
});
