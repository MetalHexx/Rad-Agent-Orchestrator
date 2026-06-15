#!/usr/bin/env node
// build.js — Single entry point for the Claude marketplace plugin build.
// 14 steps in fixed order. Fail-fast on any step.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { emitCliBundle } from '../../shared/build-helpers/emit-cli-bundle.js';
import { emitHookBundle } from '../../shared/build-helpers/emit-hook-bundle.js';
import { emitUiBundle } from '../../shared/build-helpers/emit-ui-bundle.js';
import { expandTokens } from '../../shared/build-helpers/expand-tokens.js';
import { synthesizePackageJson } from './synthesize-package-json.js';
import { validatePluginTree } from './validate.js';

function step(name, fn) {
  const t0 = Date.now();
  process.stderr.write(`[build:claude-plugin] ${name} ...\n`);
  return Promise.resolve(fn()).then((r) => {
    process.stderr.write(`[build:claude-plugin] ${name} done (${Date.now() - t0}ms)\n`);
    return r;
  }).catch((err) => {
    throw new Error(`[build:claude-plugin] step "${name}" failed: ${err.message}`);
  });
}

/** @param {{ rootDir: string, skipAdapterEngine?: boolean, skipUiRunner?: boolean,
 *            skipBootstrap?: boolean, greenfieldRel?: string }} opts
 *  `rootDir` is the repo root. `greenfieldRel` (default '.') names
 *  the relative folder under `rootDir` that hosts the new staged subsystems
 *  (`harness-installers/`, `runtime-config/`, `harness-files/`, `harness-adapters/`).
 *  Per parent design Decision 10, repo-root folders `cli/` and `ui/` stay at
 *  the repo root for the duration of iteration 1 and are referenced directly.
 *  Unit tests construct a synthetic fixture without a parent folder,
 *  so they pass `greenfieldRel: '.'` to flatten the layout. */
