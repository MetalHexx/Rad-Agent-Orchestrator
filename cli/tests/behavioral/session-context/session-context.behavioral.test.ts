import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { addRepo } from '@rad-orchestration/repo-registry';
import { sessionContextCommand } from '../../../src/commands/session-context/index.js';
import { createWorld, type SessionContextWorld } from './helpers/world.js';
import type { CommandContext } from '../../../src/framework/context.js';

const ctx = {} as CommandContext;

/** A portfolio is a `{name}-ROOT` project directory holding a `{name}-ROOT.md` document of its
 *  own name; `status` becomes that document's frontmatter. Authored here rather than imported —
 *  this tier's fixtures are not shared across suites. */
function registerPortfolio(root: string, name: string, status: 'active' | 'on-hold' | 'done'): void {
  const rootDir = path.join(root, 'projects', `${name}-ROOT`);
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, `${name}-ROOT.md`), `---\nstatus: ${status}\n---\n# ${name}\n`);
}

describe('session-context (behavioral)', () => {
  let world: SessionContextWorld;
  afterEach(() => world.restore());

  it('the envelope carries data.preamble as a string and gains no new top-level field', async () => {
    world = createWorld();
    addRepo({ root: world.root, name: 'repo-one', identity: { remote: 'g', default_branch: 'main', description: '' }, localPath: '/c/one' });

    const result = await sessionContextCommand.handler({ args: {}, flags: {}, ctx });

    expect(Object.keys(result)).toEqual(['preamble']);
    expect(typeof result.preamble).toBe('string');
    expect(result.preamble.length).toBeGreaterThan(0);
  });

  it('still just data.preamble once an active portfolio resolves end-to-end through the real registry and project tree', async () => {
    world = createWorld();
    addRepo({ root: world.root, name: 'repo-one', identity: { remote: 'g', default_branch: 'main', description: '' }, localPath: '/c/one' });
    registerPortfolio(world.root, 'PLATFORM', 'active');

    const result = await sessionContextCommand.handler({ args: {}, flags: {}, ctx });

    expect(Object.keys(result)).toEqual(['preamble']);
    expect(typeof result.preamble).toBe('string');
    expect(result.preamble.length).toBeGreaterThan(0);
  });
});
