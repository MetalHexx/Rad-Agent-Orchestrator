import child_process from 'node:child_process';

/**
 * Framework envelope returned on the CLI's stdout. Mirrors the shape used by
 * the radorch CLI command framework — see `cli/src/framework/*`.
 */
export type CliEnvelope<T> =
  | { ok: true; data: T; exit_code?: number }
  | {
      ok: false;
      error: { type: 'user_error' | 'system_error'; message: string };
      data?: unknown;
      exit_code?: number;
    };

export interface CliResult<T> {
  envelope: CliEnvelope<T>;
  rawStdout: string;
}

export interface CliShellOpts {
  /** argv passed to the radorch CLI. Do NOT include node binary or CLI path. */
  args: string[];
  /** Optional UTF-8 stdin payload. When provided, spawn is used and stdin is fully written then closed. */
  stdin?: string;
  /** Optional working directory for the child process. */
  cwd?: string;
}

const CLI_ENV_MISSING_ENVELOPE: CliEnvelope<never> = {
  ok: false,
  error: {
    type: 'system_error',
    message:
      'RADORCH_CLI_PATH not set. The UI server was started without RADORCH_CLI_PATH. Start the UI via `radorch ui start` so the CLI path is plumbed through.',
  },
};

/**
 * Promise wrapper around child_process.execFile that defers to
 * child_process.execFile at call time (not at import time), so that
 * node:test mock.method stubs can intercept it. Captures stdout/stderr
 * on non-zero exits so the caller can still parse a failure envelope.
 *
 * Node's execFile callback signature is (error, stdout, stderr) where
 * stdout and stderr are strings (when an encoding is supplied). On error,
 * Node also attaches .stdout/.stderr to the error object — we read either
 * source to be robust.
 */
function execFileP(
  file: string,
  args: string[],
  opts: { encoding: 'utf-8'; cwd?: string }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    child_process.execFile(file, args, opts, (err, stdout, stderr) => {
      const out = String(stdout ?? '');
      const errOut = String(stderr ?? '');
      if (err) {
        const execErr = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
        const enriched = Object.assign(err, {
          stdout: out || execErr.stdout || '',
          stderr: errOut || execErr.stderr || '',
        });
        reject(enriched);
      } else {
        resolve({ stdout: out, stderr: errOut });
      }
    });
  });
}

/**
 * Promise wrapper around child_process.spawn used when stdin must be piped.
 * Always closes stdin (writing `stdin` first when provided) so the child does
 * not hang waiting for input.
 */
function spawnWithStdin(
  file: string,
  args: string[],
  opts: { cwd?: string },
  stdinPayload: string
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    let child: child_process.ChildProcess;
    try {
      child = child_process.spawn(file, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: opts.cwd,
      });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
    if (child.stdin) {
      child.stdin.on('error', () => {
        // Swallow EPIPE etc. — close handler will surface the underlying failure.
      });
      child.stdin.end(stdinPayload);
    }
  });
}

/**
 * Spawns the radorch CLI at process.env.RADORCH_CLI_PATH with the supplied
 * argv (and optional stdin) and returns the parsed envelope plus the raw
 * stdout for diagnostics.
 *
 * This helper never throws — every failure mode (missing env var, spawn
 * failure, non-zero exit without parseable envelope, or unparseable stdout) is
 * surfaced as a `{ ok: false, error: { type: 'system_error', message } }`
 * envelope. Callers map envelopes to HTTP status codes themselves.
 */
export async function runCli<T>(opts: CliShellOpts): Promise<CliResult<T>> {
  const radorchBin = process.env.RADORCH_CLI_PATH;
  if (!radorchBin) {
    return { envelope: CLI_ENV_MISSING_ENVELOPE as CliEnvelope<T>, rawStdout: '' };
  }
  const argv = [radorchBin, ...opts.args];

  let stdout = '';
  let stderr = '';
  try {
    if (opts.stdin !== undefined) {
      const r = await spawnWithStdin(process.execPath, argv, { cwd: opts.cwd }, opts.stdin);
      stdout = r.stdout;
      stderr = r.stderr;
    } else {
      const r = await execFileP(process.execPath, argv, {
        encoding: 'utf-8',
        cwd: opts.cwd,
      });
      stdout = r.stdout;
      stderr = r.stderr;
    }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';
    if (!stdout) {
      return {
        envelope: {
          ok: false,
          error: {
            type: 'system_error',
            message: `CLI invocation failed: ${e.stderr ?? e.message ?? 'unknown'}`,
          },
        } as CliEnvelope<T>,
        rawStdout: '',
      };
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      envelope: {
        ok: false,
        error: {
          type: 'system_error',
          message: `Invalid CLI response: ${stdout || stderr || 'empty stdout'}`,
        },
      } as CliEnvelope<T>,
      rawStdout: stdout,
    };
  }

  // Trust the CLI envelope shape — runCli is generic over `T`; the caller
  // narrows. We only validate the boolean discriminator here.
  const env = parsed as CliEnvelope<T>;
  if (typeof (env as { ok?: unknown }).ok !== 'boolean') {
    return {
      envelope: {
        ok: false,
        error: {
          type: 'system_error',
          message: `Invalid CLI envelope: missing 'ok' discriminator (stdout=${stdout})`,
        },
      } as CliEnvelope<T>,
      rawStdout: stdout,
    };
  }
  return { envelope: env, rawStdout: stdout };
}
