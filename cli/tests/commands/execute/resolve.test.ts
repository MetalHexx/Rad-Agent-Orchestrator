import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { executeResolve, isClaudeCodeHarness } from '../../../src/commands/execute/resolve.js';
import type { ExecuteResolveDeps, RecordedSourceControl, RunMode } from '../../../src/commands/execute/resolve.js';
import type { CloneFacts } from '../../../src/lib/clone-facts.js';
import type { Project, LocateResult, NodeStatus, Tier } from '@rad-orchestration/work-graph';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProject(
  name: string,
  opts: {
    masterPlan?: string | null;
    status?: NodeStatus;
    sourceControlInitialized?: boolean;
    projectType?: 'standard' | 'side-project';
    tier?: Tier | null;
  } = {},
): Project {
  const docs: Project['docs'] = { others: [] };
  if (opts.masterPlan !== null) docs.masterPlan = opts.masterPlan ?? `${name}-MASTER-PLAN.md`;
  return {
    id: name,
    kind: 'project',
    name,
    status: opts.status ?? 'in_progress',
    dir: `/projects/${name}`,
    tier: opts.tier ?? 'execution',
    projectType: opts.projectType ?? 'standard',
    sourceControlInitialized: opts.sourceControlInitialized ?? false,
    docs,
    worktrees: [],
  };
}

const loc = (over: Partial<LocateResult> & { kind: LocateResult['kind'] }): LocateResult => ({ ...over });

const facts = (over: Partial<CloneFacts> & { path: string }): CloneFacts => ({
  exists: true,
  branch: 'main',
  dirty: [],
  ...over,
});

const deps = (over: Partial<ExecuteResolveDeps> = {}): ExecuteResolveDeps => ({
  cwd: '/somewhere',
  project: undefined,
  locate: () => loc({ kind: 'none' }),
  listProjects: () => [makeProject('P')],
  readProjectRepos: () => ({ repos: ['rad-orc-source'], projectType: 'standard' as const }),
  readConfig: () => ({ autoCommit: 'always', autoPr: 'never' }),
  defaultBranch: () => 'main',
  worktreeExists: () => true,
  planApproved: () => true,
  worktreesDir: '/wt',
  sideProjectsDir: '/sp',
  isClaudeHarness: () => true,
  recordedSourceControl: () => null,
  cloneFacts: () => null,
  repoStanding: () => 'bound',
  ...over,
});

// ── isClaudeCodeHarness ───────────────────────────────────────────────────────

describe('isClaudeCodeHarness', () => {
  it('true when CLAUDECODE is a non-empty string', () => {
    expect(isClaudeCodeHarness({ CLAUDECODE: '1' })).toBe(true);
  });

  it('true when any CLAUDE_CODE_* key is set', () => {
    expect(isClaudeCodeHarness({ CLAUDE_CODE_ENTRYPOINT: 'cli' })).toBe(true);
  });

  it('false for CLAUDE_PLUGIN_ROOT alone (Copilot in VS Code injects this too)', () => {
    expect(isClaudeCodeHarness({ CLAUDE_PLUGIN_ROOT: '/plugins/rad-orchestration' })).toBe(false);
  });

  it('false for COPILOT_PLUGIN_ROOT alone', () => {
    expect(isClaudeCodeHarness({ COPILOT_PLUGIN_ROOT: '/plugins/rad-orchestration' })).toBe(false);
  });

  it('false for an empty environment', () => {
    expect(isClaudeCodeHarness({})).toBe(false);
  });
});

// ── Run-mode matrix: location × settled-ness ─────────────────────────────────

