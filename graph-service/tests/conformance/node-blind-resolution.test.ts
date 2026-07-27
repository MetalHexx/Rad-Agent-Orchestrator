// graph-service/tests/conformance/node-blind-resolution.test.ts
//
// Node-blindness proof: a custom node type with novel field names and resolve hints must resolve
// through the same generic code path as any built-in, with no service or engine edit needed.
// The service's own resolver carries no knowledge of field names, only resolve hints — proving
// a node type with names the service has never heard of still resolves its absolute paths correctly.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';
import { GraphClient } from '@rad-orchestration/graph-client';
import type { BootedDaemon } from '../harness/boot.js';
import { bootDaemon } from '../harness/boot.js';

const REPO_NAME = 'rad-orc-source';
const REPO_BRANCH = 'radorch/STEERABLE-DAG-2.7';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const NODE_BLIND_FIXTURE_DIR = path.join(REPO_ROOT, 'examples', 'node-blind-fixture');

/**
 * Registers `repo` against `project` via the plain `/work-graph/worktree` route.
 */
async function addWorktree(baseUrl: string, projectId: string, repo: string): Promise<void> {
  const res = await fetch(`${baseUrl}/work-graph/worktree`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, repo }),
  });
  if (!res.ok) throw new Error(`addWorktree('${projectId}', '${repo}') failed: HTTP ${res.status}`);
}

describe('conformance: node-blindness — custom node type with novel field names resolves through generic path', () => {
  let daemon: BootedDaemon;

  beforeEach(async () => {
    daemon = await bootDaemon({
      stageNodeTypes: async (root) => {
        const nodeTypesRoot = path.join(root, 'node-types');
        const dest = path.join(nodeTypesRoot, 'custom', 'node-blind-fixture');
        await fs.mkdir(dest, { recursive: true });
        await fs.cp(NODE_BLIND_FIXTURE_DIR, dest, { recursive: true });
      },
    });
  });

  afterEach(async () => {
    await daemon.teardown();
  });

  function radorcRoot(): string {
    return path.dirname(daemon.dbPath);
  }

  function client(): GraphClient {
    return new GraphClient({ baseUrl: daemon.baseUrl() });
  }

  function expectedWorktreePath(projectId: string, repo: string): string {
    return path.join(radorcRoot(), 'worktrees', projectId, repo);
  }

  function expectedDocPath(projectId: string, ...segments: string[]): string {
    return path.join(radorcRoot(), 'projects', projectId, ...segments);
  }

  it('resolves worktree-repo-set hint on a custom node type with a novel field name', async () => {
    const projectId = 'node-blind-worktree-repos';
    const project = client().project(projectId);

    await project.seed([
      {
        primitive: 'add_node',
        id: 'resolver-node',
        type: 'node-blind-fixture:resolver',
        parent: ROOT_NODE_ID,
        data: {
          bizarroSourceRepos: [{ name: REPO_NAME, branch: REPO_BRANCH }],
          oddballDocPath: 'fixtures/resolver.md',
          unresolvedMandatoryPath: 'some-value',
        },
      },
    ]);
    await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

    const engaged = await project.submitEvent({ node: 'resolver-node' });
    const ctx = engaged.context as Record<string, unknown>;
    const repos = ctx.bizarroSourceRepos as Array<Record<string, unknown>>;

    expect(repos).toBeDefined();
    expect(repos.length).toBe(1);
    expect(repos[0]).toMatchObject({
      name: REPO_NAME,
      branch: REPO_BRANCH,
      path: expectedWorktreePath(projectId, REPO_NAME),
    });
  });

  it('resolves project-doc-path hint on a custom node type with a novel field name', async () => {
    const projectId = 'node-blind-doc-path';
    const project = client().project(projectId);

    await project.seed([
      {
        primitive: 'add_node',
        id: 'resolver-node',
        type: 'node-blind-fixture:resolver',
        parent: ROOT_NODE_ID,
        data: {
          bizarroSourceRepos: [{ name: REPO_NAME, branch: REPO_BRANCH }],
          oddballDocPath: 'fixtures/resolver.md',
          unresolvedMandatoryPath: 'some-value',
        },
      },
    ]);
    await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

    const engaged = await project.submitEvent({ node: 'resolver-node' });
    const ctx = engaged.context as Record<string, unknown>;

    expect(ctx.oddballDocPath).toBe(expectedDocPath(projectId, 'fixtures/resolver.md'));
  });

  it('leaves unresolved fields untouched on a custom node type', async () => {
    const projectId = 'node-blind-unresolved';
    const project = client().project(projectId);

    const testValue = 'untouched-value-12345';
    await project.seed([
      {
        primitive: 'add_node',
        id: 'resolver-node',
        type: 'node-blind-fixture:resolver',
        parent: ROOT_NODE_ID,
        data: {
          bizarroSourceRepos: [{ name: REPO_NAME, branch: REPO_BRANCH }],
          oddballDocPath: 'fixtures/resolver.md',
          unresolvedMandatoryPath: testValue,
        },
      },
    ]);
    await addWorktree(daemon.baseUrl(), projectId, REPO_NAME);

    const engaged = await project.submitEvent({ node: 'resolver-node' });
    const ctx = engaged.context as Record<string, unknown>;

    expect(ctx.unresolvedMandatoryPath).toBe(testValue);
  });
});