export async function runBuild(opts) {
  const root = path.resolve(opts.rootDir);
  const greenfieldRel = opts.greenfieldRel ?? '.';
  const greenfield = path.join(root, greenfieldRel);
  const installerDir = path.join(greenfield, 'harness-installers/claude-plugin');
  const out = path.join(installerDir, 'output');
  const adapterOut = path.join(greenfield, 'harness-adapters/output/claude');

  // All dependencies are satisfied by the single root install (hoisted
  // node_modules). opts.skipBootstrap skips the build-lib-dist step; used by
  // synthetic fixture/test builds that lack a real workspace package.json and
  // cannot run the workspace lib build.

  // Step 0 — adapter engine first. Skipped in unit
  // tests; production end-to-end runs through this branch.
  if (!opts.skipAdapterEngine) {
    await step('adapter-engine', () => {
      execSync(`node ${path.posix.join(greenfieldRel, 'harness-adapters/engine/build.js')} --harness=claude`,
        { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    });
  }

  await step('clean-output', () => fs.rmSync(out, { recursive: true, force: true }));
  fs.mkdirSync(out, { recursive: true });

  await step('copy-agents', () =>
    fs.cpSync(path.join(adapterOut, 'agents'), path.join(out, 'agents'), { recursive: true }));
  await step('copy-skills', () =>
    fs.cpSync(path.join(adapterOut, 'skills'), path.join(out, 'skills'), { recursive: true }));

  await step('copy-runtime-config', () => {
    fs.cpSync(path.join(greenfield, 'runtime-config/orchestration.yml'), path.join(out, '_install-source/orchestration.yml'));
    fs.cpSync(path.join(greenfield, 'runtime-config/templates'), path.join(out, '_install-source/templates'), { recursive: true });
  });

  // action-events staging (FR-1, FR-19, AD-3, AD-10). Source:
  // runtime-config/action-events/ → output/_install-source/action-events/.
  // The `custom/` directory ships as an empty folder — never user-authored
  // files inside the slot (FR-20).
  await step('copy-action-events', () => {
    const customSep = `${path.sep}custom${path.sep}`;
    const filter = (src) => {
      if (!src.includes(customSep)) return true;
      return src.endsWith(`${path.sep}custom`);
    };
    fs.cpSync(
      path.join(greenfield, 'runtime-config/action-events'),
      path.join(out, '_install-source/action-events'),
      { recursive: true, filter },
    );
  });

  // Build the library dist before any step that bundles the CLI or the UI:
  // the UI's `next build` resolves the by-name import through the workspace
  // symlink against dist, and the by-name CLI bundle depends on dist too (AD-5).
  if (!opts.skipBootstrap) {
    await step('build-lib-dist', () => {
      for (const pkg of [
        '@rad-orchestration/repo-registry',
        '@rad-orchestration/work-graph',
        '@rad-orchestration/telemetry',
      ]) {
        execSync(`npm run build -w ${pkg}`, { cwd: root, stdio: 'inherit' });
      }
    });
  }

  // cli/ lives at the repo root for the duration of iteration 1 per parent
  // design Decision 10 — read from `root`, not from `greenfield`.
  await step('emit-cli-bundle', () => emitCliBundle({
    source: path.join(root, 'cli'),
    target: path.join(out, 'skills/rad-orchestration/scripts/radorch.mjs'),
  }));

  // Prune TypeScript sources, test fixtures, and dev tooling from the scripts/
  // tree. copy-skills pulls the full harness-files tree from adapter output,
  // which includes raw .ts sources, tests/, package.json, tsconfig.json etc.
  // Only runtime artifacts (.js, .mjs, .gitignore) belong in the published
  // plugin payload.
  await step('prune-scripts-sources', () => {
    const scriptsDir = path.join(out, 'skills/rad-orchestration/scripts');
    const KEEP_EXTENSIONS = new Set(['.js', '.mjs']);
    const KEEP_FILES = new Set(['.gitignore']);
    function pruneDir(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Remove lib/ and tests/ entirely — they are compiled into the bundles
          // or are test-only fixtures not needed at runtime.
          fs.rmSync(abs, { recursive: true, force: true });
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (!KEEP_EXTENSIONS.has(ext) && !KEEP_FILES.has(entry.name)) {
            fs.rmSync(abs, { force: true });
          }
        }
      }
    }
    if (fs.existsSync(scriptsDir)) pruneDir(scriptsDir);
  });

  // ui/ lives at the repo root for the duration of iteration 1 per parent
  // design Decision 10 — read from `root`, not from `greenfield`.
  await step('emit-ui-bundle', () => emitUiBundle({
    source: path.join(root, 'ui'),
    target: path.join(out, '_install-source/ui.tgz'),
    runner: opts.skipUiRunner ? async () => { /* unit-test fast path */ } : undefined,
  }));

  await step('emit-hook-bundle', () => emitHookBundle({
    source: path.join(installerDir, 'hooks'),
    target: path.join(out, 'hooks'),
    // session-preamble.mjs is single-source (AD-8): staged from the shared
    // hooks dir, not the plugin's own hooks/ tree.
    sharedHooksDir: path.join(greenfield, 'harness-installers/shared/hooks'),
  }));

  // Token + namespacing transforms — run over agents/ and skills/. The hooks/
  // tree is intentionally excluded: bootstrap.mjs is already bundled, and
  // hooks.json + drift-check.mjs carry no build-time substitution tokens
  // (only runtime CLAUDE_PLUGIN_ROOT env reads).
  await step('expand-tokens', async () => {
    const agentNames = fs.readdirSync(path.join(out, 'agents'))
      .filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
      .filter((n) => n !== 'orchestrator');
    const tokenMap = {
      '${SKILLS_ROOT}': '${CLAUDE_PLUGIN_ROOT}/skills',
      '${PLUGIN_ROOT}': '${CLAUDE_PLUGIN_ROOT}',
    };
    // In-place: read from out/ subtree, write to a sibling staging dir,
    // then atomically move into place to avoid mid-walk read-after-write.
    const staging = path.join(installerDir, '.expand-staging');
    fs.rmSync(staging, { recursive: true, force: true });
    await expandTokens({ source: path.join(out, 'agents'), target: path.join(staging, 'agents'), tokenMap, agentNames });
    await expandTokens({ source: path.join(out, 'skills'), target: path.join(staging, 'skills'), tokenMap, agentNames });
    fs.rmSync(path.join(out, 'agents'), { recursive: true, force: true });
    fs.rmSync(path.join(out, 'skills'), { recursive: true, force: true });
    fs.cpSync(path.join(staging, 'agents'), path.join(out, 'agents'), { recursive: true });
    fs.cpSync(path.join(staging, 'skills'), path.join(out, 'skills'), { recursive: true });
    fs.rmSync(staging, { recursive: true, force: true });
  });

  // .claude-plugin/plugin.json — copy verbatim and stamp version from itself.
  await step('copy-plugin-manifest', () => {
    const src = path.join(installerDir, '.claude-plugin/plugin.json');
    const dst = path.join(out, '.claude-plugin/plugin.json');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  });

  // package.json synthesis from wrapper + plugin.json (plugin.json wins).
  await step('synthesize-package-json', () => synthesizePackageJson({
    wrapperPath: path.join(installerDir, 'package.json'),
    pluginJsonPath: path.join(installerDir, '.claude-plugin/plugin.json'),
    outPath: path.join(out, 'package.json'),
  }));

  // Manifest catalog: every committed v*.json copies to output/manifests/.
  await step('copy-manifest-catalog', () => {
    const src = path.join(installerDir, 'manifests');
    fs.mkdirSync(path.join(out, 'manifests'), { recursive: true });
    for (const f of fs.readdirSync(src)) {
      if (/^v.+\.json$/.test(f)) fs.copyFileSync(path.join(src, f), path.join(out, 'manifests', f));
    }
  });

  // Structural validation gates (P05-T02).
  await step('validate', () => validatePluginTree({
    outputDir: out,
    canonicalAgentsDir: path.join(greenfield, 'harness-files/agents'),
  }));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))) {
  runBuild({ rootDir: process.cwd() }).catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
}