describe('executeResolve — run mode from location + settled-ness', () => {
  interface Cell {
    location: string;
    locate: () => LocateResult;
    /** Set when this location stands in a DIFFERENT project's worktree. */
    otherProject?: string;
  }

  const cells: Cell[] = [
    { location: 'the workspace folder itself', locate: () => loc({ kind: 'worktree', worktree_name: 'P', projects: ['P'], branch: 'radorch/P' }) },
    { location: 'a repo worktree beneath it', locate: () => loc({ kind: 'worktree', worktree_name: 'P', projects: ['P'], repo: 'rad-orc-source', branch: 'radorch/P' }) },
    { location: "a different project's worktree", locate: () => loc({ kind: 'worktree', worktree_name: 'OTHER', projects: ['OTHER'], branch: 'radorch/OTHER' }), otherProject: 'OTHER' },
    { location: 'a main clone', locate: () => loc({ kind: 'main-clone', repo: 'rad-orc-source' }) },
    { location: 'nowhere', locate: () => loc({ kind: 'none' }) },
  ];

  // Config forces autoCommit/autoPr to 'ask' uniformly so the matrix can prove
  // they are suppressed exactly on the settled paths (the regression this
  // whole matrix exists to prevent) and asked everywhere else.
  const expected: Record<string, { settled: { runMode: RunMode; ask: string[] }; unsettled: { runMode: RunMode; ask: string[] } }> = {
    'the workspace folder itself': {
      settled: { runMode: 'resume', ask: [] },
      unsettled: { runMode: 'in-place', ask: ['autoCommit', 'autoPr', 'confirmHere'] },
    },
    'a repo worktree beneath it': {
      settled: { runMode: 'resume', ask: [] },
      unsettled: { runMode: 'in-place', ask: ['autoCommit', 'autoPr', 'confirmHere'] },
    },
    "a different project's worktree": {
      settled: { runMode: 'launch', ask: [] },
      unsettled: { runMode: 'in-place', ask: ['autoCommit', 'autoPr', 'reuseWorktree'] },
    },
    'a main clone': {
      settled: { runMode: 'launch', ask: [] },
      unsettled: { runMode: 'launch', ask: ['autoCommit', 'autoPr'] },
    },
    nowhere: {
      settled: { runMode: 'launch', ask: [] },
      unsettled: { runMode: 'launch', ask: ['autoCommit', 'autoPr'] },
    },
  };

  for (const cell of cells) {
    for (const settled of [true, false] as const) {
      const exp = expected[cell.location]![settled ? 'settled' : 'unsettled'];
      it(`${cell.location}, ${settled ? 'settled' : 'unsettled'} → ${exp.runMode}, asks exactly [${exp.ask.join(', ') || '(none)'}]`, () => {
        const listProjects = cell.otherProject
          ? () => [makeProject('P', { sourceControlInitialized: settled }), makeProject(cell.otherProject!)]
          : () => [makeProject('P', { sourceControlInitialized: settled })];
        const r = executeResolve(deps({
          project: 'P',
          locate: cell.locate,
          listProjects,
          readConfig: () => ({ autoCommit: 'ask', autoPr: 'ask' }),
        }));
        expect(r.runMode).toBe(exp.runMode);
        expect(Object.keys(r.ask).sort()).toEqual([...exp.ask].sort());
      });
    }
  }

  it('settled worktree with an UNAPPROVED plan → resume that approves before driving', () => {
    const r = executeResolve(deps({
      locate: () => loc({ kind: 'worktree', worktree_name: 'P', projects: ['P'], branch: 'radorch/P' }),
      listProjects: () => [makeProject('P', { sourceControlInitialized: true })],
      planApproved: () => false,
    }));
    expect(r.runMode).toBe('resume');
    expect(r.next).toEqual([
      'gate approve plan --project-dir "/projects/P"',
      'pipeline signal --event start --project-dir "/projects/P"',
    ]);
  });

  it('side-project (unsettled) → in-place, derived points under the side-projects dir on main', () => {
    const r = executeResolve(deps({
      locate: () => loc({ kind: 'side-project', worktree_name: 'SP' }),
      listProjects: () => [makeProject('SP', { projectType: 'side-project', sourceControlInitialized: false })],
      readProjectRepos: () => ({ repos: ['SP'], projectType: 'side-project' as const }),
    }));
    expect(r.runMode).toBe('in-place');
    expect(r.derived?.branch).toBe('main');
    expect(r.derived?.launchDir).toBe(path.join('/sp', 'SP'));
    expect(r.derived?.repos[0]?.worktreePath).toBe(path.join('/sp', 'SP'));
  });

  it('settled project named while standing in a DIFFERENT project\'s worktree → launches into ITS OWN workspace folder, no reuse offer', () => {
    const r = executeResolve(deps({
      project: 'P',
      locate: () => loc({ kind: 'worktree', worktree_name: 'OTHER', projects: ['OTHER'], branch: 'radorch/OTHER' }),
      listProjects: () => [makeProject('P', { sourceControlInitialized: true }), makeProject('OTHER')],
      worktreesDir: '/wt',
    }));
    expect(r.runMode).toBe('launch');
    expect(r.ask.reuseWorktree).toBeUndefined();
    expect(r.derived?.launchDir).toBe(path.join('/wt', 'P'));
  });
});

// ── Harness detection drives the launch-flavor question ──────────────────────

describe('executeResolve — launch flavor follows harness detection', () => {
  it('under Claude Code, a settled launch from elsewhere asks nothing and writes --agent claude literally', () => {
    const r = executeResolve(deps({
      project: 'P',
      locate: () => loc({ kind: 'none' }),
      listProjects: () => [makeProject('P', { sourceControlInitialized: true })],
      isClaudeHarness: () => true,
    }));
    expect(r.ask.launchFlavor).toBeUndefined();
    expect(r.next[0]).toMatch(/--agent claude\b/);
  });

  it('under a non-Claude harness, a settled launch from elsewhere asks the flavor and carries {flavor}', () => {
    const r = executeResolve(deps({
      project: 'P',
      locate: () => loc({ kind: 'none' }),
      listProjects: () => [makeProject('P', { sourceControlInitialized: true })],
      isClaudeHarness: () => false,
    }));
    expect(r.ask.launchFlavor).toBe(true);
    expect(r.next[0]).toMatch(/--agent \{flavor\}/);
  });

  it('under a non-Claude harness, the fully-questioned launch (unsettled, no worktree) also asks the flavor and carries {flavor}', () => {
    const r = executeResolve(deps({
      project: 'P',
      locate: () => loc({ kind: 'none' }),
      listProjects: () => [makeProject('P', { sourceControlInitialized: false })],
      isClaudeHarness: () => false,
    }));
    expect(r.ask.launchFlavor).toBe(true);
    expect(r.next[1]).toMatch(/--agent \{flavor\}/);
  });

  it('resume never asks the flavor, regardless of harness', () => {
    const r = executeResolve(deps({
      locate: () => loc({ kind: 'worktree', worktree_name: 'P', projects: ['P'], branch: 'radorch/P' }),
      listProjects: () => [makeProject('P', { sourceControlInitialized: true })],
      isClaudeHarness: () => false,
    }));
    expect(r.ask.launchFlavor).toBeUndefined();
  });
});

// ── No permission-mode flag anywhere ─────────────────────────────────────────

