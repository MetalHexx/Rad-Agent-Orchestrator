import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addRepo } from '@rad-orchestration/repo-registry';
import { WorkGraphService } from '@rad-orchestration/work-graph';
import { sessionContextCommand } from '../../../src/commands/session-context/index.js';
import { DELIVERY_PREFIX, COMMUNICATION_STYLE_PREFIX } from '../../../src/commands/session-context/render.js';
import * as renderLib from '../../../src/commands/session-context/render.js';
import * as communicationStyleLib from '../../../src/lib/communication-style.js';
import * as resolveLib from '../../../src/commands/session-context/resolve.js';
import type { CommandContext } from '../../../src/framework/context.js';

let tmpHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-idx-'));
  homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
});

afterEach(() => {
  homedirSpy.mockRestore();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const configPath = () => path.join(tmpHome, '.radorc', 'orchestration.yml');
const registryRoot = () => path.join(tmpHome, '.radorc');
const ctx = {} as CommandContext;

/** The Config row (and its communication-style indicator) only renders once a repo is registered. */
function registerARepo(): void {
  addRepo({ root: registryRoot(), name: 'repo-one', identity: { remote: 'g', default_branch: 'main', description: '' }, localPath: '/c/one' });
}

/** A portfolio is a `{name}-ROOT` project directory holding a `{name}-ROOT.md` document of its
 *  own name; `status` becomes that document's frontmatter, absent when null. */
function registerPortfolio(name: string, status: 'active' | 'on-hold' | 'done' | null): void {
  const rootDir = path.join(registryRoot(), 'projects', `${name}-ROOT`);
  fs.mkdirSync(rootDir, { recursive: true });
  const frontmatter = status ? `---\nstatus: ${status}\n---\n` : '';
  fs.writeFileSync(path.join(rootDir, `${name}-ROOT.md`), `${frontmatter}# ${name}\n`);
}

describe('session-context — --verbosity override precedence', () => {
  it('a --verbosity flag wins over a different persisted config value, without touching the file', async () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), 'ambient_awareness:\n  verbosity: verbose\n');
    const before = fs.readFileSync(configPath(), 'utf8');
    const beforeMtime = fs.statSync(configPath()).mtimeMs;

    const result = await sessionContextCommand.handler({ args: {}, flags: { verbosity: 'off' }, ctx });

    expect(result.preamble).toBe('');
    expect(fs.readFileSync(configPath(), 'utf8')).toBe(before);
    expect(fs.statSync(configPath()).mtimeMs).toBe(beforeMtime);
  });

  it('falls back to the persisted level when no --verbosity flag is supplied', async () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), 'ambient_awareness:\n  verbosity: verbose\n');

    const result = await sessionContextCommand.handler({ args: {}, flags: {}, ctx });

    expect(result.preamble.startsWith(DELIVERY_PREFIX)).toBe(true);
  });
});

describe('session-context — session identity flags', () => {
  it('carries --session/--cwd/--harness into the Session row', async () => {
    registerARepo();

    const result = await sessionContextCommand.handler({
      args: {},
      flags: { session: 'sess-123', cwd: '/launch/dir', harness: 'claude' },
      ctx,
    });

    expect(result.preamble).toContain('**Session** · id `sess-123` · cwd `/launch/dir` · harness `claude`');
  });

  it('renders byte-identically to today when no identity flags are supplied', async () => {
    registerARepo();

    const withoutFlags = await sessionContextCommand.handler({ args: {}, flags: {}, ctx });
    const withEmptyFlags = await sessionContextCommand.handler({
      args: {},
      flags: { session: undefined, cwd: undefined, harness: undefined },
      ctx,
    });

    expect(withoutFlags.preamble).not.toContain('**Session**');
    expect(withEmptyFlags.preamble).toBe(withoutFlags.preamble);
  });

  it('renders no Session row for the identity-less shape the hook shim spawns', async () => {
    registerARepo();

    // What session-preamble.mjs passes when stdin carried no parseable identity: --harness
    // only, since its harness value always defaults to 'claude'.
    const result = await sessionContextCommand.handler({ args: {}, flags: { harness: 'claude' }, ctx });

    expect(result.preamble).not.toContain('**Session**');
  });

  it('renders no Session row when only --cwd is supplied', async () => {
    registerARepo();

    const result = await sessionContextCommand.handler({ args: {}, flags: { cwd: '/launch/dir' }, ctx });

    expect(result.preamble).not.toContain('**Session**');
  });

  it('does not route --cwd into worktree standing resolution', async () => {
    registerARepo();
    const spy = vi.spyOn(resolveLib, 'resolveStanding');

    await sessionContextCommand.handler({
      args: {},
      flags: { cwd: '/some/other/launch/dir' },
      ctx,
    });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ cwd: process.cwd() }));
    spy.mockRestore();
  });
});

