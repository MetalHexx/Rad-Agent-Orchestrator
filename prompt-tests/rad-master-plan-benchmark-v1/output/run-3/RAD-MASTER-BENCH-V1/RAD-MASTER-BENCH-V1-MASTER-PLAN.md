---
project: "RAD-MASTER-BENCH-V1"
type: master_plan
status: "draft"
created: "2026-06-29"
project-type: side-project
repos: ["RAD-MASTER-BENCH-V1"]
repo-group: null
total_phases: 2
total_tasks: 3
author: "planner-agent"
---

# RAD-MASTER-BENCH-V1 — Master Plan

## Introduction

RAD-MASTER-BENCH-V1 is a tiny, dependency-free Node.js CLI that prints "HELLO WORLD" as large blocky ASCII-art letters, each colored through a repeating seven-color rainbow using raw ANSI escapes. It runs on a single invocation, writes the banner to stdout, and exits cleanly.

The build is split into a code phase that delivers the complete runnable program — a pure renderer, a thin entrypoint, zero-dependency packaging pinned to Node 18+, and a test suite covering both the renderer and the spawned CLI — followed by a documentation phase that ships a usage README with a static showcase of the output.

## P01: Rainbow banner CLI

Delivers the complete, runnable rainbow banner CLI: a pure renderer that assembles the colored multi-line "HELLO WORLD" string, a thin entrypoint that prints it once and exits 0, packaging that pins Node 18+ with an empty runtime-dependency set, and a test suite covering the renderer and the spawned process.

**Requirements:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, NFR-1, NFR-2, NFR-3, NFR-4, NFR-5, AD-1, AD-2, AD-3, AD-4, AD-5, DD-1, DD-2, DD-3, DD-4
**Target repos:** RAD-MASTER-BENCH-V1

**Execution order:**
    T01 → T02 (depends on T01: entrypoint requires the renderer module and the package.json scaffold)

### P01-T01: Build the rainbow banner renderer

Establishes the pure renderer that turns "HELLO WORLD" into a colored, multi-line ASCII-art string, plus the zero-dependency packaging and unit tests that lock its structure and coloring.

**Task type:** code
**Requirements:** FR-1, FR-2, FR-3, FR-6, FR-7, NFR-1, NFR-2, NFR-3, NFR-5, AD-1, AD-2, AD-3, AD-4, AD-5, DD-1, DD-2, DD-3, DD-4
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `renderer.js`
- Create: `package.json`
- Test: `test/renderer.test.js`

