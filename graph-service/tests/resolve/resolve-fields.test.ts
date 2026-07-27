import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DataSchema } from '@rad-orchestration/graph-engine';
import type { WorktreeRecord } from '@rad-orchestration/graph-store-sqlite';
import { createFieldResolver, type FieldResolverDeps } from '../../src/resolve/resolve-fields.js';

// Roots the tests supply. Every expected absolute path is derived from these same roots so the
// suite is portable — never a machine-specific literal.
const WORKTREES_ROOT = path.resolve('one', 'worktrees');
const PROJECT_DOC_ROOT = path.resolve('one', 'projects', 'demo');
const PROJECT_ID = 'demo';

function record(overrides: Partial<WorktreeRecord> & Pick<WorktreeRecord, 'repo'>): WorktreeRecord {
  return {
    projectId: PROJECT_ID,
    repo: overrides.repo,
    path: overrides.path ?? null,
    branch: overrides.branch ?? null,
    baseBranch: overrides.baseBranch ?? null,
    prUrl: overrides.prUrl ?? null,
  };
}

function deps(overrides: Partial<FieldResolverDeps> = {}): FieldResolverDeps {
  return {
    projectDocRoot: PROJECT_DOC_ROOT,
    worktreesRoot: WORKTREES_ROOT,
    projectId: PROJECT_ID,
    worktrees: [],
    ...overrides,
  };
}

// Fabricated schemas with invented field names — the node-blindness proof: the resolver never keys
// on a concrete node type or field name, only on the `resolve` axis.
describe('createFieldResolver — dispatch on declarations only', () => {
  it('resolves a hinted doc-path field and leaves an unhinted field untouched', () => {
    const schema: DataSchema = {
      scope_doc: { kind: 'string', level: 'required', resolve: 'project-doc-path' },
      note: { kind: 'string', level: 'optional' },
    };
    const resolve = createFieldResolver(deps());

    const out = resolve(schema, { scope_doc: 'plans/p1.md', note: 'plans/p1.md' });

    expect(out.scope_doc).toBe(path.join(PROJECT_DOC_ROOT, 'plans', 'p1.md'));
    // The unhinted field is left exactly as it arrived — never run through path resolution.
    expect(out.note).toBe('plans/p1.md');
  });

  it('passes an unhinted repo-shaped field through untouched (the approval case)', () => {
    const schema: DataSchema = {
      // repo-shaped, but declares no resolve hint — its pr_url must survive, no path introduced.
      approvals: { kind: 'array', level: 'optional' },
    };
    const resolve = createFieldResolver(deps({ worktrees: [record({ repo: 'svc', path: 'demo/svc' })] }));

    const approvals = [{ name: 'svc', pr_url: 'https://example.test/pr/1' }];
    const out = resolve(schema, { approvals });

    expect(out.approvals).toEqual([{ name: 'svc', pr_url: 'https://example.test/pr/1' }]);
  });

  it('never introduces an absent field (optional and computed)', () => {
    const schema: DataSchema = {
      maybe_doc: { kind: 'string', level: 'optional', resolve: 'project-doc-path' },
      derived_repos: { kind: 'array', level: 'computed', resolve: 'worktree-repo-set' },
    };
    const resolve = createFieldResolver(deps());

    const out = resolve(schema, { other: 1 });

    expect(Object.prototype.hasOwnProperty.call(out, 'maybe_doc')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, 'derived_repos')).toBe(false);
    expect(out.other).toBe(1);
  });

  it('does not mutate the input data', () => {
    const schema: DataSchema = {
      scope_doc: { kind: 'string', level: 'required', resolve: 'project-doc-path' },
    };
    const resolve = createFieldResolver(deps());
    const input = { scope_doc: 'plans/p1.md' };

    resolve(schema, input);

    expect(input.scope_doc).toBe('plans/p1.md');
  });
});

describe('createFieldResolver — worktree-repo-set', () => {
  const schema: DataSchema = {
    work_repos: { kind: 'array', level: 'required', resolve: 'worktree-repo-set' },
  };

  it('joins a record whose stored ref is set against the worktrees root, carrying every other field through', () => {
    const resolve = createFieldResolver(deps({
      // record key is `repo`; entry key is `name` — the mapping is explicit.
      worktrees: [record({ repo: 'svc', path: 'shared-name/svc' })],
    }));

    const out = resolve(schema, {
      work_repos: [{ name: 'svc', branch: 'feat/x', head_sha: 'aaa', base_sha: 'bbb' }],
    });

    expect(out.work_repos).toEqual([
      {
        name: 'svc',
        branch: 'feat/x',
        head_sha: 'aaa',
        base_sha: 'bbb',
        path: path.resolve(WORKTREES_ROOT, 'shared-name/svc'),
      },
    ]);
  });

  it('falls back to the conventional derivation when the record path is null', () => {
    const resolve = createFieldResolver(deps({
      worktrees: [record({ repo: 'svc', path: null })],
    }));

    const out = resolve(schema, { work_repos: [{ name: 'svc', branch: 'main' }] });

    expect(out.work_repos).toEqual([
      { name: 'svc', branch: 'main', path: path.resolve(WORKTREES_ROOT, PROJECT_ID, 'svc') },
    ]);
  });

  it('refuses a repo with no record at all, naming the field — not conventionalized', () => {
    const resolve = createFieldResolver(deps({ worktrees: [record({ repo: 'svc', path: 'demo/svc' })] }));

    expect(() => resolve(schema, { work_repos: [{ name: 'ghost' }] })).toThrow(/work_repos/);
    expect(() => resolve(schema, { work_repos: [{ name: 'ghost' }] })).toThrow(/ghost/);
  });

  it('resolves every entry independently across a multi-repo set', () => {
    const resolve = createFieldResolver(deps({
      worktrees: [
        record({ repo: 'svc', path: 'demo/svc' }),
        record({ repo: 'web', path: null }),
      ],
    }));

    const out = resolve(schema, { work_repos: [{ name: 'svc' }, { name: 'web' }] }) as {
      work_repos: Array<{ name: string; path: string }>;
    };

    expect(out.work_repos[0].path).toBe(path.resolve(WORKTREES_ROOT, 'demo/svc'));
    expect(out.work_repos[1].path).toBe(path.resolve(WORKTREES_ROOT, PROJECT_ID, 'web'));
  });
});

