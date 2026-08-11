import { describe, it, expect, vi } from 'vitest';
import { executePrepare, executePrepareCommand } from '../../../src/commands/execute/prepare.js';
import type { ExecutePrepareOptions, ExecutePrepareResult } from '../../../src/commands/execute/prepare.js';
import { runCommand } from '../../../src/framework/command.js';
import { validateEnvelope } from '../../../src/framework/output.js';
import type { ProvisionWorktreesResult } from '../../../src/commands/worktree/create.js';
import type { SideProjectInitResult } from '../../../src/commands/side-project/init.js';
import type { PipelineResult } from '../../../src/lib/pipeline-engine/types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const provisioned = (over: Partial<ProvisionWorktreesResult['repos'][number]> = {}): ProvisionWorktreesResult => ({
  repos: [{ name: 'rad-orc-source', created: true, pushed: true, path: '/wt/P/rad-orc-source', branch: 'radorch/P', error: null, errorType: null, ...over }],
});

const sideInit = (over: Partial<SideProjectInitResult> = {}): SideProjectInitResult => ({
  created: true, repoPath: '/sp/SP', branch: 'main', seedCommitMessage: 'chore: initialize side-project', error: null, errorType: null, ...over,
});

const approved = (over: Partial<PipelineResult> = {}): PipelineResult => ({ action: 'execute_task', context: {}, ...over });

const deps = (over: Partial<ExecutePrepareOptions> = {}): ExecutePrepareOptions => ({
  project: 'P',
  autoCommit: 'always',
  autoPr: 'never',
  readProjectRepos: () => ({ repos: ['rad-orc-source'], projectType: 'standard' as const }),
  provision: vi.fn(() => provisioned()),
  sideProjectExists: vi.fn(() => false),
  sideProjectInit: vi.fn(() => sideInit()),
  seal: vi.fn(() => ({ ok: true as const, projectDir: '/projects/P' })),
  approvePlan: vi.fn(async () => approved()),
  ...over,
});

// ── Composition ───────────────────────────────────────────────────────────────

