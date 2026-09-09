import fs from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';
import { userDataPaths } from './user-data-paths.js';
import {
  loadRegistry, writeInstallJson, buildCopilotVscodePluginEntry, isEntryCurrent,
} from './install-json.js';
import { loadManifest } from './catalog.js';
import { installManifestFiles } from './install-files.js';
import { removeManifestFiles } from './remove-files.js';
import { appendInstallLog } from './install-log.js';
import { detectAndStopUi, formatUiLockMessage } from './ui-stop.js';

/** Thrown when the dashboard UI is running and could not be stopped pre-install. */
export class UiLockError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'UiLockError';
    this.uiStatus = status;
  }
}

function cleanupStagingDir(pluginRoot) {
  try {
    fs.rmSync(path.join(pluginRoot, '_install-source'), { recursive: true, force: true });
    fs.rmSync(path.join(pluginRoot, 'templates'), { recursive: true, force: true });
    fs.rmSync(path.join(pluginRoot, 'orchestration.yml'), { force: true });
    fs.rmSync(path.join(pluginRoot, 'ui'), { recursive: true, force: true });
  } catch { /* best-effort cleanup */ }
}

const INSTALL_KEY = 'copilot-vscode-plugin';
const COEXISTENCE_PARTNERS = ['copilot-vscode', 'copilot-cli', 'copilot-cli-plugin'];

