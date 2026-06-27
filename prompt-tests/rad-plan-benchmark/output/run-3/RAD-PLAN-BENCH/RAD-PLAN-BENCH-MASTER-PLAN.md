---
project: "RAD-PLAN-BENCH"
type: master_plan
status: "draft"
created: "2026-06-27"
project-type: side-project
repos: ["RAD-PLAN-BENCH"]
repo-group: null
total_phases: 2
total_tasks: 5
author: "planner-agent"
---

# RAD-PLAN-BENCH — Master Plan

## Introduction

RAD-PLAN-BENCH is a tiny Node.js CLI that prints "HELLO WORLD" as large,
blocky ASCII-art letters, each painted in a cycling rainbow of ANSI colors. It
runs once with no arguments, draws a horizontally centered banner to the
terminal, and exits cleanly — built on Node built-ins plus a single color
dependency (`chalk`) so it renders correctly on modern terminals including
Windows.

The plan delivers the project in two phases. Phase 1 lays the project scaffold
and the deterministic, hardcoded glyph-rendering core that assembles and centers
the plain banner. Phase 2 layers the per-letter rainbow coloring on top, wires
the single-shot entrypoint, and ships a README — leaving a runnable,
test-covered program reachable through `npm start`.

## P01: Project Foundation and Banner Rendering

Establishes a runnable Node.js project shell and the deterministic rendering
core that turns the fixed phrase "HELLO WORLD" into a centered, multi-line
block-letter banner as plain text. When this phase completes, the glyph data,
assembly, and centering logic exist and are unit-tested, ready for color.

**Requirements:** FR-1, FR-3, FR-4, FR-5, NFR-1, NFR-3, NFR-4, NFR-5, AD-1, AD-2, AD-4, AD-5, DD-3, DD-4
**Target repos:** RAD-PLAN-BENCH

**Execution order:**
    T01 → T02

### P01-T01: Scaffold project and dependencies

Stand up the Node.js project manifest, the single `chalk` dependency, and the
`start`/`test` scripts so the program is runnable and testable. This task
delivers the project shell with no application framework.

**Task type:** config
**Requirements:** AD-1, NFR-1, NFR-3, NFR-4, FR-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: Author `package.json` with scripts, engines, and the single dependency**
    Create `package.json` with exactly this content. It declares a plain
    CommonJS Node CLI with no framework (AD-1), pins `chalk` at the v4 line
    because v5 is ESM-only and this project uses `require()` (NFR-1, AD-1),
    declares Node 18+ via `engines` (NFR-4), and wires `start` (the single
    no-argument entrypoint) and `test` scripts (FR-4):
    ```json
    {
      "name": "rad-plan-bench",
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
      "dependencies": {
        "chalk": "^4.1.2"
      },
      "license": "MIT"
    }
    ```

- [ ] **Step 2: Add a `.gitignore` to keep the tree minimal**
    Create `.gitignore` excluding installed modules and OS noise so the
    repository stays small and dependency-light (NFR-1, NFR-3):
    ```gitignore
    node_modules/
    npm-debug.log*
    .DS_Store
    ```

- [ ] **Step 3: Install the dependency tree**
    Run: `npm install`
    Expected: `chalk@4.x` is added under `node_modules/` and a
    `package-lock.json` is written, with no other runtime dependencies pulled
    in (NFR-1, AD-1).

- [ ] **Step 4: Verify the Node baseline and script wiring**
    Run: `node -v` and confirm the major version is 18 or newer; then run
    `npm run` and confirm both `start` and `test` scripts are listed.
    Expected: Node major version >= 18 (NFR-4) and the `start` + `test`
    scripts are present and runnable (FR-4, AD-1).

### P01-T02: Build glyph data and plain banner assembly

Render "HELLO WORLD" as fixed-height ASCII block letters assembled into centered
multi-line text. This task delivers the deterministic, dependency-free
rendering core and its first unit test, returned as a string from a dedicated
module.

**Task type:** code
**Requirements:** FR-1, FR-3, FR-5, NFR-3, NFR-5, AD-2, AD-4, AD-5, DD-3, DD-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `glyphs.js`
- Create: `render.js`
- Test: `render.test.js`

