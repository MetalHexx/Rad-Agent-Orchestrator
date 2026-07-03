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

RAD-PLAN-BENCH is a tiny Node.js command-line program that prints "HELLO WORLD"
as large, blocky ASCII-art letters, painting each letter a different rainbow hue
and centering the banner in the terminal before exiting. The implementation keeps
a single render path with hardcoded letterforms, `chalk` as the only runtime
dependency, and a small unit-test suite that proves the output structure and the
presence of ANSI color codes.

The build splits into two phases: a core render engine (project manifest,
letterform data, the pure geometry assembler, centering, and rainbow coloring)
followed by the CLI entrypoint and documentation. The render logic is a pure,
importable function kept distinct from the single side-effecting `console.log`,
so tests assert on the returned string without capturing stdout.

## P01: Core Banner Renderer

Establishes the project skeleton and the complete, importable render engine:
hardcoded letterforms, an uncolored geometry assembler, terminal-width centering,
and per-letter rainbow coloring — all proven by a colocated unit-test suite.

**Requirements:** FR-2, FR-3, FR-4, FR-5, FR-7, NFR-1, NFR-2, NFR-3, NFR-4, AD-1, AD-2, AD-3, AD-5, DD-1, DD-2, DD-3, DD-4
**Target repos:** RAD-PLAN-BENCH

**Execution order:**
    T01 → T02 → T03

### P01-T01: Scaffold project manifest and layout

Establishes the npm package skeleton — metadata, run/test scripts, the single
`chalk` dependency, and a consistent CommonJS module system — so later tasks have
a runnable, installable home.

**Task type:** config
**Requirements:** FR-7, AD-5, NFR-1, NFR-3, NFR-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `package.json`

- [ ] **Step 1: Write the project manifest**
    Create `package.json` declaring metadata, the `start` and `test` scripts, a
    Node 18+ engine target, CommonJS module resolution (no `"type"` field), and
    `chalk@^4.1.2` as the single runtime dependency — `chalk` v4 is the
    CommonJS-compatible line and is the only permitted third-party runtime
    dependency (FR-7, AD-5, NFR-1, NFR-3, NFR-4):
    ```json
    {
      "name": "rad-plan-bench",
      "version": "1.0.0",
      "description": "Prints a colorful ASCII-art HELLO WORLD banner.",
      "main": "index.js",
      "scripts": {
        "start": "node index.js",
        "test": "node --test"
      },
      "license": "MIT",
      "engines": {
        "node": ">=18"
      },
      "dependencies": {
        "chalk": "^4.1.2"
      }
    }
    ```

- [ ] **Step 2: Install the dependency set**
    Run: `npm install`
    Expected: completes successfully and writes `node_modules/chalk` plus a
    lockfile, with `chalk` as the only direct dependency (NFR-1, FR-7)

- [ ] **Step 3: Verify the runtime and dependency resolve**
    Run: `node -e "console.log(require('chalk').level !== undefined)"`
    Expected: prints `true`, confirming the Node runtime loads `chalk` under
    CommonJS resolution (AD-5, NFR-3, NFR-1)

### P01-T02: Build letterform geometry assembler

Establishes the hardcoded blocky letterforms and a pure function that assembles
them into the uncolored, equal-width banner geometry, plus a centering helper
that pads each line relative to terminal width.

**Task type:** code
**Requirements:** FR-2, FR-4, FR-5, AD-1, AD-3, DD-2, DD-3, DD-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `letterforms.js`
- Create: `render.js`
- Test: `render.test.js`

