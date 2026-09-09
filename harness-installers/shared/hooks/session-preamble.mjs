// session-preamble.mjs — Shared preamble hook shim.
// Runs the bundled CLI's `session-context` subcommand, parses the canonical
// envelope { ok, data, error }, and returns an additionalContext payload for
// the harness session-start hook contract.
//
// Resolves radorch.mjs two ways (AD-10):
//   1. Plugin delivery: ${CLAUDE_PLUGIN_ROOT|COPILOT_PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs
//   2. Standard delivery: <harnessRoot>/skills/rad-orchestration/scripts/radorch.mjs
//      where <harnessRoot> is derived from this hook file's own location (../ from hooks/).
// Copilot CLI launches the hook with COPILOT_PLUGIN_ROOT set (not
// CLAUDE_PLUGIN_ROOT), so both env vars are honored (FR-16).
//
// On ok:true  → additionalContext carries data.preamble (FR-16, FR-17)
// On ok:false, non-zero status, or unparseable stdout → clear notice that
//   ambient awareness did not load; never throws (FR-16, FR-17).
//
// Authored once here; consumed by both plugin and standard delivery (AD-8).

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const NOTICE_PREFIX = 'rad-orchestration ambient awareness did not load';

export function resolveRadorch() {
  // CLAUDE_PLUGIN_ROOT (Claude / Copilot-VSCode harnesses) or COPILOT_PLUGIN_ROOT
  // (Copilot CLI harness) — both place radorch.mjs under the same plugin layout.
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? process.env.COPILOT_PLUGIN_ROOT;
  if (pluginRoot) {
    return path.join(pluginRoot, 'skills', 'rad-orchestration', 'scripts', 'radorch.mjs');
  }
  // Standard-install: hook ships at <harnessRoot>/hooks/session-preamble.mjs.
  // Derive <harnessRoot> from this file's own location (one level up from
  // hooks/) so the same hook works under any harness root (e.g. ~/.copilot or
  // ~/.claude).
  const hookDir = path.dirname(fileURLToPath(import.meta.url));
  const harnessRoot = path.resolve(hookDir, '..');
  return path.join(harnessRoot, 'skills', 'rad-orchestration', 'scripts', 'radorch.mjs');
}

/** Coerces a possibly-absent, possibly-wrong-typed field to a string, defaulting to ''. */
function asIdentityString(v) {
  return typeof v === 'string' ? v : '';
}

/**
 * Pure, injectable parser for the session-start hook payload delivered on stdin.
 * Never throws. Unparseable / absent stdin, a non-object top-level value (e.g. a
 * bare `null` or number), and non-string identity fields all degrade to empty
 * strings rather than throwing or leaking a non-string into the downstream
 * `spawnSync` argv.
 *
 * @param {string} stdin
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ sessionId: string, cwd: string, harness: 'claude' | 'copilot' }}
 */
export function parseSessionIdentity(stdin, env = process.env) {
  let p;
  try { p = JSON.parse(stdin || '{}'); } catch { p = {}; }
  if (typeof p !== 'object' || p === null) p = {};
  const sessionId = asIdentityString(p.session_id) || asIdentityString(p.sessionId);
  const cwd = asIdentityString(p.cwd);
  let harness = 'claude';
  if (env.COPILOT_CLI === '1') harness = 'copilot';
  else if (env.COPILOT_PLUGIN_ROOT && !env.CLAUDE_PLUGIN_ROOT) harness = 'copilot';
  return { sessionId, cwd, harness };
}

function defaultRun() {
  try {
    const radorch = resolveRadorch();
    let stdin = '';
    if (!process.stdin.isTTY) {
      try { stdin = fs.readFileSync(0, 'utf8'); } catch { stdin = ''; }
    }
    const { sessionId, cwd, harness } = parseSessionIdentity(stdin);
    const args = ['session-context'];
    const push = (flag, val) => { if (val) args.push(flag, val); };
    push('--session', sessionId);
    push('--cwd', cwd);
    push('--harness', harness);
    return spawnSync(process.execPath, [radorch, ...args], { encoding: 'utf8' });
  } catch (err) {
    return { status: 1, stdout: '' };
  }
}

