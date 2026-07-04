import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runStart, resolveUiPort } from '../../src/commands/ui/start.js';
import { runStop } from '../../src/commands/ui/stop.js';
import { runStatus } from '../../src/commands/ui/status.js';
import { writePidFile, readPidFile } from '../../src/commands/ui/pid-file.js';

let home: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'rad-ui-'));
  homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(home);
});
afterEach(async () => {
  homedirSpy.mockRestore();
  await fs.rm(home, { recursive: true, force: true });
});

// resolveInstallRoot() = path.join(home, '.radorc')
// installPaths(root).uiPidFile = path.join(home, '.radorc', 'runtime', 'ui.pid')
function pidFilePath(): string { return path.join(home, '.radorc', 'runtime', 'ui.pid'); }
function runtimeDir(): string { return path.join(home, '.radorc', 'runtime'); }
function orchestrationYmlPath(): string { return path.join(home, '.radorc', 'orchestration.yml'); }

async function writeUiPortConfig(body: string): Promise<void> {
  await fs.mkdir(path.join(home, '.radorc'), { recursive: true });
  await fs.writeFile(orchestrationYmlPath(), body);
}

describe('pid-file', () => {
  it('writes and reads {pid, port, started_at}', async () => {
    const f = path.join(home, 'ui.pid');
    await writePidFile(f, { pid: 12345, port: 3001, started_at: '2026-05-08T00:00:00.000Z' });
    const r = await readPidFile(f);
    expect(r).toEqual({ pid: 12345, port: 3001, started_at: '2026-05-08T00:00:00.000Z' });
  });
  it('returns null when missing', async () => {
    const r = await readPidFile(path.join(home, 'absent.pid'));
    expect(r).toBeNull();
  });
});

describe('ui status', () => {
  it('reports stopped when no PID file', async () => {
    const r = await runStatus({ env: process.env });
    expect(r.running).toBe(false);
  });
  it('cleans stale pid file when process is dead', async () => {
    const f = pidFilePath();
    await fs.mkdir(runtimeDir(), { recursive: true });
    await writePidFile(f, { pid: 999999, port: 3000, started_at: new Date().toISOString() });
    const r = await runStatus({ env: process.env });
    expect(r.running).toBe(false);
    const after = await readPidFile(f);
    expect(after).toBeNull();
  });
  it('reports running when PID is alive (using current process)', async () => {
    const f = pidFilePath();
    await fs.mkdir(runtimeDir(), { recursive: true });
    await writePidFile(f, { pid: process.pid, port: 3007, started_at: new Date().toISOString() });
    const r = await runStatus({ env: process.env });
    expect(r.running).toBe(true);
    expect(r.url).toBe('http://localhost:3007');
  });
});

describe('ui stop', () => {
  it('reports stopped + removes pid file when pid is dead', async () => {
    const f = pidFilePath();
    await fs.mkdir(runtimeDir(), { recursive: true });
    await writePidFile(f, { pid: 999998, port: 3000, started_at: new Date().toISOString() });
    const probe = vi.fn().mockResolvedValue(true);
    const r = await runStop({ env: process.env, _probePortFree: probe });
    expect(r.stopped).toBe(true);
    expect(r.port_released).toBe(true);
    const after = await readPidFile(f);
    expect(after).toBeNull();
  });
  it('reports stopped when no pid file existed', async () => {
    const r = await runStop({ env: process.env });
    expect(r.stopped).toBe(true);
  });
  it('returns port_released:true after polling succeeds on a later attempt', async () => {
    const f = pidFilePath();
    await fs.mkdir(runtimeDir(), { recursive: true });
    await writePidFile(f, { pid: 999997, port: 3007, started_at: new Date().toISOString() });
    // First two probes report port still bound; third reports free.
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    let mockTime = 0;
    const r = await runStop({
      env: process.env,
      _probePortFree: probe,
      _now: () => mockTime,
      _sleep: async (ms) => { mockTime += ms; },
    });
    expect(r.stopped).toBe(true);
    expect(r.port_released).toBe(true);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(probe).toHaveBeenCalledWith(3007);
  });
  it('returns port_released:false when probe never succeeds within timeout', async () => {
    const f = pidFilePath();
    await fs.mkdir(runtimeDir(), { recursive: true });
    await writePidFile(f, { pid: 999996, port: 3000, started_at: new Date().toISOString() });
    const probe = vi.fn().mockResolvedValue(false);
    let mockTime = 0;
    const r = await runStop({
      env: process.env,
      _probePortFree: probe,
      _now: () => mockTime,
      _sleep: async (ms) => { mockTime += ms; },
    });
    expect(r.stopped).toBe(true);
    expect(r.port_released).toBe(false);
    // 5000ms timeout / 200ms interval = ~25 iterations. The exact count depends
    // on whether the loop probes once more after the final sleep — accept >=20.
    expect(probe.mock.calls.length).toBeGreaterThanOrEqual(20);
  });
});

