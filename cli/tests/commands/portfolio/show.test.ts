import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import type { Edge, Project } from '@rad-orchestration/work-graph';
import { portfolioShow } from '../../../src/commands/portfolio/show.js';
import type { PortfolioShowOptions } from '../../../src/commands/portfolio/show.js';
import { UserError } from '../../../src/framework/errors.js';
import type { FsReads } from '../../../src/commands/portfolio/identity.js';
import type { GraphPort } from '../../../src/commands/portfolio/graph-port.js';

const PROJECTS_DIR = path.join('root', 'projects');
const inProjects = (...segments: string[]) => path.join(PROJECTS_DIR, ...segments);

function project(id: string, over: Partial<Project> = {}): Project {
  return {
    id,
    kind: 'project',
    name: id,
    status: 'unknown',
    state: 'planning',
    stateLabel: 'Planning',
    dir: inProjects(id),
    tier: null,
    projectType: 'standard',
    sourceControlInitialized: false,
    docs: { others: [], subfolders: [] },
    worktrees: [],
    haltReason: null,
    ...over,
  };
}

function stubFs(spec: { files?: Record<string, string>; listings?: Record<string, string[]> } = {}): FsReads {
  const files = spec.files ?? {};
  const listings = spec.listings ?? {};
  return {
    exists: (p) => p in files,
    readFile: (p) => files[p] ?? '',
    readDirNames: (p) => listings[p] ?? [],
    isDirectory: (p) => p in listings,
  };
}

interface PortSpec {
  groups?: Array<{ id: string; name: string }>;
  members?: Record<string, Project[]>;
  edges?: Edge[];
  onGetGraph?: () => void;
}

function stubPort(spec: PortSpec = {}): GraphPort {
  return {
    listGroups: () => spec.groups ?? [],
    listMembers: (id: string) => spec.members?.[id] ?? [],
    getGraph: () => {
      spec.onGetGraph?.();
      return { schema: 'work-graph/v1', nodes: [], edges: spec.edges ?? [], danglingEdges: [] };
    },
  } as unknown as GraphPort;
}

// ── The default fixture: PORTFOLIO, bound to group:portfolio ─────────────────
//
// Members deliberately arrive unsorted, and deliberately include
// SESSION-TRACKING-DESIGN — a real directory that holds a document of its own
// name without being a portfolio root. It must survive as an iteration.

const MEMBERS: Project[] = [
  project('PORTFOLIO-ROOT'),
  project('PORTFOLIO-2', { state: 'not_started' }),
  project('SESSION-TRACKING-DESIGN', { state: 'complete' }),
  project('PORTFOLIO-1', {
    state: 'executing',
    docs: {
      requirements: 'PORTFOLIO-1-REQUIREMENTS.md',
      masterPlan: 'PORTFOLIO-1-MASTER-PLAN.md',
      others: ['PORTFOLIO-1-AMENDMENT-02.md', 'NOTES.md', 'PORTFOLIO-1-AMENDMENT-01.md'],
      subfolders: ['reports'],
    },
  }),
  project('PORTFOLIO-3', {
    state: 'planning',
    docs: { requirements: 'PORTFOLIO-3-REQUIREMENTS.md', others: [], subfolders: [] },
  }),
];

const DEFAULT_FILES: Record<string, string> = {
  [inProjects('PORTFOLIO-ROOT', 'PORTFOLIO-ROOT.md')]: '---\nstatus: active\n---\nBody\n',
  [inProjects('PORTFOLIO-ROOT', 'PORTFOLIO-DECISIONS.md')]: 'decisions',
  [inProjects('SESSION-TRACKING-DESIGN', 'SESSION-TRACKING-DESIGN.md')]: 'self-named, not a portfolio',
};

const DEFAULT_LISTINGS: Record<string, string[]> = {
  [PROJECTS_DIR]: ['PORTFOLIO-ROOT', 'PORTFOLIO-1', 'PORTFOLIO-2', 'PORTFOLIO-3', 'SESSION-TRACKING-DESIGN'],
  [inProjects('PORTFOLIO-1', 'reports')]: ['PORTFOLIO-1-FINAL-REVIEW.md', 'phase-1-review.md'],
};

