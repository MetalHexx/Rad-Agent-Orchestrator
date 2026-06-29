---
project: "RAD-MASTER-BENCH-V1"
type: master_plan
status: "draft"
created: "2026-06-29"
project-type: side-project
repos: ["RAD-MASTER-BENCH-V1"]
repo-group: null
total_phases: 2
total_tasks: 4
author: "planner-agent"
---

# RAD-MASTER-BENCH-V1 — Master Plan

## Introduction

RAD-MASTER-BENCH-V1 is a tiny, dependency-free Node.js CLI that prints "HELLO WORLD" as large blocky ASCII-art glyphs, each letter colored through a repeating seven-color rainbow using raw ANSI escape codes. It runs once per invocation, writes the banner to standard output, and exits cleanly.

The build splits cleanly along a renderer/I-O seam: a pure render module (hardcoded glyph font + fixed rainbow palette + assembly) that is unit-testable without capturing process output, and a thin entrypoint plus README that deliver and document it. Both phases keep the codebase to two small source files, an empty runtime-dependency footprint, and Node's built-in test runner.

## P01: Project scaffold and renderer core

This phase delivers a runnable package skeleton and the heart of the project: a pure function that returns the full colored "HELLO WORLD" banner string. When the phase completes, the rainbow renderer exists, is exercised by a passing unit test, and the package declares its scripts, engine baseline, and zero-dependency posture.

**Requirements:** FR-1, FR-2, FR-3, FR-6, FR-7, NFR-1, NFR-2, NFR-3, NFR-5, AD-1, AD-2, AD-3, AD-4, AD-5, DD-1, DD-2, DD-3, DD-4
**Target repos:** RAD-MASTER-BENCH-V1

**Execution order:**
    T01 → T02

### P01-T01: Scaffold package manifest and scripts

Establishes the package metadata that ties the two source files together and pins the zero-dependency, Node 18+ posture. Wires `npm start` and `npm test` to the built-in toolchain.

**Task type:** config
**Requirements:** FR-6, NFR-1, NFR-2, NFR-5, AD-4, AD-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `package.json`

- [ ] **Step 1: Create the package manifest (NFR-1, NFR-2, NFR-5, AD-4, AD-5)**
    Create `package.json` at the repo root. The `dependencies` block stays empty so the shipped CLI pulls in only Node built-ins; the `engines.node` field pins the modern-LTS baseline; `start` runs the entrypoint and `test` runs Node's built-in runner. The manifest names `index.js` as the package main, tying the entrypoint and renderer module together.

    ```json
    {
      "name": "rad-master-bench-v1",
      "version": "1.0.0",
      "description": "Prints HELLO WORLD as rainbow ASCII-art in the terminal.",
      "main": "index.js",
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

- [ ] **Step 2: Confirm the start and test scripts are wired (FR-6, AD-4)**
    Run: `npm pkg get scripts`
    Expected: prints `{ "start": "node index.js", "test": "node --test" }`, confirming `npm start` is equivalent to `node index.js` and `npm test` invokes the built-in `node --test` runner (FR-6, AD-4).

- [ ] **Step 3: Confirm zero runtime dependencies and the engine baseline (NFR-1, NFR-2)**
    Run: `npm pkg get dependencies engines.node`
    Expected: prints an empty `dependencies` object (`{}`) and the string `">=18"`, confirming no runtime dependencies and the Node 18+ target (NFR-1, NFR-2).

### P01-T02: Build pure rainbow banner renderer

Establishes the pure render function that assembles the colored multi-line "HELLO WORLD" banner from a hardcoded glyph font and a fixed rainbow palette. Returns a string with no I/O, making it directly unit-testable.

**Task type:** code
**Requirements:** FR-1, FR-2, FR-3, FR-7, NFR-1, NFR-3, NFR-5, AD-1, AD-2, AD-3, AD-4, DD-1, DD-2, DD-3, DD-4
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `renderer.js`
- Test: `test/renderer.test.js`

- [ ] **Step 1: Write the failing test (FR-7, FR-1, FR-3, DD-3, DD-4)**
    Create `test/renderer.test.js`. It invokes the banner-producing function and asserts the output has the expected number of ASCII-art rows and contains at least one ANSI color escape; it also pins the per-letter color reset and the clean trailing-newline output. Uses Node's built-in `node:test` and `node:assert`, keeping the zero-runtime-dependency posture.

    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const { renderBanner } = require('../renderer');

    // Matches a raw ANSI 256-color SGR foreground sequence.
    const ANSI_COLOR = /\x1b\[38;5;\d+m/;

    test('renders the banner as exactly five ASCII-art rows', () => {
      const rows = renderBanner().replace(/\n$/, '').split('\n');
      assert.strictEqual(rows.length, 5);
    });

    test('includes at least one ANSI color escape sequence', () => {
      assert.match(renderBanner(), ANSI_COLOR);
    });

    test('resets color after each glyph so it never bleeds into the prompt', () => {
      assert.ok(renderBanner().includes('\x1b[0m'));
    });

    test('ends with a single trailing newline and no leading blank line', () => {
      const banner = renderBanner();
      assert.ok(banner.endsWith('\n'));
      assert.ok(!banner.endsWith('\n\n'));
      assert.ok(!banner.startsWith('\n'));
    });
    ```

