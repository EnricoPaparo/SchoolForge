// Outcome classification, kept strictly separate from checkpoint state.
// Quota is recognised only from an explicit signal (roadmap §8): a timeout,
// a crash or a missing network are transient_error, never quota.
//
// Caveat (residual risk, see README "Limiti"): the exact JSON shape and
// wording emitted by `claude -p --output-format json` on a real usage-limit
// response has not yet been observed against the authenticated local install.
// The quota phrase list below
// is intentionally explicit and centralised so it can be corrected from a
// single place once real output is captured, without touching call sites.

const QUOTA_PHRASES = Object.freeze([/usage limit/i, /rate limit/i, /quota exceeded/i]);
const RETRY_AT_PATTERN = /resets?\s+at\s+([0-9T:.\-+Z]{10,})/i;

function extractRetryAt(text) {
  if (typeof text !== 'string') return null;
  const match = RETRY_AT_PATTERN.exec(text);
  if (!match) return null;
  const parsed = new Date(match[1]);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function looksLikeQuotaSignal(parsed, stderrText) {
  const candidates = [];
  if (parsed && typeof parsed.result === 'string') candidates.push(parsed.result);
  if (parsed && typeof parsed.error === 'string') candidates.push(parsed.error);
  if (typeof stderrText === 'string') candidates.push(stderrText);
  return candidates.some((text) => QUOTA_PHRASES.some((phrase) => phrase.test(text)));
}

const MAX_TURNS_PHRASE = /reached maximum number of turns/i;

// Running out of the --max-turns budget is a resumable stop, not an
// application-level failure: the same task can continue on `resume` with a
// fresh turn budget. Recognised only from an explicit, structured signal
// (subtype/terminal_reason) or the documented phrase — never inferred from
// a bare non-zero exit code.
function looksLikeMaxTurnsSignal(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  if (parsed.subtype === 'error_max_turns') return true;
  if (parsed.terminal_reason === 'max_turns') return true;
  const texts = [];
  if (typeof parsed.result === 'string') texts.push(parsed.result);
  if (Array.isArray(parsed.errors)) {
    for (const entry of parsed.errors) {
      if (typeof entry === 'string') texts.push(entry);
    }
  }
  return texts.some((text) => MAX_TURNS_PHRASE.test(text));
}

/**
 * @param {object} input
 * @param {number|null} input.exitCode
 * @param {string|null} input.signal
 * @param {boolean} input.timedOut
 * @param {boolean} input.interrupted
 * @param {Error|null} input.spawnError
 * @param {string} input.stdout
 * @param {string} input.stderr
 * @returns {{ outcome: string, reason: string, retryAt: string|null, isError: boolean }}
 */
export function classifyOutcome(input) {
  const { exitCode, signal, timedOut, interrupted, spawnError, stdout, stderr } = input;

  if (interrupted) {
    return { outcome: 'interrupted', reason: 'signal_received', retryAt: null, isError: false };
  }

  if (timedOut) {
    return { outcome: 'transient_error', reason: 'timeout', retryAt: null, isError: true };
  }

  if (spawnError) {
    return { outcome: 'transient_error', reason: 'spawn_error', retryAt: null, isError: true };
  }

  // The child died from a signal we did not send ourselves (not our timeout
  // or interrupt kill): treat as a crash, i.e. transient_error, never quota.
  if (signal) {
    return { outcome: 'transient_error', reason: 'crash', retryAt: null, isError: true };
  }

  let parsed = null;
  let parseError = false;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parseError = true;
  }

  if (parseError) {
    return {
      outcome: 'permanent_error',
      reason: 'invalid_output_json',
      retryAt: null,
      isError: true,
    };
  }

  const isError = exitCode !== 0 || parsed?.is_error === true;

  if (isError && looksLikeMaxTurnsSignal(parsed)) {
    return { outcome: 'interrupted', reason: 'max_turns_reached', retryAt: null, isError: true };
  }

  if (isError && looksLikeQuotaSignal(parsed, stderr)) {
    const retryAt =
      extractRetryAt(typeof parsed?.result === 'string' ? parsed.result : null) ??
      extractRetryAt(stderr);
    return { outcome: 'explicit_quota', reason: 'usage_limit_signal', retryAt, isError: true };
  }

  if (isError) {
    return {
      outcome: 'permanent_error',
      reason: 'claude_reported_error',
      retryAt: null,
      isError: true,
    };
  }

  return { outcome: 'success', reason: 'ok', retryAt: null, isError: false };
}