describe('executeResolve — permission mode is never asked or emitted', () => {
  it('no resolved command string carries --permission-mode, on any path', () => {
    const scenarios: ExecuteResolveDeps[] = [
      deps({ project: 'P', locate: () => loc({ kind: 'none' }), listProjects: () => [makeProject('P', { sourceControlInitialized: true })] }),
      deps({ project: 'P', locate: () => loc({ kind: 'none' }), listProjects: () => [makeProject('P', { sourceControlInitialized: false })] }),
      deps({ project: 'P', locate: () => loc({ kind: 'main-clone', repo: 'rad-orc-source' }), listProjects: () => [makeProject('P')] }),
      deps({
        locate: () => loc({ kind: 'worktree', worktree_name: 'PARENT', projects: ['PARENT'], branch: 'radorch/PARENT' }),
        project: 'FOLLOWUP',
        listProjects: () => [makeProject('FOLLOWUP'), makeProject('PARENT')],
      }),
    ];
    for (const d of scenarios) {
      const r = executeResolve(d);
      for (const cmd of r.next) expect(cmd).not.toMatch(/--permission-mode/);
    }
  });
});

// ── Rebuild-and-tell for a missing workspace folder ──────────────────────────

describe('executeResolve — rebuild-and-tell for a missing workspace folder', () => {
  const recorded = (worktreeName: string, repoNames: string[]): RecordedSourceControl => ({
    worktreeName,
    repos: repoNames.map((name) => ({ name, branch: `radorch/${worktreeName}`, inPlace: false })),
  });

  it('resume: all repos present → no rebuild command, no notice, empty missingRepos', () => {
    const r = executeResolve(deps({
      locate: () => loc({ kind: 'worktree', worktree_name: 'P', projects: ['P'], branch: 'radorch/P' }),
      listProjects: () => [makeProject('P', { sourceControlInitialized: true })],
      readProjectRepos: () => ({ repos: ['fake-api', 'fake-ui'], projectType: 'standard' as const }),
      recordedSourceControl: () => recorded('P', ['fake-api', 'fake-ui']),
      worktreeExists: () => true,
    }));
    expect(r.runMode).toBe('resume');
    expect(r.next.some((c) => c.startsWith('worktree create'))).toBe(false);
    expect(r.notices).toBeUndefined();
    expect(r.derived?.missingRepos).toEqual([]);
  });

  it('resume: one of two repos missing → rebuild command carries the recorded worktree name, notice names the repo, missingRepos lists only it', () => {
    const r = executeResolve(deps({
      locate: () => loc({ kind: 'worktree', worktree_name: 'P', projects: ['P'], branch: 'radorch/P' }),
      listProjects: () => [makeProject('P', { sourceControlInitialized: true })],
      readProjectRepos: () => ({ repos: ['fake-api', 'fake-ui'], projectType: 'standard' as const }),
      recordedSourceControl: () => recorded('RECORDED-NAME', ['fake-api', 'fake-ui']),
      worktreeExists: (_wt, repo) => repo === 'fake-api',
    }));
    expect(r.runMode).toBe('resume');
    expect(r.next[0]).toBe('worktree create --project P --worktree-name RECORDED-NAME');
    expect(r.notices).toBeDefined();
    expect(r.notices?.[0]).toMatch(/fake-ui/);
    expect(r.derived?.missingRepos).toEqual(['fake-ui']);
  });

  it('settled launch from elsewhere: all repos present → no rebuild command and no notice', () => {
    const r = executeResolve(deps({
      project: 'P',
      locate: () => loc({ kind: 'none' }),
      listProjects: () => [makeProject('P', { sourceControlInitialized: true })],
    }));
    expect(r.runMode).toBe('launch');
    expect(r.next).toHaveLength(1);
    expect(r.notices).toBeUndefined();
  });

  it('settled launch from elsewhere: one of two repos missing → rebuild command precedes the launch, notice names the repo, missingRepos lists only it', () => {
    const r = executeResolve(deps({
      project: 'P',
      locate: () => loc({ kind: 'none' }),
      listProjects: () => [makeProject('P', { sourceControlInitialized: true })],
      readProjectRepos: () => ({ repos: ['fake-api', 'fake-ui'], projectType: 'standard' as const }),
      recordedSourceControl: () => recorded('RECORDED-NAME', ['fake-api', 'fake-ui']),
      worktreeExists: (_wt, repo) => repo === 'fake-api',
    }));
    expect(r.runMode).toBe('launch');
    expect(r.next[0]).toBe('worktree create --project P --worktree-name RECORDED-NAME');
    expect(r.next[1]).toMatch(/^worktree launch /);
    expect(r.notices?.[0]).toMatch(/fake-ui/);
    expect(r.derived?.missingRepos).toEqual(['fake-ui']);
  });
});

// ── Fallback when recorded state cannot be read ──────────────────────────────

describe('executeResolve — settled fallback when recorded state is unreadable', () => {
  it('resume falls back to the project name and the convention branch without throwing', () => {
    const r = executeResolve(deps({
      locate: () => loc({ kind: 'worktree', worktree_name: 'P', projects: ['P'], branch: 'radorch/P' }),
      listProjects: () => [makeProject('P', { sourceControlInitialized: true })],
      recordedSourceControl: () => null,
    }));
    expect(r.runMode).toBe('resume');
    expect(r.derived?.worktreeName).toBe('P');
    expect(r.derived?.branch).toBe('radorch/P');
  });

  it('a settled launch from elsewhere falls back the same way', () => {
    const r = executeResolve(deps({
      project: 'P',
      locate: () => loc({ kind: 'none' }),
      listProjects: () => [makeProject('P', { sourceControlInitialized: true })],
      recordedSourceControl: () => null,
    }));
    expect(r.runMode).toBe('launch');
    expect(r.derived?.worktreeName).toBe('P');
    expect(r.derived?.branch).toBe('radorch/P');
  });
});

