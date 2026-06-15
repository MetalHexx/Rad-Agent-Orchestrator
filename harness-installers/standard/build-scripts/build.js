#!/usr/bin/env node
// build.js — Single entry point for the standard npm installer build.
// Fans the adapter engine output for three harnesses (claude, copilot-vscode,
// copilot-cli) into per-harness staged trees under output/<harness>/ plus a
// shared top-level output/ui/. The publish package.json is the source-side
// standard/package.json itself (npm pack runs from standard/, not output/),
// so no output-side package.json synthesis is performed. Fail-fast on any
// step (AD-7).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
// Shared build-helpers are dynamic-imported inside runBuild() so esbuild
// resolves from the hoisted root node_modules (single root install, AD-3).
import { emitManifest } from './emit-manifest.js';
import { validatePackageTree } from './validate.js';

const HARNESSES = ['claude', 'copilot-vscode', 'copilot-cli'];

function step(name, fn) {
  const t0 = Date.now();
  process.stderr.write(`[build:standard] ${name} ...\n`);
  return Promise.resolve(fn()).then((r) => {
    process.stderr.write(`[build:standard] ${name} done (${Date.now() - t0}ms)\n`);
    return r;
  }).catch((err) => {
    throw new Error(`[build:standard] step "${name}" failed: ${err.message}`);
  });
}

/** Per-harness install-root token map. Both copilot variants share ~/.copilot.
 *  Standard installer does NOT apply agent-namespacing (AD-6) — bare agent names
 *  in canonical content survive to the output/ payload. */
function tokenMapFor(harness) {
  const installRoot = harness === 'claude'
    ? path.join(os.homedir(), '.claude')
    : path.join(os.homedir(), '.copilot');
  return {
    '${SKILLS_ROOT}': path.join(installRoot, 'skills'),
    '${PLUGIN_ROOT}': installRoot,
  };
}

/** @param {{ rootDir: string, skipAdapterEngine?: boolean, skipUiRunner?: boolean,
 *            skipBootstrap?: boolean, greenfieldRel?: string }} opts
 *  `rootDir` is the repo root. `greenfieldRel` (default '.') names
 *  the relative folder under `rootDir` that hosts the new staged subsystems.
 *  Unit tests construct a synthetic fixture without a parent folder,
 *  so they pass `greenfieldRel: '.'` to flatten the layout.
 *  `skipBootstrap` skips the `build-lib-dist` step; used by synthetic
 *  fixture/test builds that lack a real workspace package.json and cannot
 *  run the workspace lib build. */