describe('executePrepare — provision then seal', () => {
  it('provisions and seals a standard project', async () => {
    const provision = vi.fn(() => provisioned());
    const seal = vi.fn(() => ({ ok: true as const, projectDir: '/projects/P' }));
    const r = await executePrepare(deps({ provision, seal }));
    expect(provision).toHaveBeenCalledTimes(1);
    expect(seal).toHaveBeenCalledTimes(1);
    expect(r.provisioned).not.toBeNull();
    expect(r.sealed?.ok).toBe(true);
  });

  it('is idempotent: an already-present worktree (created:false) still seals', async () => {
    const seal = vi.fn(() => ({ ok: true as const, projectDir: '/projects/P' }));
    const r = await executePrepare(deps({ provision: () => provisioned({ created: false, pushed: true }), seal }));
    expect(seal).toHaveBeenCalledTimes(1);
    expect(r.sealed?.ok).toBe(true);
  });

  it('side-project (repo absent): provisions via side-project init, then seals — no worktree provisioning', async () => {
    const provision = vi.fn();
    const sideProjectInit = vi.fn(() => sideInit());
    const seal = vi.fn(() => ({ ok: true as const, projectDir: '/projects/SP' }));
    const r = await executePrepare(deps({
      readProjectRepos: () => ({ repos: ['SP'], projectType: 'side-project' as const }),
      sideProjectExists: () => false,
      provision,
      sideProjectInit,
      seal,
    }));
    expect(provision).not.toHaveBeenCalled();
    expect(sideProjectInit).toHaveBeenCalledTimes(1);
    expect(seal).toHaveBeenCalledTimes(1);
    expect(r.provisioned).toBeNull();
    expect(r.sideProjectInit?.created).toBe(true);
    expect(r.sealed?.ok).toBe(true);
  });

  it('side-project (repo already exists): skips side-project init but still seals (idempotent)', async () => {
    const sideProjectInit = vi.fn(() => sideInit());
    const seal = vi.fn(() => ({ ok: true as const, projectDir: '/projects/SP' }));
    const r = await executePrepare(deps({
      readProjectRepos: () => ({ repos: ['SP'], projectType: 'side-project' as const }),
      sideProjectExists: () => true,
      sideProjectInit,
      seal,
    }));
    expect(sideProjectInit).not.toHaveBeenCalled();
    expect(seal).toHaveBeenCalledTimes(1);
    expect(r.sideProjectInit ?? null).toBeNull();
    expect(r.sealed?.ok).toBe(true);
  });

  it('side-project init failure stops before sealing', async () => {
    const seal = vi.fn();
    const r = await executePrepare(deps({
      readProjectRepos: () => ({ repos: ['SP'], projectType: 'side-project' as const }),
      sideProjectExists: () => false,
      sideProjectInit: () => sideInit({ created: false, error: 'git init failed', errorType: 'init_failed' }),
      seal,
    }));
    expect(seal).not.toHaveBeenCalled();
    expect(r.sealed).toBeNull();
    expect(r.sideProjectInit?.created).toBe(false);
  });

  it('passes worktree-name through to provision and seal (reuse path)', async () => {
    let provName: string | undefined; let sealName: string | undefined;
    const provision = vi.fn((a: { worktreeName?: string }) => { provName = a.worktreeName; return provisioned(); });
    const seal = vi.fn((a: { worktreeName?: string }) => { sealName = a.worktreeName; return { ok: true as const, projectDir: '/projects/P' }; });
    await executePrepare(deps({ worktreeName: 'PARENT', provision, seal }));
    expect(provName).toBe('PARENT');
    expect(sealName).toBe('PARENT');
  });

  it('a hard provisioning failure stops before sealing', async () => {
    const seal = vi.fn();
    const r = await executePrepare(deps({ provision: () => provisioned({ created: false, pushed: false, error: 'boom', errorType: 'unknown' }), seal }));
    expect(seal).not.toHaveBeenCalled();
    expect(r.sealed).toBeNull();
  });

  it('passes resolved auto-commit/auto-pr through to the seal', async () => {
    let received: { autoCommit: string; autoPr: string } | null = null;
    const seal = vi.fn((args: { autoCommit: 'always' | 'never'; autoPr: 'always' | 'never' }) => {
      received = { autoCommit: args.autoCommit, autoPr: args.autoPr };
      return { ok: true as const, projectDir: '/projects/P' };
    });
    await executePrepare(deps({ autoCommit: 'never', autoPr: 'always', seal }));
    expect(received).toEqual({ autoCommit: 'never', autoPr: 'always' });
  });

  it('in-place: skips provisioning entirely and seals with inPlace + baseBranch', async () => {
    const provision = vi.fn(() => provisioned());
    const seal = vi.fn(() => ({ ok: true as const, projectDir: '/projects/P' }));
    const r = await executePrepare(deps({ inPlace: true, baseBranch: 'main', provision, seal }));
    expect(provision).not.toHaveBeenCalled();
    expect(seal).toHaveBeenCalledWith(expect.objectContaining({ inPlace: true, baseBranch: 'main' }));
    expect(r.provisioned).toBeNull();
    expect(r.sealed?.ok).toBe(true);
  });

  it('in-place: passes the confirmed branch through to the seal', async () => {
    const seal = vi.fn(() => ({ ok: true as const, projectDir: '/projects/P' }));
    await executePrepare(deps({ inPlace: true, baseBranch: 'main', branch: 'feature-x', seal }));
    expect(seal).toHaveBeenCalledWith(expect.objectContaining({ branch: 'feature-x' }));
  });

  it('in-place: re-running the same invocation re-derives identical seal args (idempotent)', async () => {
    const seal = vi.fn(() => ({ ok: true as const, projectDir: '/projects/P' }));
    await executePrepare(deps({ inPlace: true, baseBranch: 'main', seal }));
    await executePrepare(deps({ inPlace: true, baseBranch: 'main', seal }));
    expect(seal.mock.calls[0]).toEqual(seal.mock.calls[1]);
  });
});

// ── Plan approval (running /rad-execute confers approval) ─────────────────────

describe('executePrepare — plan approval', () => {
  it('approves the plan after a successful seal', async () => {
    const approvePlan = vi.fn(async () => approved());
    const r = await executePrepare(deps({ approvePlan }));
    expect(approvePlan).toHaveBeenCalledTimes(1);
    expect(r.planApproved).not.toBeNull();
  });

  it('approves the plan for a side-project too', async () => {
    const approvePlan = vi.fn(async () => approved());
    await executePrepare(deps({
      readProjectRepos: () => ({ repos: ['SP'], projectType: 'side-project' as const }),
      sideProjectExists: () => false,
      seal: () => ({ ok: true as const, projectDir: '/projects/SP' }),
      approvePlan,
    }));
    expect(approvePlan).toHaveBeenCalledTimes(1);
  });

  it('does not approve the plan when the seal fails', async () => {
    const approvePlan = vi.fn(async () => approved());
    const r = await executePrepare(deps({ seal: () => ({ ok: false as const, error: 'no state.json' }), approvePlan }));
    expect(approvePlan).not.toHaveBeenCalled();
    expect(r.planApproved ?? null).toBeNull();
  });

  it('does not approve the plan when provisioning hard-fails', async () => {
    const approvePlan = vi.fn(async () => approved());
    await executePrepare(deps({ provision: () => provisioned({ created: false, pushed: false, error: 'boom', errorType: 'unknown' }), approvePlan }));
    expect(approvePlan).not.toHaveBeenCalled();
  });

  it('does not approve the plan when side-project init fails', async () => {
    const approvePlan = vi.fn(async () => approved());
    await executePrepare(deps({
      readProjectRepos: () => ({ repos: ['SP'], projectType: 'side-project' as const }),
      sideProjectExists: () => false,
      sideProjectInit: () => sideInit({ created: false, error: 'git init failed', errorType: 'init_failed' }),
      approvePlan,
    }));
    expect(approvePlan).not.toHaveBeenCalled();
  });
});

