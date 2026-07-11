import type { Timestamp, FieldValue } from 'firebase/firestore';

export type ExamModeScope = 'all' | 'classes';

/**
 * Stored at settings/studentAccess.examMode (M3F-07). Absent or malformed on
 * documents written before M3F-07 — always read through `normalizeExamMode`,
 * which treats anything incomplete as "disabled" (the safe default: fail
 * open on the teacher's toggle would leak lessons, fail closed just hides
 * a feature).
 */
export type ExamModeSettings = {
  enabled: boolean;
  scope: ExamModeScope;
  classIds: string[];
  enabledAt: Timestamp | FieldValue | null;
};

export const SAFE_DEFAULT_EXAM_MODE: ExamModeSettings = {
  enabled: false,
  scope: 'all',
  classIds: [],
  enabledAt: null,
};

/**
 * Normalizes a raw `examMode` field (or the entire missing/malformed value)
 * into a well-formed `ExamModeSettings`. Fail-safe by construction — every
 * shape other than a fully valid one collapses to "disabled":
 *   - missing/non-object/`enabled !== true` → disabled;
 *   - `scope === 'classes'` with no valid (non-empty string) class ids →
 *     disabled, never "applies to no class in particular";
 *   - any `scope` other than `'all'`/`'classes'` → disabled.
 */
export function normalizeExamMode(value: unknown): ExamModeSettings {
  if (!value || typeof value !== 'object') return SAFE_DEFAULT_EXAM_MODE;
  const v = value as Partial<ExamModeSettings>;
  if (v.enabled !== true) return SAFE_DEFAULT_EXAM_MODE;

  if (v.scope === 'all') {
    return { enabled: true, scope: 'all', classIds: [], enabledAt: v.enabledAt ?? null };
  }

  if (v.scope === 'classes') {
    const classIds = Array.isArray(v.classIds)
      ? v.classIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
    if (classIds.length === 0) return SAFE_DEFAULT_EXAM_MODE;
    return { enabled: true, scope: 'classes', classIds, enabledAt: v.enabledAt ?? null };
  }

  return SAFE_DEFAULT_EXAM_MODE;
}

/**
 * True when Modalità verifica currently applies to `classId` — the single
 * source of truth used by both the student UI (hide Lezioni) and the
 * teacher UI (status label). Accepts a raw/possibly-malformed value so
 * callers never need to normalize separately.
 */
export function isExamModeActiveForClass(examMode: unknown, classId: string | null): boolean {
  const settings = normalizeExamMode(examMode);
  if (!settings.enabled) return false;
  if (settings.scope === 'all') return true;
  return classId != null && settings.classIds.includes(classId);
}