// ── Ask gating (raw config) ──────────────────────────────────────────────────

describe('executeResolve — asks are only genuine forks', () => {
  it('auto-commit/auto-pr asked ONLY when the raw config value is "ask"', () => {
    const r = executeResolve(deps({
      project: 'P',
      locate: () => loc({ kind: 'none' }),
      readConfig: () => ({ autoCommit: 'ask', autoPr: 'always' }),
    }));
    expect(r.ask.autoCommit).toBe(true);
    expect(r.ask.autoPr).toBeUndefined();
  });

  it('launchFlavor asked only on a launch path, and only under a non-Claude harness', () => {
    const launch = executeResolve(deps({ project: 'P', locate: () => loc({ kind: 'none' }), isClaudeHarness: () => false }));
    expect(launch.ask.launchFlavor).toBe(true);
    const resume = executeResolve(deps({
      locate: () => loc({ kind: 'worktree', worktree_name: 'P', projects: ['P'] }),
      listProjects: () => [makeProject('P', { sourceControlInitialized: true })],
      isClaudeHarness: () => false,
    }));
    expect(resume.ask.launchFlavor).toBeUndefined();
  });
});

// ── Project resolution & candidates ─────────────────────────────────────────

describe('executeResolve — project resolution and eligibility', () => {
  it('no project + main clone → needsProject with eligible candidates only', () => {
    const r = executeResolve(deps({
      locate: () => loc({ kind: 'main-clone', repo: 'rad-orc-source' }),
      listProjects: () => [
        makeProject('READY', { status: 'in_progress' }),
        makeProject('FINISHED', { status: 'done' }),       // excluded: done
        makeProject('NOPLAN', { masterPlan: null }),        // excluded: no master plan
      ],
    }));
    expect(r.needsProject).toBe(true);
    expect(r.projectDir).toBeNull();
    expect(r.candidates?.map((c) => c.name)).toEqual(['READY']);
  });

  it('eligibility ignores approval — a planned, not-done project is a candidate regardless', () => {
    const r = executeResolve(deps({
      locate: () => loc({ kind: 'none' }),
      listProjects: () => [makeProject('UNAPPROVED', { status: 'not_started' })],
    }));
    expect(r.candidates?.map((c) => c.name)).toEqual(['UNAPPROVED']);
  });

  it('resolves the single cwd worktree project without --project', () => {
    const r = executeResolve(deps({
      locate: () => loc({ kind: 'worktree', worktree_name: 'P', projects: ['P'] }),
      listProjects: () => [makeProject('P', { sourceControlInitialized: true })],
    }));
    expect(r.project).toBe('P');
    expect(r.runMode).toBe('resume');
  });

  it('an UNSETTLED project standing in a different project\'s worktree → in-place reuse (offer to reuse it), not unknown', () => {
    const r = executeResolve(deps({
      project: 'P',
      locate: () => loc({ kind: 'worktree', worktree_name: 'OTHER', projects: ['OTHER'], branch: 'radorch/OTHER' }),
      listProjects: () => [makeProject('P'), makeProject('OTHER')],
    }));
    expect(r.runMode).toBe('in-place');
    expect(r.ask.reuseWorktree).toBe(true);
    expect(r.derived?.worktreeName).toBe('OTHER');
    expect(r.next[0]).toMatch(/^execute prepare --project P --worktree-name OTHER\b/);
    expect(r.next[1]).toBe('pipeline signal --event start --project-dir "/projects/P"');
  });

  it('requested project not found → unknown', () => {
    const r = executeResolve(deps({ project: 'GHOST', locate: () => loc({ kind: 'none' }), listProjects: () => [makeProject('P')] }));
    expect(r.runMode).toBe('unknown');
    expect(r.reason).toMatch(/not found/i);
  });

  it('resolved project without a master plan → unknown (not eligible)', () => {
    const r = executeResolve(deps({ project: 'P', locate: () => loc({ kind: 'none' }), listProjects: () => [makeProject('P', { masterPlan: null })] }));
    expect(r.runMode).toBe('unknown');
    expect(r.reason).toMatch(/Master Plan/i);
  });

  it('orphan worktree directory (no matching project) → unknown', () => {
    const r = executeResolve(deps({ locate: () => loc({ kind: 'worktree', worktree_name: 'ORPHAN', projects: [] }), listProjects: () => [makeProject('P')] }));
    expect(r.runMode).toBe('unknown');
    expect(r.reason).toMatch(/does not correspond/i);
  });
});

// ── Derived convention ───────────────────────────────────────────────────────

describe('executeResolve — derived convention', () => {
  it('launchDir is the PARENT (not a repo dir); per-repo base from the injected defaultBranch', () => {
    const r = executeResolve(deps({
      project: 'P',
      locate: () => loc({ kind: 'none' }),
      readProjectRepos: () => ({ repos: ['fake-api', 'fake-ui'], projectType: 'standard' as const }),
      defaultBranch: (repo) => (repo === 'fake-api' ? 'master' : 'main'),
      worktreesDir: '/wt',
    }));
    expect(r.derived?.branch).toBe('radorch/P');
    expect(r.derived?.launchDir).toBe(path.join('/wt', 'P'));
    expect(r.derived?.repos).toEqual([
      { repo: 'fake-api', base: 'master', worktreePath: path.join('/wt', 'P', 'fake-api') },
      { repo: 'fake-ui', base: 'main', worktreePath: path.join('/wt', 'P', 'fake-ui') },
    ]);
  });
});

