import assert from 'node:assert/strict';
import {
  resolveLocationKind,
  resolveRepoFolderPath,
  buildCommitChip,
  firstCommitHash,
  LOCATION_KIND_LABEL,
} from './source-control-helpers';

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

// firstCommitHash — first non-empty hash across repos (multi-repo commit-row gate)
assert.equal(firstCommitHash(undefined), null);
assert.equal(firstCommitHash([]), null);
assert.equal(firstCommitHash([{ name: 'a', commit_hash: null }, { name: 'b', commit_hash: null }]), null);
// the bug this guards: repos[0] empty but a later repo HAS a commit
assert.equal(firstCommitHash([{ name: 'a', commit_hash: null }, { name: 'b', commit_hash: 'deadbeef' }]), 'deadbeef');
assert.equal(firstCommitHash([{ name: 'a', commit_hash: '' }, { name: 'b', commit_hash: 'abc123' }]), 'abc123');
assert.equal(firstCommitHash([{ name: 'a', commit_hash: 'first' }, { name: 'b', commit_hash: 'second' }]), 'first');

console.log('source-control-helpers ✓');