- [ ] **Step 1: Write the failing test (FR-2, FR-4, DD-2, DD-3, DD-4)**
    Create `render.test.js` asserting the geometry shape and centering behavior —
    five equal-width rows, the exact assembled width of "HELLO WORLD", a visible
    word gap, and leading-space centering with an 80-column fallback:
    ```js
    const { test } = require('node:test');
    const assert = require('node:assert/strict');
    const { assemblePlain, centerLines } = require('./render');

    test('assemblePlain renders five rows', () => {
      const lines = assemblePlain('HELLO WORLD');
      assert.equal(lines.length, 5);
    });

    test('assemblePlain rows share an equal width', () => {
      const lines = assemblePlain('HELLO WORLD');
      const widths = new Set(lines.map((line) => line.length));
      assert.equal(widths.size, 1);
    });

    test('assemblePlain produces the expected banner width', () => {
      const lines = assemblePlain('HELLO WORLD');
      assert.equal(lines[0].length, 63);
    });

    test('centerLines pads with leading spaces', () => {
      const padded = centerLines(['##', '##'], 10);
      assert.equal(padded[0], '    ##');
    });

    test('centerLines falls back to a default width', () => {
      const padded = centerLines(['##'], undefined);
      assert.ok(padded[0].length > 2);
    });
    ```

- [ ] **Step 2: Run the test, confirm it fails**
    Run: `npm test`
    Expected: FAIL — `render.js` does not yet exist, so the `require('./render')`
    import throws and all five cases error (FR-2, FR-4, FR-5)

- [ ] **Step 3: Implement the letterforms and geometry assembler (AD-1, DD-2, DD-4, FR-4, DD-3)**
    Create `letterforms.js` with hardcoded, fixed-height blocky glyphs (no figlet
    or runtime generator) for every character in "HELLO WORLD" plus a full-height
    blank glyph for the inter-word space:
    ```js
    const LETTERFORMS = {
      H: ['#   #', '#   #', '#####', '#   #', '#   #'],
      E: ['#####', '#    ', '#### ', '#    ', '#####'],
      L: ['#    ', '#    ', '#    ', '#    ', '#####'],
      O: ['#####', '#   #', '#   #', '#   #', '#####'],
      W: ['#   #', '#   #', '# # #', '## ##', '#   #'],
      R: ['#### ', '#   #', '#### ', '#  # ', '#   #'],
      D: ['#### ', '#   #', '#   #', '#   #', '#### '],
    };

    const SPACE_GLYPH = ['   ', '   ', '   ', '   ', '   '];
    const GLYPH_HEIGHT = 5;
    const LETTER_GAP = 1;

    module.exports = { LETTERFORMS, SPACE_GLYPH, GLYPH_HEIGHT, LETTER_GAP };
    ```
    Create `render.js` with a pure, importable `assemblePlain` that joins glyph
    rows with a one-space gap into equal-width uncolored lines, and a
    `centerLines` helper that pads each line by the leading-space margin measured
    against the terminal width, defaulting to 80 columns when width is unavailable
    (AD-3, DD-2, DD-4, FR-4, DD-3):
    ```js
    const {
      LETTERFORMS,
      SPACE_GLYPH,
      GLYPH_HEIGHT,
      LETTER_GAP,
    } = require('./letterforms');

    const DEFAULT_COLUMNS = 80;

    function glyphFor(ch) {
      if (ch === ' ') return SPACE_GLYPH;
      const glyph = LETTERFORMS[ch];
      if (!glyph) throw new Error(`No letterform for character: ${ch}`);
      return glyph;
    }

    function assemblePlain(text) {
      const gap = ' '.repeat(LETTER_GAP);
      const rows = Array.from({ length: GLYPH_HEIGHT }, () => []);
      for (const ch of text) {
        const glyph = glyphFor(ch);
        for (let r = 0; r < GLYPH_HEIGHT; r += 1) {
          rows[r].push(glyph[r]);
        }
      }
      return rows.map((segments) => segments.join(gap));
    }

    function centerLines(lines, columns) {
      const total = columns || DEFAULT_COLUMNS;
      const width = Math.max(...lines.map((line) => line.length));
      const pad = ' '.repeat(Math.max(0, Math.floor((total - width) / 2)));
      return lines.map((line) => pad + line);
    }

    module.exports = { assemblePlain, centerLines, glyphFor, DEFAULT_COLUMNS };
    ```

- [ ] **Step 4: Run the test, confirm it passes**
    Run: `npm test`
    Expected: PASS — all five geometry and centering cases succeed (FR-2, FR-4, FR-5)

### P01-T03: Add rainbow coloring to the banner

Establishes the public `buildBanner` function that paints each letter a distinct
rainbow hue via `chalk`, cycling the ordered palette and wrapping it across the
full string while centering on the uncolored geometry so color codes do not
distort alignment.

