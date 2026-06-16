import os from 'node:os';
import path from 'node:path';
import child_process from 'node:child_process';

import { getWorktreesRoot, getSideProjectsRoot, getProjectsRoot } from './path-resolver';

/**
 * SC-PANEL-POLISH: reveal a repo's folder in the OS file explorer.
 *
 * Security: this is the only place the dashboard server opens a folder on
 * the host. The path is never trusted blindly — `resolveAndValidateFolder`
 * rejects `..` traversal and requires the resolved absolute path to live under
 * one of the known `~/.radorc` roots before `openFolder` spawns anything.
 */

export type ResolveFolderResult = { absPath: string } | { error: string };

/**
 * Expand a `~`-prefixed convention path (as produced by
 * `resolveRepoFolderPath`), resolve it to an absolute path, and confirm it is
 * contained within an allowed `~/.radorc` root. Returns `{ error }` on any
 * rejection — callers map that to a 400.
 */
export function resolveAndValidateFolder(rawPath: unknown): ResolveFolderResult {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    return { error: 'Missing folder path.' };
  }
  // Reject traversal before any expansion/resolution. Only a path *segment*
  // equal to `..` is traversal — a bare `includes('..')` would also reject
  // legitimate folder names like `foo..bar`. The allowed-roots prefix check
  // below remains the real boundary; this is a fast, precise fail.
  if (rawPath.split(/[\\/]+/).some((seg) => seg === '..')) {
    return { error: 'Invalid folder path.' };
  }
  // Expand a leading `~` (the convention paths are tilde-prefixed).
  let expanded = rawPath;
  if (expanded === '~' || expanded.startsWith('~/') || expanded.startsWith('~\\')) {
    expanded = path.join(os.homedir(), expanded.slice(1));
  }
  const absPath = path.resolve(expanded);
  const roots = [getWorktreesRoot(), getSideProjectsRoot(), getProjectsRoot()];
  const allowed = roots.some((root) => absPath === root || absPath.startsWith(root + path.sep));
  if (!allowed) {
    return { error: 'Folder path is outside the allowed roots.' };
  }
  return { absPath };
}

export interface OpenFolderResult {
  success: boolean;
  error?: string;
}

/** Per-platform file-explorer command. */
function explorerCommand(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'explorer';
  if (platform === 'darwin') return 'open';
  return 'xdg-open';
}

/**
 * Open `absPath` in the OS file explorer. Resolves `{ success: true }` once the
 * child process has spawned, and `{ success: false }` only if spawning fails
 * (e.g. ENOENT) — we deliberately do NOT inspect the exit code, because
 * `explorer` returns non-zero even on success.
 *
 * `child_process.spawn` is called at invocation time (not destructured at
 * import) so `node:test` `mock.method` stubs can intercept it. Set
 * `OPEN_FOLDER_DRY_RUN=1` to skip the real spawn (used by route tests);
 * `OPEN_FOLDER_FORCE_FAIL=1` simulates a spawn failure under dry-run.
 */
export function openFolder(absPath: string): Promise<OpenFolderResult> {
  return new Promise((resolve) => {
    if (process.env.OPEN_FOLDER_DRY_RUN === '1') {
      resolve(
        process.env.OPEN_FOLDER_FORCE_FAIL === '1'
          ? { success: false, error: 'Failed to open folder.' }
          : { success: true },
      );
      return;
    }

    let settled = false;
    const done = (r: OpenFolderResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };

    const cmd = explorerCommand(process.platform);
    try {
      const child = child_process.spawn(cmd, [absPath], { detached: true, stdio: 'ignore' });
      // 'spawn' fires once the process started; 'error' fires instead on
      // failure. Exactly one of the two always fires — no exit-code race.
      child.once('spawn', () => {
        child.unref();
        done({ success: true });
      });
      child.once('error', () => done({ success: false, error: 'Failed to open folder.' }));
    } catch {
      done({ success: false, error: 'Failed to open folder.' });
    }
  });
}