- [ ] **Step 2: Run test, confirm it fails**
    Run: `node --test test/renderer.test.js`
    Expected: FAIL — `require('../renderer')` cannot be resolved because `renderer.js` does not exist yet, so every test errors at load (FR-7).

- [ ] **Step 3: Implement the renderer (FR-1, FR-2, FR-3, NFR-1, NFR-3, NFR-5, AD-1, AD-2, AD-3, DD-1, DD-2, DD-3, DD-4)**
    Create `renderer.js`. Glyphs are a hardcoded per-character row-string map (H, E, L, O, W, R, D, plus the inter-word space), keeping the project dependency-free and deterministic. Color comes from a fixed ordered palette of raw ANSI SGR codes; letter N takes palette index `N mod 7` so color advances once per visible letter and every row of a letter shares one color. Each colored glyph segment is terminated with an ANSI reset so color never bleeds; the two words are separated by a blank-glyph gap; the function returns a multi-line string ending in a single newline with no leading blank line. The function performs no I/O.

    ```js
    'use strict';

    // ANSI reset — terminates each colored glyph so color never bleeds past the
    // banner into the user's shell prompt.
    const RESET = '\x1b[0m';

    // Fixed, ordered rainbow palette as raw ANSI 256-color SGR foreground codes:
    // red, orange, yellow, green, cyan, blue, purple.
    const PALETTE = [
      '\x1b[38;5;196m', // red
      '\x1b[38;5;208m', // orange
      '\x1b[38;5;226m', // yellow
      '\x1b[38;5;46m',  // green
      '\x1b[38;5;51m',  // cyan
      '\x1b[38;5;21m',  // blue
      '\x1b[38;5;129m', // purple
    ];

    // Every glyph is exactly this many rows tall.
    const GLYPH_HEIGHT = 5;

    // Hardcoded blocky font: one entry per required character plus the
    // inter-word space. Each value is an array of GLYPH_HEIGHT row strings.
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

    const TEXT = 'HELLO WORLD';
    const LETTER_GAP = ' ';

    // Pure function: returns the full colored banner as a multi-line string.
    function renderBanner() {
      const lines = [];
      for (let row = 0; row < GLYPH_HEIGHT; row++) {
        const segments = [];
        let colorIndex = 0;
        for (const char of TEXT) {
          const glyph = GLYPHS[char];
          if (char === ' ') {
            // Blank-glyph gap between the two words; not part of the color cycle.
            segments.push(glyph[row]);
          } else {
            const color = PALETTE[colorIndex % PALETTE.length];
            segments.push(color + glyph[row] + RESET);
            colorIndex += 1;
          }
        }
        lines.push(segments.join(LETTER_GAP));
      }
      return lines.join('\n') + '\n';
    }

    module.exports = { renderBanner };
    ```

- [ ] **Step 4: Run test, confirm pass**
    Run: `node --test test/renderer.test.js`
    Expected: PASS — banner has five rows, contains ANSI color and reset sequences, and ends in a single trailing newline (FR-7, FR-1, FR-3, DD-3, DD-4).

## P02: CLI delivery and documentation

This phase delivers the runnable command and the docs that make it shareable: a thin entrypoint that prints the banner once and exits cleanly regardless of arguments, plus a README covering install, usage, the supported Node version, and a static showcase. When complete, `node index.js` and `npm start` both render the banner, and the project is documented end-to-end.

**Requirements:** FR-4, FR-5, FR-8, NFR-2, NFR-3, NFR-4, NFR-5, AD-5
**Target repos:** RAD-MASTER-BENCH-V1

**Execution order:**
    T01 → T02

### P02-T01: Wire CLI entrypoint to print banner

Establishes the single-invocation entrypoint: it calls the pure renderer and writes the banner to stdout exactly once, ignoring all arguments and exiting with status 0.

**Task type:** code
**Requirements:** FR-4, FR-5, NFR-3, NFR-4, NFR-5, AD-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `index.js`
- Test: `test/cli.test.js`

