---
project: RAD-MASTER-BENCH-V2
phase: 1
task: 2
title: Wire the entrypoint and zero-dependency package
status: pending
complexity: simple
repos:
  - RAD-MASTER-BENCH-V2
created: '2026-06-30T03:45:17.207Z'
type: task_handoff
---

# P01-T02: Wire the entrypoint and zero-dependency package

Add the thin I/O boundary and the package manifest around the renderer: an entrypoint
that prints the banner exactly once and exits cleanly, and a `package.json` that pins
the zero-dependency, modern-Node posture with `start`/`test` scripts. Once this lands the
project is a runnable, installable command.

**Task type:** code
**Complexity:** simple
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `index.js` (the entrypoint — the only place that writes to stdout).
- Create: `package.json` (manifest: empty runtime deps, `engines`, `start`/`test`
  scripts).

**The change**
- `index.js`: require the renderer and write its banner to stdout once, then let the
  process exit 0 naturally:
  ```js
  const { renderBanner } = require('./renderer');
  process.stdout.write(renderBanner());
  ```
  It must ignore any command-line arguments and read no stdin — extra args raise no
  error and behavior is identical regardless of invocation. No explicit non-zero exit.
- `package.json`: CommonJS; `"dependencies": {}` (empty — Node built-ins only);
  `"engines": { "node": ">=18" }`; scripts `"start": "node index.js"` and
  `"test": "node --test"`. `node:test`/`node:assert` are built-ins, so no
  `devDependencies` are required.
- **The seam to get right:** `npm start` must be equivalent to `node index.js`, and the
  entrypoint is the *sole* stdout boundary — do not move any rendering or printing logic
  back into the renderer module.

**Done when**
- `node index.js` prints the full rainbow banner exactly once and exits with status 0.
- `npm start` produces identical output to `node index.js`.
- Passing extra arguments (e.g. `node index.js --whatever`) changes nothing and raises
  no error.
- `package.json` has an empty `dependencies` block and declares `engines.node >= 18`.

**Testing**
- No new automated test is warranted here beyond the renderer test from T01; the
  entrypoint is a one-line I/O shim. Manually verify `node index.js` and `npm start` both
  print the banner once and exit 0, and that `npm test` runs the renderer test green.
- Skip a test that captures process stdout to re-assert the banner bytes — it would only
  duplicate the renderer test against a brittle snapshot.

## Execution Notes

_(none yet — appended at runtime)_
