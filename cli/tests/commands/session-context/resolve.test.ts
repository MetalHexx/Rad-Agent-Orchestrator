import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { within } from '@rad-orchestration/work-graph';
import type {
  Edge, GraphDTO, LocateResult, PortfolioLifecycle, PortfolioRef, Project, ProjectKind, ProjectState, Tier, WorktreeRef,
} from '@rad-orchestration/work-graph';
import { resolveStanding } from '../../../src/commands/session-context/resolve.js';
import type {
  ResolveStandingOpts, StandingGitExec, StandingService, StandingServiceFactory,
} from '../../../src/commands/session-context/resolve.js';

const WORKTREES = path.join('/rad', 'worktrees');
const SIDE_PROJECTS = path.join('/rad', 'side-projects');

interface ProjectOverrides {
  state?: ProjectState;
  stateLabel?: string;
  tier?: Tier | null;
  projectType?: ProjectKind;
  docs?: Partial<Project['docs']>;
  haltReason?: string | null;
}

function project(name: string, over: ProjectOverrides = {}): Project {
  return {
    id: `project:${name}`,
    kind: 'project',
    name,
    status: 'in_progress',
    state: over.state ?? 'executing',
    stateLabel: over.stateLabel ?? 'Executing',
    dir: path.join('/rad', 'projects', name),
    tier: over.tier ?? 'execution',
    projectType: over.projectType ?? 'standard',
    sourceControlInitialized: true,
    docs: { others: [], subfolders: [], ...over.docs },
    worktrees: [],
    haltReason: over.haltReason ?? null,
  };
}

function ref(worktreeName: string, repo: string): WorktreeRef {
  return {
    repo,
    path: path.join(WORKTREES, worktreeName, repo),
    branch: null,
    exists: true,
    resolvedVia: 'convention',
  };
}

interface FakeWorld {
  located: LocateResult;
  projects?: Project[];
  edges?: Edge[];
  worktrees?: Record<string, WorktreeRef[]>;
  /** Branch the probe service reports once it is pointed at a repo subdirectory. */
  probedBranch?: string | null;
  throwOnLocate?: boolean;
  /** What `resolvePortfolioAmong` returns for any call — driven by the fake world's own ids,
   *  never a filesystem. Absent means "no portfolio among these ids". */
  portfolio?: PortfolioRef | null;
  throwOnResolvePortfolioAmong?: boolean;
}

interface Harness {
  opts: ResolveStandingOpts;
  /** Calls made by every git executor handed to the factory. */
  gitCalls: { file: string; args: string[]; cwd?: string }[];
  /** How many services were built with a real executor — i.e. how many branch probes ran. */
  probes: number;
  /** Every id list handed to `resolvePortfolioAmong`, in call order. */
  portfolioCalls: string[][];
}

/**
 * Fake service + factory in place of the filesystem and git, following the injectable-locator
 * pattern. The probe service mirrors the real one: given an executor it spends exactly one
 * `git worktree list --porcelain` to answer with a branch.
 */
function harness(world: FakeWorld): Harness {
  const gitCalls: Harness['gitCalls'] = [];
  const portfolioCalls: Harness['portfolioCalls'] = [];
  const state = { probes: 0 };
  const graph: GraphDTO = { schema: 'work-graph/v1', nodes: [], edges: world.edges ?? [], danglingEdges: [] };

  const factory: StandingServiceFactory = (exec) => {
    const isProbe = exec !== undefined;
    if (isProbe) state.probes++;
    const svc: StandingService = {
      locate: (cwd) => {
        if (world.throwOnLocate) throw new Error('classifier exploded');
        if (!isProbe) return world.located;
        exec?.('git', ['worktree', 'list', '--porcelain'], { cwd });
        return { kind: 'worktree', worktree_name: world.located.worktree_name, repo: path.basename(cwd), branch: world.probedBranch ?? null };
      },
      listProjects: () => world.projects ?? [],
      getGraph: () => graph,
      resolveWorktrees: (id) => world.worktrees?.[id] ?? [],
      resolvePortfolioAmong: (ids) => {
        portfolioCalls.push([...ids]);
        if (world.throwOnResolvePortfolioAmong) throw new Error('portfolio resolution exploded');
        return world.portfolio ?? null;
      },
    };
    return svc;
  };

  const exec: StandingGitExec = (file, args, execOpts) => {
    gitCalls.push({ file, args, cwd: execOpts.cwd });
    return '';
  };

  return {
    opts: { cwd: path.join(WORKTREES, 'ALPHA'), worktreesDir: WORKTREES, serviceFactory: factory, exec },
    gitCalls,
    get probes() { return state.probes; },
    portfolioCalls,
  };
}

