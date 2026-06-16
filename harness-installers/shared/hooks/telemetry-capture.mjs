#!/usr/bin/env node
// telemetry-capture.mjs — stdin-reading hook shim. Built-ins only.
// Gate is checked FIRST (default-off, AD-4/AD-5). Synchronous, hard-timeout
// bounded spawn (AD-6). Never throws; always exit 0 (NFR-1).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CAPTURE_TIMEOUT_MS = 10_000;
const HOOK_EVENTS = ['PostToolUse', 'Stop', 'SessionEnd', 'SubagentStop', 'SubagentStart', 'PreToolUse'];

// Built-ins-only parity of the CLI's readTelemetryEnabled (default-off): no YAML dep (AD-4, NFR-2).
export function readTelemetryEnabled(root) {
  let text;
  try { text = fs.readFileSync(path.join(root, 'orchestration.yml'), 'utf8'); }
  catch { return false; }                                   // missing file ⇒ off
  let inTelemetry = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) inTelemetry = /^telemetry\s*:/.test(line);   // top-level key boundary
    if (inTelemetry) {
      const m = line.match(/^\s+enabled\s*:\s*(true|false)\b/);
      if (m) return m[1] === 'true';
    }
  }
  return false;                                             // absent / malformed ⇒ off
}

export function parseHookEvent(stdin) {
  let p = {};
  try { p = JSON.parse(stdin || '{}'); } catch { p = {}; }
  const tr = (p.tool_response && typeof p.tool_response === 'object') ? p.tool_response : {};
  const raw = p.hook_event_name || p.hookEventName || '';
  return {
    event: HOOK_EVENTS.includes(raw) ? raw : 'Stop',
    sessionId: p.session_id || '',
    cwd: p.cwd || '',
    transcriptPath: p.transcript_path || '',
    toolName: p.tool_name || '',
    // Claude Code 2.1.178 delivers subagent identity on PostToolUse as camelCase
    // under tool_response (agentId/agentType), with tool_use_id top-level and no
    // agent_transcript_path. Accept both shapes; snake_case kept for back-compat.
    agentTranscriptPath: p.agent_transcript_path || tr.agent_transcript_path || tr.agentTranscriptPath || '',
    agentId: p.agent_id || tr.agent_id || p.agentId || tr.agentId || '',
    agentType: p.agent_type || tr.agent_type || p.agentType || tr.agentType || '',
    toolUseId: p.tool_use_id || tr.tool_use_id || p.toolUseId || '',
  };
}

export function toCaptureArgs(evt) {
  const args = ['telemetry', 'capture', '--event', evt.event];
  const push = (flag, val) => { if (val) args.push(flag, val); };
  push('--session', evt.sessionId);
  push('--cwd', evt.cwd);
  push('--transcript-path', evt.transcriptPath);
  push('--tool-name', evt.toolName);
  push('--agent-transcript-path', evt.agentTranscriptPath);
  push('--agent-id', evt.agentId);
  push('--agent-type', evt.agentType);
  push('--tool-use-id', evt.toolUseId);
  return args;
}

function resolveRadorch() {
  const root = process.env.CLAUDE_PLUGIN_ROOT || process.env.COPILOT_PLUGIN_ROOT;
  if (root) return path.join(root, 'skills', 'rad-orchestration', 'scripts', 'radorch.mjs');
  const here = path.dirname(fileURLToPath(import.meta.url));            // .../hooks
  return path.join(here, '..', 'skills', 'rad-orchestration', 'scripts', 'radorch.mjs');
}

function main() {
  try {
    if (!readTelemetryEnabled(path.join(os.homedir(), '.radorc'))) return;   // gate FIRST
    let stdin = '';
    try { stdin = fs.readFileSync(0, 'utf8'); } catch { stdin = ''; }
    const args = toCaptureArgs(parseHookEvent(stdin));
    spawnSync(process.execPath, [resolveRadorch(), ...args], {
      timeout: CAPTURE_TIMEOUT_MS, killSignal: 'SIGKILL', stdio: 'ignore',
    });
  } catch { /* swallow — telemetry must never disturb a session (NFR-1) */ }
}

// Run when launched directly (`node "shim.mjs"` → argv[1] is the shim) OR via the plugin's
// `node -e "import(...telemetry-capture.mjs)"` form, where argv[1] is undefined. Stay inert
// when imported by tests (argv[1] is the test file, ≠ shim). Mirrors session-preamble.mjs.
const direct = !process.argv[1] || import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) { try { main(); } finally { process.exit(0); } }