describe('ui start (with mocked spawn)', () => {
  it('emits user_error when every port 1337-1347 is taken', async () => {
    const probe = vi.fn().mockResolvedValue(false); // no port free
    await expect(runStart({ env: process.env, _probePortFree: probe })).rejects.toThrow(/1337.*1347/);
    expect(probe).toHaveBeenCalledTimes(11);
  });
  it('writes pid file with {pid, port, started_at} on successful spawn', async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const fakeSpawn = vi.fn().mockReturnValue({ pid: 4242, unref: () => {} });
    const r = await runStart({
      env: { ...process.env, RADORCH_UI_DIR: path.join(home, 'fake-ui') },
      _probePortFree: probe,
      _spawn: fakeSpawn as never,
    });
    expect(r.url).toBe('http://localhost:1337');
    expect(r.pid).toBe(4242);
    expect(r.port).toBe(1337);
    expect(r.requested_port).toBe(1337);
    const pidFile = await readPidFile(pidFilePath());
    expect(pidFile?.pid).toBe(4242);
    expect(pidFile?.port).toBe(1337);
    // verify env-bridge: in plugin mode ~/.radorc IS the canonical workspace
    // and orch root in one, so WORKSPACE_ROOT=root, ORCH_ROOT=".". The UI's
    // path-resolver then reads orchestration.yml at <root>/skills/...
    const spawnCall = fakeSpawn.mock.calls[0];
    const spawnEnv = spawnCall[2].env;
    expect(spawnEnv.WORKSPACE_ROOT).toBe(path.join(home, '.radorc'));
    expect(spawnEnv.ORCH_ROOT).toBe('.');
    expect(spawnCall[2].detached).toBe(true);
    expect(spawnCall[2].windowsHide).toBe(true);
  });
  it('is idempotent: returns existing handle without re-spawning when a live PID is recorded', async () => {
    const f = pidFilePath();
    await fs.mkdir(runtimeDir(), { recursive: true });
    // current process pid is alive — simulates a live UI server entry
    await writePidFile(f, { pid: process.pid, port: 3007, started_at: '2026-05-08T00:00:00.000Z' });
    const probe = vi.fn().mockResolvedValue(true);
    const fakeSpawn = vi.fn();
    const r = await runStart({
      env: { ...process.env, RADORCH_UI_DIR: path.join(home, 'fake-ui') },
      _probePortFree: probe,
      _spawn: fakeSpawn as never,
    });
    expect(fakeSpawn).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(r.pid).toBe(process.pid);
    expect(r.port).toBe(3007);
    expect(r.requested_port).toBe(3007);
    expect(r.url).toBe('http://localhost:3007');
    expect(r.started_at).toBe('2026-05-08T00:00:00.000Z');
  });
  it('clears a stale PID file (dead process) and proceeds to a fresh spawn', async () => {
    const f = pidFilePath();
    await fs.mkdir(runtimeDir(), { recursive: true });
    await writePidFile(f, { pid: 999996, port: 3007, started_at: new Date().toISOString() });
    const probe = vi.fn().mockResolvedValue(true);
    const fakeSpawn = vi.fn().mockReturnValue({ pid: 5151, unref: () => {} });
    const r = await runStart({
      env: { ...process.env, RADORCH_UI_DIR: path.join(home, 'fake-ui') },
      _probePortFree: probe,
      _spawn: fakeSpawn as never,
    });
    expect(fakeSpawn).toHaveBeenCalledTimes(1);
    expect(r.pid).toBe(5151);
    expect(r.port).toBe(1337);
    expect(r.requested_port).toBe(1337);
  });
  it('spawns the server entry at the nested ui/server.js path (standalone layout)', async () => {
    const uiDir = path.join(home, 'fake-ui');
    const probe = vi.fn().mockResolvedValue(true);
    const fakeSpawn = vi.fn().mockReturnValue({ pid: 7373, unref: () => {} });
    await runStart({
      env: { ...process.env, RADORCH_UI_DIR: uiDir },
      _probePortFree: probe,
      _spawn: fakeSpawn as never,
    });
    const spawnedServerJs: string = fakeSpawn.mock.calls[0][1][0];
    expect(spawnedServerJs).toBe(path.join(uiDir, 'ui', 'server.js'));
  });

  describe('configured ui.port anchoring', () => {
    it('with no ui section in config, scans from 1337 and reports requested_port: 1337', async () => {
      await writeUiPortConfig('source_control:\n  auto_commit: ask\n');
      const probe = vi.fn().mockResolvedValue(true);
      const fakeSpawn = vi.fn().mockReturnValue({ pid: 1001, unref: () => {} });
      const r = await runStart({
        env: { ...process.env, RADORCH_UI_DIR: path.join(home, 'fake-ui') },
        _probePortFree: probe,
        _spawn: fakeSpawn as never,
      });
      expect(r.requested_port).toBe(1337);
      expect(r.port).toBe(1337);
      expect(probe).toHaveBeenCalledWith(1337);
    });

    it('anchors the scan at a configured ui.port when that port is free', async () => {
      await writeUiPortConfig('ui:\n  port: 4000\n');
      const probe = vi.fn().mockResolvedValue(true);
      const fakeSpawn = vi.fn().mockReturnValue({ pid: 1002, unref: () => {} });
      const r = await runStart({
        env: { ...process.env, RADORCH_UI_DIR: path.join(home, 'fake-ui') },
        _probePortFree: probe,
        _spawn: fakeSpawn as never,
      });
      expect(r.requested_port).toBe(4000);
      expect(r.port).toBe(4000);
      expect(probe).toHaveBeenCalledWith(4000);
    });

    it('reports a fallback distinctly when the configured port is taken but a nearby one is free', async () => {
      await writeUiPortConfig('ui:\n  port: 4000\n');
      const probe = vi.fn()
        .mockResolvedValueOnce(false) // 4000 taken
        .mockResolvedValueOnce(true); // 4001 free
      const fakeSpawn = vi.fn().mockReturnValue({ pid: 1003, unref: () => {} });
      const r = await runStart({
        env: { ...process.env, RADORCH_UI_DIR: path.join(home, 'fake-ui') },
        _probePortFree: probe,
        _spawn: fakeSpawn as never,
      });
      expect(r.requested_port).toBe(4000);
      expect(r.port).toBe(4001);
      expect(r.port).not.toBe(r.requested_port);
    });

    it('degrades to the default port when ui.port is malformed', async () => {
      await writeUiPortConfig('ui:\n  port: "not-a-number"\n');
      const probe = vi.fn().mockResolvedValue(true);
      const fakeSpawn = vi.fn().mockReturnValue({ pid: 1004, unref: () => {} });
      const r = await runStart({
        env: { ...process.env, RADORCH_UI_DIR: path.join(home, 'fake-ui') },
        _probePortFree: probe,
        _spawn: fakeSpawn as never,
      });
      expect(r.requested_port).toBe(1337);
    });

    it('degrades to the default port when ui.port is out of range', async () => {
      await writeUiPortConfig('ui:\n  port: 70000\n');
      const probe = vi.fn().mockResolvedValue(true);
      const fakeSpawn = vi.fn().mockReturnValue({ pid: 1005, unref: () => {} });
      const r = await runStart({
        env: { ...process.env, RADORCH_UI_DIR: path.join(home, 'fake-ui') },
        _probePortFree: probe,
        _spawn: fakeSpawn as never,
      });
      expect(r.requested_port).toBe(1337);
    });

    it('degrades to the default port when orchestration.yml is malformed YAML', async () => {
      await writeUiPortConfig('ui:\n  port: [unterminated\n');
      const probe = vi.fn().mockResolvedValue(true);
      const fakeSpawn = vi.fn().mockReturnValue({ pid: 1006, unref: () => {} });
      const r = await runStart({
        env: { ...process.env, RADORCH_UI_DIR: path.join(home, 'fake-ui') },
        _probePortFree: probe,
        _spawn: fakeSpawn as never,
      });
      expect(r.requested_port).toBe(1337);
    });

    it('exhausting the resolved range throws UserError naming the resolved range', async () => {
      await writeUiPortConfig('ui:\n  port: 4000\n');
      const probe = vi.fn().mockResolvedValue(false);
      await expect(runStart({ env: process.env, _probePortFree: probe })).rejects.toThrow(/4000.*4010/);
      expect(probe).toHaveBeenCalledTimes(11);
    });
  });
});

describe('resolveUiPort', () => {
  it('returns the default when no config file exists', () => {
    expect(resolveUiPort(path.join(home, '.radorc'))).toBe(1337);
  });
});
