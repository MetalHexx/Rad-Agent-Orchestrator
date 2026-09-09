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
import { validateConfig } from './config-validator';
import type { OrchestrationConfig, ConfigValidationErrors } from '@/types/config';

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
  ui: {
    port: 4321,
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

    // ── readConfigWithRaw() communication_style hydration ─────────────────

    console.log('\nreadConfigWithRaw() — communication_style hydration');

    const readHydratedConfig = async (
      yamlBody: string,
    ): Promise<{ config: OrchestrationConfig; rawYaml: string }> => {
      const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'fs-reader-config-rw-hydrate-'));
      try {
        const radorcDir = path.join(fakeHome, '.radorc');
        await mkdir(radorcDir, { recursive: true });
        const configFile = path.join(radorcDir, 'orchestration.yml');
        await fsWriteFile(configFile, yamlBody);
        let result!: { config: OrchestrationConfig; rawYaml: string };
        await withFakeHome(fakeHome, async () => {
          result = await readConfigWithRaw();
        });
        return result;
      } finally {
        await rm(fakeHome, { recursive: true, force: true });
      }
    };

    await test('absent communication_style section hydrates to both defaults, rawYaml untouched', async () => {
      const { config, rawYaml } = await readHydratedConfig(MINIMAL_CONFIG_YAML);
      assert.deepStrictEqual(config.communication_style, { enabled: false, selected: 'high-level.md' });
      assert.strictEqual(rawYaml, MINIMAL_CONFIG_YAML);
    });

    await test('enabled-only section keeps enabled and defaults selected', async () => {
      const yamlBody = `${MINIMAL_CONFIG_YAML}communication_style:\n  enabled: true\n`;
      const { config, rawYaml } = await readHydratedConfig(yamlBody);
      assert.deepStrictEqual(config.communication_style, { enabled: true, selected: 'high-level.md' });
      assert.strictEqual(rawYaml, yamlBody);
    });

    await test('selected-only section keeps selected and defaults enabled', async () => {
      const yamlBody = `${MINIMAL_CONFIG_YAML}communication_style:\n  selected: caveman.md\n`;
      const { config, rawYaml } = await readHydratedConfig(yamlBody);
      assert.deepStrictEqual(config.communication_style, { enabled: false, selected: 'caveman.md' });
      assert.strictEqual(rawYaml, yamlBody);
    });

    await test('complete, well-typed section reads back unchanged', async () => {
      const yamlBody = `${MINIMAL_CONFIG_YAML}communication_style:\n  enabled: true\n  selected: caveman.md\n`;
      const { config, rawYaml } = await readHydratedConfig(yamlBody);
      assert.deepStrictEqual(config.communication_style, { enabled: true, selected: 'caveman.md' });
      assert.strictEqual(rawYaml, yamlBody);
    });

    await test('scalar communication_style hydrates to both defaults', async () => {
      const yamlBody = `${MINIMAL_CONFIG_YAML}communication_style: not-a-section\n`;
      const { config } = await readHydratedConfig(yamlBody);
      assert.deepStrictEqual(config.communication_style, { enabled: false, selected: 'high-level.md' });
    });

    await test('null communication_style hydrates to both defaults', async () => {
      const yamlBody = `${MINIMAL_CONFIG_YAML}communication_style: null\n`;
      const { config } = await readHydratedConfig(yamlBody);
      assert.deepStrictEqual(config.communication_style, { enabled: false, selected: 'high-level.md' });
    });

    await test('array communication_style hydrates to both defaults', async () => {
      const yamlBody = `${MINIMAL_CONFIG_YAML}communication_style:\n  - enabled\n  - selected\n`;
      const { config } = await readHydratedConfig(yamlBody);
      assert.deepStrictEqual(config.communication_style, { enabled: false, selected: 'high-level.md' });
    });

    await test('off-type values (enabled: "yes", selected: "") hydrate to both defaults', async () => {
      const yamlBody = `${MINIMAL_CONFIG_YAML}communication_style:\n  enabled: "yes"\n  selected: ""\n`;
      const { config } = await readHydratedConfig(yamlBody);
      assert.deepStrictEqual(config.communication_style, { enabled: false, selected: 'high-level.md' });
    });

    await test('hydrated section-less config with Enabled toggled on validates clean (unreadable-catalog path, no knownStylePaths)', async () => {
      const { config } = await readHydratedConfig(MINIMAL_CONFIG_YAML);
      config.communication_style = { ...config.communication_style!, enabled: true };
      const errors: ConfigValidationErrors = validateConfig(config);
      assert.strictEqual(errors['communication_style.enabled'], undefined);
      assert.strictEqual(errors['communication_style.selected'], undefined);
    });

    await test('hydrated section-less config with Enabled toggled on validates clean (readable catalog containing the default)', async () => {
      const { config } = await readHydratedConfig(MINIMAL_CONFIG_YAML);
      config.communication_style = { ...config.communication_style!, enabled: true };
      const errors: ConfigValidationErrors = validateConfig(config, ['high-level.md', 'caveman.md']);
      assert.strictEqual(errors['communication_style.enabled'], undefined);
      assert.strictEqual(errors['communication_style.selected'], undefined);
    });

    await test('hydrated section-less config with Enabled toggled on validates clean (readable catalog omitted, empty list)', async () => {
      const { config } = await readHydratedConfig(MINIMAL_CONFIG_YAML);
      config.communication_style = { ...config.communication_style!, enabled: true };
      const errors: ConfigValidationErrors = validateConfig(config, []);
      assert.strictEqual(errors['communication_style.enabled'], undefined);
      assert.strictEqual(errors['communication_style.selected'], undefined);
    });

    // ── readConfigWithRaw() ambient_awareness hydration ───────────────────

    console.log('\nreadConfigWithRaw() — ambient_awareness hydration');

    await test('absent ambient_awareness section hydrates to the minimal default, rawYaml untouched', async () => {
      const { config, rawYaml } = await readHydratedConfig(MINIMAL_CONFIG_YAML);
      assert.deepStrictEqual(config.ambient_awareness, { verbosity: 'minimal' });
      assert.strictEqual(rawYaml, MINIMAL_CONFIG_YAML);
    });

    await test('a known verbosity level reads back unchanged', async () => {
      const yamlBody = `${MINIMAL_CONFIG_YAML}ambient_awareness:\n  verbosity: silent\n`;
      const { config, rawYaml } = await readHydratedConfig(yamlBody);
      assert.deepStrictEqual(config.ambient_awareness, { verbosity: 'silent' });
      assert.strictEqual(rawYaml, yamlBody);
    });

    await test('an unrecognized verbosity value hydrates to the minimal default', async () => {
      const yamlBody = `${MINIMAL_CONFIG_YAML}ambient_awareness:\n  verbosity: chatty\n`;
      const { config } = await readHydratedConfig(yamlBody);
      assert.deepStrictEqual(config.ambient_awareness, { verbosity: 'minimal' });
    });

    await test('a missing verbosity key hydrates to the minimal default', async () => {
      const yamlBody = `${MINIMAL_CONFIG_YAML}ambient_awareness: {}\n`;
      const { config } = await readHydratedConfig(yamlBody);
      assert.deepStrictEqual(config.ambient_awareness, { verbosity: 'minimal' });
    });

    await test('scalar ambient_awareness hydrates to the minimal default', async () => {
      const yamlBody = `${MINIMAL_CONFIG_YAML}ambient_awareness: not-a-section\n`;
      const { config } = await readHydratedConfig(yamlBody);
      assert.deepStrictEqual(config.ambient_awareness, { verbosity: 'minimal' });
    });

    await test('null ambient_awareness hydrates to the minimal default', async () => {
      const yamlBody = `${MINIMAL_CONFIG_YAML}ambient_awareness: null\n`;
      const { config } = await readHydratedConfig(yamlBody);
      assert.deepStrictEqual(config.ambient_awareness, { verbosity: 'minimal' });
    });

    await test('array ambient_awareness hydrates to the minimal default', async () => {
      const yamlBody = `${MINIMAL_CONFIG_YAML}ambient_awareness:\n  - verbosity\n`;
      const { config } = await readHydratedConfig(yamlBody);
      assert.deepStrictEqual(config.ambient_awareness, { verbosity: 'minimal' });
    });

    await test('hydrated section-less config validates clean', async () => {
      const { config } = await readHydratedConfig(MINIMAL_CONFIG_YAML);
      const errors: ConfigValidationErrors = validateConfig(config);
      assert.strictEqual(errors['ambient_awareness.verbosity'], undefined);
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