**Task type:** code
**Requirements:** FR-3, FR-5, AD-2, AD-3, DD-1, NFR-2
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Modify: `render.js`
- Test: `render.test.js`

- [ ] **Step 1: Write the failing test (FR-3, DD-1, NFR-2)**
    Append cases to `render.test.js` that force `chalk` color output and assert
    ANSI escape codes are emitted, that the colored banner keeps its five-line
    structure, and that the exported palette is the ordered seven-hue rainbow
    starting at red:
    ```js
    const { buildBanner, PALETTE } = require('./render');

    test('buildBanner emits ANSI color codes', () => {
      require('chalk').level = 3;
      const banner = buildBanner('HELLO WORLD', 80);
      assert.match(banner, /\[/);
    });

    test('buildBanner renders five colored lines', () => {
      require('chalk').level = 3;
      const banner = buildBanner('HELLO WORLD', 80);
      assert.equal(banner.split('\n').length, 5);
    });

    test('buildBanner uses the full ordered rainbow palette', () => {
      assert.equal(PALETTE.length, 7);
      assert.equal(PALETTE[0], '#FF0000');
    });
    ```

- [ ] **Step 2: Run the test, confirm it fails**
    Run: `npm test`
    Expected: FAIL — `buildBanner` and `PALETTE` are not yet exported from
    `render.js`, so the new cases throw on undefined references (FR-3, FR-5)

- [ ] **Step 3: Implement rainbow coloring (AD-2, DD-1, NFR-2, AD-3)**
    Modify `render.js` to require `chalk`, define the ordered red→orange→yellow→
    green→cyan→blue→purple palette, and add the pure `buildBanner` function: it
    paints each non-space glyph with the next palette hue (wrapping when the
    string is longer than the palette), leaves the word gap uncolored, joins
    colored glyph rows with the one-space gap, and pads using the uncolored
    geometry width so ANSI codes never distort centering. `chalk` is the sole
    coloring path, giving cross-platform ANSI support on modern terminals.
    Add `require('chalk')` at the top of the file:
    ```js
    const chalk = require('chalk');
    ```
    Add the palette and builder, then extend `module.exports`:
    ```js
    const PALETTE = [
      '#FF0000', // red
      '#FF7F00', // orange
      '#FFFF00', // yellow
      '#00FF00', // green
      '#00FFFF', // cyan
      '#0000FF', // blue
      '#8B00FF', // purple
    ];

    function buildBanner(text = 'HELLO WORLD', columns = process.stdout.columns) {
      const gap = ' '.repeat(LETTER_GAP);
      const coloredRows = Array.from({ length: GLYPH_HEIGHT }, () => []);
      let colorIndex = 0;
      for (const ch of text) {
        const glyph = glyphFor(ch);
        let paint = (segment) => segment;
        if (ch !== ' ') {
          const hex = PALETTE[colorIndex % PALETTE.length];
          paint = (segment) => chalk.hex(hex)(segment);
          colorIndex += 1;
        }
        for (let r = 0; r < GLYPH_HEIGHT; r += 1) {
          coloredRows[r].push(paint(glyph[r]));
        }
      }
      const coloredLines = coloredRows.map((segments) => segments.join(gap));
      const plainLines = assemblePlain(text);
      const total = columns || DEFAULT_COLUMNS;
      const width = Math.max(...plainLines.map((line) => line.length));
      const pad = ' '.repeat(Math.max(0, Math.floor((total - width) / 2)));
      return coloredLines.map((line) => pad + line).join('\n');
    }

    module.exports = {
      assemblePlain,
      centerLines,
      buildBanner,
      glyphFor,
      PALETTE,
      DEFAULT_COLUMNS,
    };
    ```

- [ ] **Step 4: Run the test, confirm it passes**
    Run: `npm test`
    Expected: PASS — the geometry, centering, ANSI-code, line-count, and palette
    cases all succeed (FR-3, FR-5, AD-2, DD-1)

## P02: CLI Entrypoint and Documentation

