// harness-installers/standard/lib/install/install-harness.js —
// Top-level orchestrator for a single harness's install. Single-shape only
// (AD-1) — there is no v5 union or migration logic; the standard installer
// writes structurally from the first install.
//
// State machine (AD-11):
//   install.json absent OR entry missing OR sentinel missing → fresh-install
//   entry present, version == delivering, sentinel present   → noop
//   entry present, prior < delivering                        → upgrade-complete
//   entry present, prior > delivering                        → downgrade-refused (non-zero exit code)
//
// After any write action (fresh / upgrade / self-heal):
//   - Folder mutex (FR-11, AD-12): copilot-cli ↔ copilot-vscode share ~/.copilot/.
//     The cross-UI standard partner is removed from the registry; no stderr
//     line is emitted here because the wizard now confirms eviction pre-install.
//   - Plugin coexistence (FR-13, AD-15): a standard install can coexist with
//     a plugin partner in the same harness folder (claude ↔ claude-plugin,
//     copilot-cli ↔ copilot-cli-plugin or copilot-vscode-plugin, etc.). The
//     plugin's registry entry is PRESERVED; an stderr notice is emitted so
//     headless `--yes` runs still surface the situation.
//
// NFR-4 (best-effort): the mutex + coexistence emit is wrapped in a single
// try/catch. If stderr write fails, the install still completes.

import fs from 'node:fs';
import path from 'node:path';
import { userDataPaths } from './user-data-paths.js';
import { harnessRoot } from './harness-paths.js';
import { loadBundledManifest } from './catalog.js';
import { installManifestFiles } from './install-files.js';
import { removeManifestFiles } from './remove-files.js';
import {
  writeInstallJson,
  loadRegistry,
  cmpSemver,
  resolveFolderConflict,
  detectPluginCoexistence,
  isEntryCurrent,
} from './install-json.js';
import { mergePreambleHook, reconcileTelemetryHooks } from './claude-hook-settings.js';

const STANDARD_CHANNEL = 'standard';

/**
 * Install or upgrade a single harness. The caller (P04's index.js) loops over
 * selected harnesses and invokes this once each; sibling harnesses are never
 * rolled back on a per-harness failure (AD-11).
 *
 * @param {{
 *   bundleRoot: string,
 *   sharedRoot?: string,
 *   harness: string,
 *   stderr?: { write(s: string): unknown },
 *   settingsPath?: string,
 * }} opts
 *   settingsPath — absolute path to Claude's settings.json (FR-18, AD-10).
 *                  When absent and harness === 'claude', defaults to
 *                  ~/.claude/settings.json. Not used for Copilot harnesses.
 * @returns {Promise<{
 *   action: 'fresh-install' | 'upgrade-complete' | 'noop' | 'downgrade-refused',
 *   code: number,
 *   deliveringVersion: string,
 *   installedVersion?: string,
 *   message?: string,
 * }>}
 */
