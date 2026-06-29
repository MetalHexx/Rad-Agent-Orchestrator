---
project: RAD-MASTER-BENCH-V1
phase: 1
task: 2
title: Wire CLI entrypoint and package manifest
status: pending
requirement_tags:
  - FR-4
  - FR-5
  - FR-6
  - NFR-1
  - NFR-2
  - NFR-3
  - NFR-4
  - AD-3
  - AD-4
  - AD-5
repos:
  - RAD-MASTER-BENCH-V1
author: explosion-script
created: '2026-06-29T20:07:42.211Z'
type: task_handoff
---

# P01-T02: Wire CLI entrypoint and package manifest

Establishes the runnable surface: an entrypoint that is the sole writer to standard output, printing the banner once and exiting cleanly while ignoring arguments and stdin, plus a package manifest that wires `npm start`/`npm test`, declares the Node 18+ engine, and keeps runtime dependencies empty. An integration test drives the CLI as a child process to confirm the behavior end-to-end.

**Task type:** code
**Requirements:** FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-4, AD-3, AD-4, AD-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `index.js`
- Create: `package.json`
- Test: `test/cli.test.js`

- [ ] **Step 1: Write the failing CLI integration test (FR-4, FR-5, NFR-3)**
Create `test/cli.test.js`. It spawns the entrypoint as a child process with extra arguments to prove they are ignored (FR-5), asserts the run exits with status 0 (`execFileSync` throws on any non-zero exit, so reaching the assertions proves exit 0) and printed the banner once with the expected row count (FR-4), and asserts the output carries the ANSI CSI introducer so it renders on a modern terminal (NFR-3).

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ENTRY = path.join(__dirname, '..', 'index.js');
const CSI = String.fromCharCode(27) + '[';

test('prints the banner once and exits 0, even with extra arguments', () => {
  const output = execFileSync(process.execPath, [ENTRY, '--unused', 'extra'], {
    encoding: 'utf8',
  });
  const rows = output.split('\n').filter((line) => line.length > 0);
  assert.strictEqual(rows.length, 5);
  assert.ok(output.includes(CSI));
});
```

- [ ] **Step 2: Run the test, confirm it fails**
Run: `node --test test/cli.test.js`
Expected: FAIL — `index.js` does not exist yet, so the spawned process errors with `Cannot find module`, exits non-zero, and `execFileSync` throws (FR-4, AD-5).

- [ ] **Step 3: Implement the entrypoint and package manifest (FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-4, AD-3, AD-4, AD-5)**
Create `index.js` exactly as below: it requires the renderer module and is the only place that writes to standard output (AD-3, AD-5), writing the banner exactly once. It reads no arguments and no stdin (FR-5); with nothing keeping the event loop alive, the process exits naturally and effectively instantly with status 0 (FR-4, NFR-4).

```js
'use strict';

const { renderBanner } = require('./banner.js');

// The entrypoint is the only place that performs I/O. Command-line arguments
// and stdin are ignored; the banner is written exactly once and the process
// exits naturally with status 0.
process.stdout.write(renderBanner());
```

Then create `package.json` exactly as below: a `start` script makes `npm start` equivalent to `node index.js` (FR-6), a `test` script runs the Node built-in test runner (AD-4), `engines.node` declares the Node 18+ LTS baseline (NFR-2), and `dependencies` is empty with no `devDependencies` because the test runner is built in (NFR-1).

```json
{
  "name": "rad-master-bench-v1",
  "version": "1.0.0",
  "description": "Prints HELLO WORLD as large rainbow ASCII-art letters.",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "test": "node --test"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {},
  "license": "MIT"
}
```

- [ ] **Step 4: Run the test suite, confirm it passes**
Run: `npm test`
Expected: PASS — `node --test` discovers and passes both `test/cli.test.js` and `test/banner.test.js`, proving the CLI prints the banner once and exits 0 with arguments ignored (FR-4, FR-5) and the `test` script is correctly wired (AD-4). Also run `npm start` and confirm it prints the colored banner exactly once and returns to the prompt (FR-6, NFR-3).
