import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';

export interface SessionContextWorld {
  /** The synthetic home directory `os.homedir()` is pointed at. */
  home: string;
  /** `~/.radorc` inside it — the registry/project root the command reads. */
  root: string;
  /** Restores `os.homedir()` and removes the synthetic home. Call in `afterEach`. */
  restore: () => void;
}

/**
 * `session-context`'s handler resolves its registry and project root through `userDataPaths()`,
 * which hardcodes `os.homedir()` with no injection seam. Spying on `os.homedir()` is the only way
 * to point it at a disposable root instead of the developer's real `~/.radorc/` — the same pattern
 * `cli/tests/commands/session-context/index.test.ts` uses.
 */
export function createWorld(): SessionContextWorld {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-behavioral-'));
  const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(home);
  return {
    home,
    root: path.join(home, '.radorc'),
    restore: () => {
      homedirSpy.mockRestore();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}