- [ ] **Step 1: Write the failing renderer test (FR-7, FR-3, DD-3, DD-4)**
    Create `test/renderer.test.js` with the exact content below. It exercises the pure renderer directly (no stdout capture), asserting row count, presence of an ANSI color escape, presence of a color reset, and clean top/bottom framing.
    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const { renderBanner } = require('../renderer');

    test('banner renders exactly five ASCII-art rows', () => {
      const banner = renderBanner();
      const lines = banner.split('\n');
      assert.strictEqual(lines[lines.length - 1], '');
      assert.strictEqual(lines.slice(0, -1).length, 5);
    });

    test('banner contains at least one ANSI color escape', () => {
      const banner = renderBanner();
      assert.match(banner, /\x1b\[38;5;\d+m/);
    });

    test('banner resets color after each colored letter', () => {
      const banner = renderBanner();
      assert.ok(banner.includes('\x1b[0m'));
    });

    test('banner has no leading blank line and ends with one newline', () => {
      const banner = renderBanner();
      assert.ok(!banner.startsWith('\n'));
      assert.ok(banner.endsWith('\n'));
      assert.ok(!banner.endsWith('\n\n'));
    });
    ```

- [ ] **Step 2: Run the renderer test, confirm it fails**
    Run: `node --test test/renderer.test.js`
    Expected: FAIL — `Cannot find module '../renderer'`; the renderer module does not exist yet (FR-7).

- [ ] **Step 3: Implement the renderer and package scaffold (FR-1, FR-2, FR-3, NFR-1, NFR-2, NFR-5, AD-1, AD-2, AD-3, AD-4, AD-5, DD-1, DD-2, DD-3, DD-4)**
    Create `renderer.js` with the exact content below. It holds a hardcoded glyph map (H, E, L, O, W, R, D, and the inter-word space), a fixed seven-color rainbow palette of raw ANSI SGR codes, and a pure `renderBanner` function that advances color per visible letter (index mod 7), resets color after each glyph segment, leaves a blank-glyph word gap, and returns a single trailing-newline string with no leading blank line.
    ```js
    'use strict';

    const ROWS = 5;

    const GLYPHS = {
      H: ['#   #', '#   #', '#####', '#   #', '#   #'],
      E: ['#####', '#    ', '#### ', '#    ', '#####'],
      L: ['#    ', '#    ', '#    ', '#    ', '#####'],
      O: [' ### ', '#   #', '#   #', '#   #', ' ### '],
      W: ['#   #', '#   #', '# # #', '## ##', '#   #'],
      R: ['#### ', '#   #', '#### ', '#  # ', '#   #'],
      D: ['#### ', '#   #', '#   #', '#   #', '#### '],
      ' ': ['   ', '   ', '   ', '   ', '   '],
    };

    const PALETTE = [
      '\x1b[38;5;196m', // red
      '\x1b[38;5;208m', // orange
      '\x1b[38;5;226m', // yellow
      '\x1b[38;5;46m',  // green
      '\x1b[38;5;51m',  // cyan
      '\x1b[38;5;21m',  // blue
      '\x1b[38;5;129m', // purple
    ];

    const RESET = '\x1b[0m';

    function renderBanner() {
      const word = 'HELLO WORLD';
      const lines = Array.from({ length: ROWS }, () => '');
      let letterIndex = 0;

      for (const ch of word) {
        const glyph = GLYPHS[ch];
        if (!glyph) {
          continue;
        }
        if (ch === ' ') {
          for (let r = 0; r < ROWS; r += 1) {
            lines[r] += glyph[r];
          }
          continue;
        }
        const color = PALETTE[letterIndex % PALETTE.length];
        for (let r = 0; r < ROWS; r += 1) {
          lines[r] += color + glyph[r] + RESET + ' ';
        }
        letterIndex += 1;
      }

      return lines.map((line) => line.replace(/\s+$/, '')).join('\n') + '\n';
    }

    module.exports = { renderBanner, PALETTE, RESET };
    ```
    Create `package.json` with the exact content below. It declares an empty `dependencies` block, pins Node 18+ via `engines`, and wires `start` and `test` scripts to the Node built-in test runner — keeping the project free of runtime and dev dependencies.
    ```json
    {
      "name": "rad-master-bench-v1",
      "version": "1.0.0",
      "description": "Prints HELLO WORLD as a rainbow ASCII-art banner.",
      "main": "index.js",
      "type": "commonjs",
      "scripts": {
        "start": "node index.js",
        "test": "node --test"
      },
      "engines": {
        "node": ">=18"
      },
      "license": "MIT",
      "dependencies": {},
      "devDependencies": {}
    }
    ```

- [ ] **Step 4: Run the test suite, confirm it passes**
    Run: `npm test`
    Expected: PASS — all four renderer assertions pass; the banner is five rows tall, carries ANSI color and reset escapes, and is cleanly framed (FR-7, NFR-3).

### P01-T02: Wire CLI entrypoint and run-once behavior

Establishes the runnable entrypoint that prints the banner exactly once and exits cleanly, ignoring any arguments, and locks that behavior with a spawned-process integration test.

**Task type:** code
**Requirements:** FR-4, FR-5, FR-6, NFR-4, AD-3, AD-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `index.js`
- Test: `test/cli.test.js`

- [ ] **Step 1: Write the failing CLI integration test (FR-4, FR-5)**
    Create `test/cli.test.js` with the exact content below. It spawns the entrypoint as a child process and asserts a zero exit code, a colored banner on stdout, and identical behavior when extra arguments are supplied.
    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const path = require('node:path');
    const { spawnSync } = require('node:child_process');

    const ENTRY = path.join(__dirname, '..', 'index.js');

    test('CLI prints the banner and exits with code 0', () => {
      const result = spawnSync(process.execPath, [ENTRY], { encoding: 'utf8' });
      assert.strictEqual(result.status, 0);
      assert.match(result.stdout, /\x1b\[38;5;\d+m/);
      assert.ok(result.stdout.endsWith('\n'));
    });

    test('CLI ignores extra command-line arguments', () => {
      const result = spawnSync(process.execPath, [ENTRY, '--word', 'ignored', 'extra'], { encoding: 'utf8' });
      assert.strictEqual(result.status, 0);
      assert.match(result.stdout, /\x1b\[38;5;\d+m/);
    });
    ```

- [ ] **Step 2: Run the CLI test, confirm it fails**
    Run: `node --test test/cli.test.js`
    Expected: FAIL — `index.js` does not exist, so the spawned process exits non-zero and `result.status` is not 0 (FR-4).

- [ ] **Step 3: Implement the entrypoint (FR-4, FR-5, NFR-4, AD-3, AD-5)**
    Create `index.js` with the exact content below. It is the only module that writes to stdout: it calls the pure renderer once, writes the result, and lets the process exit naturally with status 0 — never reading `process.argv` or stdin, and never looping.
    ```js
    'use strict';

    const { renderBanner } = require('./renderer');

    process.stdout.write(renderBanner());
    ```

- [ ] **Step 4: Run the full test suite, confirm it passes**
    Run: `npm test`
    Expected: PASS — renderer and CLI tests all pass; the CLI prints once and exits 0 regardless of arguments, and `npm start` now resolves to the working entrypoint (FR-4, FR-5, FR-6).

## P02: Usage documentation

Delivers the user-facing README: it explains the Node 18+ requirement and zero-dependency footprint, documents installation and how to run the CLI, and presents a static showcase of the banner output.

**Requirements:** FR-8, NFR-2, NFR-5
**Target repos:** RAD-MASTER-BENCH-V1

**Execution order:**
    T01

### P02-T01: Author usage README

Ships a concise, scannable README that lets a developer install, run, and recognize the banner output at a glance, with the supported Node version stated explicitly.

**Task type:** doc
**Requirements:** FR-8, NFR-2, NFR-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `README.md`

- [ ] **Step 1: Write the README structure, requirements, and usage sections (FR-8, NFR-2)**
    Create `README.md` with the overview, requirements (Node.js 18 or newer; zero runtime dependencies), installation, and usage sections shown below.
    ````markdown
    # RAD-MASTER-BENCH-V1

    Prints **HELLO WORLD** as large rainbow-colored ASCII-art letters, then exits.

    ## Requirements

    - Node.js 18 or newer. The CLI uses only Node.js built-in modules and has zero
      runtime dependencies, so there is nothing to install beyond Node itself.

    ## Installation

    ```bash
    git clone <repo-url>
    cd RAD-MASTER-BENCH-V1
    ```

    No `npm install` step is required — the `dependencies` block is empty.

    ## Usage

    ```bash
    npm start
    # equivalent to:
    node index.js
    ```

    The banner prints once and the process exits with status 0.
    ````

- [ ] **Step 2: Add the static showcase and testing sections (FR-8, NFR-5)**
    Append the showcase and testing sections below to `README.md`. The showcase is a static, monochrome rendering of the live output (which prints in a per-letter rainbow), kept short so the whole file stays scannable.
    ````markdown
    ## Showcase

    The live banner colors each letter through a red → orange → yellow → green →
    cyan → blue → purple cycle. Rendered monochrome, it looks like this:

    ```
    #   # ##### #     #      ###      #   #  ###  ####  #     ####
    #   # #     #     #     #   #     #   # #   # #   # #     #   #
    ##### ####  #     #     #   #     # # # #   # ####  #     #   #
    #   # #     #     #     #   #     ## ## #   # #  #  #     #   #
    #   # ##### ##### ##### #   #     #   #  ###  #   # ##### ####
    ```

    ## Testing

    ```bash
    npm test
    ```

    Runs the Node.js built-in test runner against the renderer and the spawned CLI.
    ````

- [ ] **Step 3: Proofread the README for accuracy and scannability (FR-8, NFR-5)**
    Read `README.md` end to end and confirm: the stated Node version matches the `engines` field, the run commands (`npm start`, `node index.js`, `npm test`) are correct and copy-pasteable, the showcase reads as "HELLO WORLD", and the document is short enough to scan in under a minute (FR-8, NFR-2, NFR-5).
