import assert from 'node:assert/strict';
import {
  resolveLocationKind,
  resolveRepoFolderPath,
  buildCommitChip,
  selectPrLinks,
  LOCATION_KIND_LABEL,
} from './source-control-helpers';
import type { SourceControlRepo, V5SourceControlState } from '@/types/state';

// resolveLocationKind (FR-10)
assert.equal(resolveLocationKind('side-project', false), 'side-project');
assert.equal(resolveLocationKind('side-project', true), 'side-project'); // side-project wins
assert.equal(resolveLocationKind('standard', true), 'in-place');
assert.equal(resolveLocationKind('standard', false), 'worktree');
assert.equal(resolveLocationKind(undefined, undefined), 'worktree');

// resolveRepoFolderPath (FR-9, AD-5) — convention-derived, never stored
assert.equal(
  resolveRepoFolderPath({ locationKind: 'worktree', projectName: 'FAKE-NEWS', repoName: 'fake-api', registryPath: null }),
  '~/.radorc/worktrees/FAKE-NEWS/fake-api/',
);
assert.equal(
  resolveRepoFolderPath({ locationKind: 'in-place', projectName: 'P', repoName: 'r', registryPath: 'C:/clones/r' }),
  'C:/clones/r',
);
assert.equal(
  resolveRepoFolderPath({ locationKind: 'side-project', projectName: 'TOY', repoName: 'TOY', registryPath: null }),
  '~/.radorc/side-projects/TOY/',
);

// buildCommitChip (AD-3) — per-repo base URL from that repo's own compare_url
const landed = buildCommitChip({ name: 'fake-api', commit_hash: 'abc1234def' }, 'https://github.com/o/fake-api/compare/main...x');
assert.equal(landed.href, 'https://github.com/o/fake-api/commit/abc1234def');
assert.equal(landed.shortHash, 'abc1234');
assert.equal(landed.linkable, true);

const notLanded = buildCommitChip({ name: 'fake-api', commit_hash: null }, 'https://github.com/o/fake-api/compare/main...x');
assert.equal(notLanded.linkable, false);
assert.equal(notLanded.shortHash, null);

const noBase = buildCommitChip({ name: 'fake-api', commit_hash: 'abc1234' }, null);
assert.equal(noBase.href, null);
assert.equal(noBase.linkable, false);

assert.equal(LOCATION_KIND_LABEL.worktree, 'Worktree');
assert.equal(LOCATION_KIND_LABEL['in-place'], 'In-place · main clone');
assert.equal(LOCATION_KIND_LABEL['side-project'], 'Local · side-project');

// selectPrLinks — repo-aware PR derivation (replaces the repos[0] pin)
function repo(name: string, pr_url: string | null): SourceControlRepo {
  return { name, branch: 'b', base_branch: 'main', remote_url: null, compare_url: null, pr_url };
}
function sc(repos: SourceControlRepo[]): V5SourceControlState {
  return { worktree_path: '/tmp/x', auto_commit: 'never', auto_pr: 'never', repos };
}

assert.deepEqual(selectPrLinks(null), []);
assert.deepEqual(selectPrLinks(undefined), []);
assert.deepEqual(selectPrLinks(sc([])), []);
assert.deepEqual(selectPrLinks(sc([repo('api', null)])), []);
assert.deepEqual(selectPrLinks(sc([repo('api', 'https://github.com/o/api/pull/4')])), [
  { repoName: 'api', url: 'https://github.com/o/api/pull/4' },
]);
assert.deepEqual(
  selectPrLinks(sc([repo('api', null), repo('ui', 'https://github.com/o/ui/pull/5')])),
  [{ repoName: 'ui', url: 'https://github.com/o/ui/pull/5' }],
);
assert.deepEqual(
  selectPrLinks(sc([repo('api', 'https://github.com/o/api/pull/4'), repo('ui', 'https://github.com/o/ui/pull/5')])),
  [
    { repoName: 'api', url: 'https://github.com/o/api/pull/4' },
    { repoName: 'ui', url: 'https://github.com/o/ui/pull/5' },
  ],
);

console.log('source-control-helpers ✓');
