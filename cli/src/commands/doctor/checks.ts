import fs from 'node:fs';
import fsP from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathExists } from '../../lib/fs-helpers.js';
import { installPaths, userDataPaths } from '../../lib/paths.js';
import { readInstallJson } from '../../lib/config.js';
import { cmpSemver, readLastWriterVersion } from '../../lib/install-json.js';
import { parseYaml } from '../../lib/yaml.js';
import { scanUserLevelHarnesses, type HarnessInstallReport } from '../../lib/cross-harness-scan.js';
import { getCliVersion } from '../../lib/package-version.js';
import { readRegistry } from '@rad-orchestration/repo-registry';
import { readConfig, type ConfigResult } from '../config/index.js';

const pkg = { version: getCliVersion() };

export type CheckStatus = 'pass' | 'warn' | 'fail';
export type CheckCategory = 'Environment' | 'Install' | 'Plugin' | 'Tooling' | 'Registry';

export interface CheckResult {
  category: CheckCategory;
  name: string;
  status: CheckStatus;
  detail?: string;
}

/** The four properties retired in 1.3 — present in old orchestration.yml files. */
const RETIRED_KEYS = ['system.orch_root', 'projects.base_path', 'projects.naming', 'source_control.provider'] as const;

/** Config-state checks. Pure: takes the already-read config, returns results.
 *  Kept separate from runInstallChecks so it is unit-testable without a real ~/.radorc. */
export function runConfigStateChecks(config: ConfigResult): CheckResult[] {
  const out: CheckResult[] = [];

  // 1. session-tracking-available — when `ambientVerbosity === 'off'`, session tracking is unavailable
  if (config.ambientVerbosity === 'off') {
    out.push({
      category: 'Install',
      name: 'session-tracking-available',
      status: 'warn',
      detail: 'ambient awareness set to off — session-start preamble renders no ambient block, session identity never reaches the agent, and session tracking is unavailable. Change `ambient_awareness.verbosity` in orchestration.yml to restore it.',
    });
  } else {
    out.push({
      category: 'Install',
      name: 'session-tracking-available',
      status: 'pass',
    });
  }

  // 2. session-active-time — when `telemetryEnabled` is false, active time will not be reported
  if (!config.telemetryEnabled) {
    out.push({
      category: 'Install',
      name: 'session-active-time',
      status: 'warn',
      detail: 'telemetry disabled — active time will not be reported. It will appear once telemetry is enabled.',
    });
  } else {
    out.push({
      category: 'Install',
      name: 'session-active-time',
      status: 'pass',
    });
  }

  return out;
}

export async function runEnvironmentChecks(): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const major = Number(process.versions.node.split('.')[0]);
  out.push({
    category: 'Environment',
    name: 'node-version',
    status: major >= 20 ? 'pass' : 'fail',
    detail: `node ${process.versions.node}`,
  });
  out.push({
    category: 'Environment',
    name: 'platform',
    status: 'pass',
    detail: `${process.platform}/${process.arch}`,
  });
  return out;
}

