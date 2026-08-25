// Preflight gate: only claude.ai subscription auth (pro/max/team/enterprise)
// is admitted. Console/API auth is rejected, and the mere presence of
// ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN blocks the run before any
// process is spawned, so a subscription session can never silently fall
// back to paid API credits. Never returns email, orgId, tokens or any raw
// credential field, even if `claude auth status` includes them.

import { resolveClaudeBinary } from './resolveBinary.mjs';
import { runProcess } from './processRunner.mjs';

const ELIGIBLE_SUBSCRIPTIONS = Object.freeze(['pro', 'max', 'team', 'enterprise']);
const API_ENV_VARS = Object.freeze(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']);

export async function runPreflight(ports, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000;

  const presentApiVars = API_ENV_VARS.filter(
    (name) => typeof ports.env[name] === 'string' && ports.env[name].length > 0,
  );
  if (presentApiVars.length > 0) {
    return {
      ok: false,
      reason: 'api_credentials_present',
      detail: `env vars present: ${presentApiVars.join(', ')}`,
    };
  }

  let claudeBin;
  try {
    claudeBin = await resolveClaudeBinary(ports, options.claudeBinOverride ?? null);
  } catch {
    return { ok: false, reason: 'binary_not_found' };
  }

  const result = await runProcess(ports, {
    command: claudeBin,
    // Claude Code 2.1.231 already emits JSON for `auth status` and rejects
    // the global `--output-format` flag when it follows this subcommand.
    args: ['auth', 'status'],
    input: null,
    timeoutMs,
    maxBufferBytes: 64 * 1024,
    interruptSignal: null,
  });

  if (result.spawnError) {
    return { ok: false, reason: 'exec_failed' };
  }
  if (result.timedOut) {
    return { ok: false, reason: 'timed_out' };
  }
  if (result.exitCode !== 0) {
    return { ok: false, reason: 'status_exit_nonzero' };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { ok: false, reason: 'invalid_status_output' };
  }

  const authMethod = typeof parsed.authMethod === 'string' ? parsed.authMethod : null;
  const subscriptionType =
    typeof parsed.subscriptionType === 'string' ? parsed.subscriptionType : null;

  if (
    parsed.loggedIn !== true ||
    authMethod !== 'claude.ai' ||
    !ELIGIBLE_SUBSCRIPTIONS.includes(subscriptionType)
  ) {
    return { ok: false, reason: 'auth_not_eligible', authMethod, subscriptionType };
  }

  return { ok: true, authMethod, subscriptionType, claudeBin };
}
