import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(__dirname, p), 'utf-8');
const projectsSrc = read('use-projects.ts');
const artifactSrc = read('use-artifact-live.tsx');
const registrySrc = read('../components/repo-registry/use-registry-live.ts');
const pageTestSrc = read('../app/projects/page.test.tsx');

test('useProjects subscribes through the shared provider, not its own useSSE EventSource (FR-12, NFR-1)', () => {
  assert.ok(projectsSrc.includes('useSSEContext'), 'useProjects must consume the shared provider');
  assert.ok(!projectsSrc.includes('useSSE('), 'useProjects must not open its own useSSE connection');
});

test('use-artifact-live subscribes through the shared provider and constructs no raw EventSource (FR-12, NFR-1)', () => {
  assert.ok(artifactSrc.includes('useSSEContext'), 'use-artifact-live must consume the shared provider');
  assert.ok(!artifactSrc.includes('new EventSource('), 'use-artifact-live must not construct a raw EventSource');
});

test('use-artifact-live still self-heals via snapshot reconcile on reconnect (FR-13, NFR-2)', () => {
  assert.ok(/refreshSnapshot\(\s*['"]reconcile['"]\s*\)/.test(artifactSrc), 'reconnect self-heal reconcile must be preserved');
});

test('use-registry-live subscribes through the shared provider and keeps hold-while-dirty (FR-12, FR-13, NFR-2)', () => {
  assert.ok(registrySrc.includes('useSSEContext'), 'use-registry-live must consume the shared provider');
  assert.ok(!/useSSE\(/.test(registrySrc), 'use-registry-live must not open its own useSSE connection');
  assert.ok(registrySrc.includes('nextLiveAction'), 'hold-while-dirty policy must be preserved');
});

test('project_removed reconciles against the authoritative list to survive lifecycle coalescing (FR-3, NFR-4)', () => {
  // The lifecycle topic coalesces latest-wins (maxQueuePerTopic = 1), so a burst of
  // lifecycle events collapses to the newest. project_added/connected already refetch;
  // project_removed must ALSO refetch so a surviving removal recovers any sibling
  // lifecycle event the coalesce window dropped — otherwise those projects linger stale.
  const removedCase = projectsSrc.slice(projectsSrc.indexOf('case "project_removed"'));
  const removedBody = removedCase.slice(0, removedCase.indexOf('break;'));
  assert.ok(
    /fetchProjectList\(\)/.test(removedBody),
    'the project_removed handler must refetch the authoritative list, not only filter locally',
  );
});

test('page.test.tsx guard is rewritten for the multiplexed single-connection model (DD-4)', () => {
  assert.ok(!/page\.tsx must not import or call useSSEContext/.test(pageTestSrc),
    'the old guard forbidding useSSEContext must be removed');
  assert.ok(/single shared|multiplex|one shared connection/i.test(pageTestSrc),
    'the rewritten guard must reference the single shared / multiplexed connection');
});
