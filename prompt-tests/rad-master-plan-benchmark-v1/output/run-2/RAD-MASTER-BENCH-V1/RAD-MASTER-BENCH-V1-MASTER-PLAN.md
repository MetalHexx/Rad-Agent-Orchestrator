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

RAD-MASTER-BENCH-V1 is a tiny, dependency-free Node.js CLI that prints "HELLO WORLD" as large blocky ASCII-art letters, each colored through a repeating seven-color rainbow using raw ANSI escape codes. It runs once, writes the banner to stdout, and exits cleanly — small enough to read in a few minutes, finished enough to feel shareable the moment it runs.

The build is two layers stitched together: a pure renderer module (hardcoded glyph font + rainbow palette + assembly) that returns the colored multi-line string, and a thin `index.js` entrypoint that is the only code allowed to write to stdout. Phase 1 lays the package skeleton and the unit-tested renderer; Phase 2 wires the entrypoint and ships the usage README. Tests run on Node's built-in `node:test` runner, preserving the zero-runtime-dependency posture.

## P01: Project Foundation & Banner Renderer

Delivers a runnable, unit-tested rendering core: a `package.json` with the engines/scripts/empty-dependencies posture and a pure renderer module that returns "HELLO WORLD" as a rainbow-colored, blocky ASCII-art string. When this phase completes, the banner can be produced and verified in isolation, before any I/O is wired.

**Requirements:** FR-1, FR-2, FR-3, FR-6, FR-7, NFR-1, NFR-2, NFR-3, NFR-5, AD-1, AD-2, AD-3, AD-4, AD-5, DD-1, DD-2, DD-3, DD-4
**Target repos:** RAD-MASTER-BENCH-V1

**Execution order:**
    T01 → T02 (renderer test runner and project skeleton exist before the renderer is built)

### P01-T01: Scaffold package and tooling

Establishes the project skeleton: a `package.json` declaring the modern-Node baseline, the `start`/`test` scripts, and an empty runtime-dependency surface. This is the contract that ties the renderer module and entrypoint together and makes `npm start` / `npm test` work.

**Task type:** config
**Requirements:** FR-6, NFR-1, NFR-2, AD-4, AD-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `package.json`

- [ ] **Step 1: Author `package.json` with the engines, scripts, and empty-dependency posture (FR-6, NFR-1, NFR-2, AD-4, AD-5)**
    Create `package.json` at the project root with exactly this content. The `start` script makes `npm start` equivalent to `node index.js`, the `test` script invokes Node's built-in runner, `engines.node` pins the modern-LTS baseline, and both dependency blocks are empty so the shipped CLI carries no runtime dependencies.
    ```json
    {
      "name": "rad-master-bench-v1",
      "version": "1.0.0",
      "description": "Prints HELLO WORLD as large rainbow-colored ASCII-art in the terminal.",
      "private": true,
      "type": "commonjs",
      "main": "index.js",
      "engines": {
        "node": ">=18"
      },
      "scripts": {
        "start": "node index.js",
        "test": "node --test"
      },
      "dependencies": {},
      "devDependencies": {}
    }
    ```

- [ ] **Step 2: Confirm the runtime baseline meets the declared engine**
    Run: `node --version`
    Expected: prints `v18.x` or newer, matching the `engines.node` `>=18` declaration (NFR-2)

- [ ] **Step 3: Confirm the runtime-dependency surface is empty**
    Run: `npm pkg get dependencies`
    Expected: prints `{}`, confirming no runtime dependencies are declared (NFR-1)

- [ ] **Step 4: Confirm the lifecycle scripts resolve**
    Run: `npm run`
    Expected: lists both `start` and `test` scripts, so `npm start` runs the entrypoint and `npm test` runs the built-in test runner (FR-6, AD-4)

### P01-T02: Build the rainbow banner renderer

Establishes the heart of the project: a pure function that assembles "HELLO WORLD" from a hardcoded blocky glyph map, colors each letter through the seven-color rainbow cycle with raw ANSI codes, and returns the finished multi-line string. The function is unit-tested in isolation, with no stdout capture required.

**Task type:** code
**Requirements:** FR-1, FR-2, FR-3, FR-7, NFR-3, NFR-5, AD-1, AD-2, AD-3, AD-4, DD-1, DD-2, DD-3, DD-4
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `banner.js`
- Test: `test/banner.test.js`

