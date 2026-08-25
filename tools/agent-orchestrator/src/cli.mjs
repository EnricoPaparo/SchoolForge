// Minimal CLI: preflight, run, resume, status. One closed JSON object on
// stdout per invocation, closed exit codes. `status` never invokes claude.

import { resolve } from 'node:path';

import { runPreflight } from './preflight.mjs';
import { runInvocation } from './invoke.mjs';
import { hashManifest } from './manifest.mjs';
import { CheckpointMalformedError, InvalidTaskIdError, readCheckpoint } from './checkpoint.mjs';
import { EXIT_CODES, OUTCOME_EXIT_CODES } from './exitCodes.mjs';

const CLI_SCHEMA = 'schoolforge-agent-orchestrator-cli/v1';

export class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliUsageError';
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      throw new CliUsageError(`unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new CliUsageError(`missing value for --${name}`);
    }
    flags[name] = next;
    i += 1;
  }
  return { command, flags };
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new CliUsageError(`missing required flag --${name}`);
  }
  return value;
}

function envelope(command, exitCode, payload) {
  return { output: { schema: CLI_SCHEMA, command, ...payload }, exitCode };
}

async function readManifestHash(ports, manifestFilePath) {
  const text = await ports.fs.readFile(resolve(manifestFilePath));
  return hashManifest(text);
}

async function handlePreflight(ports, flags) {
  const result = await runPreflight(ports, { claudeBinOverride: flags['claude-bin'] ?? null });
  const exitCode = result.ok ? EXIT_CODES.SUCCESS : EXIT_CODES.PREFLIGHT_FAILED;
  return envelope('preflight', exitCode, result);
}

async function handleStatus(ports, flags) {
  const repoRoot = resolve(flags['repo-root'] ?? '.');
  const taskId = requireFlag(flags, 'task-id');
  try {
    const checkpoint = await readCheckpoint(ports, repoRoot, taskId);
    if (checkpoint === null) {
      return envelope('status', EXIT_CODES.CHECKPOINT_NOT_FOUND, {
        found: false,
        checkpoint: null,
      });
    }
    return envelope('status', EXIT_CODES.SUCCESS, { found: true, checkpoint });
  } catch (error) {
    if (error instanceof InvalidTaskIdError) {
      return envelope('status', EXIT_CODES.USAGE_ERROR, { error: error.message });
    }
    if (error instanceof CheckpointMalformedError) {
      return envelope('status', EXIT_CODES.CHECKPOINT_INVALID, {
        found: true,
        checkpoint: null,
        reason: error.reason,
      });
    }
    throw error;
  }
}

async function handleInvoke(ports, flags, mode, interruptSignal) {
  const repoRoot = resolve(flags['repo-root'] ?? '.');
  const taskId = requireFlag(flags, 'task-id');
  const manifestFile = requireFlag(flags, 'manifest-file');
  const promptFile = requireFlag(flags, 'prompt-file');
  const allowedToolsRaw = requireFlag(flags, 'allowed-tools');
  const maxTurnsRaw = requireFlag(flags, 'max-turns');

  const manifestHash = await readManifestHash(ports, manifestFile);
  const prompt = await ports.fs.readFile(resolve(promptFile));
  const allowedTools = allowedToolsRaw
    .split(',')
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
  const maxTurns = Number.parseInt(maxTurnsRaw, 10);
  const pr = flags.pr !== undefined ? Number.parseInt(flags.pr, 10) : null;

  const result = await runInvocation(ports, {
    mode,
    repoRoot,
    taskId,
    manifestHash,
    prompt,
    allowedTools,
    maxTurns,
    permissionMode: flags['permission-mode'] ?? 'default',
    timeoutMs:
      flags['timeout-ms'] !== undefined ? Number.parseInt(flags['timeout-ms'], 10) : undefined,
    claudeBinOverride: flags['claude-bin'] ?? null,
    interruptSignal,
    passthrough: {
      branch: flags.branch ?? null,
      pr,
      headSha: flags['head-sha'] ?? null,
    },
  });

  switch (result.kind) {
    case 'invalid_task_id':
      return envelope(mode, EXIT_CODES.USAGE_ERROR, {
        kind: result.kind,
        reason: result.error.message,
      });
    case 'checkpoint_rejected':
      return envelope(mode, EXIT_CODES.CHECKPOINT_INVALID, {
        kind: result.kind,
        reason: result.error.message,
      });
    case 'needs_new_session':
      return envelope(mode, EXIT_CODES.NEEDS_NEW_SESSION, {
        kind: result.kind,
        reason: result.error.message,
      });
    case 'active_session_exists':
      return envelope(mode, EXIT_CODES.USAGE_ERROR, {
        kind: result.kind,
        reason: result.error.message,
      });
    case 'preflight_failed':
      return envelope(mode, EXIT_CODES.PREFLIGHT_FAILED, {
        kind: result.kind,
        preflight: result.preflight,
      });
    case 'invalid_options':
      return envelope(mode, EXIT_CODES.USAGE_ERROR, {
        kind: result.kind,
        reason: result.error.message,
      });
    case 'invoked':
      return envelope(mode, OUTCOME_EXIT_CODES[result.classification.outcome], {
        kind: result.kind,
        outcome: result.classification.outcome,
        reason: result.classification.reason,
        retryAt: result.classification.retryAt,
        checkpoint: result.checkpoint,
        stderrExcerpt: result.stderrExcerpt,
        stdoutTruncated: result.stdoutTruncated,
        stderrTruncated: result.stderrTruncated,
      });
    default:
      throw new Error(`unhandled invocation result kind: ${result.kind}`);
  }
}

/**
 * @param {string[]} argv - e.g. process.argv.slice(2)
 * @param {object} ports
 * @param {AbortSignal|null} [interruptSignal]
 * @returns {Promise<{ output: object, exitCode: number }>}
 */
export async function runCli(argv, ports, interruptSignal = null) {
  let command;
  let flags;
  try {
    ({ command, flags } = parseArgs(argv));
  } catch (error) {
    return envelope('unknown', EXIT_CODES.USAGE_ERROR, { error: error.message });
  }

  try {
    switch (command) {
      case 'preflight':
        return await handlePreflight(ports, flags);
      case 'status':
        return await handleStatus(ports, flags);
      case 'run':
        return await handleInvoke(ports, flags, 'run', interruptSignal);
      case 'resume':
        return await handleInvoke(ports, flags, 'resume', interruptSignal);
      default:
        return envelope('unknown', EXIT_CODES.USAGE_ERROR, {
          error: `unknown command: ${command ?? '(none)'}`,
        });
    }
  } catch (error) {
    if (error instanceof CliUsageError) {
      return envelope(command, EXIT_CODES.USAGE_ERROR, { error: error.message });
    }
    throw error;
  }
}
