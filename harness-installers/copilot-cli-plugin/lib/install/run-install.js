import fs from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';
import { userDataPaths } from './user-data-paths.js';
import {
  loadRegistry, writeInstallJson, buildCopilotCliPluginEntry, isEntryCurrent,
} from './install-json.js';
import { loadManifest } from './catalog.js';
import { installManifestFiles } from './install-files.js';
import { removeManifestFiles } from './remove-files.js';
import { appendInstallLog } from './install-log.js';
import { detectAndStopUi, formatUiLockMessage } from './ui-stop.js';

const INSTALL_KEY = 'copilot-cli-plugin';
const COEXISTENCE_PARTNERS = ['copilot-cli', 'copilot-vscode'];

/** Thrown when the dashboard UI is running and could not be stopped pre-install. */
export class UiLockError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'UiLockError';
    this.uiStatus = status;
  }
}

function cmpSemver(a, b) {
  const pa = a.split(/[.-]/).map((p) => /^\d+$/.test(p) ? Number(p) : p);
  const pb = b.split(/[.-]/).map((p) => /^\d+$/.test(p) ? Number(p) : p);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i]; const y = pb[i];
    if (x === undefined) return typeof y === 'string' ? 1 : -1;
    if (y === undefined) return typeof x === 'string' ? -1 : 1;
    if (typeof x === 'number' && typeof y === 'number') { if (x !== y) return x < y ? -1 : 1; }
    // SemVer §11.4.3: numeric identifiers always have lower precedence than non-numeric ones.
    else if (typeof x === 'number') return -1;
    else if (typeof y === 'number') return 1;
    else if (x !== y) return x < y ? -1 : 1;
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
  const partnerList = partnersPresent.join(' and ');
  stderr(
    `WARNING: A standard-installer ${partnerList} install of rad-orchestration is already registered\n` +
    `alongside copilot-cli-plugin. All keys coexist in ~/.radorc/install.json so neither install\n` +
    `clobbers the other's metadata, but the standard-installer's user-level files at ~/.copilot/\n` +
    `will shadow plugin-shipped agents and skills per Copilot CLI's documented load order.\n` +
    `Consider removing the standard-installer (${partnerList}) install if the plugin is the canonical channel.\n`,
  );
}

function cleanupStagingDir(pluginRoot) {
  // Sweep the staging dir (_install-source/) and the legacy top-level shadows
  // (templates/, orchestration.yml, ui/) left by pre-relocation payloads on
  // existing installs. Called only on the success branches now (not in
  // finally) so a transient failure doesn't permanently break retries.
  try {
    fs.rmSync(path.join(pluginRoot, '_install-source'), { recursive: true, force: true });
    fs.rmSync(path.join(pluginRoot, 'templates'), { recursive: true, force: true });
    fs.rmSync(path.join(pluginRoot, 'orchestration.yml'), { force: true });
    fs.rmSync(path.join(pluginRoot, 'ui'), { recursive: true, force: true });
  } catch { /* best-effort cleanup — do not mask the primary outcome */ }
}

/**
 * @param {{
 *   pluginRoot: string,
 *   radHome?: string,
 *   force?: boolean,
 *   stderr?: (msg:string)=>void,
 *   _detectAndStopUi?: typeof detectAndStopUi,
 * }} opts
 * @returns {Promise<{
 *   action: 'noop'|'downgrade-noop'|'fresh-install'|'upgrade-complete',
 *   deliveringVersion: string,
 *   installedVersionBefore: string | null,
 *   uiStopped: boolean,
 *   installJsonUpserted: boolean,
 * }>}
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

    // FR-19 bidirectional coexistence: name every partner present.
    const partnersPresent = COEXISTENCE_PARTNERS.filter((k) => ij.harnesses[k]);
    if (partnersPresent.length > 0) emitCoexistenceWarning(stderr, partnersPresent);

    // Same-version fast path with sentinel self-heal. Still upserts the
    // install.json entry when missing or shape-drifted so install.json
    // remains authoritative for "is this harness installed?".
    if (prior && installedVersionBefore === deliveringVersion && sentinelPresent && !opts.force) {
      let installJsonUpserted = false;
      if (!isEntryCurrent(prior, deliveringVersion)) {
        ij.harnesses[INSTALL_KEY] = buildCopilotCliPluginEntry(deliveringVersion);
        writeInstallJson(paths.installJson, ij);
        installJsonUpserted = true;
      }
      appendInstallLog(paths.installLog, { action: 'noop', deliveringVersion, installedVersionBefore });
      cleanupStagingDir(opts.pluginRoot);
      return { action: 'noop', deliveringVersion, installedVersionBefore, uiStopped: false, installJsonUpserted };
    }

    // Downgrade-noop (FR-21). Same install.json upsert as above.
    if (prior && cmpSemver(deliveringVersion, installedVersionBefore) < 0 && !opts.force) {
      stderr(`[install] Delivering v${deliveringVersion} is older than installed v${installedVersionBefore}; downgrade accepted as no-op.\n`);
      let installJsonUpserted = false;
      if (!isEntryCurrent(prior, installedVersionBefore)) {
        ij.harnesses[INSTALL_KEY] = buildCopilotCliPluginEntry(installedVersionBefore);
        writeInstallJson(paths.installJson, ij);
        installJsonUpserted = true;
      }
      appendInstallLog(paths.installLog, { action: 'downgrade-noop', deliveringVersion, installedVersionBefore });
      cleanupStagingDir(opts.pluginRoot);
      return { action: 'downgrade-noop', deliveringVersion, installedVersionBefore, uiStopped: false, installJsonUpserted };
    }

    // Pre-flight UI gate. Runs only when actual file work is required (past
    // the two NOOP branches above). A running UI holds a file lock on
    // ~/.radorc/ui/ that would break the wholesale tarball extract below;
    // stop it cleanly or abort the whole install with a clear message.
    const ui = await detect({ radHome: opts.radHome });
    if (ui.wasRunning && !ui.stopped) {
      throw new UiLockError(formatUiLockMessage(ui.status, ui.reason), ui.status);
    }
    uiStopped = ui.stopped;

    // Upgrade or fresh install — remove prior manifest entries (skip user-config), install new.
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

    // UI ships as a gzipped tarball (ui.tgz) so node_modules/ and .next/
    // survive the satellite `.gitignore` and `npm pack`'s hardcoded
    // node_modules strip. Extract it wholesale into ~/.radorc/ui/.
    const pluginUiTarball = path.join(opts.pluginRoot, '_install-source/ui.tgz');
    if (fs.existsSync(pluginUiTarball)) {
      fs.rmSync(paths.ui, { recursive: true, force: true });
      fs.mkdirSync(paths.ui, { recursive: true });
      await tar.x({ file: pluginUiTarball, cwd: paths.ui });
    }

    ij.harnesses[INSTALL_KEY] = buildCopilotCliPluginEntry(deliveringVersion);
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
