---
project: RAD-MASTER-BENCH-V2
phase: 1
task: 2
title: Wire entrypoint and zero-dependency manifest
status: pending
complexity: simple
repos:
  - RAD-MASTER-BENCH-V2
created: '2026-06-30T02:40:09.823Z'
type: task_handoff
---

# P01-T02: Wire entrypoint and zero-dependency manifest

Wrap the pure renderer in the runnable CLI: a one-shot `index.js` that prints the banner once
and exits cleanly, and a `package.json` that declares a modern Node baseline, an empty runtime
dependency surface, and the `start`/`test` scripts. Once it lands, `npm start` and `node
index.js` both produce the banner and `npm test` runs the renderer test.

**Task type:** code
**Complexity:** simple
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `index.js` (the sole stdout boundary — calls `renderBanner()` and prints).
- Create: `package.json` (manifest: empty runtime deps, `engines`, `start`/`test` scripts).

**The change**
- `index.js` is a thin I/O wrapper over the pure renderer:
  ```js
  const { renderBanner } = require('./renderer');
  process.stdout.write(renderBanner());
  // no explicit process.exit() — the process exits 0 once the event loop drains
  ```
  It ignores `process.argv` entirely (extra arguments raise no error), reads no stdin, and is
  the only place in the project that writes to stdout — keeping the renderer pure and testable.
- **Do not call `process.exit(0)` immediately after the write.** `process.exit()` can terminate
  before `process.stdout` flushes when stdout is a pipe or a redirected file, truncating the
  banner; a clean run already exits 0 when the event loop drains. If an explicit exit is ever
  needed, put it in the write callback — `process.stdout.write(renderBanner(), () => process.exit(0))` —
  or set `process.exitCode = 0` instead.
- `package.json` shape:
  ```json
  {
    "name": "rad-master-bench-v2",
    "version": "1.0.0",
    "private": true,
    "engines": { "node": ">=18" },
    "scripts": { "start": "node index.js", "test": "node --test" },
    "dependencies": {}
  }
  ```
  `dependencies` stays empty (Node built-ins only); `start` makes `npm start` equivalent to
  `node index.js`; `test` runs the built-in runner so the renderer test executes with no
  runtime or dev dependency installed.
- **The seam to get right:** all stdout stays in `index.js` — don't move printing into the
  renderer, and don't add flag parsing or an arg-validation branch (R3 is explicitly
  argument-agnostic).

**Done when**
- `node index.js` and `npm start` each print the rainbow banner exactly once and exit with
  status 0.
- `node index.js --anything extra` prints the same banner and exits 0 with no error.
- `package.json` has an empty `dependencies` block and `engines.node` of `>=18`, and
  `npm test` invokes the built-in test runner.

**Testing**
- No new automated test here — the entrypoint is a thin wrapper and the renderer is already
  covered by T01. A manual `node index.js` / `npm start` smoke check confirms the one-shot
  print-and-exit.
- Skip a stdout-capture test that re-asserts the full banner string — it would only duplicate
  T01's renderer assertions against brittle exact output.

## Execution Notes

_(none yet — appended at runtime)_