export async function runInstallChecks(): Promise<CheckResult[]> {
  const p = userDataPaths();
  const out: CheckResult[] = [];

  // Config-state checks (pure function that can be tested without a real ~/.radorc)
  const config = readConfig({ root: p.root });
  out.push(...runConfigStateChecks(config));

  // 1. radorch-home-exists
  const rootExists = await pathExists(p.root);
  out.push({
    category: 'Install',
    name: 'radorch-home-exists',
    status: rootExists ? 'pass' : 'fail',
    detail: rootExists ? p.root : `missing ${p.root} — run \`radorch install\``,
  });
  if (!rootExists) return out;

  // 2. install-json-shape — single structural shape; pick any registered
  // harness entry's version as the representative.
  try {
    const ij = await readInstallJson(p.installJson);
    const version = Object.values(ij.harnesses)[0]?.version;
    out.push({
      category: 'Install',
      name: 'install-json-shape',
      status: typeof version === 'string' ? 'pass' : 'fail',
    });
  } catch (e) {
    out.push({ category: 'Install', name: 'install-json-shape', status: 'fail', detail: (e as Error).message });
  }

  // 3. (retired) `radorch-bin-on-path` — the CLI no longer ships at
  // ~/.radorc/bin/; it lives inside the rad-orchestration skill folder and
  // is invoked through the harness's slash commands or `node <skill-path>`.
  // There is no PATH-on-shell concern to surface here anymore.

  // 4. templates-folder-populated
  {
    const templatesDir = p.templates;
    const required = ['extra-high.yml', 'high.yml', 'medium.yml', 'low.yml'];
    let allPresent = true;
    const missing: string[] = [];
    for (const file of required) {
      if (!(await pathExists(path.join(templatesDir, file)))) {
        allPresent = false;
        missing.push(file);
      }
    }
    out.push({
      category: 'Install',
      name: 'templates-folder-populated',
      status: allPresent ? 'pass' : 'warn',
      detail: allPresent ? undefined : `missing templates: ${missing.join(', ')}`,
    });
  }

  // 5. retired-properties-present
  {
    const orchYml = p.orchestrationYml;
    const found: string[] = [];
    try {
      const text = await fsP.readFile(orchYml, 'utf8');
      const parsed = parseYaml<Record<string, unknown>>(text);
      if (parsed && typeof parsed === 'object') {
        for (const key of RETIRED_KEYS) {
          const parts = key.split('.');
          const top = parts[0];
          const sub = parts[1];
          if (!top) continue;
          const topVal = (parsed as Record<string, unknown>)[top];
          if (sub) {
            if (topVal !== null && typeof topVal === 'object' && sub in (topVal as Record<string, unknown>)) {
              found.push(key);
            }
          } else {
            if (top in parsed) found.push(key);
          }
        }
      }
    } catch {
      // orchestration.yml absent or unreadable — no retired keys to report.
    }
    if (found.length > 0) {
      out.push({
        category: 'Install',
        name: 'retired-properties-present',
        status: 'warn',
        detail: `stale keys in orchestration.yml (safe to delete): ${found.join(', ')}`,
      });
    } else {
      out.push({
        category: 'Install',
        name: 'retired-properties-present',
        status: 'pass',
      });
    }
  }

  // 6. version-match — picks the first registered harness entry's version.
  {
    let versionStatus: CheckStatus = 'pass';
    let versionDetail: string | undefined;
    try {
      const ij = await readInstallJson(p.installJson);
      const installedVersion = Object.values(ij.harnesses)[0]?.version;
      if (typeof installedVersion !== 'string') {
        versionStatus = 'warn';
        versionDetail = 'install.json missing version';
      } else {
        const cliVersion = pkg.version;
        if (cliVersion) {
          const match = cmpSemver(cliVersion, installedVersion) === 0;
          versionStatus = match ? 'pass' : 'warn';
          versionDetail = match
            ? `${cliVersion}`
            : `CLI is ${cliVersion}, install.json reports ${installedVersion} — re-run \`radorch install\``;
        }
      }
    } catch {
      versionStatus = 'warn';
      versionDetail = 'install.json unreadable — run `radorch install`';
    }
    out.push({ category: 'Install', name: 'version-match', status: versionStatus, detail: versionDetail });
  }

  return out;
}


