// harness-installers/standard/lib/install/claude-hook-settings.js —
// Surgical, marker-tagged merge of the preamble hook into Claude's user-owned
// settings.json on install, and removal of exactly that marked entry on
// uninstall, leaving all other user settings intact.
//
// The stable marker substring "rad-orc-preamble" is embedded in the hook
// command string so that idempotency checks and removal can locate the entry
// without any extra metadata field.
//
// Exports:
//   - mergePreambleHook({ settingsPath, hookCommand })
//       Reads settings.json (treating a missing file as {}; throws on malformed), ensures
//       hooks.SessionStart is an array, and inserts a single SessionStart
//       entry whose command carries the "rad-orc-preamble" marker.  Idempotent:
//       skips when a marked entry already exists.  Preserves every other key.
//       Writes atomically via tmp+rename (NFR-2 pattern, AD-9).
//
//   - removePreambleHook({ settingsPath })
//       Filters out exactly the marked entry from hooks.SessionStart, leaving
//       all other SessionStart entries and all other settings untouched.
//       Writes atomically via tmp+rename (NFR-2 pattern, AD-9).
//
//   - reconcileTelemetryHooks({ settingsPath, hookCommand })
//       Adds / refreshes the three telemetry hook entries (PostToolUse, Stop,
//       SessionEnd) tagged with the "rad-orc-telemetry" marker.  Idempotent;
//       never touches the preamble (AD-7, FR-8, NFR-3, NFR-5).
//
//   - removeTelemetryHooks({ settingsPath })
//       Removes exactly the telemetry-marked entries from the 3 event arrays;
//       never touches the preamble or any other entry (NFR-3).

import fs from 'node:fs';
import path from 'node:path';

/** Stable marker substring embedded in the hook command (AD-9). */
const MARKER = 'rad-orc-preamble';

/**
 * Read settings.json at `settingsPath`.  Returns `{}` when the file is
 * missing (lazy creation is safe).  Throws when the file exists but cannot be
 * read or parsed — preserving the user's file rather than silently overwriting
 * it with a default.
 *
 * @param {string} settingsPath
 * @returns {object}
 * @throws {Error} when the file exists but is unreadable or contains malformed JSON
 */
function readSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return {};
  let text;
  try {
    text = fs.readFileSync(settingsPath, 'utf8');
  } catch (err) {
    throw new Error(
      `Cannot read settings file "${settingsPath}": ${err.message}`,
    );
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Cannot parse settings file "${settingsPath}" as JSON: ${err.message}. ` +
        'Fix or remove the file before re-running.',
    );
  }
}

/**
 * Atomic write: serialize → temp file → rename (NFR-2, AD-9).
 *
 * @param {string} settingsPath
 * @param {object} value
 */
function writeSettings(settingsPath, value) {
  const content = JSON.stringify(value, null, 2) + '\n';
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tmp = `${settingsPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, settingsPath);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

/**
 * Returns true when the given SessionStart group entry carries the stable
 * "rad-orc-preamble" marker in any of its hook commands.
 *
 * @param {object} entry  — a SessionStart group object
 * @returns {boolean}
 */
function isMarkedEntry(entry) {
  if (!entry || !Array.isArray(entry.hooks)) return false;
  return entry.hooks.some(
    (h) => typeof h.command === 'string' && h.command.includes(MARKER),
  );
}

/**
 * Build the SessionStart group entry for the preamble hook.
 * The hookCommand is embedded verbatim; the MARKER is appended as a
 * comment-style suffix so the entry is always identifiable.
 *
 * Claude's settings.json SessionStart hook format:
 *   { hooks: [ { type: 'command', command: '<cmd>' } ] }
 *
 * @param {string} hookCommand
 * @returns {object}
 */
function buildMarkedEntry(hookCommand) {
  return {
    hooks: [
      {
        type: 'command',
        command: `${hookCommand} # ${MARKER}`,
      },
    ],
  };
}

/**
 * Merge the preamble hook into Claude's settings.json (FR-18, AD-9, AD-10).
 *
 * - Reads the file at `settingsPath` (treats missing as `{}`; throws on malformed).
 * - Ensures `hooks.SessionStart` is an array.
 * - Inserts a single marked entry when none exists (idempotent).
 * - Preserves every other key and every other SessionStart entry.
 * - Writes atomically via tmp+rename (NFR-2).
 *
 * @param {{ settingsPath: string, hookCommand: string }} opts
 */
export function mergePreambleHook({ settingsPath, hookCommand }) {
  const settings = readSettings(settingsPath);

  // Ensure the hooks namespace and SessionStart array exist.
  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }
  if (!Array.isArray(settings.hooks.SessionStart)) {
    settings.hooks.SessionStart = [];
  }

  // Idempotency guard — skip if a marked entry already exists.
  if (settings.hooks.SessionStart.some(isMarkedEntry)) {
    return;
  }

  settings.hooks.SessionStart.push(buildMarkedEntry(hookCommand));
  writeSettings(settingsPath, settings);
}