const follows = (from: string, to: string): Edge => ({ type: 'follows', from: `project:${from}`, to: `project:${to}` });
const names = (s: NonNullable<ReturnType<typeof resolveStanding>>): string[] => s.projects.map((p) => p.name);
const tipName = (s: NonNullable<ReturnType<typeof resolveStanding>>): string =>
  s.projects.filter((p) => p.isTip).map((p) => p.name).join(',');

describe('resolveStanding — classification outcomes', () => {
  it('resolves a standing for a worktree naming every co-tenant', () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['ONE', 'TWO'], branch: null },
      projects: [project('ONE'), project('TWO')],
    });

    const standing = resolveStanding(h.opts);

    expect(standing).not.toBeNull();
    expect(names(standing!).sort()).toEqual(['ONE', 'TWO']);
    expect(standing!.projects.filter((p) => p.isTip)).toHaveLength(1);
    expect(standing!.tip.name).toBe(tipName(standing!));
  });

  it('says nothing at a main clone', () => {
    const h = harness({ located: { kind: 'main-clone', repo: 'rad-orc-source' } });
    expect(resolveStanding(h.opts)).toBeNull();
  });

  it('says nothing in an unclassified directory', () => {
    const h = harness({ located: { kind: 'none' } });
    expect(resolveStanding(h.opts)).toBeNull();
  });

  it('says nothing for a worktree matching no project', () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ORPHAN', projects: [], branch: null },
      projects: [project('ELSEWHERE')],
    });
    expect(resolveStanding(h.opts)).toBeNull();
  });

  it('says nothing when a named co-tenant is not in the project list', () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['GHOST'], branch: null },
      projects: [project('ELSEWHERE')],
    });
    expect(resolveStanding(h.opts)).toBeNull();
  });
});

describe('resolveStanding — the side-project path', () => {
  it('resolves the one project named by worktree_name, with no projects array to read', () => {
    const h = harness({
      located: { kind: 'side-project', worktree_name: 'SCRATCH' },
      projects: [project('SCRATCH', { projectType: 'side-project' }), project('OTHER')],
    });
    h.opts.cwd = path.join(SIDE_PROJECTS, 'SCRATCH');

    const standing = resolveStanding(h.opts);

    expect(names(standing!)).toEqual(['SCRATCH']);
    expect(standing!.tip.name).toBe('SCRATCH');
    expect(standing!.projects[0].isTip).toBe(true);
  });

  it('has no managed workspace and an empty (not absent) alsoHere', () => {
    const h = harness({
      located: { kind: 'side-project', worktree_name: 'SCRATCH' },
      projects: [project('SCRATCH', { projectType: 'side-project' })],
    });

    const standing = resolveStanding(h.opts);

    expect(standing!.worktree).toBeUndefined();
    expect(standing!.alsoHere).toEqual([]);
  });

  it('says nothing when the side-project folder matches no project', () => {
    const h = harness({ located: { kind: 'side-project', worktree_name: 'GONE' }, projects: [project('SCRATCH')] });
    expect(resolveStanding(h.opts)).toBeNull();
  });
});