export async function runPluginChecks(opts: {
  root: string;
  localVersion: string;
  pluginRoot?: string;
  /**
   * Optional iter-01 (legacy npm-installed `radorch`) version, supplied by
   * callers that have already detected a parallel install. When omitted the
   * cross-install-version-skew check warns "iter-01 install not detected;
   * nothing to compare" rather than shelling out (NFR-8: filesystem-light).
   */
  iter01Version?: string;
}): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const p = installPaths(opts.root);

  // Precondition: the three plugin-specific checks (bundle-integrity,
  // plugin-skills-enumerable, plugin-agents-resolvable) are only meaningful
  // when the system is running inside the Claude Code plugin or when a plugin
  // install is registered. If neither signal is present, skip those three
  // checks entirely — they would degrade to noisy CLAUDE_PLUGIN_ROOT warnings
  // on every Copilot harness and every legacy-installer Claude install.
  const registeredReports = scanUserLevelHarnesses();
  const claudePluginRegistered = registeredReports.some(
    (r) => r.installKey === 'claude-plugin' && r.installed,
  );
  const runPluginSpecificChecks = opts.pluginRoot !== undefined || claudePluginRegistered;

  // Bundle integrity: probe the bundled CLI when CLAUDE_PLUGIN_ROOT is known.
  if (runPluginSpecificChecks) {
    if (opts.pluginRoot) {
      const bundle = path.join(
        opts.pluginRoot, 'skills', 'rad-orchestration', 'scripts', 'radorch.mjs',
      );
      const exists = await pathExists(bundle);
      out.push({
        category: 'Plugin',
        name: 'bundle-integrity',
        status: exists ? 'pass' : 'fail',
        detail: exists ? bundle : `missing ${bundle} — run \`npm run build:plugin\``,
      });
    } else {
      // Plugin registered in install.json but env var absent (e.g. running
      // doctor outside a Claude Code session) — warn that the bundle can't be
      // located without CLAUDE_PLUGIN_ROOT.
      out.push({
        category: 'Plugin',
        name: 'bundle-integrity',
        status: 'warn',
        detail: 'CLAUDE_PLUGIN_ROOT not set — bundle presence not verified',
      });
    }
  }
  // UI PID consistency
  const pidExists = await pathExists(p.uiPidFile);
  let pidStatus: CheckStatus = 'pass';
  let pidDetail: string | undefined;
  if (pidExists) {
    try {
      const fsModule = await import('node:fs/promises');
      const entry = JSON.parse(await fsModule.readFile(p.uiPidFile, 'utf8')) as { pid: number };
      try {
        process.kill(entry.pid, 0);
      } catch {
        pidStatus = 'warn';
        pidDetail = `stale PID ${entry.pid} in ${p.uiPidFile} — process is dead`;
      }
    } catch {
      pidStatus = 'warn';
      pidDetail = 'pid file present but unparseable';
    }
  }
  out.push({ category: 'Plugin', name: 'ui-pid-consistency', status: pidStatus, detail: pidDetail });
  // Version skew — reads the latest last_writer_version across v5 (top-level)
  // or v6 (max across all registered harness entries).
  let skewStatus: CheckStatus = 'pass';
  let skewDetail: string | undefined;
  if (await pathExists(p.installJson)) {
    const ij = await readInstallJson(p.installJson);
    const lastWriter = readLastWriterVersion(ij);
    if (!lastWriter) {
      skewStatus = 'pass';
      skewDetail = 'install.json has no last_writer_version (iter-01 install — skipping skew check)';
    } else if (cmpSemver(opts.localVersion, lastWriter) < 0) {
      skewStatus = 'fail';
      skewDetail = `state last written by ${lastWriter}; this CLI is ${opts.localVersion}`;
    }
  }
  out.push({ category: 'Plugin', name: 'version-skew', status: skewStatus, detail: skewDetail });
  // projects-base-path-readable (legacy check for workspace-relative projects dir)
  {
    const projectsDir = path.join(opts.root, 'projects');
    let detail: string | undefined;
    let status: CheckStatus = 'pass';
    try {
      await fsP.access(projectsDir, fsP.constants.R_OK);
      detail = projectsDir;
    } catch {
      status = 'fail';
      detail = `${projectsDir} is missing or unreadable`;
    }
    out.push({ category: 'Plugin', name: 'projects-base-path-readable', status, detail });
  }
  // plugin-skills-enumerable: every shipped skills/<name>/ folder must contain
  // a SKILL.md. Only runs when the plugin is active or registered.
  if (runPluginSpecificChecks) {
    if (opts.pluginRoot) {
      const skillsDir = path.join(opts.pluginRoot, 'skills');
      if (!(await pathExists(skillsDir))) {
        out.push({
          category: 'Plugin',
          name: 'plugin-skills-enumerable',
          status: 'warn',
          detail: 'skills/ directory missing under CLAUDE_PLUGIN_ROOT',
        });
      } else {
        const missing: string[] = [];
        for (const name of await fsP.readdir(skillsDir)) {
          const f = path.join(skillsDir, name, 'SKILL.md');
          if (!(await pathExists(f))) missing.push(name);
        }
        out.push({
          category: 'Plugin',
          name: 'plugin-skills-enumerable',
          status: missing.length === 0 ? 'pass' : 'fail',
          detail: missing.length === 0 ? undefined : `skills missing SKILL.md: ${missing.join(', ')}`,
        });
      }
    } else {
      // Plugin registered but env var absent — warn that skills can't be verified.
      out.push({
        category: 'Plugin',
        name: 'plugin-skills-enumerable',
        status: 'warn',
        detail: 'CLAUDE_PLUGIN_ROOT not set — skills not verifiable outside a plugin session',
      });
    }
  }
  // plugin-agents-resolvable: the plugin ships canonical agent files under
  // agents/. Only runs when the plugin is active or registered.
  if (runPluginSpecificChecks) {
    if (opts.pluginRoot) {
      const agentsDir = path.join(opts.pluginRoot, 'agents');
      const missing: string[] = [];
      if (!(await pathExists(agentsDir))) {
        missing.push('agents/ directory');
      } else {
        const entries = (await fsP.readdir(agentsDir)).filter((f) => f.endsWith('.md'));
        if (entries.length === 0) {
          missing.push('no .md agent files under agents/');
        } else {
          for (const f of entries) {
            try {
              await fsP.access(path.join(agentsDir, f), fsP.constants.R_OK);
            } catch {
              missing.push(f);
            }
          }
        }
      }
      out.push({
        category: 'Plugin',
        name: 'plugin-agents-resolvable',
        status: missing.length === 0 ? 'pass' : 'fail',
        detail: missing.length === 0 ? undefined : `missing or unreadable: ${missing.join(', ')}`,
      });
    } else {
      // Plugin registered but env var absent — warn that agents can't be verified.
      out.push({
        category: 'Plugin',
        name: 'plugin-agents-resolvable',
        status: 'warn',
        detail: 'CLAUDE_PLUGIN_ROOT not set — agents not verifiable outside a plugin session',
      });
    }
  }
  // cross-install-version-skew (FR-14, AD-12, NFR-8): warn when a parallel
  // iter-01 npm install of `radorch` reports a different version from the
  // plugin CLI. Detection is caller-supplied via `opts.iter01Version` to
  // keep this check filesystem-light — no shell-outs, no PATH walk.
  {
    let crossStatus: CheckStatus = 'warn';
    let crossDetail = 'iter-01 install not detected; nothing to compare';
    if (opts.iter01Version) {
      if (opts.iter01Version === opts.localVersion) {
        crossStatus = 'pass';
        crossDetail = `iter-01 install at ${opts.iter01Version} matches plugin CLI`;
      } else {
        crossStatus = 'warn';
        crossDetail = `iter-01 install reports ${opts.iter01Version}; plugin CLI is ${opts.localVersion}`;
      }
    }
    out.push({
      category: 'Plugin',
      name: 'cross-install-version-skew',
      status: crossStatus,
      detail: crossDetail,
    });
  }
  // multi-harness-install-table (DD-8 + Section 6): render per-install-key status
  // from the v6 registry at ~/.radorc/install.json. Each install-key emits one
  // line with `(channel)` suffix. When both `claude` and `claude-plugin` are
  // present, append an info line recommending consolidation.
  {
    const reports = registeredReports;
    const lines = reports.map((r) => {
      if (!r.installed) return `${r.installKey}: not installed`;
      const channel = r.channel ? ` (${r.channel})` : '';
      const ver = r.packageVersion ?? 'unknown';
      return `${r.installKey}: ${ver}${channel}`;
    });
    const hasClaude = reports.some((r) => r.installed && r.installKey === 'claude');
    const hasClaudePlugin = reports.some((r) => r.installed && r.installKey === 'claude-plugin');
    if (hasClaude && hasClaudePlugin) {
      lines.push('');
      lines.push('Both `claude` and `claude-plugin` are registered — they share ~/.claude/.');
      lines.push('The plugin is the recommended channel. To remove the legacy install,');
      lines.push('run `npx rad-orchestration uninstall`.');
    }
    out.push({
      category: 'Plugin',
      name: 'multi-harness-install-table',
      status: 'pass',
      detail: lines.join('\n'),
    });
  }
  return out;
}

