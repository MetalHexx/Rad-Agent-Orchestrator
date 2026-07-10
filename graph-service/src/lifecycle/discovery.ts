// graph-service/src/lifecycle/discovery.ts — the on-disk seam every lifecycle verb reads/writes
// through: `~/.radorc/service.json`, the one place a running daemon's endpoint is recorded so a
// caller (`ensure`/`status`/`stop`, the CLI in a later iteration) can find it without guessing a
// port. Writes are atomic (temp-write + rename) so a reader never observes a half-written file,
// and the shape is intentionally minimal — see graph-service/AGENTS.md for the documented contract.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const SERVICE_DISCOVERY_FILENAME = 'service.json';
export const SERVICE_LOCK_FILENAME = 'service.lock';

/** The discovery file's public shape — a documented seam other processes read directly. */
export interface ServiceDiscovery {
  readonly pid: number;
  /** The port actually bound — may differ from the requested default on a fallback. */
  readonly port: number;
  readonly url: string;
  readonly startedAt: string;
}

/**
 * Resolves `~/.radorc` the same portable way the rest of the system does (e.g. `cli/src/lib/
 * paths.ts`'s `resolveInstallRoot`) — `os.homedir()` read at call time, never a baked-in absolute
 * path a different machine/user would inherit.
 */
export function resolveRadorcRoot(): string {
  return path.join(os.homedir(), '.radorc');
}

export function discoveryFilePath(root: string = resolveRadorcRoot()): string {
  return path.join(root, SERVICE_DISCOVERY_FILENAME);
}

export function lockFilePath(root: string = resolveRadorcRoot()): string {
  return path.join(root, SERVICE_LOCK_FILENAME);
}

/**
 * Writes `service.json` atomically: the body lands in a per-process/timestamp temp file in the
 * same directory, then an `fs.rename` swaps it into place — a concurrent reader only ever sees
 * the old complete file or the new complete file, never a partial write.
 */
export async function writeDiscoveryFile(entry: ServiceDiscovery, root: string = resolveRadorcRoot()): Promise<void> {
  const file = discoveryFilePath(root);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tmp, JSON.stringify(entry, null, 2) + '\n', 'utf8');
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isServiceDiscovery(value: unknown): value is ServiceDiscovery {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ServiceDiscovery>;
  return (
    typeof candidate.pid === 'number' &&
    typeof candidate.port === 'number' &&
    typeof candidate.url === 'string' &&
    typeof candidate.startedAt === 'string'
  );
}

/**
 * Reads `service.json`; returns `null` when the file is absent, unreadable, or fails to parse
 * into the documented shape — a stale/corrupt file reads the same as "no daemon on record"
 * rather than throwing, since every caller's next move (probe, then maybe spawn) is the same
 * either way.
 */
export async function readDiscoveryFile(root: string = resolveRadorcRoot()): Promise<ServiceDiscovery | null> {
  let text: string;
  try {
    text = await fs.readFile(discoveryFilePath(root), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isServiceDiscovery(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Removes `service.json`; a no-op when it's already gone, so a restart always finds a clean slate. */
export async function removeDiscoveryFile(root: string = resolveRadorcRoot()): Promise<void> {
  await fs.rm(discoveryFilePath(root), { force: true });
}