describe('resolveStanding — the removed in_progress gate', () => {
  const cases: { state: ProjectState; label: string; tier: Tier | null }[] = [
    { state: 'planning', label: 'Planning', tier: 'planning' },
    { state: 'planned', label: 'Planned', tier: 'planning' },
    { state: 'halted', label: 'Halted', tier: 'halted' },
    { state: 'complete', label: 'Complete', tier: 'complete' },
  ];

  for (const c of cases) {
    it(`resolves a standing for a ${c.state} project`, () => {
      const h = harness({
        located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['ONE'], branch: null },
        projects: [project('ONE', { state: c.state, stateLabel: c.label, tier: c.tier })],
      });

      const standing = resolveStanding(h.opts);

      expect(standing!.tip.stateLabel).toBe(c.label);
    });
  }
});

describe('resolveStanding — series ordering and tip selection', () => {
  it('walks the follows chain from its start, flagging only real joins', () => {
    // LATER follows EARLY, so EARLY comes first and LATER is joined to it.
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['LATER', 'EARLY'], branch: null },
      projects: [project('LATER'), project('EARLY')],
      edges: [follows('LATER', 'EARLY')],
    });

    const standing = resolveStanding(h.opts);

    expect(names(standing!)).toEqual(['EARLY', 'LATER']);
    expect(standing!.projects.map((p) => p.followsPrevious)).toEqual([false, true]);
  });

  it('puts isTip on the chain end, not the trailing unlinked co-tenant', () => {
    // AARDVARK sorts first but is unlinked; it is appended after the chain and must not be the tip.
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['LATER', 'EARLY', 'AARDVARK'], branch: null },
      projects: [project('LATER'), project('EARLY'), project('AARDVARK')],
      edges: [follows('LATER', 'EARLY')],
    });

    const standing = resolveStanding(h.opts);

    expect(names(standing!)).toEqual(['EARLY', 'LATER', 'AARDVARK']);
    expect(tipName(standing!)).toBe('LATER');
    expect(standing!.tip.name).toBe('LATER');
    expect(standing!.projects[standing!.projects.length - 1].isTip).toBe(false);
  });

  it('yields exactly one isTip when no co-tenant is linked at all', () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['ZULU', 'BRAVO', 'MIKE'], branch: null },
      projects: [project('ZULU'), project('BRAVO'), project('MIKE')],
    });

    const standing = resolveStanding(h.opts);

    expect(names(standing!)).toEqual(['BRAVO', 'MIKE', 'ZULU']);
    expect(standing!.projects.filter((p) => p.isTip).map((p) => p.name)).toEqual(['BRAVO']);
    expect(standing!.projects.every((p) => !p.followsPrevious)).toBe(true);
  });

  it('ignores a follows edge that leaves the workspace when ordering co-tenants', () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['ONE'], branch: null },
      projects: [project('ONE'), project('OUTSIDER')],
      edges: [follows('ONE', 'OUTSIDER')],
    });

    const standing = resolveStanding(h.opts);

    expect(names(standing!)).toEqual(['ONE']);
    expect(standing!.projects[0].followsPrevious).toBe(false);
    expect(standing!.projects[0].isTip).toBe(true);
  });
});

describe('resolveStanding — tip detail', () => {
  it('flattens docs slot-first and carries subfolders, group and halt reason', () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['ONE'], branch: null },
      projects: [project('ONE', {
        state: 'halted',
        stateLabel: 'Halted',
        tier: 'halted',
        haltReason: 'awaiting a decision',
        docs: {
          brainstorming: 'brainstorming.md',
          requirements: 'requirements.md',
          masterPlan: 'master-plan.md',
          others: ['appendix.md', 'notes.md'],
          subfolders: ['phases', 'tasks'],
        },
      })],
      edges: [{ type: 'contains', from: 'group:PLATFORM', to: 'project:ONE' }],
    });

    const standing = resolveStanding(h.opts);

    expect(standing!.tip.docs).toEqual(['requirements.md', 'master-plan.md', 'brainstorming.md', 'appendix.md', 'notes.md']);
    expect(standing!.tip.subfolders).toEqual(['phases', 'tasks']);
    expect(standing!.tip.group).toBe('PLATFORM');
    expect(standing!.tip.haltReason).toBe('awaiting a decision');
  });

  it("lists a portfolio root's own document now that it owns a slot", () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['PLATFORM-ROOT'], branch: null },
      projects: [project('PLATFORM-ROOT', {
        projectType: 'portfolio',
        docs: { root: 'PLATFORM-ROOT.md', others: ['appendix.md'] },
      })],
    });

    const standing = resolveStanding(h.opts);

    expect(standing!.tip.docs).toEqual(['PLATFORM-ROOT.md', 'appendix.md']);
  });

  it('drops absent doc slots and omits an unrecorded halt reason', () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['ONE'], branch: null },
      projects: [project('ONE', { docs: { requirements: 'requirements.md', others: [] } })],
    });

    const standing = resolveStanding(h.opts);

    expect(standing!.tip.docs).toEqual(['requirements.md']);
    expect(standing!.tip.haltReason).toBeUndefined();
    expect(standing!.tip.group).toBeUndefined();
  });
});