export async function installHarness(opts) {
  const paths = userDataPaths();
  const sharedRoot = opts.sharedRoot ?? opts.bundleRoot;
  const stderr = opts.stderr ?? process.stderr;
  // Resolve Claude settings.json path (FR-18, AD-10). Defaults to ~/.claude/settings.json.
  const settingsPath = opts.settingsPath ?? path.join(harnessRoot('claude'), 'settings.json');

  // 1. Resolve delivering version from bundle/package.json.
  const pkgPath = path.join(opts.bundleRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`installHarness: bundle package.json missing at ${pkgPath}`);
  }
  const bundlePkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const deliveringVersion = bundlePkg.version;

  // 2. Load registry (single-shape; missing/malformed → empty harnesses object).
  const registry = loadRegistry(paths.installJson);

  // 3. Install-key equals the harness name for the standard installer (AD-10).
  const installKey = opts.harness;
  const existingEntry = registry.harnesses[installKey];

  // 4. Sentinel check — the CLI sentinel must be present in the harness root.
  const sentinelPath = path.join(
    harnessRoot(opts.harness),
    'skills/rad-orchestration/scripts/radorch.mjs',
  );
  const sentinelPresent = fs.existsSync(sentinelPath);

  // 5. Action decision (AD-11).
  if (!existingEntry) {
    return doFreshInstall({
      paths, opts, sharedRoot, deliveringVersion, installKey, registry, stderr, settingsPath,
    });
  }

  if (!sentinelPresent) {
    // NFR-11: sentinel-missing is a loud fresh-install — emit a notice but
    // return the action as 'fresh-install' (no special action name).
    safeWrite(stderr, '[install] sentinel missing — forcing fresh install\n');
    return doFreshInstall({
      paths, opts, sharedRoot, deliveringVersion, installKey, registry, stderr, settingsPath,
      installedVersion: existingEntry.version,
    });
  }

  const installedVersion = existingEntry.version;
  const cmp = cmpSemver(deliveringVersion, installedVersion);

  if (cmp === 0) {
    // NOOP fast path. Upsert install.json when the entry is missing fields
    // (e.g. an old standard install wrote without `last_writer_version`) so
    // install.json remains authoritative for "is this harness installed?".
    let installJsonUpserted = false;
    if (!isEntryCurrent(existingEntry, deliveringVersion)) {
      registry.harnesses[installKey] = {
        version: deliveringVersion,
        channel: STANDARD_CHANNEL,
        installed_at: existingEntry.installed_at ?? new Date().toISOString(),
        last_writer_version: deliveringVersion,
      };
      writeInstallJson(paths.installJson, registry);
      installJsonUpserted = true;
    }
    return {
      action: 'noop',
      code: 0,
      deliveringVersion,
      installedVersion,
      installJsonUpserted,
    };
  }

  if (cmp < 0) {
    const message =
      `Installed v${installedVersion} of harness '${opts.harness}' is newer than ` +
      `delivering v${deliveringVersion}; refusing to downgrade.\n` +
      `To downgrade, uninstall first, then install the older tarball.\n`;
    safeWrite(stderr, message);
    return {
      action: 'downgrade-refused',
      code: 1,
      deliveringVersion,
      installedVersion,
      message,
    };
  }

  // 6. Upgrade path.
  return doUpgrade({
    paths, opts, sharedRoot, deliveringVersion, installedVersion,
    installKey, existingEntry, registry, stderr, settingsPath,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function doFreshInstall({
  paths, opts, sharedRoot, deliveringVersion, installKey, registry, stderr, settingsPath,
  installedVersion,
}) {
  // Ensure ~/.radorc/ skeleton exists.
  fs.mkdirSync(paths.root, { recursive: true });

  // Copy the delivering manifest's files.
  const newManifest = loadBundledManifest(opts.bundleRoot, opts.harness, deliveringVersion);
  installManifestFiles(newManifest, opts.bundleRoot, opts.harness, { sharedRoot });

  // Preamble hook wiring (FR-18, AD-9, AD-10): merge the marked SessionStart
  // entry into Claude's settings.json. The shim path is the manifest-dropped
  // hooks/session-preamble.mjs resolved to its install-time absolute location.
  if (opts.harness === 'claude') {
    const shimPath = path.join(harnessRoot('claude'), 'hooks', 'session-preamble.mjs');
    mergePreambleHook({ settingsPath, hookCommand: `node "${shimPath}"` });
    const telemetryShimPath = path.join(harnessRoot('claude'), 'hooks', 'telemetry-capture.mjs');
    reconcileTelemetryHooks({ settingsPath, hookCommand: `node "${telemetryShimPath}"` });
  }

  // Folder mutex + cross-channel emission, best-effort (NFR-4).
  emitPostInstallNotices({ registry, installKey, stderr });

  // Update registry entry. Preserve installed_at if it happens to exist
  // (defensive — fresh-install usually has no prior entry, but the
  // sentinel-self-heal branch lands here too).
  const priorInstalledAt = registry.harnesses[installKey]?.installed_at;
  registry.harnesses[installKey] = {
    version: deliveringVersion,
    channel: STANDARD_CHANNEL,
    installed_at: priorInstalledAt ?? new Date().toISOString(),
    last_writer_version: deliveringVersion,
  };
  writeInstallJson(paths.installJson, registry);

  return {
    action: 'fresh-install',
    code: 0,
    deliveringVersion,
    installedVersion,
  };
}

function doUpgrade({
  paths, opts, sharedRoot, deliveringVersion, installedVersion,
  installKey, existingEntry, registry, stderr, settingsPath,
}) {
  fs.mkdirSync(paths.root, { recursive: true });

  // Remove prior manifest, then install delivering. Prior manifest must be
  // bundled (AD-4) — let `loadBundledManifest` throw if absent.
  const priorManifest = loadBundledManifest(opts.bundleRoot, opts.harness, installedVersion);
  removeManifestFiles(priorManifest, opts.harness);

  const newManifest = loadBundledManifest(opts.bundleRoot, opts.harness, deliveringVersion);
  installManifestFiles(newManifest, opts.bundleRoot, opts.harness, { sharedRoot });

  // Preamble hook wiring (FR-18, AD-9, AD-10): merge idempotent — a no-op if
  // the marker is already present from a prior install.
  if (opts.harness === 'claude') {
    const shimPath = path.join(harnessRoot('claude'), 'hooks', 'session-preamble.mjs');
    mergePreambleHook({ settingsPath, hookCommand: `node "${shimPath}"` });
    const telemetryShimPath = path.join(harnessRoot('claude'), 'hooks', 'telemetry-capture.mjs');
    reconcileTelemetryHooks({ settingsPath, hookCommand: `node "${telemetryShimPath}"` });
  }

  emitPostInstallNotices({ registry, installKey, stderr });

  // Preserve installed_at on upgrade; bump version + last_writer_version.
  registry.harnesses[installKey] = {
    version: deliveringVersion,
    channel: STANDARD_CHANNEL,
    installed_at: existingEntry.installed_at,
    last_writer_version: deliveringVersion,
  };
  writeInstallJson(paths.installJson, registry);

  return {
    action: 'upgrade-complete',
    code: 0,
    deliveringVersion,
    installedVersion,
  };
}

/**
 * Folder mutex (FR-11, AD-12) eviction + plugin coexistence (FR-13, AD-15)
 * notice. Wrapped in a try/catch so stderr write failures do not abort the
 * install (NFR-4). The mutex eviction is now confirmed pre-install by the
 * wizard, so this function only performs the registry mutation here — no
 * stderr line about it. Plugin coexistence is surfaced post-install via a
 * uniform stderr notice so headless `--yes` runs still record the situation;
 * the plugin's registry entry is left intact.
 */
function emitPostInstallNotices({ registry, installKey, stderr }) {
  try {
    // Cross-UI standard mutex eviction. Plugin partners are absent from the mutex
    // map (see install-json.js) and are NOT removed by this call.
    resolveFolderConflict(registry.harnesses, installKey);

    const coexist = detectPluginCoexistence(registry.harnesses, installKey);
    if (coexist.length > 0) {
      emitCoexistNotice(installKey, coexist, stderr);
    }
  } catch {
    /* NFR-4: best-effort — swallow stderr failures and continue. */
  }
}

/**
 * Plugin coexistence stderr notice. Uniform across all three standard harnesses.
 * Fires when a standard install proceeds alongside one or more plugin partners
 * sharing the harness folder. Standard installer and plugins write to
 * non-overlapping subtrees, so nothing on disk is overwritten — but the harness
 * loads BOTH subtrees and surfaces duplicate `rad-orc:<name>` entries.
 */
function emitCoexistNotice(installKey, coexist, stderr) {
  const partnerSummary = coexist
    .map(({ partner, entry }) => entry ? `${partner} v${entry.version}` : `${partner} (on disk)`)
    .join(', ');
  stderr.write(
    `WARNING: a plugin install is already present alongside this standard install (${partnerSummary}).\n` +
    `Both channels' agents and skills are now on disk in separate subtrees, so the harness\n` +
    `will load DUPLICATE rad-orc:<name> entries for every shared agent and skill.\n` +
    `To avoid duplicates, run \`/plugin uninstall rad-orc\` inside the affected harness\n` +
    `before re-installing the standard variant.\n`,
  );
}

/** Best-effort stderr write that swallows write failures (NFR-4). */
function safeWrite(stderr, text) {
  try {
    stderr.write(text);
  } catch {
    /* swallow */
  }
}
