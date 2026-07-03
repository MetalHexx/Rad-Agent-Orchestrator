---
project: RAD-PLAN-BENCH
phase: 2
task: 1
title: Wire CLI entrypoint and npm scripts
status: pending
requirement_tags:
  - FR-4
  - FR-5
  - FR-6
  - NFR-1
  - NFR-2
  - NFR-4
  - AD-3
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:56:44.089Z'
type: task_handoff
---

# P02-T01: Wire CLI entrypoint and npm scripts

Establishes `index.js` as the run-once entrypoint that prints the rendered banner and exits cleanly, plus the `package.json` with start/test scripts, engine pin, and an empty runtime-dependency set. After this task `npm start` prints the banner.

**Task type:** code
**Requirements:** FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-4, AD-3
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `index.js`
- Create: `package.json`
- Test: `test/cli.test.js`

- [ ] **Step 1: Write the failing test (FR-4, FR-5, NFR-4)**
    Create `test/cli.test.js`:
    ```js
    const test = require('node:test');
    const assert = require('node:assert');
    const { execFileSync } = require('node:child_process');
    const path = require('node:path');

    const ENTRY = path.join(__dirname, '..', 'index.js');

    test('CLI prints a colored banner and exits 0', () => {
      const out = execFileSync('node', [ENTRY], { encoding: 'utf8' });
      assert.match(out, /\x1b\[38;5;\d+m/, 'banner is colored');
      assert.ok(out.replace(/\n$/, '').split('\n').length >= 5, 'banner has glyph rows');
    });

    test('CLI ignores extra arguments without error', () => {
      const out = execFileSync('node', [ENTRY, '--whatever', 'ignored'], { encoding: 'utf8' });
      assert.match(out, /\x1b\[38;5;\d+m/, 'same output regardless of args');
    });
    ```

- [ ] **Step 2: Run test, confirm it fails**
    Run: `node --test test/cli.test.js`
    Expected: FAIL — `index.js` does not exist, so `execFileSync` exits non-zero and throws (FR-4, FR-5)

- [ ] **Step 3: Implement minimal code (FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-4, AD-3)**
    Create `index.js` — the only place that performs I/O (AD-3); it renders once, writes, and lets the process exit 0 naturally without reading args or stdin:
    ```js
    'use strict';
    const { renderBanner } = require('./src/banner.js');
    process.stdout.write(renderBanner());
    ```
    Create `package.json` with start/test scripts, the engine pin, and an empty runtime-dependency surface:
    ```json
    {
      "name": "rad-plan-bench",
      "version": "1.0.0",
      "private": true,
      "description": "Rainbow ASCII-art HELLO WORLD CLI",
      "main": "index.js",
      "type": "commonjs",
      "engines": { "node": ">=18" },
      "scripts": {
        "start": "node index.js",
        "test": "node --test"
      }
    }
    ```

- [ ] **Step 4: Run test, confirm pass**
    Run: `node --test test/cli.test.js`
    Expected: PASS — CLI prints the colored banner once, exits 0, and ignores extra args; `npm start` is wired (FR-4, FR-5, FR-6, NFR-4)