describe('resolveStanding — series neighbours', () => {
  it('reads one hop in both directions from follows and spawned-from', () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['MIDDLE'], branch: null },
      projects: [project('MIDDLE'), project('BEFORE'), project('AFTER')],
      edges: [follows('MIDDLE', 'BEFORE'), { type: 'spawned-from', from: 'project:AFTER', to: 'project:MIDDLE' }],
    });

    const standing = resolveStanding(h.opts);

    expect(standing!.tip.predecessor).toEqual({ name: 'BEFORE', stateLabel: 'Executing', dir: path.join('/rad', 'projects', 'BEFORE') });
    expect(standing!.tip.successor?.name).toBe('AFTER');
  });

  it('leaves predecessor absent so the render can state "none"', () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['HEAD'], branch: null },
      projects: [project('HEAD'), project('AFTER')],
      edges: [follows('AFTER', 'HEAD')],
    });

    const standing = resolveStanding(h.opts);

    expect(standing!.tip.predecessor).toBeUndefined();
    expect(standing!.tip.successor?.name).toBe('AFTER');
  });

  it('leaves successor absent so the render can state "none"', () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['TAIL'], branch: null },
      projects: [project('TAIL'), project('BEFORE')],
      edges: [follows('TAIL', 'BEFORE')],
    });

    const standing = resolveStanding(h.opts);

    expect(standing!.tip.successor).toBeUndefined();
    expect(standing!.tip.predecessor?.name).toBe('BEFORE');
  });

  it('reports a project that is both a neighbour and a co-tenant only under Series', () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['LATER', 'EARLY', 'AARDVARK'], branch: null },
      projects: [project('LATER'), project('EARLY'), project('AARDVARK')],
      edges: [follows('LATER', 'EARLY')],
    });

    const standing = resolveStanding(h.opts);

    expect(standing!.tip.predecessor?.name).toBe('EARLY');
    expect(standing!.alsoHere.map((n) => n.name)).toEqual(['AARDVARK']);
  });
});

