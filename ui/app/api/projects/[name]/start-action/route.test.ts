import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { NextRequest } from 'next/server';

// --- Fixtures ---------------------------------------------------------
const VALID_YAML = `version: "4"
limits:
  max_retries_per_task: 2
  max_consecutive_review_rejections: 3
human_gates:
  after_planning: true
  execution_mode: ask
  after_final_review: true
source_control:
  auto_commit: always
  auto_pr: ask
`;

let tmpDir = '';
let projectsDir = '';
let origHomedir: typeof os.homedir;

async function setup() {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'start-action-'));
  const radorcDir = path.join(tmpDir, '.radorc');
  // Write orchestration.yml under ~/.radorc/
  await mkdir(radorcDir, { recursive: true });
  await writeFile(path.join(radorcDir, 'orchestration.yml'), VALID_YAML, 'utf-8');
  projectsDir = path.join(radorcDir, 'projects');
  await mkdir(path.join(projectsDir, 'DEMO-PROJECT'), { recursive: true });
  origHomedir = os.homedir;
  (os as unknown as { homedir: () => string }).homedir = () => tmpDir;
  process.env.LAUNCH_CLAUDE_PROJECT_DRY_RUN = '1';
}

async function teardown() {
  (os as unknown as { homedir: typeof os.homedir }).homedir = origHomedir;
  delete process.env.LAUNCH_CLAUDE_PROJECT_DRY_RUN;
  await rm(tmpDir, { recursive: true, force: true });
}

async function invokePOST(body: unknown, name: string) {
  const { POST } = await import('./route');
  const req = new Request(`http://localhost/api/projects/${name}/start-action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  // Next route handlers accept a Request and a context object.
  return POST(req as unknown as NextRequest, { params: { name } });
}

(async () => {
  await setup();
  try {
    // Unknown project → 404
    {
      const res = await invokePOST({ action: 'start-brainstorming' }, 'NOPE');
      assert.equal(res.status, 404);
      const json = await res.json();
      assert.match(json.error, /not found/i);
      console.log('✓ unknown project → 404 not found');
    }

    // Invalid project-name format → 400
    {
      const res = await invokePOST({ action: 'start-brainstorming' }, 'bad..name');
      assert.equal(res.status, 400);
      console.log('✓ invalid project name format → 400');
    }

    // Unknown action → 400
    {
      const res = await invokePOST({ action: 'nope' }, 'DEMO-PROJECT');
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.match(json.error, /action/i);
      assert.match(json.error, /execute-plan/);
      console.log('✓ unknown action → 400');
    }

    // Happy path start-brainstorming → 200 success:true platform string
    {
      const res = await invokePOST({ action: 'start-brainstorming' }, 'DEMO-PROJECT');
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(typeof json.platform, 'string');
      console.log('✓ start-brainstorming happy path → 200 success:true platform string');
    }

    // Happy path start-planning → 200 success:true
    {
      const res = await invokePOST({ action: 'start-planning' }, 'DEMO-PROJECT');
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      console.log('✓ start-planning happy path → 200 success:true');
    }

    // home pointing to dir with no .radorc/projects/ subdir → 500
    {
      const emptyDir = await mkdtemp(path.join(os.tmpdir(), 'start-action-empty-'));
      try {
        (os as unknown as { homedir: () => string }).homedir = () => emptyDir;
        const res = await invokePOST({ action: 'start-brainstorming' }, 'DEMO-PROJECT');
        assert.equal(res.status, 500);
        const json = await res.json();
        assert.ok(typeof json.error === 'string', 'error must be a string');
        assert.ok(!/[A-Z]:\\|\/home\//.test(json.error), 'error must not echo absolute host path');
        console.log('✓ missing projects dir → 500, concise error, no path leakage');
      } finally {
        (os as unknown as { homedir: () => string }).homedir = () => tmpDir; // restore
        await rm(emptyDir, { recursive: true, force: true });
      }
    }

    // Forced launcher failure → 500 with structured error, no path leakage
    {
      process.env.LAUNCH_CLAUDE_PROJECT_FORCE_FAIL = '1';
      const res = await invokePOST({ action: 'start-brainstorming' }, 'DEMO-PROJECT');
      delete process.env.LAUNCH_CLAUDE_PROJECT_FORCE_FAIL;
      assert.equal(res.status, 500);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(typeof json.error, 'string');
      assert.ok(!/[A-Z]:\\|\/home\//.test(json.error), 'error must not echo absolute host path');
      assert.ok(
        !/LAUNCH_CLAUDE_PROJECT_FORCE_FAIL/.test(json.error),
        'error must not echo env var name'
      );
      console.log('✓ forced launcher failure → 500, structured error, no path leakage');
    }

    // Happy path execute-plan → 200 success:true platform string (FR-4, FR-5)
    {
      const res = await invokePOST({ action: 'execute-plan' }, 'DEMO-PROJECT');
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(typeof json.platform, 'string');
      console.log('✓ execute-plan happy path → 200 success:true platform string');
    }

    // execute-plan on unknown project → 404 (AD-4)
    {
      const res = await invokePOST({ action: 'execute-plan' }, 'NOPE');
      assert.equal(res.status, 404);
      console.log('✓ execute-plan unknown project → 404');
    }

    // execute-plan: invalid project name format → 400 (AD-4)
    {
      const res = await invokePOST({ action: 'execute-plan' }, 'bad..name');
      assert.equal(res.status, 400);
      console.log('✓ execute-plan invalid project name → 400');
    }

    // execute-plan: forced launcher failure → 500, no path/env leakage (NFR-2, NFR-3)
    {
      process.env.LAUNCH_CLAUDE_PROJECT_FORCE_FAIL = '1';
      const res = await invokePOST({ action: 'execute-plan' }, 'DEMO-PROJECT');
      delete process.env.LAUNCH_CLAUDE_PROJECT_FORCE_FAIL;
      assert.equal(res.status, 500);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(typeof json.error, 'string');
      assert.ok(!/[A-Z]:\\|\/home\//.test(json.error), 'execute-plan error must not echo absolute host path');
      assert.ok(
        !/LAUNCH_CLAUDE_PROJECT_FORCE_FAIL/.test(json.error),
        'execute-plan error must not echo env var name'
      );
      console.log('✓ execute-plan forced launcher failure → 500, no path/env leakage');
    }

    // execute-plan: route returns promptly under DRY_RUN (NFR-1: no wait on terminal)
    {
      const start = Date.now();
      const res = await invokePOST({ action: 'execute-plan' }, 'DEMO-PROJECT');
      const elapsedMs = Date.now() - start;
      assert.equal(res.status, 200);
      // The launcher runs under LAUNCH_CLAUDE_PROJECT_DRY_RUN=1 (set in setup);
      // the route must return before any real terminal would render. This is
      // a generous upper bound — true responsiveness is OS-level.
      assert.ok(elapsedMs < 5000, `route must return promptly; took ${elapsedMs}ms`);
      console.log(`✓ execute-plan route returns promptly (${elapsedMs}ms)`);
    }

    // projectsDir stays inside tmpDir (teardown safety)
    assert.ok(
      projectsDir.startsWith(tmpDir),
      'projectsDir must be inside tmpDir so teardown does not escape the temp workspace',
    );
    console.log('✓ projectsDir stays inside tmpDir (teardown safety)');

    console.log('\nAll start-action route tests passed');
  } finally {
    await teardown();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