export async function runRegistryHealthChecks(opts: { root: string }): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  let registry: ReturnType<typeof readRegistry>;
  try {
    registry = readRegistry({ root: opts.root });
  } catch (e) {
    out.push({
      category: 'Registry',
      name: 'registry-readable',
      status: 'fail',
      detail: (e as Error).message,
    });
    return out;
  }
  out.push({ category: 'Registry', name: 'registry-readable', status: 'pass' });

  // unbound-repos: repos without a local path entry
  const unboundNames = Object.keys(registry.repos).filter(
    (name) => !(name in registry.localPaths),
  );
  out.push({
    category: 'Registry',
    name: 'unbound-repos',
    status: unboundNames.length > 0 ? 'warn' : 'pass',
    detail: unboundNames.length > 0 ? `repos without local path: ${unboundNames.join(', ')}` : undefined,
  });

  // missing-local-clones: bound paths that no longer exist on disk
  const missingNames = Object.entries(registry.localPaths)
    .filter(([, localPath]) => !fs.existsSync(localPath))
    .map(([name]) => name);
  out.push({
    category: 'Registry',
    name: 'missing-local-clones',
    status: missingNames.length > 0 ? 'warn' : 'pass',
    detail: missingNames.length > 0 ? `missing local clones: ${missingNames.join(', ')}` : undefined,
  });

  return out;
}