// ── Exit-code precedence (mapResult) ─────────────────────────────────────────

describe('executePrepareCommand.mapResult — exit-code precedence', () => {
  const mr = executePrepareCommand.mapResult!;

  it('provision hard error → ok:false system_error (exit 2)', () => {
    const r: ExecutePrepareResult = { provisioned: provisioned({ created: false, pushed: false, error: 'boom', errorType: 'unknown' }), sealed: null };
    const env = mr(r);
    expect(env.ok).toBe(false);
    expect(env.error?.type).toBe('system_error');
    expect(env).not.toHaveProperty('data');
    expect(() => validateEnvelope(env)).not.toThrow();
  });

  it('side-project init hard error → ok:false system_error (exit 2)', () => {
    const r: ExecutePrepareResult = { provisioned: null, sideProjectInit: sideInit({ created: false, repoPath: null, error: 'git init failed', errorType: 'init_failed' }), sealed: null };
    const env = mr(r);
    expect(env.ok).toBe(false);
    expect(env.error?.type).toBe('system_error');
    expect(env.error?.message).toMatch(/init failed/i);
    expect(env).not.toHaveProperty('data');
    expect(() => validateEnvelope(env)).not.toThrow();
  });

  it('seal failure → ok:false user_error (exit 1)', () => {
    const r: ExecutePrepareResult = { provisioned: provisioned(), sealed: { ok: false, error: 'no state.json' } };
    const env = mr(r);
    expect(env.ok).toBe(false);
    expect(env.error?.type).toBe('user_error');
    expect(env.error?.message).toMatch(/state\.json/);
    expect(env).not.toHaveProperty('data');
    expect(() => validateEnvelope(env)).not.toThrow();
  });

  it('success → ok:true exit_code 0', () => {
    const r: ExecutePrepareResult = { provisioned: provisioned(), sealed: { ok: true, projectDir: '/projects/P' } };
    const env = mr(r);
    expect(env.ok).toBe(true);
    expect(env.exit_code).toBe(0);
  });

  it('created-but-not-pushed → ok:true exit_code 1 with a warning', () => {
    const r: ExecutePrepareResult = { provisioned: provisioned({ created: true, pushed: false }), sealed: { ok: true, projectDir: '/projects/P' } };
    const env = mr(r);
    expect(env.ok).toBe(true);
    expect(env.exit_code).toBe(1);
    expect(env.warnings?.[0]).toMatch(/push/i);
  });

  it('plan auto-approval failure → ok:true exit_code 0 with a warning (non-fatal)', () => {
    const r: ExecutePrepareResult = {
      provisioned: provisioned(),
      sealed: { ok: true, projectDir: '/projects/P' },
      planApproved: { action: null, context: {}, error: { message: 'gate locked', event: 'plan_approved' } },
    };
    const env = mr(r);
    expect(env.ok).toBe(true);
    expect(env.exit_code).toBe(0);
    expect(env.warnings?.some((w) => /approval/i.test(w))).toBe(true);
  });
});

// ── CLI passthrough (runCommand argv → handler args) ─────────────────────────

describe('executePrepareCommand CLI path', () => {
  it('passes --project, --worktree-name, --repo, --auto-commit, --auto-pr, --in-place, --base-branch, --branch through runCommand', async () => {
    type PrepArgs = { project?: string; 'worktree-name'?: string; repo?: string };
    type PrepFlags = { 'auto-commit'?: string; 'auto-pr'?: string; 'in-place'?: boolean; 'base-branch'?: string; branch?: string };
    let received: { args: PrepArgs; flags: PrepFlags } = { args: {}, flags: {} };
    const probeDef = {
      ...executePrepareCommand,
      handler: async ({ args, flags }: { args: PrepArgs; flags: PrepFlags; ctx: unknown }) => {
        received = { args, flags };
        return { provisioned: null, sealed: { ok: true, projectDir: '/x' } } as never;
      },
      mapResult: undefined,
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as never);
    await runCommand(probeDef, {
      argv: ['--project', 'MY-PROJECT', '--worktree-name', 'MY-WT', '--repo', 'my-repo', '--auto-commit', 'always', '--auto-pr', 'never', '--in-place', '--base-branch', 'main', '--branch', 'feature-x'],
      env: { RADORCH_NO_LOG: '1' },
      isTTY: false,
      stderr: process.stderr,
    });
    expect(received.args.project).toBe('MY-PROJECT');
    expect(received.args['worktree-name']).toBe('MY-WT');
    expect(received.args.repo).toBe('my-repo');
    expect(received.flags['auto-commit']).toBe('always');
    expect(received.flags['auto-pr']).toBe('never');
    expect(received.flags['in-place']).toBe(true);
    expect(received.flags['base-branch']).toBe('main');
    expect(received.flags.branch).toBe('feature-x');
    expect(exit).toHaveBeenCalledWith(0);
    log.mockRestore(); exit.mockRestore();
  });
});