- [ ] **Step 1: Write the failing renderer test (FR-7, AD-3, AD-4, DD-4)**
    Create `test/banner.test.js` with the content below. It invokes the pure renderer directly (no process-output capture), asserting the banner row count matches the glyph height, that at least one ANSI color escape is present, and that the output has a single trailing newline with no leading blank line. The test uses the `node:test` runner and `node:assert` only.
    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const { renderBanner, GLYPH_ROWS } = require('../banner.js');

    test('banner renders the expected number of ASCII-art rows', () => {
      const banner = renderBanner();
      const rows = banner.replace(/\n$/, '').split('\n');
      assert.strictEqual(rows.length, GLYPH_ROWS);
    });

    test('banner emits at least one ANSI color escape sequence', () => {
      const banner = renderBanner();
      assert.match(banner, /\x1b\[38;5;\d+m/);
    });

    test('banner has a single trailing newline and no leading blank line', () => {
      const banner = renderBanner();
      assert.ok(banner.endsWith('\n'));
      assert.ok(!banner.startsWith('\n'));
    });
    ```

- [ ] **Step 2: Run the renderer test and confirm it fails**
    Run: `node --test test/banner.test.js`
    Expected: FAIL — `banner.js` does not exist yet, so the `require('../banner.js')` resolution throws a module-not-found error (FR-7)

- [ ] **Step 3: Implement the pure renderer module (FR-1, FR-2, FR-3, NFR-3, NFR-5, AD-1, AD-2, AD-3, DD-1, DD-2, DD-3, DD-4)**
    Create `banner.js` with exactly this content. It stores the glyphs as a hardcoded per-character map of five row strings, defines the rainbow palette as raw ANSI 256-color SGR codes in red→orange→yellow→green→cyan→blue→purple order, colors letter N with palette index `N mod 7`, separates the two words with a fixed multi-space gap, resets color after every glyph segment, and returns a single string ending in one newline.
    ```js
    'use strict';

    // Hardcoded ASCII-art glyph map. Each glyph is exactly 5 rows tall.
    const GLYPHS = {
      H: ['#   #', '#   #', '#####', '#   #', '#   #'],
      E: ['#####', '#    ', '#### ', '#    ', '#####'],
      L: ['#    ', '#    ', '#    ', '#    ', '#####'],
      O: [' ### ', '#   #', '#   #', '#   #', ' ### '],
      W: ['#   #', '#   #', '# # #', '## ##', '#   #'],
      R: ['#### ', '#   #', '#### ', '#  # ', '#   #'],
      D: ['#### ', '#   #', '#   #', '#   #', '#### '],
    };

    const GLYPH_ROWS = 5;

    // Fixed rainbow palette as raw ANSI 256-color SGR codes,
    // ordered red, orange, yellow, green, cyan, blue, purple.
    const PALETTE = [
      '\x1b[38;5;196m', // red
      '\x1b[38;5;208m', // orange
      '\x1b[38;5;226m', // yellow
      '\x1b[38;5;46m',  // green
      '\x1b[38;5;51m',  // cyan
      '\x1b[38;5;21m',  // blue
      '\x1b[38;5;129m', // purple
    ];

    // Emitted after every colored glyph segment so color never bleeds
    // past the banner into the user's shell prompt.
    const RESET = '\x1b[0m';

    // Single-column separator between letters; wider gap between the two words.
    const LETTER_GAP = ' ';
    const WORD_GAP = '   ';

    const WORDS = ['HELLO', 'WORLD'];

    function renderBanner() {
      const lines = [];
      for (let row = 0; row < GLYPH_ROWS; row += 1) {
        let line = '';
        let letterIndex = 0;
        for (let w = 0; w < WORDS.length; w += 1) {
          const word = WORDS[w];
          for (let c = 0; c < word.length; c += 1) {
            if (c > 0) {
              line += LETTER_GAP;
            }
            const color = PALETTE[letterIndex % PALETTE.length];
            line += color + GLYPHS[word[c]][row] + RESET;
            letterIndex += 1;
          }
          if (w < WORDS.length - 1) {
            line += WORD_GAP;
          }
        }
        lines.push(line);
      }
      // Single trailing newline, no leading blank lines.
      return lines.join('\n') + '\n';
    }

    module.exports = { renderBanner, GLYPH_ROWS, PALETTE, RESET };
    ```

- [ ] **Step 4: Run the renderer test and confirm it passes**
    Run: `node --test test/banner.test.js`
    Expected: PASS — all three cases pass: five rows present, an ANSI color escape is found, and the trailing-newline/no-leading-blank shape holds (FR-1, FR-3, FR-7, DD-4)

## P02: CLI Entrypoint & Usage Documentation

Delivers the user-facing surface: a thin entrypoint that prints the banner exactly once and exits 0 regardless of arguments, plus a README that documents install, run, Node version, and a static showcase of the output. When this phase completes, `npm start` produces the finished rainbow banner and the project is documented for a newcomer.

**Requirements:** FR-4, FR-5, FR-8, NFR-1, NFR-2, NFR-3, NFR-4, AD-3, AD-5
**Target repos:** RAD-MASTER-BENCH-V1

**Execution order:**
    T01 → T02 (the README showcases the live entrypoint output, so the entrypoint exists first)

### P02-T01: Wire the CLI entrypoint

Establishes the single I/O boundary: `index.js` calls the pure renderer and writes the result to stdout once, ignoring all arguments and stdin, then exits 0 on natural completion. An integration test spawns the entrypoint as a real process to verify the run-once / exit-0 / args-ignored behavior.

**Task type:** code
**Requirements:** FR-4, FR-5, NFR-4, AD-3, AD-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `index.js`
- Test: `test/cli.test.js`

- [ ] **Step 1: Write the failing entrypoint integration test (FR-4, FR-5)**
    Create `test/cli.test.js` with the content below. It runs `index.js` as a child process with the current Node binary; `execFileSync` throws on any non-zero exit, so a successful return proves the process exited 0. The first case asserts a colored banner is printed and the output ends with a newline; the second passes extra arguments to prove they are ignored and raise no error.
    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const { execFileSync } = require('node:child_process');
    const path = require('node:path');

    const ENTRY = path.join(__dirname, '..', 'index.js');

    test('entrypoint prints a colored banner and exits 0', () => {
      const out = execFileSync(process.execPath, [ENTRY], { encoding: 'utf8' });
      assert.match(out, /\x1b\[38;5;\d+m/);
      assert.ok(out.endsWith('\n'));
    });

    test('entrypoint ignores extra arguments without error', () => {
      const out = execFileSync(
        process.execPath,
        [ENTRY, '--word', 'foo', 'extra'],
        { encoding: 'utf8' },
      );
      assert.match(out, /\x1b\[38;5;\d+m/);
    });
    ```

- [ ] **Step 2: Run the entrypoint test and confirm it fails**
    Run: `node --test test/cli.test.js`
    Expected: FAIL — `index.js` does not exist yet, so the spawned process exits non-zero and `execFileSync` throws, failing both cases (FR-4)

- [ ] **Step 3: Implement the entrypoint (FR-4, FR-5, NFR-4, AD-3, AD-5)**
    Create `index.js` with exactly this content. It is the only module that writes to stdout: it requires the pure renderer, writes the banner once, and lets the process exit 0 on natural completion. It reads no argv and no stdin, so behavior is identical for any invocation, and the fixed small string makes the run effectively instantaneous.
    ```js
    'use strict';

    const { renderBanner } = require('./banner.js');

    // Ignore all argv and stdin; behavior is identical for any invocation.
    // Print the banner exactly once; the process exits 0 on natural completion.
    process.stdout.write(renderBanner());
    ```

- [ ] **Step 4: Run the entrypoint test and confirm it passes**
    Run: `node --test test/cli.test.js`
    Expected: PASS — the spawned process prints the colored banner, ignores the extra arguments, and exits 0 effectively instantly (FR-4, FR-5, NFR-4)

### P02-T02: Author the usage README

Establishes the newcomer-facing documentation: install steps, how to run, the supported Node version, the zero-dependency note, and a static showcase of the banner. This is the "shareable, finished" surface a developer trying the toolchain sees first.

**Task type:** doc
**Requirements:** FR-8, NFR-1, NFR-2, NFR-3
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `README.md`

- [ ] **Step 1: Author the README with install, run, version, dependency, and showcase sections (FR-8, NFR-1, NFR-2, NFR-3)**
    Create `README.md` with exactly the content below. It documents the modern-Node requirement and ANSI-terminal expectation, the install and run commands, the empty runtime-dependency posture, a monochrome static showcase of the banner, and how to run the tests.
    ````markdown
    # rad-master-bench-v1

    Prints **HELLO WORLD** as large, rainbow-colored ASCII-art in your terminal — zero runtime dependencies, one quick run.

    ## Requirements

    - Node.js 18 or newer (modern LTS).
    - A terminal with ANSI escape support: modern macOS/Linux terminals or Windows Terminal. Legacy terminals without ANSI support are out of scope.

    ## Install

    ```bash
    git clone <repo-url>
    cd rad-master-bench-v1
    npm install
    ```

    `npm install` pulls nothing at runtime — the project depends only on Node.js built-in modules.

    ## Run

    ```bash
    npm start
    # equivalent to:
    node index.js
    ```

    The banner prints once and the process exits immediately. Command-line arguments are ignored.

    ## Output

    Each letter cycles through a seven-color rainbow — red, orange, yellow, green, cyan, blue, purple — wrapping back to red. Monochrome preview of the blocky layout (colors are applied per letter at runtime):

    ```
    #   #  #####  #      #       ###      #   #   ###   ####   #      ####
    #   #  #      #      #      #   #     #   #  #   #  #   #  #      #   #
    #####  ####   #      #      #   #     # # #  #   #  ####   #      #   #
    #   #  #      #      #      #   #     ## ##  #   #  #  #   #      #   #
    #   #  #####  #####  #####   ###      #   #   ###   #   #  #####  ####
    ```

    ## Test

    ```bash
    npm test
    ```

    Runs the Node.js built-in test runner (`node --test`), asserting the banner row count and the presence of ANSI color codes.
    ````

- [ ] **Step 2: Verify the documented run command produces the banner**
    Run: `npm start`
    Expected: the rainbow ASCII-art "HELLO WORLD" banner prints once and the process exits, matching the README's Run and Output sections on a modern ANSI terminal (FR-8, NFR-3)

- [ ] **Step 3: Verify the documented zero-dependency claim**
    Run: `npm pkg get dependencies`
    Expected: prints `{}`, confirming the README's "depends only on Node.js built-in modules" statement (NFR-1)

- [ ] **Step 4: Verify the documented Node version baseline**
    Run: `npm pkg get engines.node`
    Expected: prints `">=18"`, confirming the README's "Node.js 18 or newer" requirement (NFR-2)