/**
 * Pure function: accepts an injectable { run } for testability.
 * `run` defaults to spawning the bundled CLI's `session-context` subcommand.
 * Returns { additionalContext: string }.
 *
 * @param {{ run?: () => { status: number, stdout: string } }} [opts]
 * @returns {{ additionalContext: string }}
 */
export function buildHookOutput(opts = {}) {
  const run = opts.run ?? defaultRun;
  try {
    const result = run();
    if (result.status !== 0) {
      // Try to extract error message from the envelope even on non-zero exit
      let detail = '';
      try {
        const parsed = JSON.parse(result.stdout);
        if (parsed?.error?.message) detail = ` — ${parsed.error.message}`;
      } catch { /* unparseable; no detail */ }
      return { additionalContext: `${NOTICE_PREFIX}${detail}.` };
    }
    let envelope;
    try {
      envelope = JSON.parse(result.stdout);
    } catch {
      return { additionalContext: `${NOTICE_PREFIX} (could not parse CLI output).` };
    }
    if (!envelope?.ok) {
      const detail = envelope?.error?.message ? ` — ${envelope.error.message}` : '';
      return { additionalContext: `${NOTICE_PREFIX}${detail}.` };
    }
    return { additionalContext: envelope.data.preamble };
  } catch {
    return { additionalContext: `${NOTICE_PREFIX}.` };
  }
}

/**
 * Serializes the hook output for stdout, mirroring the existing SessionStart
 * drift-check hook: the raw context text is written straight to stdout, where
 * the harness injects it as conversation context (the `additionalContext`
 * channel — see the harness context-channel contract). Returns the exact
 * string the main-execution block writes.
 *
 * @param {{ additionalContext: string }} out
 * @returns {string}
 */
export function emitHookResult(out) {
  return out?.additionalContext ?? '';
}

/**
 * Serialize the hook's additionalContext for stdout in the shape the *current
 * harness* injects as session-start context. Each runtime has its own contract
 * (see docs/research/copilot-cli-hooks.md and docs/research/copilot-vscode-hooks.md):
 *   - Copilot CLI (sets COPILOT_CLI=1): a JSON object with a BARE top-level
 *     `additionalContext` string; raw stdout is discarded for every event.
 *   - Copilot in VS Code: stdout is parsed as JSON and context is injected ONLY
 *     from the NESTED `hookSpecificOutput.additionalContext` field; raw stdout is
 *     silently dropped.
 *   - Claude Code: injects raw stdout OR the nested shape — it accepts nested too.
 * Because VS Code *requires* the nested shape and Claude Code *accepts* it, the
 * non-CLI branch emits nested — there is no need to distinguish VS Code from
 * Claude Code (unreliable: both set CLAUDE_PLUGIN_ROOT, and VSCODE_PID is present
 * whenever Claude runs in a VS Code terminal). Returns '' for empty text.
 *
 * @param {string} text
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function serializeForStdout(text, env = process.env) {
  if (!text) return '';
  if (env.COPILOT_CLI === '1') return JSON.stringify({ additionalContext: text });
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } });
}

// Main-execution block: fires when this module is the session-start hook entry —
// either run directly (`node .../session-preamble.mjs` → argv[1] === self) OR
// dynamically imported with no entry script (`node -e "import(...)"` → argv[1]
// undefined, the Claude/Copilot-VSCode hooks.json launch form, which wraps the
// import so the Windows CLAUDE_PLUGIN_ROOT `/c/`→`C:` fixup can run first).
// Stays silent when a test imports the module (argv[1] is the test file, ≠ self).
// Soft-failing by contract — it must never throw and never block session start.
if (!process.argv[1] || fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const out = buildHookOutput();
    const payload = serializeForStdout(emitHookResult(out));
    if (payload) process.stdout.write(payload);
  } catch {
    /* never throw from the hook entry point */
  }
}
