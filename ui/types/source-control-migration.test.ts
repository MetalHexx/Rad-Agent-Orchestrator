import assert from 'node:assert/strict';
import { selectSourceControlRepos } from '@/components/dag-timeline/source-control-helpers';
import type { SourceControlRepo } from '@/types/state';

// AD-1: repos[] is the canonical source; readers select it directly.
const repo: SourceControlRepo = { name: 'fake-api', branch: 'radorch/FAKE-NEWS', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null };
assert.deepEqual(selectSourceControlRepos({ repos: [repo] } as any), [repo]);
assert.deepEqual(selectSourceControlRepos(null), []);
assert.deepEqual(selectSourceControlRepos({ repos: undefined } as any), []);

console.log('source-control-migration ✓');