Delivers the runnable program — a single-invocation entrypoint that composes the
pure builder with one `console.log` and exits — and a README that documents usage
and showcases the colorful banner.

**Requirements:** FR-1, FR-6, AD-3, AD-4
**Target repos:** RAD-PLAN-BENCH

**Execution order:**
    T01
    T02 (independent — documentation)

### P02-T01: Wire single-invocation CLI entrypoint

Establishes `index.js` as the runnable entrypoint that composes the pure banner
builder with a single synchronous `console.log` and exits cleanly, taking no
arguments and reading no input.

**Task type:** code
**Requirements:** FR-1, AD-3, AD-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `index.js`
- Test: `index.test.js`

- [ ] **Step 1: Write the failing test (FR-1, AD-4)**
    Create `index.test.js` that spawns the entrypoint as a child process with
    color forced on, asserting it prints the five-line banner with ANSI codes and
    exits with a success status in a single synchronous pass (a non-zero exit
    would make `execFileSync` throw):
    ```js
    const { test } = require('node:test');
    const assert = require('node:assert/strict');
    const { execFileSync } = require('node:child_process');
    const path = require('node:path');

    test('index.js prints the banner once and exits successfully', () => {
      const out = execFileSync('node', [path.join(__dirname, 'index.js')], {
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '3' },
      });
      const lines = out.replace(/\n$/, '').split('\n');
      assert.equal(lines.length, 5);
      assert.match(out, /\[/);
    });
    ```

- [ ] **Step 2: Run the test, confirm it fails**
    Run: `npm test`
    Expected: FAIL — `index.js` does not exist, so the child process exits
    non-zero and `execFileSync` throws (FR-1, AD-4)

- [ ] **Step 3: Implement the entrypoint (FR-1, AD-3, AD-4)**
    Create `index.js` that imports the pure builder and writes the banner once
    with a single `console.log`, keeping render logic separate from output and
    using no timers, async loops, or argument parsing — the program renders in
    one synchronous pass and exits:
    ```js
    const { buildBanner } = require('./render');

    console.log(buildBanner());
    ```

- [ ] **Step 4: Run the test, confirm it passes**
    Run: `npm test`
    Expected: PASS — the entrypoint prints the five-line colored banner and exits
    with success (FR-1, AD-4)

### P02-T02: Author README usage and showcase

Establishes the README so a reader understands and can run the program — install
and run instructions plus a showcase of the ASCII-art output before they execute
it.

**Task type:** doc
**Requirements:** FR-6
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `README.md`

- [ ] **Step 1: Write the README with install, usage, and showcase (FR-6)**
    Create `README.md` documenting what the program produces, how to install and
    run it (`npm install`, then `npm start` or `node index.js`), how to run the
    tests (`npm test`), and a fenced showcase block of the ASCII-art banner so the
    output is visible before running:
    ```markdown
    # RAD-PLAN-BENCH

    A tiny Node.js CLI that prints "HELLO WORLD" as a large, blocky ASCII-art
    banner with each letter painted a different rainbow color, then exits.

    ## Showcase

    ```
    #   #  #####  #     #     #####     #   #  #####  ####   #     ####
    #   #  #      #     #     #   #     #   #  #   #  #   #  #     #   #
    #####  ####   #     #     #   #     # # #  #   #  ####   #     #   #
    #   #  #      #     #     #   #     ## ##  #   #  #  #   #     #   #
    #   #  #####  #####  #####  #####     #   #  #####  #   #  #####  ####
    ```

    (Each letter is rendered in a distinct rainbow hue in your terminal.)

    ## Install

    ```sh
    npm install
    ```

    ## Run

    ```sh
    npm start
    # or
    node index.js
    ```

    ## Test

    ```sh
    npm test
    ```

    ## Requirements

    - Node.js 18 or newer
    ```

- [ ] **Step 2: Verify the README renders and matches the program (FR-6)**
    Run: `node -e "const fs=require('fs');const r=fs.readFileSync('README.md','utf8');if(!/npm start/.test(r)||!/Showcase/.test(r))process.exit(1);console.log('README OK')"`
    Expected: prints `README OK`, confirming the README documents the run command
    and includes the output showcase (FR-6)