// ── Next ordering & auto-value pre-substitution ──────────────────────────────

describe('executeResolve — next ordering and pre-substitution', () => {
  it('bakes resolved always/never into the prepare command; leaves a placeholder for "ask"', () => {
    const baked = executeResolve(deps({ project: 'P', locate: () => loc({ kind: 'none' }), readConfig: () => ({ autoCommit: 'always', autoPr: 'never' }) }));
    expect(baked.next[0]).toBe('execute prepare --project P --auto-commit always --auto-pr never');

    const asked = executeResolve(deps({ project: 'P', locate: () => loc({ kind: 'none' }), readConfig: () => ({ autoCommit: 'ask', autoPr: 'ask' }) }));
    expect(asked.next[0]).toBe('execute prepare --project P --auto-commit {ac} --auto-pr {ap}');
  });

  it('launch emits prepare then a worktree-launch command into the parent dir, with no permission-mode flag', () => {
    const r = executeResolve(deps({ project: 'P', locate: () => loc({ kind: 'none' }), worktreesDir: '/wt' }));
    expect(r.next).toHaveLength(2);
    expect(r.next[1]).toBe(`worktree launch --agent claude --worktree-path "${path.join('/wt', 'P')}" --prompt "/rad-execute P"`);
  });
});

// ── Side-project: fixed layout, ordinary location-vs-started shape ────────────

describe('executeResolve — side-project runs where it lives', () => {
  const SP_DIR = path.join('/sp', 'SP');

  // A side-project has no workspace folder at all, so nothing may consult the
  // worktree convention — `worktreeExists: false` proves a rebuild would have
  // fired if it did.
  const sideProject = (over: Partial<ExecuteResolveDeps> = {}): ExecuteResolveDeps => deps({
    project: 'SP',
    listProjects: () => [makeProject('SP', { projectType: 'side-project', sourceControlInitialized: false })],
    readProjectRepos: () => ({ repos: ['SP'], projectType: 'side-project' as const }),
    worktreeExists: () => false,
    ...over,
  });

  const inside = () => loc({ kind: 'side-project', worktree_name: 'SP' });

  it('named from elsewhere, unsettled → launches into the side-projects dir with prepare FIRST', () => {
    const r = executeResolve(sideProject({ locate: () => loc({ kind: 'none' }) }));
    expect(r.runMode).toBe('launch');
    expect(r.derived?.launchDir).toBe(SP_DIR);
    expect(r.next).toEqual([
      'execute prepare --project SP',
      `worktree launch --agent claude --worktree-path "${SP_DIR}" --prompt "/rad-execute SP"`,
    ]);
  });

  it('named from elsewhere, settled → launches into the side-projects dir with no prepare', () => {
    const r = executeResolve(sideProject({
      locate: () => loc({ kind: 'none' }),
      listProjects: () => [makeProject('SP', { projectType: 'side-project', sourceControlInitialized: true })],
    }));
    expect(r.runMode).toBe('launch');
    expect(r.next).toEqual([`worktree launch --agent claude --worktree-path "${SP_DIR}" --prompt "/rad-execute SP"`]);
  });

  it('neither launch arm emits a rebuild command or a lost-work notice, even with no worktree on disk', () => {
    for (const settled of [false, true] as const) {
      const r = executeResolve(sideProject({
        locate: () => loc({ kind: 'worktree', worktree_name: 'OTHER', projects: ['OTHER'], branch: 'radorch/OTHER' }),
        listProjects: () => [makeProject('OTHER'), makeProject('SP', { projectType: 'side-project', sourceControlInitialized: settled })],
      }));
      expect(r.runMode).toBe('launch');
      expect(r.derived?.launchDir).toBe(SP_DIR);
      expect(r.next.some((c) => c.startsWith('worktree create'))).toBe(false);
      expect(r.notices).toBeUndefined();
    }
  });

  it('standing inside it, unsettled → in-place with a confirmHere and nothing else', () => {
    const r = executeResolve(sideProject({ locate: inside, readConfig: () => ({ autoCommit: 'ask', autoPr: 'ask' }) }));
    expect(r.runMode).toBe('in-place');
    expect(Object.keys(r.ask)).toEqual(['confirmHere']);
    expect(r.derived?.branch).toBe('main');
    expect(r.derived?.launchDir).toBe(SP_DIR);
    expect(r.derived?.repos[0]?.worktreePath).toBe(SP_DIR);
    expect(r.next).toEqual([
      'execute prepare --project SP',
      'pipeline signal --event start --project-dir "/projects/SP"',
    ]);
  });

  it('standing inside it, settled → resume (drive only), no confirmHere', () => {
    const r = executeResolve(sideProject({
      locate: inside,
      listProjects: () => [makeProject('SP', { projectType: 'side-project', sourceControlInitialized: true })],
    }));
    expect(r.runMode).toBe('resume');
    expect(r.ask.confirmHere).toBeUndefined();
    expect(r.next).toEqual(['pipeline signal --event start --project-dir "/projects/SP"']);
  });

  it('standing inside it, settled with an UNAPPROVED plan → resume that approves before driving', () => {
    const r = executeResolve(sideProject({
      locate: inside,
      listProjects: () => [makeProject('SP', { projectType: 'side-project', sourceControlInitialized: true })],
      planApproved: () => false,
    }));
    expect(r.next).toEqual([
      'gate approve plan --project-dir "/projects/SP"',
      'pipeline signal --event start --project-dir "/projects/SP"',
    ]);
  });

  it('suppresses commit/PR asks on every path even when config is "ask" (fixed binding)', () => {
    const locations = [inside, () => loc({ kind: 'none' })];
    for (const locate of locations) {
      for (const settled of [false, true] as const) {
        const r = executeResolve(sideProject({
          locate,
          listProjects: () => [makeProject('SP', { projectType: 'side-project', sourceControlInitialized: settled })],
          readConfig: () => ({ autoCommit: 'ask', autoPr: 'ask' }),
        }));
        expect(r.ask.autoCommit).toBeUndefined();
        expect(r.ask.autoPr).toBeUndefined();
      }
    }
  });

  it('its repos are exempt from the registry check — the pseudo-repo is the project name', () => {
    const r = executeResolve(sideProject({ locate: inside, repoStanding: () => 'unknown' }));
    expect(r.runMode).toBe('in-place');
  });
});