describe('session-context — active projects canonical state', () => {
  it('carries the dashboard stateLabel through to the Active Projects row', async () => {
    registerARepo();
    const projectDir = path.join(registryRoot(), 'projects', 'REPO-POEM');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'state.json'), JSON.stringify({
      pipeline: { current_tier: 'execution' },
      graph: { nodes: { phase_loop: { status: 'in_progress' } } },
    }));

    const result = await sessionContextCommand.handler({ args: {}, flags: {}, ctx });

    expect(result.preamble).toContain('`REPO-POEM` (Executing)');
  });
});

describe('session-context — communication style resolution', () => {
  it('enabled + resolvable: the style prose is delivered and named in the Config row', async () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    registerARepo();
    fs.writeFileSync(configPath(), 'communication_style:\n  enabled: true\n  selected: caveman.md\n');
    const spy = vi.spyOn(communicationStyleLib, 'readSelectedStyle').mockReturnValue({
      name: 'caveman',
      frontmatter: { name: 'caveman', title: 'Caveman', description: 'Short words' },
      body: 'Short words. Big meaning.',
    });

    const result = await sessionContextCommand.handler({ args: {}, flags: {}, ctx });

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('communication-styles'), 'caveman.md');
    expect(result.preamble).toContain('communication style `caveman`');
    expect(result.preamble).toContain(COMMUNICATION_STYLE_PREFIX);
    expect(result.preamble).toContain('Short words. Big meaning.');
    spy.mockRestore();
  });

  it('enabled + unresolvable (null): degrades to off, no style prose', async () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    registerARepo();
    fs.writeFileSync(configPath(), 'communication_style:\n  enabled: true\n  selected: missing.md\n');
    const spy = vi.spyOn(communicationStyleLib, 'readSelectedStyle').mockReturnValue(null);

    const result = await sessionContextCommand.handler({ args: {}, flags: {}, ctx });

    expect(spy).toHaveBeenCalled();
    expect(result.preamble).toContain('communication style `off`');
    expect(result.preamble).not.toContain(COMMUNICATION_STYLE_PREFIX);
    spy.mockRestore();
  });

  it('disabled: the style is not even looked up', async () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    registerARepo();
    fs.writeFileSync(configPath(), 'communication_style:\n  enabled: false\n');
    const spy = vi.spyOn(communicationStyleLib, 'readSelectedStyle');

    const result = await sessionContextCommand.handler({ args: {}, flags: {}, ctx });

    expect(spy).not.toHaveBeenCalled();
    expect(result.preamble).toContain('communication style `off`');
    spy.mockRestore();
  });
});

describe('session-context — active portfolios list', () => {
  it('reaches activePortfolios with a portfolio whose lifecycle status is active', async () => {
    registerARepo();
    registerPortfolio('PLATFORM', 'active');
    const spy = vi.spyOn(renderLib, 'renderPreamble');

    await sessionContextCommand.handler({ args: {}, flags: {}, ctx });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ activePortfolios: ['PLATFORM'] }));
    spy.mockRestore();
  });

  it('filters out a portfolio whose lifecycle status is not active', async () => {
    registerARepo();
    registerPortfolio('PLATFORM', 'active');
    registerPortfolio('LEGACY', 'done');
    const spy = vi.spyOn(renderLib, 'renderPreamble');

    await sessionContextCommand.handler({ args: {}, flags: {}, ctx });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ activePortfolios: ['PLATFORM'] }));
    spy.mockRestore();
  });

  it('leaves the preamble unchanged when listPortfolios throws', async () => {
    registerARepo();
    const baseline = await sessionContextCommand.handler({ args: {}, flags: {}, ctx });

    const listSpy = vi.spyOn(WorkGraphService.prototype, 'listPortfolios').mockImplementation(() => {
      throw new Error('projects directory unreadable');
    });

    const result = await sessionContextCommand.handler({ args: {}, flags: {}, ctx });

    expect(result.preamble).toBe(baseline.preamble);
    listSpy.mockRestore();
  });
});
