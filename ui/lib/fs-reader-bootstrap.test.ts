/**
 * Tests for readConfig() and resolveOrchRoot().
 * Run with: npx tsx ui/lib/fs-reader-bootstrap.test.ts
 */
import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readConfig, resolveOrchRoot } from './fs-reader';
import type { OrchestrationConfig } from '@/types/config';

let passed = 0;
let failed = 0;

const MINIMAL_CONFIG_YAML = `version: "1"
limits:
  max_retries_per_task: 3
human_gates:
  after_planning: true
  execution_mode: autonomous
  after_final_review: true
source_control:
  auto_commit: always
  auto_pr: never
`;


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
  let tmpDir = '';

  try {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'fs-reader-bootstrap-test-'));

    // ── readConfig() tests ────────────────────────────────────────────────

    console.log('\nreadConfig() — reads from ~/.radorc/orchestration.yml');

    await test('reads config from ~/.radorc/orchestration.yml', async () => {
      const radorcDir = path.join(tmpDir, '.radorc');
      await mkdir(radorcDir, { recursive: true });
      await writeFile(path.join(radorcDir, 'orchestration.yml'), MINIMAL_CONFIG_YAML);

      const origHomedir = os.homedir;
      (os as unknown as { homedir: () => string }).homedir = () => tmpDir;
      try {
        const config = await readConfig();
        assert.strictEqual(config.version, '1');
      } finally {
        (os as unknown as { homedir: () => string }).homedir = origHomedir;
      }
    });

    await test('throws when orchestration.yml does not exist', async () => {
      const fakeHome = path.join(tmpDir, 'nonexistent-home');
      const origHomedir = os.homedir;
      (os as unknown as { homedir: () => string }).homedir = () => fakeHome;
      try {
        await assert.rejects(
          () => readConfig(),
          (err: unknown) => err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT'
        );
      } finally {
        (os as unknown as { homedir: () => string }).homedir = origHomedir;
      }
    });

    // ── resolveOrchRoot() tests ────────────────────────────────────────────────

    console.log('\nresolveOrchRoot()');

    await test('returns .claude as the orchestration root', async () => {
      const config: OrchestrationConfig = {
        version: '1',
        limits: { max_retries_per_task: 3 },
        human_gates: { after_planning: true, execution_mode: 'autonomous', after_final_review: true },
        source_control: { auto_commit: 'always', auto_pr: 'never' },
      };
      assert.strictEqual(resolveOrchRoot(config), '.claude');
    });

    await test('returns .claude consistently regardless of input config shape', async () => {
      const config: OrchestrationConfig = {
        version: '1',
        limits: { max_retries_per_task: 3 },
        human_gates: { after_planning: true, execution_mode: 'autonomous', after_final_review: true },
        source_control: { auto_commit: 'always', auto_pr: 'never' },
      };
      assert.strictEqual(resolveOrchRoot(config), '.claude');
    });

  } finally {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