// ── Every targeted repo must be registered AND bound ─────────────────────────

describe('executeResolve — unregistered or unbound repo stops the run', () => {
  const fromNowhere = (standing: 'unknown' | 'unbound') => executeResolve(deps({
    project: 'P',
    locate: () => loc({ kind: 'none' }),
    readProjectRepos: () => ({ repos: ['ghost-repo'], projectType: 'standard' as const }),
    repoStanding: () => standing,
  }));

  it('stops on a plain launch with no clone anywhere in the picture', () => {
    const r = fromNowhere('unknown');
    expect(r.runMode).toBe('unknown');
    expect(r.reason).toMatch(/ghost-repo/);
    expect(r.reason).toMatch(/P/);
    expect(r.next).toEqual([]);
  });

  it('an unregistered repo and an unbound one get different explanations', () => {
    expect(fromNowhere('unknown').reason).not.toBe(fromNowhere('unbound').reason);
    expect(fromNowhere('unbound').runMode).toBe('unknown');
  });

  it('names the first offending repo of a multi-repo project', () => {
    const r = executeResolve(deps({
      project: 'P',
      locate: () => loc({ kind: 'none' }),
      readProjectRepos: () => ({ repos: ['known', 'ghost-repo'], projectType: 'standard' as const }),
      repoStanding: (repo) => (repo === 'known' ? 'bound' : 'unknown'),
    }));
    expect(r.runMode).toBe('unknown');
    expect(r.reason).toMatch(/ghost-repo/);
  });
});

// ── Binding a project to the operator's own clone ────────────────────────────

