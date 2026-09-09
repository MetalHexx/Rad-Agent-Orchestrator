import path from 'node:path';
import { resolveInstallRoot, installPaths } from '../../lib/paths.js';
import { ensureDir } from '../../lib/fs-helpers.js';
import { resolveUiPort } from '../../lib/ui-address.js';
import { readPidFile, removePidFile, writePidFile, isPidAlive } from './pid-file.js';
import { probePortFree as defaultProbe, openLogFd, spawn as defaultSpawn } from './spawn.js';
import { UserError, SystemError } from '../../framework/errors.js';

// Re-exported so existing importers of `resolveUiPort` from this module keep
// working — `cli/tests/commands/ui.test.ts` imports it from here.
export { resolveUiPort };

const SCAN_WIDTH = 11; // preserves today's 11-port window (e.g. 3000-3010)

export interface StartResult {
  pid: number;
  port: number;
  requested_port: number;
  url: string;
  started_at: string;
}

export async function runStart(opts: {
  env: NodeJS.ProcessEnv;
  _probePortFree?: (p: number) => Promise<boolean>;
  _spawn?: typeof defaultSpawn;
}): Promise<StartResult> {
  const root = resolveInstallRoot();
  const p = installPaths(root);
  await ensureDir(p.runtimeDir);
  await ensureDir(p.logsDir);
  // Idempotency: if a recorded UI server is already alive, return its handle
  // instead of spawning a duplicate. A stale entry (process already dead) is
  // cleaned up so we proceed with a fresh spawn.
  const existing = await readPidFile(p.uiPidFile);
  if (existing) {
    if (isPidAlive(existing.pid)) {
      return {
        pid: existing.pid,
        port: existing.port,
        requested_port: existing.port,
        url: `http://localhost:${existing.port}`,
        started_at: existing.started_at,
      };
    }
    await removePidFile(p.uiPidFile);
  }
  const basePort = resolveUiPort(root);
  const portHi = basePort + SCAN_WIDTH - 1;
  const probe = opts._probePortFree ?? defaultProbe;
  let chosenPort: number | null = null;
  const tried: number[] = [];
  for (let port = basePort; port <= portHi; port++) {
    tried.push(port);
    if (await probe(port)) {
      chosenPort = port;
      break;
    }
  }
  if (chosenPort === null) {
    throw new UserError(
      `every port ${basePort}-${portHi} is taken (tried ${tried.join(', ')}); free one and retry`,
    );
  }
  // UI dir resolution: the bootstrap (SessionStart hook) copies ui/ from the
  // plugin cache into ~/.radorc/ui/ via the manifest routing in route.ts.
  // Always launch from ~/.radorc/ui so the UI process is independent of the
  // plugin cache location. RADORCH_UI_DIR is the explicit override for tests.
  const uiDir = opts.env['RADORCH_UI_DIR']
    ?? path.join(resolveInstallRoot(), 'ui');
  const serverJs = path.join(uiDir, 'ui', 'server.js');
  const spawnFn = opts._spawn ?? defaultSpawn;
  // In plugin mode, ~/.radorc is the canonical workspace and orch root in
  // one. WORKSPACE_ROOT must point at ~/.radorc so the UI can read
  // orchestration.yml at ~/.radorc/orchestration.yml (provisioned by the
  // SessionStart hook); ORCH_ROOT="." means workspace IS the orch root.
  // The UI's ui/lib/path-resolver.ts then reads orchestration.yml's
  // base_path field (default "projects") to resolve the projects dir.
  //
  // RADORCH_CLI_PATH hands the spawned UI server the path to this CLI
  // bundle so the gate route can shell back out without hardcoding the
  // install location (which now varies by channel — plugin staging dir for
  // the Claude plugin vs ~/.claude/skills/... for the legacy installer).
  const env = {
    ...opts.env,
    WORKSPACE_ROOT: root,
    ORCH_ROOT: '.',
    PORT: String(chosenPort),
    HOSTNAME: '127.0.0.1',
    RADORCH_CLI_PATH: process.argv[1] ?? '',
  };
  const logFd = opts._spawn ? -1 : openLogFd(p.uiLog);
  const child = spawnFn('node', [serverJs], {
    detached: true,
    windowsHide: true,
    stdio: opts._spawn ? 'ignore' : (['ignore', logFd, logFd] as never),
    env,
    cwd: uiDir,
  });
  if (!child.pid) throw new SystemError('failed to spawn UI server');
  child.unref();
  const started_at = new Date().toISOString();
  await writePidFile(p.uiPidFile, { pid: child.pid, port: chosenPort, started_at });
  return {
    pid: child.pid,
    port: chosenPort,
    requested_port: basePort,
    url: `http://localhost:${chosenPort}`,
    started_at,
  };
}