export async function runBuild(opts) {
  const root = path.resolve(opts.rootDir);
  const greenfieldRel = opts.greenfieldRel ?? '.';
  const greenfield = path.join(root, greenfieldRel);
  const installerDir = path.join(greenfield, 'harness-installers/standard');
  const out = path.join(installerDir, 'output');

  // Shared helpers are dynamic-imported here; esbuild resolves from the
  // hoisted root node_modules (single root install).
  const { emitCliBundle } = await import('../../shared/build-helpers/emit-cli-bundle.js');
  const { emitUiBundle } = await import('../../shared/build-helpers/emit-ui-bundle.js');
  const { expandTokens } = await import('../../shared/build-helpers/expand-tokens.js');

  // Step 0 — adapter engine, once per harness. Skipped in unit tests.
  if (!opts.skipAdapterEngine) {
    await step('adapter-engine', () => {
      for (const h of HARNESSES) {
        execSync(`node ${path.posix.join(greenfieldRel, 'harness-adapters/engine/build.js')} --harness=${h}`,
          { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
      }
    });
  }

  await step('clean-output', () => fs.rmSync(out, { recursive: true, force: true }));
  fs.mkdirSync(out, { recursive: true });

  // Per-harness staging: adapter output → output/<harness>/{agents,skills}/.
  await step('copy-adapter-output', () => {
    for (const h of HARNESSES) {
      const adapterOut = path.join(greenfield, 'harness-adapters/output', h);
      fs.cpSync(path.join(adapterOut, 'agents'), path.join(out, h, 'agents'), { recursive: true });
      fs.cpSync(path.join(adapterOut, 'skills'), path.join(out, h, 'skills'), { recursive: true });
    }
  });

  // Per-harness runtime-config staging: orchestration.yml + four templates.
  await step('copy-runtime-config', () => {
    for (const h of HARNESSES) {
      fs.cpSync(
        path.join(greenfield, 'runtime-config/orchestration.yml'),
        path.join(out, h, 'orchestration.yml'),
      );
      fs.cpSync(
        path.join(greenfield, 'runtime-config/templates'),
        path.join(out, h, 'templates'),
        { recursive: true },
      );
    }
  });

  // Per-harness action-events staging (FR-1, FR-19, AD-3). Ships the canonical
  // `action.*.md` / `event.*.md` files plus the top-level `README.md`. The
  // `custom/` directory ships as an empty folder — any user-authored content
  // inside it (FR-20) is excluded.
  await step('copy-action-events', () => {
    const aeSrc = path.join(greenfield, 'runtime-config/action-events');
    const customSep = `${path.sep}custom${path.sep}`;
    const filter = (src) => {
      if (!src.includes(customSep)) return true;
      return src.endsWith(`${path.sep}custom`);
    };
    for (const h of HARNESSES) {
      fs.cpSync(aeSrc, path.join(out, h, 'action-events'), { recursive: true, filter });
    }
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
        execSync(`npm run build -w ${pkg}`, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
      }
    });
  }

  // Per-harness CLI bundle. cli/ lives at the repo root.
  await step('emit-cli-bundle', async () => {
    for (const h of HARNESSES) {
      await emitCliBundle({
        source: path.join(root, 'cli'),
        target: path.join(out, h, 'skills/rad-orchestration/scripts/radorch.mjs'),
      });
    }
  });

  // Per-harness preamble hook shim staging (FR-18, AD-8, AD-13).
  // Copies harness-installers/shared/hooks/session-preamble.mjs into each
  // per-harness output/<harness>/hooks/ tree. For Copilot harnesses the
  // manifest file-drop places the shim in the auto-discovered hooks directory.
  // For the Claude harness the shim lands at ~/.claude/hooks/session-preamble.mjs,
  // which is the absolute path that install-harness.js points the settings entry at.
  await step('copy-hook-shim', () => {
    const shimSrc = path.join(greenfield, 'harness-installers/shared/hooks/session-preamble.mjs');
    for (const h of HARNESSES) {
      const hooksDir = path.join(out, h, 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });
      fs.copyFileSync(shimSrc, path.join(hooksDir, 'session-preamble.mjs'));
    }
  });

  // Prune non-runtime artifacts from per-harness scripts trees. Only
  // runtime artifacts (.js, .mjs) survive.
  // Files named `.gitignore` are not kept because npm-packlist hardcodes
  // them as ignored when building the tarball — they would never reach the
  // user anyway and listing them in the manifest would break install with
  // ENOENT on copyFile.
  await step('prune-scripts-sources', () => {
    const KEEP_EXTENSIONS = new Set(['.js', '.mjs']);
    function pruneDir(dir) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          fs.rmSync(abs, { recursive: true, force: true });
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (!KEEP_EXTENSIONS.has(ext)) {
            fs.rmSync(abs, { force: true });
          }
        }
      }
    }
    for (const h of HARNESSES) {
      pruneDir(path.join(out, h, 'skills/rad-orchestration/scripts'));
    }
  });

  // UI bundle ONCE at top-level output/ui/ — shared across all three harnesses
  // (AD-9). Never duplicated under output/<harness>/.
  await step('emit-ui-bundle', () => emitUiBundle({
    source: path.join(root, 'ui'),
    target: path.join(out, 'ui.tgz'),
    runner: opts.skipUiRunner ? async () => { /* unit-test fast path */ } : undefined,
  }));

  // Per-harness token expansion. Standard installer passes agentNames: [] so
  // NO `rad-orc:` namespacing is applied (AD-6). Read from out/<h>/,
  // write through a staging dir to avoid mid-walk read-after-write, then
  // atomically move back over.
  await step('expand-tokens', async () => {
    for (const h of HARNESSES) {
      const hOut = path.join(out, h);
      const tokenMap = tokenMapFor(h);
      const staging = path.join(installerDir, `.expand-staging-${h}`);
      fs.rmSync(staging, { recursive: true, force: true });
      await expandTokens({
        source: path.join(hOut, 'agents'),
        target: path.join(staging, 'agents'),
        tokenMap,
        agentNames: [],
      });
      await expandTokens({
        source: path.join(hOut, 'skills'),
        target: path.join(staging, 'skills'),
        tokenMap,
        agentNames: [],
      });
      fs.rmSync(path.join(hOut, 'agents'), { recursive: true, force: true });
      fs.rmSync(path.join(hOut, 'skills'), { recursive: true, force: true });
      fs.cpSync(path.join(staging, 'agents'), path.join(hOut, 'agents'), { recursive: true });
      fs.cpSync(path.join(staging, 'skills'), path.join(hOut, 'skills'), { recursive: true });
      fs.rmSync(staging, { recursive: true, force: true });
    }
  });

  // Per-harness manifest emission + copy-forward of every prior committed
  // version (so a user installed at any prior version has a clean upgrade
  // path resolvable against the bundled manifests).
  const pkg = JSON.parse(
    fs.readFileSync(path.join(installerDir, 'package.json'), 'utf8'),
  );
  await step('emit-manifest', async () => {
    for (const h of HARNESSES) {
      const manifestDir = path.join(installerDir, 'manifests', h);
      fs.mkdirSync(manifestDir, { recursive: true });
      await emitManifest({
        harnessOutputDir: path.join(out, h),
        harness: h,
        version: pkg.version,
        manifestDir,
      });
      const distManifestDir = path.join(out, h, 'manifests');
      fs.mkdirSync(distManifestDir, { recursive: true });
      for (const f of fs.readdirSync(manifestDir)) {
        if (/^v.+\.json$/.test(f)) {
          fs.copyFileSync(path.join(manifestDir, f), path.join(distManifestDir, f));
        }
      }
    }
  });

  // Per-harness package.json stub — written AFTER emit-manifest so it stays
  // out of the manifest (which would otherwise copy it to ~/.<harness>/).
  // `installHarness` reads `bundleRoot/package.json` to resolve the delivering
  // version (and the noop/upgrade/downgrade decision), so each per-harness
  // payload must carry its own version stub.
  await step('emit-per-harness-package-json', () => {
    for (const h of HARNESSES) {
      const stub = { name: 'rad-orchestration', version: pkg.version };
      fs.writeFileSync(
        path.join(out, h, 'package.json'),
        JSON.stringify(stub, null, 2) + '\n',
      );
    }
  });

  // Structural validation — final gate before npm pack (FR-27, FR-28, NFR-5, NFR-7, AD-7).
  // A throw aborts the build with a non-zero exit code.
  await step('validate', () => validatePackageTree({
    outputDir: out,
    canonicalAgentsDir: path.join(greenfield, 'harness-files/agents'),
    harnesses: ['claude', 'copilot-vscode', 'copilot-cli'],
    version: pkg.version,
  }));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))) {
  runBuild({ rootDir: process.cwd() }).catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
}
