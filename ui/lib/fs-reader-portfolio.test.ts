/**
 * Tests for discoverProjects' portfolio-kind resolution — a directory is a
 * portfolio root when it holds a document named after itself, a structural
 * test that degrades to "not a portfolio" rather than throwing.
 * Run with: npx tsx ui/lib/fs-reader-portfolio.test.ts
 */
import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { discoverProjects, fileExists } from './fs-reader';
import { withHomedir } from './test-helpers.js';

let passed = 0;
let failed = 0;
let tmpDir = '';

async function setup(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fs-reader-portfolio-test-'));
  const projectsDir = path.join(dir, '.radorc', 'projects');
  await mkdir(projectsDir, { recursive: true });

  // (a) a -ROOT directory with its own root document and no state.json
  await mkdir(path.join(projectsDir, 'ALPHA-ROOT'));
  await writeFile(path.join(projectsDir, 'ALPHA-ROOT', 'ALPHA-ROOT.md'), '---\nstatus: active\n---\n# Alpha\n');

  // (b) a -ROOT directory with a root document AND a valid state.json
  await mkdir(path.join(projectsDir, 'BETA-ROOT'));
  await writeFile(path.join(projectsDir, 'BETA-ROOT', 'BETA-ROOT.md'), '# Beta\n');
  await writeFile(
    path.join(projectsDir, 'BETA-ROOT', 'state.json'),
    JSON.stringify({
      $schema: 'orchestration-state-v5',
      project: { name: 'BETA-ROOT', created: '2026-01-01T00:00:00.000Z', updated: '2026-04-06T12:00:00.000Z' },
      config: { gate_mode: 'task', limits: { max_retries_per_task: 3 }, source_control: { auto_commit: 'always', auto_pr: 'never' } },
      pipeline: { gate_mode: 'task', source_control: null, current_tier: 'planning', halt_reason: null },
      graph: { template_id: 'extra-high', status: 'in_progress', current_node_path: null, nodes: {} },
    }),
  );

  // (c) a -ROOT directory with a root document AND a malformed state.json
  await mkdir(path.join(projectsDir, 'GAMMA-ROOT'));
  await writeFile(path.join(projectsDir, 'GAMMA-ROOT', 'GAMMA-ROOT.md'), '# Gamma\n');
  await writeFile(path.join(projectsDir, 'GAMMA-ROOT', 'state.json'), 'not valid json{{{');

  // (d) an ordinary directory (no -ROOT suffix) that happens to hold a
  // same-named document — must not be misclassified as a portfolio
  await mkdir(path.join(projectsDir, 'WIDGET-UI'));
  await writeFile(path.join(projectsDir, 'WIDGET-UI', 'WIDGET-UI.md'), '# Overview\n');

  // (e) a plain, otherwise-empty project directory
  await mkdir(path.join(projectsDir, 'PLAIN-PROJECT'));

  return dir;
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ ${name}\n    ${msg}`);
    failed++;
  }
}

async function run() {
  try {
    tmpDir = await setup();
    let projects!: Awaited<ReturnType<typeof discoverProjects>>;
    await withHomedir(tmpDir, async () => {
      projects = await discoverProjects();
    });

    console.log('discoverProjects — portfolio-kind resolution');

    await test('a -ROOT directory with its own root document and no state.json yields the portfolio kind', async () => {
      const p = projects.find((x) => x.name === 'ALPHA-ROOT');
      assert.ok(p, 'ALPHA-ROOT should be in results');
      assert.strictEqual(p!.project_type, 'portfolio');
      assert.strictEqual(p!.hasState, false);
    });

    await test('a -ROOT directory with a root document AND a state.json also yields the portfolio kind', async () => {
      const p = projects.find((x) => x.name === 'BETA-ROOT');
      assert.ok(p, 'BETA-ROOT should be in results');
      assert.strictEqual(p!.project_type, 'portfolio');
      assert.strictEqual(p!.hasState, true);
      assert.strictEqual(p!.hasMalformedState, false);
    });

    await test('a -ROOT directory with a malformed state.json still reports the portfolio kind, and hasMalformedState stays true', async () => {
      const p = projects.find((x) => x.name === 'GAMMA-ROOT');
      assert.ok(p, 'GAMMA-ROOT should be in results');
      assert.strictEqual(p!.project_type, 'portfolio');
      assert.strictEqual(p!.hasMalformedState, true);
    });

    await test('a same-named document in a directory without the -ROOT suffix does not yield the portfolio kind', async () => {
      const p = projects.find((x) => x.name === 'WIDGET-UI');
      assert.ok(p, 'WIDGET-UI should be in results');
      assert.notStrictEqual(p!.project_type, 'portfolio');
    });

    await test('a plain project directory yields what it yields today — no portfolio kind', async () => {
      const p = projects.find((x) => x.name === 'PLAIN-PROJECT');
      assert.ok(p, 'PLAIN-PROJECT should be in results');
      assert.notStrictEqual(p!.project_type, 'portfolio');
      assert.strictEqual(p!.tier, 'not_initialized');
    });

    // fileExists still backs other reader paths (e.g. the files route) even
    // though the portfolio check itself now runs on the same directory
    // listing as the brainstorming-doc check; exercise it directly against a
    // path that is guaranteed to fail the stat call for a reason other than
    // "missing" (a regular file standing in for a directory segment),
    // portable across POSIX and Windows.
    await test('fileExists degrades to false — never throws — for an unreadable path', async () => {
      const blockerFile = path.join(tmpDir, 'blocker.txt');
      await writeFile(blockerFile, 'not a directory');
      const unreachable = path.join(blockerFile, 'ROOT-ROOT.md');
      assert.strictEqual(await fileExists(unreachable), false);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}

run();
