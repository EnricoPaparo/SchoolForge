// Shared non-interactive process execution: timeout, capped stdout/stderr
// buffering, and killing only the spawned child (never a process tree or
// unrelated processes). Never writes the full prompt anywhere; the prompt
// is piped over stdin by the caller and is not echoed by this module.

import { Buffer } from 'node:buffer';
import { clearTimeout, setTimeout } from 'node:timers';

const TRUNCATION_MARKER = '\n…[truncated]';

function utf8SequenceLength(byte) {
  if (byte >= 0xf0) return 4;
  if (byte >= 0xe0) return 3;
  if (byte >= 0xc0) return 2;
  if (byte < 0x80) return 1;
  return 0; // continuation byte (0x80-0xBF), not a valid sequence start
}

// Drops a trailing UTF-8 sequence left incomplete by a hard byte cut, so
// decoding never turns 1-3 leftover bytes into a 3-byte U+FFFD replacement
// that would push the kept payload back over the byte budget.
function trimIncompleteUtf8Tail(buffer) {
  const len = buffer.length;
  for (let back = 1; back <= 4 && back <= len; back += 1) {
    const byte = buffer[len - back];
    if (byte >= 0x80 && byte < 0xc0) continue; // continuation byte: keep scanning back
    const seqLen = utf8SequenceLength(byte);
    if (seqLen === 0 || back >= seqLen) return buffer; // complete (or unrecognised): leave as-is
    return buffer.subarray(0, len - back); // incomplete trailing sequence: drop it
  }
  return buffer;
}

// Caps by actual UTF-8 byte length, not JS string length (UTF-16 code
// units), and decodes only once the raw bytes are complete: decoding each
// `data` chunk independently can split a multi-byte UTF-8 sequence across
// two chunks and corrupt it. When the cap lands mid-character, the
// incomplete trailing bytes are dropped rather than decoded, so the kept
// text never exceeds maxBytes once re-encoded.
class ByteCappedCollector {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
    this.chunks = [];
    this.byteLength = 0;
    this.truncated = false;
  }

  push(chunk) {
    if (this.truncated) return;
    if (this.byteLength + chunk.length <= this.maxBytes) {
      this.chunks.push(chunk);
      this.byteLength += chunk.length;
      return;
    }
    const remaining = this.maxBytes - this.byteLength;
    if (remaining > 0) {
      this.chunks.push(chunk.subarray(0, remaining));
      this.byteLength += remaining;
    }
    this.truncated = true;
  }

  toResult() {
    let buf = Buffer.concat(this.chunks);
    if (this.truncated) {
      buf = trimIncompleteUtf8Tail(buf);
    }
    const text = buf.toString('utf8');
    return {
      text: this.truncated ? `${text}${TRUNCATION_MARKER}` : text,
      truncated: this.truncated,
    };
  }
}

/**
 * @returns {{
 *   exitCode: number|null,
 *   signal: string|null,
 *   stdout: string,
 *   stderr: string,
 *   stdoutTruncated: boolean,
 *   stderrTruncated: boolean,
 *   timedOut: boolean,
 *   interrupted: boolean,
 *   spawnError: Error|null,
 * }}
 */
export function runProcess(ports, options) {
  const {
    command,
    args,
    input,
    timeoutMs,
    maxBufferBytes = 256 * 1024,
    interruptSignal = null,
    cwd = undefined,
  } = options;

  return new Promise((resolvePromise) => {
    const stdoutCollector = new ByteCappedCollector(maxBufferBytes);
    const stderrCollector = new ByteCappedCollector(maxBufferBytes);
    let timedOut = false;
    let interrupted = false;
    let settled = false;
    let timer = null;

    let child;
    try {
      child = ports.exec.spawn(command, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (spawnError) {
      resolvePromise({
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        interrupted: false,
        spawnError,
      });
      return;
    }

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (interruptSignal) {
        interruptSignal.removeEventListener('abort', onInterrupt);
      }
      resolvePromise(result);
    };

    const settle = (exitCode, signal, spawnError) => {
      const { text: stdout, truncated: stdoutTruncated } = stdoutCollector.toResult();
      const { text: stderr, truncated: stderrTruncated } = stderrCollector.toResult();
      finish({
        exitCode,
        signal,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        timedOut,
        interrupted,
        spawnError,
      });
    };

    const killChildOnly = () => {
      try {
        child.kill();
      } catch {
        // process may have already exited
      }
    };

    const onInterrupt = () => {
      interrupted = true;
      killChildOnly();
    };

    if (interruptSignal) {
      if (interruptSignal.aborted) {
        onInterrupt();
      } else {
        interruptSignal.addEventListener('abort', onInterrupt, { once: true });
      }
    }

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killChildOnly();
      }, timeoutMs);
    }

    child.on('error', (spawnError) => {
      settle(null, null, spawnError);
    });

    child.stdout?.on('data', (chunk) => {
      stdoutCollector.push(chunk);
    });

    child.stderr?.on('data', (chunk) => {
      stderrCollector.push(chunk);
    });

    child.on('close', (exitCode, signal) => {
      settle(exitCode, signal, null);
    });

    if (input !== null && input !== undefined && child.stdin) {
      child.stdin.write(input, 'utf8');
    }
    child.stdin?.end();
  });
}