function baseOptions(over: Partial<PortfolioShowOptions> = {}): PortfolioShowOptions {
  return {
    projectsDir: PROJECTS_DIR,
    portfolio: 'PORTFOLIO',
    port: stubPort({
      groups: [{ id: 'group:portfolio', name: 'Portfolio' }],
      members: { 'group:portfolio': MEMBERS },
      edges: [{ type: 'contains', from: 'group:portfolio', to: 'PORTFOLIO-ROOT' }],
    }),
    fs: stubFs({ files: DEFAULT_FILES, listings: DEFAULT_LISTINGS }),
    ...over,
  };
}

const iteration = (result: ReturnType<typeof portfolioShow>, name: string) =>
  result.iterations.find((i) => i.name === name)!;

describe('portfolioShow — resolution', () => {
  it('returns the same portfolio for a base name, a group name, and a full group id', () => {
    const byBase = portfolioShow(baseOptions({ portfolio: 'PORTFOLIO' }));
    const byLowercase = portfolioShow(baseOptions({ portfolio: 'portfolio' }));
    const byGroupId = portfolioShow(baseOptions({ portfolio: 'group:portfolio' }));
    expect(byLowercase).toEqual(byBase);
    expect(byGroupId).toEqual(byBase);
    expect(byBase.name).toBe('PORTFOLIO');
    expect(byBase.group).toBe('group:portfolio');
    expect(byBase.status).toBe('active');
    expect(byBase.root).toEqual({
      project: 'PORTFOLIO-ROOT',
      dir: inProjects('PORTFOLIO-ROOT'),
      doc: inProjects('PORTFOLIO-ROOT', 'PORTFOLIO-ROOT.md'),
    });
  });

  it('resolves a slugified group id passed without its prefix, which matches neither id nor name', () => {
    // The A1 regression: `data.group` carries the slug (`rad-orc`), which misses
    // g.id (`group:rad-orc`) and misses g.name (`RAD.ORC`).
    const options = baseOptions({
      portfolio: 'rad-orc',
      port: stubPort({
        groups: [{ id: 'group:rad-orc', name: 'RAD.ORC' }],
        members: { 'group:rad-orc': [project('RAD.ORC-ROOT'), project('RAD.ORC-1')] },
      }),
      fs: stubFs({ files: { [inProjects('RAD.ORC-ROOT', 'RAD.ORC-ROOT.md')]: 'root' } }),
    });
    const result = portfolioShow(options);
    expect(result.name).toBe('RAD.ORC');
    expect(result.group).toBe('group:rad-orc');
    expect(result.iterations.map((i) => i.name)).toEqual(['RAD.ORC-1']);
  });

  it('resolves an unslugified group name too', () => {
    const result = portfolioShow(baseOptions({
      portfolio: 'RAD.ORC',
      port: stubPort({
        groups: [{ id: 'group:rad-orc', name: 'RAD.ORC' }],
        members: { 'group:rad-orc': [project('RAD.ORC-ROOT')] },
      }),
      fs: stubFs({ files: { [inProjects('RAD.ORC-ROOT', 'RAD.ORC-ROOT.md')]: 'root' } }),
    }));
    expect(result.name).toBe('RAD.ORC');
  });

  it('resolves by base name, case-insensitively, when no group matches', () => {
    const options = baseOptions({
      port: stubPort({}),
      fs: stubFs({
        files: { [inProjects('STANDALONE-ROOT', 'STANDALONE-ROOT.md')]: 'root' },
        listings: { [PROJECTS_DIR]: ['STANDALONE-ROOT'] },
      }),
    });
    expect(portfolioShow({ ...options, portfolio: 'STANDALONE' }).name).toBe('STANDALONE');
    expect(portfolioShow({ ...options, portfolio: 'standalone' }).name).toBe('STANDALONE');
  });

  it('falls through to the base-name path when the matched group holds no root document', () => {
    const result = portfolioShow(baseOptions({
      portfolio: 'STANDALONE',
      port: stubPort({
        groups: [{ id: 'group:standalone', name: 'Standalone' }],
        members: { 'group:standalone': [project('MR-1'), project('MR-2')] },
        edges: [{ type: 'contains', from: 'group:standalone', to: 'MR-1' }],
      }),
      fs: stubFs({
        files: { [inProjects('STANDALONE-ROOT', 'STANDALONE-ROOT.md')]: 'root' },
        listings: { [PROJECTS_DIR]: ['STANDALONE-ROOT'] },
      }),
    }));
    expect(result.name).toBe('STANDALONE');
    expect(result.group).toBeNull();
    expect(result.iterations).toEqual([]);
  });

  it('resolves the exact id/slug match ahead of an unrelated group whose display name collides, regardless of list order', () => {
    // group:beta's display name has drifted to coincidentally equal group:alpha's
    // own slug — 'alpha' must always resolve to group:alpha, never group:beta,
    // no matter which one `listGroups()` returns first.
    const idMatchGroup = { id: 'group:alpha', name: 'Something Else' };
    const nameMatchGroup = { id: 'group:beta', name: 'ALPHA' };
    const fs = stubFs({
      files: {
        [inProjects('ALPHA-ROOT', 'ALPHA-ROOT.md')]: 'root',
        [inProjects('BETA-ROOT', 'BETA-ROOT.md')]: 'root',
      },
    });
    const members = {
      'group:alpha': [project('ALPHA-ROOT')],
      'group:beta': [project('BETA-ROOT')],
    };

    const forward = portfolioShow(baseOptions({
      portfolio: 'alpha',
      port: stubPort({ groups: [idMatchGroup, nameMatchGroup], members }),
      fs,
    }));
    const reversed = portfolioShow(baseOptions({
      portfolio: 'alpha',
      port: stubPort({ groups: [nameMatchGroup, idMatchGroup], members }),
      fs,
    }));

    expect(forward.group).toBe('group:alpha');
    expect(forward.name).toBe('ALPHA');
    expect(reversed).toEqual(forward);
  });

  it('throws UserError naming both attempts when nothing resolves', () => {
    let error: unknown;
    try {
      portfolioShow(baseOptions({ portfolio: 'NOPE' }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).message).toContain("no group matches 'NOPE'");
    expect((error as UserError).message).toContain('NOPE-ROOT/NOPE-ROOT.md');
  });

  it('throws UserError when the root directory exists but holds no root document', () => {
    // A freshly created portfolio whose root document has not been authored yet.
    expect(() => portfolioShow(baseOptions({
      portfolio: 'FRESH',
      port: stubPort({}),
      fs: stubFs({ listings: { [PROJECTS_DIR]: ['FRESH-ROOT'], [inProjects('FRESH-ROOT')]: [] } }),
    }))).toThrow(UserError);
  });

  it('issues at most one getGraph of its own on either resolution path', () => {
    const viaGroup = vi.fn();
    portfolioShow(baseOptions({
      port: stubPort({
        groups: [{ id: 'group:portfolio', name: 'Portfolio' }],
        members: { 'group:portfolio': MEMBERS },
        onGetGraph: viaGroup,
      }),
    }));
    expect(viaGroup.mock.calls.length).toBeLessThanOrEqual(1);

    const viaBaseName = vi.fn();
    portfolioShow(baseOptions({
      portfolio: 'STANDALONE',
      port: stubPort({
        edges: [{ type: 'contains', from: 'group:standalone', to: 'STANDALONE-ROOT' }],
        onGetGraph: viaBaseName,
      }),
      fs: stubFs({
        files: { [inProjects('STANDALONE-ROOT', 'STANDALONE-ROOT.md')]: 'root' },
        listings: { [PROJECTS_DIR]: ['STANDALONE-ROOT'] },
      }),
    }));
    expect(viaBaseName.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe('portfolioShow — iterations', () => {
  it('excludes the resolved root project and keeps a member holding a document of its own name', () => {
    const names = portfolioShow(baseOptions()).iterations.map((i) => i.name);
    expect(names).not.toContain('PORTFOLIO-ROOT');
    expect(names).toContain('SESSION-TRACKING-DESIGN');
  });

  it('orders iterations by name ascending regardless of member order', () => {
    const names = portfolioShow(baseOptions()).iterations.map((i) => i.name);
    expect(names).toEqual(['PORTFOLIO-1', 'PORTFOLIO-2', 'PORTFOLIO-3', 'SESSION-TRACKING-DESIGN']);
  });

  it('carries the work-graph state through verbatim alongside the derived status', () => {
    const row = iteration(portfolioShow(baseOptions()), 'PORTFOLIO-1');
    expect(row.state).toBe('executing');
    expect(row.dir).toBe(inProjects('PORTFOLIO-1'));
  });

  it('derives proposed, planned, and executing from document presence', () => {
    const result = portfolioShow(baseOptions());
    expect(iteration(result, 'PORTFOLIO-2').derivedStatus).toBe('proposed');
    expect(iteration(result, 'PORTFOLIO-3').derivedStatus).toBe('planned');
    expect(iteration(result, 'PORTFOLIO-1').derivedStatus).toBe('executing');
  });

  it('derives shipped from a complete state even with no requirements document', () => {
    const row = iteration(portfolioShow(baseOptions()), 'SESSION-TRACKING-DESIGN');
    expect(row.docs.requirements).toBeNull();
    expect(row.derivedStatus).toBe('shipped');
  });
});

describe('portfolioShow — document resolution', () => {
  it('joins the bare requirements and master-plan filenames onto the project dir', () => {
    const row = iteration(portfolioShow(baseOptions()), 'PORTFOLIO-1');
    expect(row.docs.requirements).toBe(inProjects('PORTFOLIO-1', 'PORTFOLIO-1-REQUIREMENTS.md'));
    expect(row.docs.masterPlan).toBe(inProjects('PORTFOLIO-1', 'PORTFOLIO-1-MASTER-PLAN.md'));
  });

  it('returns null for absent requirements and master plan', () => {
    const row = iteration(portfolioShow(baseOptions()), 'PORTFOLIO-2');
    expect(row.docs.requirements).toBeNull();
    expect(row.docs.masterPlan).toBeNull();
  });

  it('resolves amendments in ascending order and ignores unrelated files', () => {
    const row = iteration(portfolioShow(baseOptions()), 'PORTFOLIO-1');
    expect(row.docs.amendments).toEqual([
      inProjects('PORTFOLIO-1', 'PORTFOLIO-1-AMENDMENT-01.md'),
      inProjects('PORTFOLIO-1', 'PORTFOLIO-1-AMENDMENT-02.md'),
    ]);
    expect(iteration(portfolioShow(baseOptions()), 'PORTFOLIO-2').docs.amendments).toEqual([]);
  });

  it('resolves the final review by reading reports/, which the subfolder listing alone cannot', () => {
    const row = iteration(portfolioShow(baseOptions()), 'PORTFOLIO-1');
    expect(row.docs.finalReview).toBe(inProjects('PORTFOLIO-1', 'reports', 'PORTFOLIO-1-FINAL-REVIEW.md'));
  });

  it('returns null for a final review when reports/ is absent', () => {
    const row = iteration(portfolioShow(baseOptions()), 'PORTFOLIO-3');
    expect(row.docs.finalReview).toBeNull();
  });

  it('reports all five portfolio documents with existence, present or not', () => {
    const result = portfolioShow(baseOptions());
    expect(Object.keys(result.docs).sort()).toEqual(['decisions', 'groundTruth', 'iterations', 'root', 'technical']);
    expect(result.docs.root).toEqual({ path: inProjects('PORTFOLIO-ROOT', 'PORTFOLIO-ROOT.md'), exists: true });
    expect(result.docs.decisions.exists).toBe(true);
    expect([result.docs.iterations.exists, result.docs.technical.exists, result.docs.groundTruth.exists])
      .toEqual([false, false, false]);
    expect(result.docs.technical.path).toBe(inProjects('PORTFOLIO-ROOT', 'PORTFOLIO-TECHNICAL.md'));
  });
});

describe('portfolioShow — degradation and guards', () => {
  it('returns status null for a root document with no frontmatter and for a malformed status', () => {
    const withFiles = (rootDoc: string) => baseOptions({
      fs: stubFs({
        files: { ...DEFAULT_FILES, [inProjects('PORTFOLIO-ROOT', 'PORTFOLIO-ROOT.md')]: rootDoc },
        listings: DEFAULT_LISTINGS,
      }),
    });
    expect(portfolioShow(withFiles('No frontmatter here.\n')).status).toBeNull();
    expect(portfolioShow(withFiles('---\nstatus: retired\n---\nBody\n')).status).toBeNull();
  });

  it.each(['../ESCAPE', '/abs/path', 'A\\B'])('rejects %s before touching the filesystem', (value) => {
    const reads = {
      exists: vi.fn(() => false),
      readFile: vi.fn(() => ''),
      readDirNames: vi.fn(() => [] as string[]),
      isDirectory: vi.fn(() => false),
    };
    expect(() => portfolioShow(baseOptions({ portfolio: value, fs: reads }))).toThrow(UserError);
    for (const read of Object.values(reads)) expect(read).not.toHaveBeenCalled();
  });
});

describe('portfolioShow — dependsOn', () => {
  it('surfaces an iteration with one recorded dependency', () => {
    const result = portfolioShow(baseOptions({
      port: stubPort({
        groups: [{ id: 'group:portfolio', name: 'Portfolio' }],
        members: { 'group:portfolio': MEMBERS },
        edges: [
          { type: 'contains', from: 'group:portfolio', to: 'PORTFOLIO-ROOT' },
          { type: 'depends-on', from: 'PORTFOLIO-2', to: 'PORTFOLIO-1' },
        ],
      }),
    }));
    expect(iteration(result, 'PORTFOLIO-2').dependsOn).toEqual(['PORTFOLIO-1']);
  });

  it('surfaces multiple dependencies sorted ascending', () => {
    const result = portfolioShow(baseOptions({
      port: stubPort({
        groups: [{ id: 'group:portfolio', name: 'Portfolio' }],
        members: { 'group:portfolio': MEMBERS },
        edges: [
          { type: 'contains', from: 'group:portfolio', to: 'PORTFOLIO-ROOT' },
          { type: 'depends-on', from: 'PORTFOLIO-3', to: 'PORTFOLIO-2' },
          { type: 'depends-on', from: 'PORTFOLIO-3', to: 'PORTFOLIO-1' },
          { type: 'depends-on', from: 'PORTFOLIO-3', to: 'SESSION-TRACKING-DESIGN' },
        ],
      }),
    }));
    expect(iteration(result, 'PORTFOLIO-3').dependsOn).toEqual([
      'PORTFOLIO-1',
      'PORTFOLIO-2',
      'SESSION-TRACKING-DESIGN',
    ]);
  });

  it('returns empty array when an iteration has no recorded dependencies', () => {
    const result = portfolioShow(baseOptions({
      port: stubPort({
        groups: [{ id: 'group:portfolio', name: 'Portfolio' }],
        members: { 'group:portfolio': MEMBERS },
        edges: [{ type: 'contains', from: 'group:portfolio', to: 'PORTFOLIO-ROOT' }],
      }),
    }));
    expect(iteration(result, 'PORTFOLIO-1').dependsOn).toEqual([]);
  });

  it('filters by edge type: ignores non-depends-on edges from the same node', () => {
    const result = portfolioShow(baseOptions({
      port: stubPort({
        groups: [{ id: 'group:portfolio', name: 'Portfolio' }],
        members: { 'group:portfolio': MEMBERS },
        edges: [
          { type: 'contains', from: 'group:portfolio', to: 'PORTFOLIO-ROOT' },
          { type: 'contains', from: 'PORTFOLIO-1', to: 'MR-1' },
          { type: 'follows', from: 'PORTFOLIO-1', to: 'PORTFOLIO-2' },
          { type: 'depends-on', from: 'PORTFOLIO-1', to: 'PORTFOLIO-3' },
        ],
      }),
    }));
    expect(iteration(result, 'PORTFOLIO-1').dependsOn).toEqual(['PORTFOLIO-3']);
  });

  it('matches edges on project.id, not project.dir', () => {
    // Fixture where project id differs from dir to prove the match happens on id.
    // Members have different ids (bare dir names are the ids).
    const customMembers = [
      project('PORTFOLIO-ROOT'),
      project('PORTFOLIO-2', { dir: inProjects('custom-dir-name') }),
      project('PORTFOLIO-1'),
    ];
    const result = portfolioShow(baseOptions({
      port: stubPort({
        groups: [{ id: 'group:portfolio', name: 'Portfolio' }],
        members: { 'group:portfolio': customMembers },
        edges: [
          { type: 'contains', from: 'group:portfolio', to: 'PORTFOLIO-ROOT' },
          { type: 'depends-on', from: 'PORTFOLIO-1', to: 'PORTFOLIO-2' },
        ],
      }),
    }));
    const p1 = iteration(result, 'PORTFOLIO-1');
    // Should match on id 'PORTFOLIO-2', not on dir 'custom-dir-name'.
    expect(p1.dependsOn).toEqual(['PORTFOLIO-2']);
  });

  it('ensures getGraph is called exactly once when building dependsOn, regardless of member count', () => {
    const getGraphCount = vi.fn();
    portfolioShow(baseOptions({
      port: stubPort({
        groups: [{ id: 'group:portfolio', name: 'Portfolio' }],
        members: { 'group:portfolio': MEMBERS },
        edges: [{ type: 'contains', from: 'group:portfolio', to: 'PORTFOLIO-ROOT' }],
        onGetGraph: getGraphCount,
      }),
    }));
    expect(getGraphCount.mock.calls.length).toBe(1);
  });
});