describe('createFieldResolver — project-doc-path', () => {
  it('joins a relative path against the project doc root and leaves an in-root absolute alone', () => {
    const schema: DataSchema = {
      doc: { kind: 'string', level: 'required', resolve: 'project-doc-path' },
    };
    const resolve = createFieldResolver(deps());
    const inRootAbsolute = path.join(PROJECT_DOC_ROOT, 'tasks', 'a.md');

    expect(resolve(schema, { doc: 'tasks/a.md' }).doc).toBe(path.join(PROJECT_DOC_ROOT, 'tasks', 'a.md'));
    expect(resolve(schema, { doc: inRootAbsolute }).doc).toBe(inRootAbsolute);
  });

  it('resolves an array element-wise with order preserved', () => {
    const schema: DataSchema = {
      docs: { kind: 'array', level: 'required', resolve: 'project-doc-path' },
    };
    const resolve = createFieldResolver(deps());

    const out = resolve(schema, { docs: ['p/one.md', 'p/two.md'] });

    expect(out.docs).toEqual([
      path.join(PROJECT_DOC_ROOT, 'p', 'one.md'),
      path.join(PROJECT_DOC_ROOT, 'p', 'two.md'),
    ]);
  });

  it('refuses a traversal escape', () => {
    const schema: DataSchema = {
      doc: { kind: 'string', level: 'required', resolve: 'project-doc-path' },
    };
    const resolve = createFieldResolver(deps());

    expect(() => resolve(schema, { doc: '../escape.md' })).toThrow(/doc/);
  });

  it('refuses an absolute path outside the root', () => {
    const schema: DataSchema = {
      doc: { kind: 'string', level: 'required', resolve: 'project-doc-path' },
    };
    const resolve = createFieldResolver(deps());
    const outsideAbsolute = path.resolve(PROJECT_DOC_ROOT, '..', 'other', 'x.md');

    expect(() => resolve(schema, { doc: outsideAbsolute })).toThrow(/escapes/);
  });

  it('refuses an array whose element escapes', () => {
    const schema: DataSchema = {
      docs: { kind: 'array', level: 'required', resolve: 'project-doc-path' },
    };
    const resolve = createFieldResolver(deps());

    expect(() => resolve(schema, { docs: ['ok.md', '../bad.md'] })).toThrow(/docs/);
  });
});

describe('createFieldResolver — the fail-loud guard', () => {
  it('throws naming the field when a required field is present and unresolvable', () => {
    const schema: DataSchema = {
      req_repos: { kind: 'array', level: 'required', resolve: 'worktree-repo-set' },
    };
    const resolve = createFieldResolver(deps());

    expect(() => resolve(schema, { req_repos: [{ name: 'svc' }] })).toThrow(/req_repos/);
  });

  it('does not throw when an optional field is absent', () => {
    const schema: DataSchema = {
      opt_doc: { kind: 'string', level: 'optional', resolve: 'project-doc-path' },
    };
    const resolve = createFieldResolver(deps());

    expect(() => resolve(schema, {})).not.toThrow();
  });

  it('throws when an optional field is present but unresolvable', () => {
    const schema: DataSchema = {
      opt_doc: { kind: 'string', level: 'optional', resolve: 'project-doc-path' },
    };
    const resolve = createFieldResolver(deps());

    expect(() => resolve(schema, { opt_doc: '../escape.md' })).toThrow(/opt_doc/);
  });

  it('throws when a required field is absent entirely', () => {
    const schema: DataSchema = {
      req_doc: { kind: 'string', level: 'required', resolve: 'project-doc-path' },
    };
    const resolve = createFieldResolver(deps());

    expect(() => resolve(schema, {})).toThrow(/req_doc/);
  });
});

describe('createFieldResolver — determinism', () => {
  it('produces identical output for the same inputs twice', () => {
    const schema: DataSchema = {
      docs: { kind: 'array', level: 'required', resolve: 'project-doc-path' },
      repos: { kind: 'array', level: 'required', resolve: 'worktree-repo-set' },
    };
    const resolve = createFieldResolver(deps({ worktrees: [record({ repo: 'svc', path: 'demo/svc' })] }));
    const data = { docs: ['a.md', 'b.md'], repos: [{ name: 'svc', branch: 'main' }] };

    expect(resolve(schema, data)).toEqual(resolve(schema, data));
  });
});
