import type { SubmissionMonitorItem } from './submissionsMonitorService.js';

export type SubmissionMonitorSortKey =
  | 'student'
  | 'status'
  | 'score'
  | 'percentage'
  | 'submittedAt'
  | 'events';

export type SubmissionMonitorSortDirection = 'asc' | 'desc';

export type SubmissionMonitorSortConfig = {
  key: SubmissionMonitorSortKey;
  direction: SubmissionMonitorSortDirection;
};

export type SubmissionMonitorRow = {
  studentUid: string;
  studentName: string;
  stateLabel: string;
  item: SubmissionMonitorItem | null;
};

function timestampSeconds(value: unknown): number | null {
  if (!value || typeof value !== 'object' || !('seconds' in value)) return null;
  const seconds = (value as { seconds?: unknown }).seconds;
  return typeof seconds === 'number' ? seconds : null;
}

function valueFor(
  row: SubmissionMonitorRow,
  key: SubmissionMonitorSortKey,
): string | number | null {
  switch (key) {
    case 'student':
      return row.studentName;
    case 'status':
      return row.stateLabel;
    case 'score':
      return row.item?.correctionSummary?.totalPoints ?? null;
    case 'percentage':
      return row.item?.correctionSummary?.percentage ?? null;
    case 'submittedAt':
      return timestampSeconds(row.item?.submittedAt);
    case 'events':
      return row.item?.attentionEventsCount ?? 0;
  }
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'it', { sensitivity: 'base', numeric: true });
}

/** Pure, stable client-side ordering. Missing values always remain at the end. */
export function sortSubmissionMonitorRows(
  rows: SubmissionMonitorRow[],
  config: SubmissionMonitorSortConfig,
): SubmissionMonitorRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const a = valueFor(left.row, config.key);
      const b = valueFor(right.row, config.key);
      if (a == null && b == null) {
        return (
          left.row.studentName.localeCompare(right.row.studentName, 'it', {
            sensitivity: 'base',
          }) || left.index - right.index
        );
      }
      if (a == null) return 1;
      if (b == null) return -1;
      const primary = compareValues(a, b) * (config.direction === 'asc' ? 1 : -1);
      return (
        primary ||
        left.row.studentName.localeCompare(right.row.studentName, 'it', { sensitivity: 'base' }) ||
        left.index - right.index
      );
    })
    .map(({ row }) => row);
}