/**
 * Remove the marked preamble hook entry from Claude's settings.json (FR-18,
 * AD-9).
 *
 * - Reads the file at `settingsPath`.  No-ops when the file is absent; throws on malformed.
 * - Filters out exactly the marked entry from `hooks.SessionStart`.
 * - Leaves all other SessionStart entries and all other settings untouched.
 * - Writes atomically via tmp+rename (NFR-2).
 *
 * @param {{ settingsPath: string }} opts
 */
export function removePreambleHook({ settingsPath }) {
  const settings = readSettings(settingsPath);

  if (
    !settings.hooks ||
    !Array.isArray(settings.hooks.SessionStart)
  ) {
    return;
  }

  const before = settings.hooks.SessionStart.length;
  settings.hooks.SessionStart = settings.hooks.SessionStart.filter(
    (entry) => !isMarkedEntry(entry),
  );

  // Only write back when something was actually removed.
  if (settings.hooks.SessionStart.length !== before) {
    writeSettings(settingsPath, settings);
  }
}

// ---------------------------------------------------------------------------
// Telemetry hook reconciliation (FR-1, FR-8, NFR-3, NFR-5, AD-1, AD-3, AD-7)
// ---------------------------------------------------------------------------

/** Stable marker for the telemetry hook set — distinct from the preamble marker (AD-7). */
const TELEMETRY_MARKER = 'rad-orc-telemetry';
const TELEMETRY_EVENTS = ['PostToolUse', 'Stop', 'SessionEnd'];

function isTelemetryEntry(entry) {
  return !!entry && Array.isArray(entry.hooks)
    && entry.hooks.some((h) => typeof h.command === 'string' && h.command.includes(TELEMETRY_MARKER));
}

function buildTelemetryEntry(event, hookCommand) {
  const entry = { hooks: [{ type: 'command', command: `${hookCommand} # ${TELEMETRY_MARKER}` }] };
  if (event === 'PostToolUse') entry.matcher = 'Agent';   // per-event matcher (AD-7)
  return entry;
}

/**
 * Reconcile the telemetry hook set to the desired state — add / refresh / leave (FR-8, NFR-5).
 *
 * - Adds the three telemetry hook entries (PostToolUse, Stop, SessionEnd) when absent.
 * - Refreshes in-place when the hookCommand has changed.
 * - De-duplicates: collapses any extra telemetry-marked entries for an event down
 *   to a single desired entry, so a manually-edited or older buggy settings file
 *   self-heals to exactly one telemetry hook per event (NFR-5).
 * - No-ops when the entries already match the desired state (idempotent).
 * - Never touches the preamble or any other hook entry (NFR-3).
 *
 * @param {{ settingsPath: string, hookCommand: string }} opts
 */
export function reconcileTelemetryHooks({ settingsPath, hookCommand }) {
  const settings = readSettings(settingsPath);
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};
  let changed = false;
  for (const event of TELEMETRY_EVENTS) {
    if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = [];
    const arr = settings.hooks[event];
    const desired = buildTelemetryEntry(event, hookCommand);
    const idxs = arr.reduce((acc, e, i) => (isTelemetryEntry(e) ? (acc.push(i), acc) : acc), []);
    if (idxs.length === 0) {
      arr.push(desired); changed = true;                                         // add
    } else {
      if (JSON.stringify(arr[idxs[0]]) !== JSON.stringify(desired)) {            // refresh first
        arr[idxs[0]] = desired; changed = true;
      }
      for (let k = idxs.length - 1; k >= 1; k--) {                              // de-dup extras
        arr.splice(idxs[k], 1); changed = true;
      }
    }
  }
  if (changed) writeSettings(settingsPath, settings);
}

/**
 * Remove exactly the telemetry entries across the 3 arrays; never touch the preamble (NFR-3).
 *
 * - Filters out telemetry-marked entries from PostToolUse, Stop, SessionEnd.
 * - Deletes the event array entirely when it held only telemetry (tidy).
 * - Leaves the preamble (SessionStart) and all other hook entries untouched.
 *
 * @param {{ settingsPath: string }} opts
 */
export function removeTelemetryHooks({ settingsPath }) {
  const settings = readSettings(settingsPath);
  if (!settings.hooks || typeof settings.hooks !== 'object') return;
  let changed = false;
  for (const event of TELEMETRY_EVENTS) {
    const arr = settings.hooks[event];
    if (!Array.isArray(arr)) continue;
    const kept = arr.filter((e) => !isTelemetryEntry(e));
    if (kept.length !== arr.length) changed = true;
    if (kept.length === 0) delete settings.hooks[event];   // tidy an array that held only telemetry
    else settings.hooks[event] = kept;
  }
  if (changed) writeSettings(settingsPath, settings);
}