function cmpSemver(a, b) {
  // Split release (major.minor.patch) from prerelease (`-alpha.1` etc) before
  // tokenising so we can apply the SemVer §11.3 rule "release > prerelease of
  // the same release" without conflating it with §11.4.4's "longer prerelease
  // wins". A naive single-pass split on /[.-]/ can't distinguish a missing
  // identifier because pa never entered prerelease from a missing identifier
  // because pa's prerelease is just shorter than pb's.
  function parse(v) {
    // Split on the first `-` only — `split('-', 2)` would silently drop
    // content past a second hyphen in a prerelease identifier (e.g. the
    // `-hotfix` suffix in `1.0.0-rc.1-hotfix`).
    const dashIdx = v.indexOf('-');
    const main = dashIdx === -1 ? v : v.slice(0, dashIdx);
    const pre = dashIdx === -1 ? '' : v.slice(dashIdx + 1);
    const release = main.split('.').map(Number);
    const prerelease = pre ? pre.split('.').map((p) => /^\d+$/.test(p) ? Number(p) : p) : [];
    return { release, prerelease };
  }
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const x = pa.release[i] ?? 0;
    const y = pb.release[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  // SemVer §11.3: a version without prerelease outranks one with prerelease at the same release.
  if (pa.prerelease.length === 0 && pb.prerelease.length > 0) return 1;
  if (pa.prerelease.length > 0 && pb.prerelease.length === 0) return -1;
  const n = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < n; i++) {
    const x = pa.prerelease[i];
    const y = pb.prerelease[i];
    if (x === undefined) return -1; // §11.4.4: shorter prerelease has lower precedence.
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x < y ? -1 : 1;
    } else if (typeof x === 'number') {
      return -1; // §11.4.3: numeric identifiers have lower precedence than non-numeric.
    } else if (typeof y === 'number') {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

function readDeliveringVersion(pluginRoot) {
  const pluginJsonPath = path.join(pluginRoot, 'plugin.json');
  if (fs.existsSync(pluginJsonPath)) {
    const pj = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
    if (pj.version) return pj.version;
  }
  const pkgJsonPath = path.join(pluginRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  return pkg.version;
}

function emitCoexistenceWarning(stderr, partnersPresent) {
  const partnerList = partnersPresent.join(', ');
  const cliPluginPresent = partnersPresent.includes('copilot-cli-plugin');
  const extra = cliPluginPresent
    ? `\nNote: the copilot-cli-plugin partner is auto-discovered by VS Code via one-way cross-discovery\n` +
      `from ~/.copilot/installed-plugins/. Its agent files carry CLI-shape model identifiers that\n` +
      `VS Code's model resolver does not recognize. Load-order ambiguity means either plugin's agent\n` +
      `files may win at runtime; uninstalling the CLI plugin resolves the precedence.\n`
    : '';
  stderr(
    `WARNING: rad-orchestration is already registered under ${partnerList} alongside copilot-vscode-plugin.\n` +
    `All install-keys coexist in ~/.radorc/install.json so neither install clobbers the other's metadata,\n` +
    `but the standard-installer's ~/.copilot/ writes can shadow plugin-shipped agents and skills per\n` +
    `VS Code's documented load order. The copilot-vscode-plugin ships correctly-shaped model identifiers\n` +
    `for VS Code's resolver and is the recommended canonical channel for VS-Code-heavy users.\n${extra}`,
  );
}

/**
 * @param {{
 *   pluginRoot: string, radHome?: string, force?: boolean,
 *   stderr?: (msg:string)=>void,
 *   _detectAndStopUi?: typeof detectAndStopUi,
 * }} opts
 */
export async function runInstall(opts) {
  const stderr = opts.stderr ?? ((msg) => process.stderr.write(msg));
  const detect = opts._detectAndStopUi ?? detectAndStopUi;
  const paths = userDataPaths({ radHome: opts.radHome });
  let deliveringVersion = null;
  let installedVersionBefore = null;
  let uiStopped = false;
  try {
    deliveringVersion = readDeliveringVersion(opts.pluginRoot);
    const sentinel = path.join(opts.pluginRoot, 'skills/rad-orchestration/scripts/radorch.mjs');

    fs.mkdirSync(paths.projects, { recursive: true });
    fs.mkdirSync(paths.logs, { recursive: true });

    const ij = loadRegistry(paths.installJson);
    const prior = ij.harnesses[INSTALL_KEY];
    installedVersionBefore = prior?.version ?? null;
    const sentinelPresent = fs.existsSync(sentinel);

    // Three-partner bidirectional coexistence: name every partner present.
    const partnersPresent = COEXISTENCE_PARTNERS.filter((k) => ij.harnesses[k]);
    if (partnersPresent.length > 0) emitCoexistenceWarning(stderr, partnersPresent);

    // Same-version fast path with sentinel self-heal (FR-15). Upserts
    // install.json when entry is missing or shape-drifted so install.json
    // remains authoritative for "is this harness installed?".
    if (prior && installedVersionBefore === deliveringVersion && sentinelPresent && !opts.force) {
      let installJsonUpserted = false;
      if (!isEntryCurrent(prior, deliveringVersion)) {
        ij.harnesses[INSTALL_KEY] = buildCopilotVscodePluginEntry(deliveringVersion);
        writeInstallJson(paths.installJson, ij);
        installJsonUpserted = true;
      }
      appendInstallLog(paths.installLog, { action: 'noop', deliveringVersion, installedVersionBefore });
      cleanupStagingDir(opts.pluginRoot);
      return { action: 'noop', deliveringVersion, installedVersionBefore, uiStopped: false, installJsonUpserted };
    }

    // Downgrade-noop (FR-23). Same upsert.
    if (prior && cmpSemver(deliveringVersion, installedVersionBefore) < 0 && !opts.force) {
      stderr(`[install] Delivering v${deliveringVersion} is older than installed v${installedVersionBefore}; downgrade accepted as no-op.\n`);
      let installJsonUpserted = false;
      if (!isEntryCurrent(prior, installedVersionBefore)) {
        ij.harnesses[INSTALL_KEY] = buildCopilotVscodePluginEntry(installedVersionBefore);
        writeInstallJson(paths.installJson, ij);
        installJsonUpserted = true;
      }
      appendInstallLog(paths.installLog, { action: 'downgrade-noop', deliveringVersion, installedVersionBefore });
      cleanupStagingDir(opts.pluginRoot);
      return { action: 'downgrade-noop', deliveringVersion, installedVersionBefore, uiStopped: false, installJsonUpserted };
    }

    // Pre-flight UI gate — runs only when actual file work is required.
    const ui = await detect({ radHome: opts.radHome });
    if (ui.wasRunning && !ui.stopped) {
      throw new UiLockError(formatUiLockMessage(ui.status, ui.reason), ui.status);
    }
    uiStopped = ui.stopped;

    // Upgrade or fresh install — remove prior manifest entries (skip user-config), install new (FR-16).
    if (prior && installedVersionBefore !== deliveringVersion) {
      try {
        const priorManifest = loadManifest(opts.pluginRoot, installedVersionBefore);
        removeManifestFiles(priorManifest, { radHome: opts.radHome });
      } catch { /* prior manifest may be unavailable — clobber install acceptable */ }
    }
    const manifest = loadManifest(opts.pluginRoot, deliveringVersion);
    // The corpus is installer-owned in full and is replaced, never merged. This channel
    // keeps only one manifest, so the prior-version removal pass above cannot run — without
    // this, a page dropped between two releases would linger on disk forever.
    fs.rmSync(paths.docs, { recursive: true, force: true });
    installManifestFiles(manifest, opts.pluginRoot, { radHome: opts.radHome });

    // UI hydration: extract the gzipped tarball wholesale. The tarball
    // shape (vs a loose tree) lets node_modules/ and .next/ survive the
    // satellite `.gitignore` and `npm pack`'s hardcoded node_modules strip.
    const pluginUiTarball = path.join(opts.pluginRoot, '_install-source/ui.tgz');
    if (fs.existsSync(pluginUiTarball)) {
      fs.rmSync(paths.ui, { recursive: true, force: true });
      fs.mkdirSync(paths.ui, { recursive: true });
      await tar.x({ file: pluginUiTarball, cwd: paths.ui });
    }

    ij.harnesses[INSTALL_KEY] = buildCopilotVscodePluginEntry(deliveringVersion);
    writeInstallJson(paths.installJson, ij);

    const action = (installedVersionBefore && sentinelPresent) ? 'upgrade-complete' : 'fresh-install';
    appendInstallLog(paths.installLog, { action, deliveringVersion, installedVersionBefore });

    // Success-only staging cleanup. A failure leaves _install-source/ intact
    // so the next bootstrap firing can retry without ENOENT cascades.
    cleanupStagingDir(opts.pluginRoot);

    return { action, deliveringVersion, installedVersionBefore, uiStopped, installJsonUpserted: true };
  } catch (err) {
    appendInstallLog(paths.installLog, { action: 'error', deliveringVersion, installedVersionBefore });
    throw err;
  }
}
