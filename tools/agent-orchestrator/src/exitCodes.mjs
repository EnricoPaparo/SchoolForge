// Documented, closed exit code matrix shared by the CLI and its tests.

export const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  USAGE_ERROR: 1,
  EXPLICIT_QUOTA: 2,
  TRANSIENT_ERROR: 3,
  PERMANENT_ERROR: 4,
  INTERRUPTED: 5,
  NEEDS_NEW_SESSION: 6,
  PREFLIGHT_FAILED: 7,
  CHECKPOINT_INVALID: 8,
  CHECKPOINT_NOT_FOUND: 9,
});

export const OUTCOME_EXIT_CODES = Object.freeze({
  success: EXIT_CODES.SUCCESS,
  explicit_quota: EXIT_CODES.EXPLICIT_QUOTA,
  transient_error: EXIT_CODES.TRANSIENT_ERROR,
  permanent_error: EXIT_CODES.PERMANENT_ERROR,
  interrupted: EXIT_CODES.INTERRUPTED,
});