type ToolingExec = (file: string, args: string[]) => { status: number; stdout: string; stderr: string; error?: NodeJS.ErrnoException };

interface AgentCheckSpec { name: 'claude' | 'copilot' | 'code'; bin: string; install: string }

function defaultToolingExec(file: string, args: string[]) {
  const r = spawnSync(file, args, { encoding: 'utf8', timeout: 1000, shell: false });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    error: r.error as NodeJS.ErrnoException | undefined,
  };
}

function agentsToCheck(reports: HarnessInstallReport[]): AgentCheckSpec[] {
  const installed = new Set(reports.filter((r) => r.installed).map((r) => r.installKey));
  const out: AgentCheckSpec[] = [];
  if (installed.has('claude') || installed.has('claude-plugin')) {
    out.push({ name: 'claude', bin: 'claude', install: 'install Claude Code (https://docs.anthropic.com/claude/claude-code)' });
  }
  if (installed.has('copilot-cli')) {
    out.push({ name: 'copilot', bin: 'copilot', install: 'install GitHub Copilot CLI (https://github.com/github/copilot-cli)' });
  }
  if (installed.has('copilot-vscode')) {
    out.push({ name: 'code', bin: 'code', install: 'install VS Code\'s `code` shim via the command palette: `Shell Command: Install \'code\' command in PATH`' });
  }
  return out;
}

export async function runToolingChecks(opts: { exec?: ToolingExec; harnessReports?: HarnessInstallReport[] } = {}): Promise<CheckResult[]> {
  const exec = opts.exec ?? defaultToolingExec;
  const reports = opts.harnessReports ?? scanUserLevelHarnesses();
  const out: CheckResult[] = [];

  // git probe
  const gitResult = exec('git', ['--version']);
  const gitMissing = gitResult.error?.code === 'ENOENT' || gitResult.status !== 0;
  if (gitMissing) {
    out.push({ category: 'Tooling', name: 'git', status: 'fail', detail: 'git not on PATH — install git and re-run doctor' });
  } else {
    const m = gitResult.stdout.match(/git version (\S+)/);
    out.push({ category: 'Tooling', name: 'git', status: 'pass', detail: m ? `git ${m[1]}` : 'git present' });
  }

  // gh binary probe
  const ghBinary = exec('gh', ['--version']);
  const ghMissing = ghBinary.error?.code === 'ENOENT' || ghBinary.status !== 0;
  if (ghMissing) {
    out.push({ category: 'Tooling', name: 'gh', status: 'fail', detail: 'gh not on PATH — install GitHub CLI and run `gh auth login`' });
  } else {
    const ghAuth = exec('gh', ['auth', 'status']);
    if (ghAuth.status === 0) {
      out.push({ category: 'Tooling', name: 'gh', status: 'pass', detail: 'gh authenticated' });
    } else {
      out.push({
        category: 'Tooling',
        name: 'gh',
        status: 'fail',
        detail: ghAuth.stderr.trim() || 'gh present but not logged in — run `gh auth login`',
      });
    }
  }

  // Conditional agent CLI probes
  for (const spec of agentsToCheck(reports)) {
    const r = exec(spec.bin, ['--version']);
    const missing = r.error?.code === 'ENOENT' || r.status !== 0;
    if (missing) {
      out.push({ category: 'Tooling', name: spec.name, status: 'fail', detail: `${spec.bin} not on PATH — ${spec.install}` });
    } else {
      const v = r.stdout.trim().split('\n')[0] ?? '';
      out.push({ category: 'Tooling', name: spec.name, status: 'pass', detail: v || `${spec.bin} present` });
    }
  }

  return out;
}