describe('resolveStanding — the managed workspace', () => {
  it('names the workspace, its repos, and which one the cwd is in', () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['ONE'], repo: 'api', branch: 'radorch/ALPHA' },
      projects: [project('ONE')],
      worktrees: { 'project:ONE': [ref('ALPHA', 'api'), ref('ALPHA', 'ui')] },
    });
    h.opts.cwd = path.join(WORKTREES, 'ALPHA', 'api', 'src');

    const standing = resolveStanding(h.opts);

    expect(standing!.worktree).toEqual({
      path: path.join(WORKTREES, 'ALPHA'),
      branch: 'radorch/ALPHA',
      repos: [
        { name: 'api', path: path.join(WORKTREES, 'ALPHA', 'api'), here: true },
        { name: 'ui', path: path.join(WORKTREES, 'ALPHA', 'ui'), here: false },
      ],
    });
  });

  it('reuses the library within() helper for repo containment', () => {
    expect(within('/a/b', '/a/b/c')).toBe(true);
    expect(within('/a/b', '/a/x')).toBe(false);
  });

  it('still names the workspace when no repo reference resolves', () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['ONE'], branch: null },
      projects: [project('ONE')],
    });

    const standing = resolveStanding(h.opts);

    expect(standing!.worktree).toEqual({ path: path.join(WORKTREES, 'ALPHA'), branch: null, repos: [] });
  });

  it('keeps the legacy single-worktree ref path as-is instead of taking its dirname', () => {
    // resolvedVia: 'git' is the legacy pre-per-repo shape: `path` already IS the workspace
    // directory itself, not a per-repo subfolder — dirname would wrongly report its parent.
    const legacyRef: WorktreeRef = {
      repo: 'ALPHA',
      path: path.join(WORKTREES, 'ALPHA'),
      branch: 'main',
      exists: true,
      resolvedVia: 'git',
    };
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['ONE'], repo: 'ALPHA', branch: 'main' },
      projects: [project('ONE')],
      worktrees: { 'project:ONE': [legacyRef] },
    });

    const standing = resolveStanding(h.opts);

    expect(standing!.worktree!.path).toBe(legacyRef.path);
    expect(standing!.worktree!.path).not.toBe(path.dirname(legacyRef.path));
  });
});

describe('resolveStanding — the git budget', () => {
  it('spends nothing when no worktree reference resolves to probe', () => {
    // No `worktrees` entry for the project, so `resolveWorktrees` yields an empty ref list —
    // `probeBranch` bails before spending anything, the only real no-probe case: the default
    // service factory always builds classify-time `locate()` with a no-op git exec, so a real
    // `located.branch` (like the pre-fix version of this test injected directly) never occurs.
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['ONE'], repo: 'api', branch: null },
      projects: [project('ONE')],
    });
    h.opts.cwd = path.join(WORKTREES, 'ALPHA', 'api');

    const standing = resolveStanding(h.opts);

    expect(standing!.worktree!.branch).toBeNull();
    expect(h.probes).toBe(0);
    expect(h.gitCalls).toHaveLength(0);
  });

  it('probes for the branch when located.repo is set and located.branch is null (the common case)', () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['ONE'], repo: 'api', branch: null },
      projects: [project('ONE')],
      worktrees: { 'project:ONE': [ref('ALPHA', 'api'), ref('ALPHA', 'ui')] },
      probedBranch: 'radorch/ALPHA',
    });
    h.opts.cwd = path.join(WORKTREES, 'ALPHA', 'api');

    const standing = resolveStanding(h.opts);

    expect(standing!.worktree!.branch).toBe('radorch/ALPHA');
    expect(h.probes).toBe(1);
    expect(h.gitCalls).toHaveLength(1);
  });

  it('spends exactly one invocation when the branch is unknown, whatever the repo count', () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['ONE'], branch: null },
      projects: [project('ONE')],
      worktrees: { 'project:ONE': [ref('ALPHA', 'api'), ref('ALPHA', 'ui'), ref('ALPHA', 'docs')] },
      probedBranch: 'radorch/ALPHA',
    });

    const standing = resolveStanding(h.opts);

    expect(standing!.worktree!.branch).toBe('radorch/ALPHA');
    expect(h.probes).toBe(1);
    expect(h.gitCalls).toHaveLength(1);
    expect(h.gitCalls[0].cwd).toBe(path.join(WORKTREES, 'ALPHA', 'api'));
  });

  it('spends nothing on the side-project path', () => {
    const h = harness({
      located: { kind: 'side-project', worktree_name: 'SCRATCH' },
      projects: [project('SCRATCH', { projectType: 'side-project' })],
    });

    resolveStanding(h.opts);

    expect(h.gitCalls).toHaveLength(0);
  });
});

