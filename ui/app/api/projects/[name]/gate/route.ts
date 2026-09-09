import { NextRequest, NextResponse } from 'next/server';
import child_process from 'node:child_process';

import type { GateApproveResponse, GateErrorResponse } from '@/types/state';
import { resolveProjectDir } from '@/lib/path-resolver';
import { readProjectState } from '@/lib/fs-reader';
import { detectPortfolio } from '@/lib/portfolio-detect';

export const dynamic = 'force-dynamic';

const ALLOWED_GATE_EVENTS: ReadonlySet<string> = new Set(['plan_approved', 'final_approved']);
const PROJECT_NAME_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;

/**
 * `detectPortfolio` is documented to never throw, but the approval this
 * guards has already landed by the time it runs, and this call sits inside
 * the route's outer `try`, whose `catch` returns a blanket 500. A throw
 * escaping here would turn a landed approval into a 500 — the exact
 * inversion this detection exists to avoid — so the promise is enforced
 * locally rather than trusted.
 */
async function safeDetectPortfolio(projectName: string): ReturnType<typeof detectPortfolio> {
  try {
    return await detectPortfolio(projectName);
  } catch {
    return null;
  }
}

/**
 * Thin Promise wrapper around child_process.execFile that defers to
 * child_process.execFile at call time (not at import time), so that
 * node:test mock.method stubs can intercept it. Node's execFile callback
 * passes stdout/stderr as the 2nd and 3rd positional args (strings, when
 * an encoding is set) — not as fields on a single result object.
 */
function execFileP(
  file: string,
  args: string[],
  opts: { encoding: 'utf-8' }
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> | { name: string } }
): Promise<NextResponse<GateApproveResponse | GateErrorResponse>> {
  try {
    // Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body.' } satisfies GateErrorResponse,
        { status: 400 }
      );
    }

    const { event } = body as { event?: string };

    // Validate event whitelist
    if (!event || !ALLOWED_GATE_EVENTS.has(event)) {
      return NextResponse.json(
        { error: 'Invalid gate event. Allowed: plan_approved, final_approved.' } satisfies GateErrorResponse,
        { status: 400 }
      );
    }

    const resolvedParams = params instanceof Promise ? await params : params;
    const name = resolvedParams.name;

    // Validate project name format
    if (!PROJECT_NAME_PATTERN.test(name)) {
      return NextResponse.json(
        { error: 'Invalid project name format.' } satisfies GateErrorResponse,
        { status: 400 }
      );
    }

    // Resolve project directory and verify existence
    const projectDir = resolveProjectDir(name);

    const state = await readProjectState(projectDir);
    if (state === null) {
      return NextResponse.json(
        { error: 'Project not found.' } satisfies GateErrorResponse,
        { status: 404 }
      );
    }

    // Invoke the radorch CLI — it auto-resolves doc paths from state (FR-13).
    // The CLI path is provided by whoever spawned this UI server (see
    // cli/src/commands/ui/start.ts), which stamps its own location into
    // RADORCH_CLI_PATH. If the UI was started outside the normal flow the
    // env var is missing and we hard-fail with a clear error rather than
    // shelling out to a guessed location.
    const radorchBin = process.env.RADORCH_CLI_PATH;
    if (!radorchBin) {
      return NextResponse.json(
        {
          error: 'RADORCH_CLI_PATH not set.',
          detail: 'The UI server was started without RADORCH_CLI_PATH. Start the UI via `radorch ui start` so the CLI path is plumbed through.',
        } satisfies GateErrorResponse,
        { status: 500 },
      );
    }
    const subcmd = event === 'plan_approved' ? 'plan' : 'final';
    const args = [radorchBin, 'gate', 'approve', subcmd, '--project-dir', projectDir];

    let stdout: string;
    try {
      const r = await execFileP(process.execPath, args, { encoding: 'utf-8' });
      stdout = r.stdout;
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      // CLI may exit non-zero with a valid envelope on stdout; try to parse first.
      stdout = e.stdout ?? '';
      if (!stdout) {
        return NextResponse.json(
          { error: 'Gate CLI failed.', detail: e.stderr ?? e.message ?? 'unknown' } satisfies GateErrorResponse,
          { status: 500 },
        );
      }
    }

    // Parse the framework envelope: { ok, data, error, exit_code }
    let parsed: {
      ok?: boolean;
      data?: { action?: string | null; context?: Record<string, unknown>; event?: string };
      error?: { type?: 'user_error' | 'system_error'; message?: string };
    };
    try { parsed = JSON.parse(stdout!); }
    catch {
      return NextResponse.json(
        { error: 'Invalid CLI response.', detail: stdout! } satisfies GateErrorResponse,
        { status: 500 },
      );
    }

    if (parsed.ok === true) {
      const portfolio = event === 'final_approved' ? await safeDetectPortfolio(name) : null;
      return NextResponse.json(
        {
          success: true,
          action: parsed.data?.action ?? '',
          ...(portfolio ? { portfolio: { name: portfolio.name } } : {}),
        } satisfies GateApproveResponse,
        { status: 200 },
      );
    }

    const detail = parsed.error?.message ?? stdout!;
    if (parsed.error?.type === 'system_error') {
      return NextResponse.json(
        { error: 'Pipeline internal error.', detail } satisfies GateErrorResponse,
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: 'Pipeline rejected the event.', detail } satisfies GateErrorResponse,
      { status: 409 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      { error: message } satisfies GateErrorResponse,
      { status: 500 }
    );
  }
}
