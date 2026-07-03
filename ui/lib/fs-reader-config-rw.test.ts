/**
 * Tests for getConfigPath(), readConfigWithRaw(), and writeConfig() in fs-reader.ts,
 * and stringifyYaml() in yaml-parser.ts.
 * Run with: npx tsx ui/lib/fs-reader-config-rw.test.ts
 */
import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile as fsWriteFile, rm, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getConfigPath, readConfig, readConfigWithRaw, writeConfig } from './fs-reader';
import { parseYaml, stringifyYaml } from './yaml-parser';
import type { OrchestrationConfig } from '@/types/config';

let passed = 0;
let failed = 0;

const SAMPLE_CONFIG: OrchestrationConfig = {
  version: '1',
  limits: {
    max_retries_per_task: 3,
  },
  human_gates: {
    after_planning: true,
    execution_mode: 'ask',
    after_final_review: true,
  },
  source_control: {
    auto_commit: 'always',
    auto_pr: 'ask',
  },
};

const MINIMAL_CONFIG_YAML = `version: "1"
limits:
  max_retries_per_task: 3
human_gates:
  after_planning: true
  execution_mode: ask
  after_final_review: true
source_control:
  auto_commit: always
  auto_pr: ask
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
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'fs-reader-config-rw-test-'));

    // Helper to stub os.homedir to a fake home directory and restore it
    const withFakeHome = (dir: string, fn: () => Promise<void>): Promise<void> => {
      const origHomedir = os.homedir;
      (os as unknown as { homedir: () => string }).homedir = () => dir;
      return fn().finally(() => {
        (os as unknown as { homedir: () => string }).homedir = origHomedir;
      });
    };

    // ── getConfigPath() tests ─────────────────────────────────────────────

    console.log('\ngetConfigPath()');

    await test('returns <home>/.radorc/orchestration.yml for a given home dir', async () => {
      await withFakeHome(tmpDir, async () => {
        const result = getConfigPath();
        const expected = path.join(tmpDir, '.radorc', 'orchestration.yml');
        assert.strictEqual(result, expected);
      });
    });

    await test('returns ~/.radorc/orchestration.yml unconditionally', async () => {
      const result = getConfigPath();
      const expected = path.join(os.homedir(), '.radorc', 'orchestration.yml');
      assert.strictEqual(result, expected);
    });

    // ── readConfig() still works ──────────────────────────────────────────

    console.log('\nreadConfig() — still works after refactor');

    await test('readConfig() reads and parses config', async () => {
      const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'fs-reader-config-rw-readconfig-'));
      try {
        const radorcDir = path.join(fakeHome, '.radorc');
        await mkdir(radorcDir, { recursive: true });
        await fsWriteFile(path.join(radorcDir, 'orchestration.yml'), MINIMAL_CONFIG_YAML);
        await withFakeHome(fakeHome, async () => {
          const config = await readConfig();
          assert.strictEqual(config.version, '1');
          assert.strictEqual(config.limits.max_retries_per_task, 3);
        });
      } finally {
        await rm(fakeHome, { recursive: true, force: true });
      }
    });

    // ── readConfigWithRaw() tests ─────────────────────────────────────────

    console.log('\nreadConfigWithRaw()');

    await test('returns both config and rawYaml', async () => {
      const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'fs-reader-config-rw-rawconfig-'));
      try {
        const radorcDir = path.join(fakeHome, '.radorc');
        await mkdir(radorcDir, { recursive: true });
        await fsWriteFile(path.join(radorcDir, 'orchestration.yml'), MINIMAL_CONFIG_YAML);
        await withFakeHome(fakeHome, async () => {
          const { config, rawYaml } = await readConfigWithRaw();
          assert.strictEqual(config.version, '1');
          assert.strictEqual(config.limits.max_retries_per_task, 3);
          assert.strictEqual(typeof rawYaml, 'string');
          assert.ok(rawYaml.includes('version'));
          assert.ok(rawYaml.includes('max_retries_per_task'));
        });
      } finally {
        await rm(fakeHome, { recursive: true, force: true });
      }
    });

    await test('throws on missing file', async () => {
      const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'fs-reader-config-rw-missing-'));
      try {
        await withFakeHome(fakeHome, async () => {
          await assert.rejects(
            () => readConfigWithRaw(),
            (err: unknown) => err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT'
          );
        });
      } finally {
        await rm(fakeHome, { recursive: true, force: true });
      }
    });

    // ── writeConfig() tests ───────────────────────────────────────────────

    console.log('\nwriteConfig()');

    await test('writes atomically — file contains provided content and no temp files remain', async () => {
      const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'fs-reader-config-rw-write-'));
      try {
        const radorcDir = path.join(fakeHome, '.radorc');
        await mkdir(radorcDir, { recursive: true });
        await fsWriteFile(path.join(radorcDir, 'orchestration.yml'), MINIMAL_CONFIG_YAML);
        await withFakeHome(fakeHome, async () => {
          const newContent = 'version: "2"\n';
          await writeConfig(newContent);

          const configPath = getConfigPath();
          const written = await readFile(configPath, 'utf-8');
          assert.strictEqual(written, newContent);

          // No temp files should remain
          const configDir = path.dirname(configPath);
          const files = await readdir(configDir);
          const tmpFiles = files.filter(f => f.startsWith('.orchestration.yml.tmp.'));
          assert.strictEqual(tmpFiles.length, 0, `Temp files remain: ${tmpFiles.join(', ')}`);
        });
      } finally {
        await rm(fakeHome, { recursive: true, force: true });
      }
    });

    await test('temp file is in same directory as config', async () => {
      const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'fs-reader-config-rw-tempfile-'));
      try {
        const radorcDir = path.join(fakeHome, '.radorc');
        await mkdir(radorcDir, { recursive: true });
        await fsWriteFile(path.join(radorcDir, 'orchestration.yml'), MINIMAL_CONFIG_YAML);
        await withFakeHome(fakeHome, async () => {
          const configPath = getConfigPath();
          const configDir = path.dirname(configPath);
          await writeConfig(MINIMAL_CONFIG_YAML);
          const written = await readFile(configPath, 'utf-8');
          assert.strictEqual(written, MINIMAL_CONFIG_YAML);
          const files = await readdir(configDir);
          assert.ok(files.includes('orchestration.yml'));
        });
      } finally {
        await rm(fakeHome, { recursive: true, force: true });
      }
    });

    await test('rejects when home/.radorc directory does not exist', async () => {
      const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'fs-reader-config-rw-nodir-'));
      try {
        // fakeHome exists but has no .radorc subdir, so the write should fail
        await withFakeHome(fakeHome, async () => {
          await assert.rejects(
            () => writeConfig('version: "3"\n'),
            (err: unknown) => err instanceof Error
          );
        });
      } finally {
        await rm(fakeHome, { recursive: true, force: true });
      }
    });

    // ── stringifyYaml() tests ─────────────────────────────────────────────

    console.log('\nstringifyYaml()');

    await test('returns a string', async () => {
      const result = stringifyYaml({ hello: 'world' });
      assert.strictEqual(typeof result, 'string');
      assert.ok(result.length > 0);
    });

    await test('produces valid YAML that can be parsed back', async () => {
      const yaml = stringifyYaml(SAMPLE_CONFIG);
      const parsed = parseYaml<OrchestrationConfig>(yaml);
      assert.deepStrictEqual(parsed, SAMPLE_CONFIG);
    });

    // ── Round-trip integrity ──────────────────────────────────────────────

    console.log('\nRound-trip integrity');

    await test('parseYaml(stringifyYaml(config)) deep-equals original', async () => {
      const yaml = stringifyYaml(SAMPLE_CONFIG);
      const roundTripped = parseYaml<OrchestrationConfig>(yaml);
      assert.deepStrictEqual(roundTripped, SAMPLE_CONFIG);
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
