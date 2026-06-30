---
project: RAD-MASTER-BENCH-V2
phase: 1
task: 2
title: Wire the run-once CLI entrypoint and zero-dependency manifest
status: pending
complexity: simple
repos:
  - RAD-MASTER-BENCH-V2
created: '2026-06-30T03:36:53.924Z'
type: task_handoff
---

# P01-T02: Wire the run-once CLI entrypoint and zero-dependency manifest

The thin shell around the renderer: an entrypoint that prints the banner exactly once and exits
cleanly, and a `package.json` that declares the zero-dependency, modern-Node posture and the
`start`/`test` scripts. When it lands, `node index.js` and `npm start` both print the banner, and
`npm test` runs the T01 test — the project is runnable and verifiable from a clean clone.

**Task type:** code
**Complexity:** simple
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `index.js` (the sole I/O boundary — imports `renderBanner` from `renderer.js`, writes
  the result to stdout once, exits 0).
- Create: `package.json` (empty runtime `dependencies`, `engines.node`, `start`/`test` scripts;
  module type consistent with the `import`/`export` style chosen in T01).

**The change**
- `index.js` is intentionally tiny — call the pure function and print:
  ```js
  import { renderBanner } from "./renderer.js";
  process.stdout.write(renderBanner());
  // run-once: no loop, no stdin read, no arg parsing; falls off the end → exit 0
  ```
  Ignore any command-line arguments and read no stdin; extra args must not raise an error.
  Do not append an extra newline here — `renderBanner()` already ends with exactly one.
- `package.json` contract:
  ```json
  {
    "name": "rad-master-bench-v2",
    "version": "1.0.0",
    "type": "module",
    "engines": { "node": ">=18" },
    "scripts": { "start": "node index.js", "test": "node --test" },
    "dependencies": {}
  }
  ```
  `dependencies` is empty (built-ins only); any tooling would live in `devDependencies`.
  `"type": "module"` is required because T01 ships ESM (`export`/`renderBanner` is imported via
  `import` above) — without it `node index.js` throws `SyntaxError: Cannot use import statement
  outside a module`. Keep the manifest and the source module style consistent: ESM source ↔
  `"type": "module"`.
- **The seam to get right:** the `test` script must discover T01's `renderer.test.js`. `node --test`
  auto-discovers `*.test.js` files, so the filename from T01 and this script are the contract —
  if T01 named the test differently, the glob must still match. And `engines.node >= 18` is what
  makes `node --test` available, so the baseline and the script agree.

**Done when**
- `node index.js` prints the rainbow banner exactly once and exits with status 0; passing extra
  arguments changes nothing and raises no error.
- `npm start` is equivalent to `node index.js`; `npm test` runs the renderer unit test and passes.
- `package.json` has an empty `dependencies` block and declares `engines.node >= 18`.

**Testing**
- No new test file — this task is exercised by T01's unit test running through the `npm test`
  script and by the manual run-once acceptance above (`node index.js` → banner, exit 0).
- Skip asserting the manifest's static field values in a test; they're config, verified by the
  scripts actually running, not by snapshotting JSON.

## Execution Notes

_(none yet — appended at runtime)_