describe('resolveStanding — portfolio resolution', () => {
  const portfolioRef = (status: PortfolioLifecycle | null): PortfolioRef => ({
    name: 'PLATFORM',
    rootProject: 'PLATFORM-ROOT',
    dir: path.join('/rad', 'projects', 'PLATFORM-ROOT'),
    rootDoc: path.join('/rad', 'projects', 'PLATFORM-ROOT', 'PLATFORM-ROOT.md'),
    status,
  });

  const lifecycles: (PortfolioLifecycle | null)[] = ['active', 'on-hold', 'done', null];
  for (const status of lifecycles) {
    it(`carries the portfolio's name, status (${status}), and root doc when the group holds a root project`, () => {
      const ref = portfolioRef(status);
      const h = harness({
        located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['ONE'], branch: null },
        projects: [project('ONE')],
        edges: [
          { type: 'contains', from: 'group:PLATFORM', to: 'project:ONE' },
          { type: 'contains', from: 'group:PLATFORM', to: 'project:PLATFORM-ROOT' },
        ],
        portfolio: ref,
      });

      const standing = resolveStanding(h.opts);

      expect(standing!.portfolio).toEqual({ name: ref.name, status: ref.status, rootDoc: ref.rootDoc });
    });
  }

  it("carries no portfolio when the tip's group holds no root project", () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['ONE'], branch: null },
      projects: [project('ONE')],
      edges: [{ type: 'contains', from: 'group:PLATFORM', to: 'project:ONE' }],
      portfolio: null,
    });

    const standing = resolveStanding(h.opts);

    expect(standing!.portfolio).toBeUndefined();
  });

  it('carries no portfolio, and never consults resolvePortfolioAmong, when the tip has no containing group at all', () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['ONE'], branch: null },
      projects: [project('ONE')],
    });

    const standing = resolveStanding(h.opts);

    expect(standing!.portfolio).toBeUndefined();
    expect(h.portfolioCalls).toHaveLength(0);
  });

  it("passes the containing group's member ids — not the whole project list, and not the tip alone", () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['ONE'], branch: null },
      projects: [project('ONE'), project('OUTSIDER')],
      edges: [
        { type: 'contains', from: 'group:PLATFORM', to: 'project:ONE' },
        { type: 'contains', from: 'group:PLATFORM', to: 'project:PLATFORM-ROOT' },
      ],
      portfolio: null,
    });

    resolveStanding(h.opts);

    expect(h.portfolioCalls).toEqual([['project:ONE', 'project:PLATFORM-ROOT']]);
  });

  it('degrades the whole standing to null when resolvePortfolioAmong throws', () => {
    const h = harness({
      located: { kind: 'worktree', worktree_name: 'ALPHA', projects: ['ONE'], branch: null },
      projects: [project('ONE')],
      edges: [{ type: 'contains', from: 'group:PLATFORM', to: 'project:ONE' }],
      throwOnResolvePortfolioAmong: true,
    });

    expect(resolveStanding(h.opts)).toBeNull();
  });
});

describe('resolveStanding — resilience', () => {
  it('resolves null rather than throwing when the classifier throws', () => {
    const h = harness({ located: { kind: 'worktree' }, throwOnLocate: true });
    expect(() => resolveStanding(h.opts)).not.toThrow();
    expect(resolveStanding(h.opts)).toBeNull();
  });

  it('keeps the standing when the workspace repos cannot be resolved', () => {
    const failing: StandingServiceFactory = () => ({
      locate: () => ({ kind: 'worktree', worktree_name: 'ALPHA', projects: ['ONE'], branch: null }),
      listProjects: () => [project('ONE')],
      getGraph: () => ({ schema: 'work-graph/v1', nodes: [], edges: [], danglingEdges: [] }),
      resolveWorktrees: () => { throw new Error('unreadable project'); },
      resolvePortfolioAmong: () => null,
    });

    const standing = resolveStanding({ cwd: path.join(WORKTREES, 'ALPHA'), worktreesDir: WORKTREES, serviceFactory: failing });

    expect(standing!.tip.name).toBe('ONE');
    expect(standing!.worktree).toEqual({ path: path.join(WORKTREES, 'ALPHA'), branch: null, repos: [] });
  });
});