- [ ] **Step 1: Write the failing test (FR-1, FR-3, FR-5, AD-4, AD-5, DD-3)**
    Create `render.test.js` using Node's built-in runner (AD-5). It asserts the
    rendered banner has the fixed glyph height in rows (FR-1, DD-3), that the
    assembled rows carry the first letter's block shape (FR-1), and that the
    rendered banner is leading-padded for centering (FR-3). The module is
    imported as a returned string, requiring no process spawn (AD-4):
    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const { renderBanner, assembleRows, GLYPH_HEIGHT } = require('./render');

    test('banner renders a fixed number of rows', () => {
      const lines = renderBanner().split('\n');
      assert.strictEqual(lines.length, GLYPH_HEIGHT);
    });

    test('assembled rows contain HELLO WORLD glyph content', () => {
      const rows = assembleRows('HELLO WORLD');
      assert.strictEqual(rows.length, GLYPH_HEIGHT);
      assert.ok(rows[0].includes('H   H'));
    });

    test('rendered banner is centered with leading padding', () => {
      const line = renderBanner().split('\n')[0];
      assert.ok(line.startsWith(' '), 'expected leading pad before glyphs');
    });
    ```

- [ ] **Step 2: Run the test, confirm it fails**
    Run: `node --test render.test.js`
    Expected: FAIL — `Cannot find module './render'` because `render.js` does
    not exist yet (FR-1, FR-5).

- [ ] **Step 3: Implement the glyph data and assembly module (FR-1, FR-3, NFR-3, NFR-5, AD-2, AD-4, DD-3, DD-4)**
    Create `glyphs.js` holding hardcoded, in-repo block-letter data — no
    figlet or generator (AD-2) — with a uniform 5-row height and 5-column
    width per glyph so rendered rows align into clean bands (DD-3). Only the
    seven letters of "HELLO WORLD" plus space are needed (NFR-3):
    ```js
    'use strict';

    // Hardcoded block glyphs. Each glyph is 5 equal-width rows (DD-3).
    const GLYPHS = {
      H: ['H   H', 'H   H', 'HHHHH', 'H   H', 'H   H'],
      E: ['EEEEE', 'E    ', 'EEEE ', 'E    ', 'EEEEE'],
      L: ['L    ', 'L    ', 'L    ', 'L    ', 'LLLLL'],
      O: [' OOO ', 'O   O', 'O   O', 'O   O', ' OOO '],
      W: ['W   W', 'W   W', 'W W W', 'WW WW', 'W   W'],
      R: ['RRRR ', 'R   R', 'RRRR ', 'R  R ', 'R   R'],
      D: ['DDDD ', 'D   D', 'D   D', 'D   D', 'DDDD '],
      ' ': ['     ', '     ', '     ', '     ', '     '],
    };

    const GLYPH_HEIGHT = 5;
    const GLYPH_WIDTH = 5;

    module.exports = { GLYPHS, GLYPH_HEIGHT, GLYPH_WIDTH };
    ```
    Then create `render.js`, which assembles the fixed phrase row-by-row,
    centers each row using the detected terminal width with an 80-column
    fallback for non-TTY contexts (FR-3, DD-4), and returns the whole banner
    as a single string so a test can assert on it without spawning a process
    (AD-4). The work is synchronous and trivial, so it renders effectively
    instantly (NFR-5):
    ```js
    'use strict';

    const { GLYPHS, GLYPH_HEIGHT, GLYPH_WIDTH } = require('./glyphs');

    const WORD = 'HELLO WORLD';
    const COLUMN_GAP = 1;
    const FALLBACK_WIDTH = 80;

    function bannerWidth() {
      const count = WORD.length;
      return count * GLYPH_WIDTH + (count - 1) * COLUMN_GAP;
    }

    function assembleRows(word) {
      const rows = [];
      for (let r = 0; r < GLYPH_HEIGHT; r++) {
        const segments = [];
        for (const ch of word) {
          segments.push(GLYPHS[ch][r]);
        }
        rows.push(segments.join(' '.repeat(COLUMN_GAP)));
      }
      return rows;
    }

    function terminalWidth() {
      const cols = process.stdout && process.stdout.columns;
      return cols && cols > 0 ? cols : FALLBACK_WIDTH;
    }

    function centerRows(rows) {
      const pad = Math.max(0, Math.floor((terminalWidth() - bannerWidth()) / 2));
      const prefix = ' '.repeat(pad);
      return rows.map((row) => prefix + row);
    }

    function renderBanner() {
      return centerRows(assembleRows(WORD)).join('\n');
    }

    module.exports = { renderBanner, assembleRows, bannerWidth, WORD, GLYPH_HEIGHT };
    ```

- [ ] **Step 4: Run the test, confirm it passes**
    Run: `node --test render.test.js`
    Expected: PASS — all three assertions hold: the banner is 5 rows, the
    first row carries the `H` glyph shape, and each row is centered with
    leading padding (FR-1, FR-3, FR-5, AD-4, DD-3, DD-4).

## P02: Rainbow Color, CLI, and Documentation

Turns the plain banner into the shippable product: a per-letter rainbow color
pass, the single no-argument entrypoint that prints once and exits, and a README
that documents and showcases the banner. When this phase completes, a developer
can clone, `npm install`, and run `npm start` to see the colored banner.

**Requirements:** FR-2, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-4, NFR-5, AD-1, AD-3, AD-5, DD-1, DD-2
**Target repos:** RAD-PLAN-BENCH

**Execution order:**
    T01
       → T02
       → T03

### P02-T01: Apply per-letter rainbow coloring

Color the banner so each visible letter advances one step through a looping
rainbow spectrum, producing a multicolored banner that renders across platforms.
This task delivers the color pass and the test that asserts ANSI escapes are
present.

**Task type:** code
**Requirements:** FR-2, FR-5, NFR-2, AD-3, AD-5, DD-1, DD-2
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Modify: `render.js`
- Test: `render.test.js`

- [ ] **Step 1: Write the failing test (FR-2, FR-5, DD-1, DD-2)**
    Append two assertions to `render.test.js`: the rendered banner contains
    ANSI color escape sequences (FR-2, FR-5), and it uses multiple distinct
    color codes so the rainbow is visibly multicolored across letters (DD-1,
    DD-2):
    ```js
    test('banner output includes ANSI color escape sequences', () => {
      const out = renderBanner();
      assert.match(out, /\[/);
    });

    test('rainbow uses multiple distinct colors across letters', () => {
      const out = renderBanner();
      const codes = new Set(out.match(/\[[0-9;]*m/g));
      assert.ok(codes.size >= 3, `expected >= 3 distinct color codes, got ${codes.size}`);
    });
    ```

- [ ] **Step 2: Run the test, confirm it fails**
    Run: `node --test render.test.js`
    Expected: FAIL — the new assertions fail because `render.js` still emits
    plain, uncolored rows with no ANSI escape sequences (FR-2, FR-5).

- [ ] **Step 3: Add the rainbow color pass (FR-2, NFR-2, AD-3, DD-1, DD-2)**
    Modify `render.js` to color each visible letter through `chalk`, the single
    permitted dependency that normalizes ANSI handling across platforms
    including Windows (AD-3, NFR-2). Use a forced `chalk` instance so color is
    emitted even in non-TTY/CI contexts. Define the spectrum in the order
    red → orange → yellow → green → cyan → blue → purple, looping back to red
    (DD-1), and advance one color per visible letter while skipping the space
    (DD-2). Add the import and palette near the top of `render.js`:
    ```js
    const chalk = require('chalk');

    // Force at least 16-color output so the banner is always colorful (NFR-2).
    const ink = new chalk.Instance({ level: Math.max(chalk.level, 1) });

    // Rainbow order: red, orange, yellow, green, cyan, blue, purple (DD-1).
    const PALETTE = ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#8B00FF'];

    function colorForLetter(letterIndex) {
      return PALETTE[letterIndex % PALETTE.length];
    }
    ```
    Then replace the `assembleRows` function so each non-space letter's
    row-segment is wrapped in its rainbow color and the space stays uncolored,
    advancing the color index only on visible letters (DD-2). Centering math is
    unchanged because it derives from the fixed glyph width, not the colored
    string length:
    ```js
    function assembleRows(word) {
      const rows = [];
      for (let r = 0; r < GLYPH_HEIGHT; r++) {
        const segments = [];
        let letterIndex = 0;
        for (const ch of word) {
          const cell = GLYPHS[ch][r];
          if (ch === ' ') {
            segments.push(cell);
          } else {
            segments.push(ink.hex(colorForLetter(letterIndex))(cell));
            letterIndex++;
          }
        }
        rows.push(segments.join(' '.repeat(COLUMN_GAP)));
      }
      return rows;
    }
    ```

- [ ] **Step 4: Run the test, confirm it passes**
    Run: `node --test render.test.js`
    Expected: PASS — every test passes, including the original row-count and
    centering checks plus the new ANSI-presence and multi-color checks, since
    each letter is wrapped in a distinct rainbow color (FR-2, FR-5, NFR-2,
    AD-3, DD-1, DD-2).

### P02-T02: Wire the CLI entrypoint

Provide the single no-argument entrypoint that draws the banner exactly once and
exits with success. This task delivers `index.js` and a process-level test
proving it prints color and exits zero.

**Task type:** code
**Requirements:** FR-4, FR-5, NFR-5, AD-1, AD-5
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `index.js`
- Test: `index.test.js`

- [ ] **Step 1: Write the failing test (FR-4, FR-5, NFR-5, AD-5)**
    Create `index.test.js`. It runs the entrypoint as a real process via
    `execFileSync` — which throws on any non-zero exit — and asserts the
    output carries ANSI color and the full banner height, proving the program
    prints once and exits with a success code (FR-4, NFR-5). It uses Node's
    built-in runner and child_process, adding no test dependency (AD-5):
    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const path = require('node:path');
    const { execFileSync } = require('node:child_process');

    test('entrypoint prints a colored banner and exits zero', () => {
      const entry = path.join(__dirname, 'index.js');
      const out = execFileSync('node', [entry], { encoding: 'utf8' });
      assert.match(out, /\[/);
      assert.ok(out.split('\n').length >= 5, 'expected the full banner height');
    });
    ```

- [ ] **Step 2: Run the test, confirm it fails**
    Run: `node --test index.test.js`
    Expected: FAIL — `execFileSync` errors because `index.js` does not exist
    yet, so `node index.js` exits non-zero (FR-4, FR-5).

- [ ] **Step 3: Implement the entrypoint (FR-4, NFR-5, AD-1)**
    Create `index.js` as a thin CommonJS wrapper with no framework (AD-1) that
    calls the render module once, writes the result to stdout with a trailing
    newline, and performs no further work so the process exits naturally with a
    success code immediately after printing (FR-4, NFR-5):
    ```js
    'use strict';

    const { renderBanner } = require('./render');

    process.stdout.write(renderBanner() + '\n');
    ```

- [ ] **Step 4: Run the test, confirm it passes**
    Run: `node --test index.test.js`
    Expected: PASS — `node index.js` prints the colored, centered banner once
    and exits zero, so `execFileSync` returns its captured output without
    throwing (FR-4, FR-5, NFR-5, AD-1).

### P02-T03: Author README with usage and showcase

Document what the project is, how to install and run it, and show a sample of
the rendered banner. This task delivers the README that completes the shippable
package.

**Task type:** doc
**Requirements:** FR-6, NFR-1, NFR-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `README.md`

- [ ] **Step 1: Write the project overview and run instructions (FR-6, NFR-4)**
    Create `README.md` opening with a one-line description of the project,
    then install and run instructions. State the Node 18+ requirement to match
    the declared engine baseline (NFR-4):
    ```markdown
    # RAD-PLAN-BENCH

    Prints **HELLO WORLD** as a large, blocky ASCII-art banner, each letter
    painted in a cycling rainbow of ANSI colors. It runs once, draws the
    banner, and exits.

    ## Requirements

    - Node.js 18 or newer.

    ## Install

    ```bash
    npm install
    ```

    ## Run

    ```bash
    npm start
    # or
    node index.js
    ```
    ```

- [ ] **Step 2: Add the banner showcase and dependency note (FR-6, NFR-1)**
    Append a showcase section that shows a sample of the rendered ASCII-art
    banner (FR-6) and a short note that the only runtime dependency is `chalk`,
    used for cross-platform color (NFR-1):
    ```markdown
    ## Showcase

    ```text
    H   H EEEEE L     L      OOO    W   W  OOO  RRRR  L     DDDD
    H   H E     L     L     O   O   W   W O   O R   R L     D   D
    HHHHH EEEE  L     L     O   O   W W W O   O RRRR  L     D   D
    H   H E     L     L     O   O   WW WW O   O R  R  L     D   D
    H   H EEEEE LLLLL LLLLL  OOO    W   W  OOO  R   R LLLLL DDDD
    ```

    Each letter is rendered in a rolling rainbow (red → orange → yellow →
    green → cyan → blue → purple) when run in a terminal.

    ## Dependencies

    The only runtime dependency is [`chalk`](https://www.npmjs.com/package/chalk),
    used for cross-platform ANSI color. Everything else is Node.js built-ins.
    ```

- [ ] **Step 3: Verify the documented commands work end-to-end (FR-6)**
    Run: `npm start`
    Expected: a centered, multicolored "HELLO WORLD" banner is drawn to the
    terminal and the process exits, confirming the README's run instructions
    are accurate (FR-6).