describe('executeResolve — the clone-binding offer and the multi-repo stop', () => {
  const CLONE = path.join('/clones', 'alpha');

  interface Shape { name: string; repos: string[] }
  const shapes: Shape[] = [
    { name: 'single-repo, this clone', repos: ['alpha'] },
    { name: 'single-repo, another clone', repos: ['beta'] },
    { name: 'multi-repo including this clone', repos: ['alpha', 'beta'] },
    { name: 'multi-repo excluding this clone', repos: ['beta', 'gamma'] },
  ];

  // A settled project never reaches the offer: 7b has already claimed it. On the
  // repo's default branch the clone is irrelevant and today's workspace launch
  // stands. Config is forced to 'ask' so the ask sets are meaningful.
  const expected: Record<string, Record<'default' | 'feature', { settled: [RunMode, string[]]; unsettled: [RunMode, string[]] }>> = {
    'single-repo, this clone': {
      default: { settled: ['launch', []], unsettled: ['launch', ['autoCommit', 'autoPr']] },
      feature: { settled: ['launch', []], unsettled: ['in-place', ['autoCommit', 'autoPr', 'bindClone']] },
    },
    'single-repo, another clone': {
      default: { settled: ['launch', []], unsettled: ['launch', ['autoCommit', 'autoPr']] },
      feature: { settled: ['launch', []], unsettled: ['launch', ['autoCommit', 'autoPr']] },
    },
    'multi-repo including this clone': {
      default: { settled: ['launch', []], unsettled: ['launch', ['autoCommit', 'autoPr']] },
      feature: { settled: ['launch', []], unsettled: ['unknown', []] },
    },
    'multi-repo excluding this clone': {
      default: { settled: ['launch', []], unsettled: ['launch', ['autoCommit', 'autoPr']] },
      feature: { settled: ['launch', []], unsettled: ['launch', ['autoCommit', 'autoPr']] },
    },
  };

  const standingIn = (branch: string, shape: Shape, settled: boolean, over: Partial<ExecuteResolveDeps> = {}) =>
    executeResolve(deps({
      project: 'P',
      locate: () => loc({ kind: 'main-clone', repo: 'alpha', branch }),
      listProjects: () => [makeProject('P', { sourceControlInitialized: settled })],
      readProjectRepos: () => ({ repos: shape.repos, projectType: 'standard' as const }),
      cloneFacts: (repo) => (repo === 'alpha' ? facts({ path: CLONE, branch }) : null),
      readConfig: () => ({ autoCommit: 'ask', autoPr: 'ask' }),
      ...over,
    }));

  for (const shape of shapes) {
    for (const [label, branch] of [['default', 'main'], ['feature', 'feature/x']] as const) {
      for (const settled of [true, false] as const) {
        const [runMode, askKeys] = expected[shape.name]![label][settled ? 'settled' : 'unsettled'];
        it(`${shape.name}, on the ${label} branch, ${settled ? 'settled' : 'unsettled'} → ${runMode}, asks exactly [${askKeys.join(', ') || '(none)'}]`, () => {
          const r = standingIn(branch, shape, settled);
          expect(r.runMode).toBe(runMode);
          expect(Object.keys(r.ask).sort()).toEqual([...askKeys].sort());
        });
      }
    }
  }

  it('the offer carries the clone facts, an in-place prepare with a {base} placeholder, and derived pointing at the clone', () => {
    const dirty = Array.from({ length: 14 }, (_, i) => ` M file-${i}.ts`);
    const r = standingIn('feature/x', shapes[0]!, false, {
      cloneFacts: () => facts({ path: CLONE, branch: 'feature/x', dirty }),
      readConfig: () => ({ autoCommit: 'always', autoPr: 'never' }),
    });
    expect(r.runMode).toBe('in-place');
    expect(r.cloneBinding).toEqual({
      repo: 'alpha',
      clonePath: CLONE,
      branch: 'feature/x',
      proposedBase: 'main',
      dirtyPaths: dirty.slice(0, 10),
      dirtyCount: 14,
    });
    expect(r.derived?.branch).toBe('feature/x');
    expect(r.derived?.launchDir).toBe(CLONE);
    expect(r.derived?.repos).toEqual([{ repo: 'alpha', base: 'main', worktreePath: CLONE }]);
    expect(r.next).toEqual([
      'execute prepare --project P --in-place --base-branch "{base}" --branch "feature/x" --auto-commit always --auto-pr never',
      'pipeline signal --event start --project-dir "/projects/P"',
    ]);
  });

  it('the offer leaves the commit/PR placeholders unresolved when config says ask', () => {
    const r = standingIn('feature/x', shapes[0]!, false);
    expect(r.next[0]).toBe('execute prepare --project P --in-place --base-branch "{base}" --branch "feature/x" --auto-commit {ac} --auto-pr {ap}');
  });

  it('a clone on the repo default branch never yields a binding — it gets its own workspace', () => {
    const r = standingIn('main', shapes[0]!, false);
    expect(r.cloneBinding).toBeUndefined();
    expect(r.ask.bindClone).toBeUndefined();
    expect(r.derived?.launchDir).toBe(path.join('/wt', 'P'));
    expect(r.derived?.branch).toBe('radorch/P');
  });

  it('a multi-repo project named from one of its clones stops, naming the project, its repos, the clone and the branch', () => {
    const r = standingIn('feature/x', shapes[2]!, false);
    expect(r.runMode).toBe('unknown');
    expect(r.reason).toMatch(/P/);
    expect(r.reason).toMatch(/alpha/);
    expect(r.reason).toMatch(/beta/);
    expect(r.reason).toMatch(/feature\/x/);
    expect(r.reason).toMatch(/on ".*"'s default branch/);
    expect(r.cloneBinding).toBeUndefined();
  });

  it('the same multi-repo project named from the default branch still provisions a workspace', () => {
    const r = standingIn('main', shapes[2]!, false);
    expect(r.runMode).toBe('launch');
    expect(r.derived?.launchDir).toBe(path.join('/wt', 'P'));
    expect(r.next[0]).toMatch(/^execute prepare --project P --auto-commit /);
  });

  it('an already-started multi-repo project named from one of its clones launches into its workspace', () => {
    const r = standingIn('feature/x', shapes[2]!, true);
    expect(r.runMode).toBe('launch');
    expect(r.derived?.launchDir).toBe(path.join('/wt', 'P'));
  });

  it('a clone whose git facts cannot be read is not eligible', () => {
    const r = standingIn('feature/x', shapes[0]!, false, {
      cloneFacts: () => facts({ path: CLONE, branch: null }),
    });
    expect(r.runMode).toBe('launch');
    expect(r.cloneBinding).toBeUndefined();
  });
});

// ── Resuming a project bound to a clone ──────────────────────────────────────

describe('executeResolve — resuming a recorded clone binding', () => {
  const CLONE = path.join('/clones', 'alpha');

  const boundTo = (branch: string): RecordedSourceControl => ({
    worktreeName: 'P',
    repos: [{ name: 'alpha', branch, inPlace: true }],
  });

  // `worktreeExists: false` would trip rebuild-and-tell on any workspace path —
  // a bound clone has no workspace, so reaching it would be the bug.
  const bound = (over: Partial<ExecuteResolveDeps> = {}) => executeResolve(deps({
    project: 'P',
    listProjects: () => [makeProject('P', { sourceControlInitialized: true })],
    readProjectRepos: () => ({ repos: ['alpha'], projectType: 'standard' as const }),
    recordedSourceControl: () => boundTo('feature/x'),
    cloneFacts: () => facts({ path: CLONE, branch: 'feature/x' }),
    worktreeExists: () => false,
    locate: () => loc({ kind: 'none' }),
    ...over,
  }));

  it('standing in the clone → resume there, with no rebuild command and no lost-work notice', () => {
    const r = bound({ locate: () => loc({ kind: 'main-clone', repo: 'alpha', branch: 'feature/x' }) });
    expect(r.runMode).toBe('resume');
    expect(r.derived?.launchDir).toBe(CLONE);
    expect(r.derived?.branch).toBe('feature/x');
    expect(r.derived?.repos).toEqual([{ repo: 'alpha', base: 'main', worktreePath: CLONE }]);
    expect(r.next).toEqual(['pipeline signal --event start --project-dir "/projects/P"']);
    expect(r.notices).toBeUndefined();
  });

  it('standing in the clone with an UNAPPROVED plan → approves before driving', () => {
    const r = bound({
      locate: () => loc({ kind: 'main-clone', repo: 'alpha', branch: 'feature/x' }),
      planApproved: () => false,
    });
    expect(r.next).toEqual([
      'gate approve plan --project-dir "/projects/P"',
      'pipeline signal --event start --project-dir "/projects/P"',
    ]);
  });

  it('named from elsewhere → launches into the clone, with no rebuild command and no lost-work notice', () => {
    const r = bound();
    expect(r.runMode).toBe('launch');
    expect(r.derived?.launchDir).toBe(CLONE);
    expect(r.next).toEqual([`worktree launch --agent claude --worktree-path "${CLONE}" --prompt "/rad-execute P"`]);
    expect(r.next.some((c) => c.startsWith('worktree create'))).toBe(false);
    expect(r.notices).toBeUndefined();
  });

  it('a non-Claude harness still asks the launch flavor on the launch-into-clone path', () => {
    const r = bound({ isClaudeHarness: () => false });
    expect(r.ask.launchFlavor).toBe(true);
    expect(r.next[0]).toMatch(/--agent \{flavor\}/);
  });

  it('the clone switched to another branch stops, naming both branches', () => {
    const r = bound({ cloneFacts: () => facts({ path: CLONE, branch: 'something-else' }) });
    expect(r.runMode).toBe('unknown');
    expect(r.reason).toMatch(/feature\/x/);
    expect(r.reason).toMatch(/something-else/);
  });

  it('the clone moved back onto the repo default branch stops', () => {
    const r = bound({
      recordedSourceControl: () => boundTo('main'),
      cloneFacts: () => facts({ path: CLONE, branch: 'main' }),
    });
    expect(r.runMode).toBe('unknown');
    expect(r.reason).toMatch(/main/);
  });

  it('the clone gone from disk stops', () => {
    const r = bound({ cloneFacts: () => facts({ path: CLONE, exists: false, branch: null }) });
    expect(r.runMode).toBe('unknown');
    expect(r.reason).toMatch(/alpha/);
  });

  it('a recorded workspace (no in-place repo) is untouched by the binding path', () => {
    const r = bound({
      recordedSourceControl: () => ({ worktreeName: 'P', repos: [{ name: 'alpha', branch: 'radorch/P', inPlace: false }] }),
    });
    expect(r.runMode).toBe('launch');
    expect(r.derived?.launchDir).toBe(path.join('/wt', 'P'));
  });
});

// ── Reuse a different project's worktree (follow-up / correction) ─────────────

describe('executeResolve — reuse a different project\'s worktree', () => {
  it('inherits the worktree name + branch and passes --worktree-name to prepare', () => {
    const r = executeResolve(deps({
      project: 'FOLLOWUP',
      locate: () => loc({ kind: 'worktree', worktree_name: 'PARENT', projects: ['PARENT'], branch: 'radorch/PARENT' }),
      listProjects: () => [makeProject('FOLLOWUP'), makeProject('PARENT')],
    }));
    expect(r.runMode).toBe('in-place');
    expect(r.ask.reuseWorktree).toBe(true);
    expect(r.derived?.worktreeName).toBe('PARENT');
    expect(r.derived?.branch).toBe('radorch/PARENT');
    expect(r.derived?.missingRepos).toEqual([]);
    expect(r.next[0]).toMatch(/^execute prepare --project FOLLOWUP --worktree-name PARENT\b/);
  });

  it('surfaces repos the reused worktree set is missing', () => {
    const r = executeResolve(deps({
      project: 'FOLLOWUP',
      locate: () => loc({ kind: 'worktree', worktree_name: 'PARENT', projects: ['PARENT'], branch: 'radorch/PARENT' }),
      listProjects: () => [makeProject('FOLLOWUP'), makeProject('PARENT')],
      readProjectRepos: () => ({ repos: ['fake-api', 'fake-ui'], projectType: 'standard' as const }),
      worktreeExists: (_wt, repo) => repo === 'fake-api', // fake-ui is missing under the reused set
    }));
    expect(r.derived?.missingRepos).toEqual(['fake-ui']);
  });
});

// ── Confirmations ────────────────────────────────────────────────────────────

describe('executeResolve — confirmations', () => {
  it('standard project in its OWN unsettled worktree → in-place + confirmHere (not reuseWorktree)', () => {
    const r = executeResolve(deps({
      locate: () => loc({ kind: 'worktree', worktree_name: 'P', projects: ['P'], branch: 'radorch/P' }),
      listProjects: () => [makeProject('P', { sourceControlInitialized: false })],
    }));
    expect(r.runMode).toBe('in-place');
    expect(r.ask.confirmHere).toBe(true);
    expect(r.ask.reuseWorktree).toBeUndefined();
  });

  it('an already-done project → confirmDone, still classifying a run mode', () => {
    const r = executeResolve(deps({
      project: 'P',
      locate: () => loc({ kind: 'none' }),
      listProjects: () => [makeProject('P', { status: 'done' })],
    }));
    expect(r.ask.confirmDone).toBe(true);
    expect(r.runMode).toBe('launch');
  });
});