- [ ] **Step 1: Write the failing test (FR-4, FR-5)**
    Create `test/cli.test.js`. It spawns the entrypoint as a child process and asserts it exits with status 0 and emits a colored banner on stdout, both with no arguments and with extra unexpected arguments — proving the run-once, exit-0 lifecycle and the ignore-all-input behavior. Uses Node's built-in `node:test`, `node:assert`, and `node:child_process`.

    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const { spawnSync } = require('node:child_process');
    const path = require('node:path');

    const ENTRY = path.join(__dirname, '..', 'index.js');
    const ANSI_COLOR = /\x1b\[38;5;\d+m/;

    function runCli(args) {
      return spawnSync(process.execPath, [ENTRY, ...(args || [])], {
        encoding: 'utf8',
      });
    }

    test('prints the banner and exits with status 0', () => {
      const result = runCli();
      assert.strictEqual(result.status, 0);
      assert.match(result.stdout, ANSI_COLOR);
    });

    test('ignores extra command-line arguments and still exits 0', () => {
      const result = runCli(['--word', 'nope', 'extra']);
      assert.strictEqual(result.status, 0);
      assert.match(result.stdout, ANSI_COLOR);
    });
    ```

- [ ] **Step 2: Run test, confirm it fails**
    Run: `node --test test/cli.test.js`
    Expected: FAIL — `index.js` does not exist yet, so the spawned process exits non-zero with empty stdout and the status/color assertions fail (FR-4).

- [ ] **Step 3: Implement the entrypoint (FR-4, FR-5, NFR-3, NFR-4, NFR-5, AD-5)**
    Create `index.js`. It requires the renderer module and writes the rendered banner to stdout exactly once. It reads neither `process.argv` nor stdin, so behavior is identical for any invocation; after the single synchronous write the process exits naturally with status 0. The output is a small fixed string, so the process completes effectively instantly.

    ```js
    'use strict';

    const { renderBanner } = require('./renderer');

    // Ignore argv and stdin entirely — behavior is identical for any invocation.
    // Write the banner exactly once; the process then exits naturally with code 0.
    process.stdout.write(renderBanner());
    ```

- [ ] **Step 4: Run test, confirm pass**
    Run: `node --test test/cli.test.js`
    Expected: PASS — the entrypoint prints a colored banner and exits 0 both with and without extra arguments (FR-4, FR-5).

### P02-T02: Write usage and showcase README

Establishes user-facing documentation: how to install and run the CLI, the supported Node version, and a static showcase of the rainbow banner.

**Task type:** doc
**Requirements:** FR-8, NFR-2, NFR-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `README.md`

- [ ] **Step 1: Author the README (FR-8, NFR-2, NFR-5)**
    Create `README.md` documenting the supported Node version, installation, how to run via both `npm start` and `node index.js`, the no-arguments behavior, the test command, and a static showcase of the banner output. The showcase is a plain-text rendering of the glyphs (color is described in prose since ANSI codes do not render in Markdown).

    ```markdown
    # RAD-MASTER-BENCH-V1

    Prints **HELLO WORLD** as large, rainbow-colored ASCII-art in your terminal —
    zero runtime dependencies, one command.

    ## Requirements

    - Node.js 18 or newer (modern LTS).

    ## Installation

    Clone the repository (there are no runtime dependencies to install):

    ```sh
    git clone <repo-url>
    cd RAD-MASTER-BENCH-V1
    ```

    ## Usage

    Run the banner with either command — they are equivalent:

    ```sh
    npm start
    # or
    node index.js
    ```

    The program prints the banner once and exits with status 0. It takes no flags
    or arguments and reads no input; extra arguments are ignored.

    ## Showcase

    Each letter is rendered in a repeating rainbow:
    red -> orange -> yellow -> green -> cyan -> blue -> purple.

    ```text
    #   #  #####  #      #       ###     #   #   ###   ####   #      ####
    #   #  #      #      #      #   #    #   #  #   #  #   #  #      #   #
    #####  ####   #      #      #   #    # # #  #   #  ####   #      #   #
    #   #  #      #      #      #   #    ## ##  #   #  #  #   #      #   #
    #   #  #####  #####  #####   ###     #   #   ###   #   #  #####  ####
    ```

    ## Testing

    ```sh
    npm test
    ```

    Runs the unit tests on Node's built-in test runner (`node --test`).

    ## License

    MIT
    ```

- [ ] **Step 2: Verify the README covers the required sections (FR-8, NFR-2)**
    Run: `node -e "const fs=require('fs');const r=fs.readFileSync('README.md','utf8');for(const s of ['Installation','Usage','Showcase','npm start','node index.js','18']){if(!r.includes(s))throw new Error('README missing: '+s);}console.log('README ok');"`
    Expected: prints `README ok`, confirming the README documents installation, usage (both run commands), the showcase, and the supported Node version (FR-8, NFR-2).
