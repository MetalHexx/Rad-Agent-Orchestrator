---
project: "RAD-PLAN-BENCH"
type: master_plan
status: "draft"
created: "2026-06-27"
project-type: side-project
repos: ["RAD-PLAN-BENCH"]
repo-group: null
total_phases: 2
total_tasks: 4
author: "planner-agent"
---

# RAD-PLAN-BENCH — Master Plan

## Introduction

RAD-PLAN-BENCH is a zero-dependency Node.js CLI that prints "HELLO WORLD" as large blocky ASCII-art letters, each colored through a repeating rainbow spectrum, then exits. The work divides cleanly into a pure renderer that assembles the colored multi-line banner string and a thin CLI/packaging layer that prints it once and ships a test, README, and package metadata.

Phase 1 delivers the renderer and its unit tests: a hardcoded glyph font, the rainbow palette, and a pure assembly function that performs no I/O. Phase 2 wires the runnable entrypoint, npm scripts, the Node 18+ engine constraint, and the documentation so a clean checkout runs end-to-end via `npm start`.

## P01: Rainbow Banner Renderer
Delivers a pure, unit-tested renderer module that turns "HELLO WORLD" into a multi-row ASCII-art banner with each letter colored through the rainbow palette. When the phase completes, calling the render function returns the finished colored string with no I/O performed.

**Requirements:** FR-1, FR-2, FR-3, FR-7, NFR-3, NFR-5, AD-1, AD-2, AD-3, AD-4, AD-5, DD-1, DD-2, DD-3, DD-4
**Target repos:** RAD-PLAN-BENCH

**Execution order:**
    T01 → T02

### P01-T01: Assemble the ASCII-art banner
Establishes the hardcoded glyph font and the pure assembler that lays "HELLO WORLD" out as a multi-row blocky banner with a clean word gap and a trailing newline, with coloring left as a pass-through stub. This is the structural skeleton the next task colors in.

**Task type:** code
**Requirements:** FR-1, FR-2, AD-1, AD-3, AD-5, DD-2, DD-4, NFR-5
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `src/banner.js`
- Test: `test/banner.test.js`

- [ ] **Step 1: Write the failing test (FR-1, FR-2, DD-2, DD-4)**
    Create `test/banner.test.js`:
    ```js
    const test = require('node:test');
    const assert = require('node:assert');
    const { renderBanner, HEIGHT } = require('../src/banner.js');

    test('banner renders HEIGHT rows ending in a single trailing newline', () => {
      const out = renderBanner();
      assert.ok(out.endsWith('\n'), 'output ends with a trailing newline');
      assert.ok(!out.endsWith('\n\n'), 'only a single trailing newline');
      const rows = out.replace(/\n$/, '').split('\n');
      assert.strictEqual(rows.length, HEIGHT, 'one line per glyph row');
    });

    test('banner shows a visible gap between HELLO and WORLD', () => {
      const firstRow = renderBanner().split('\n')[0];
      assert.match(firstRow, /\s{3,}/, 'word gap reads as a run of spaces');
    });
    ```

- [ ] **Step 2: Run test, confirm it fails**
    Run: `node --test test/banner.test.js`
    Expected: FAIL — `src/banner.js` does not exist yet, so the require throws (FR-1, FR-2)

- [ ] **Step 3: Implement minimal code (FR-1, FR-2, AD-1, AD-3, AD-5, DD-2, DD-4, NFR-5)**
    Create `src/banner.js` with a hardcoded 5-row glyph map and a pure assembler. Coloring is a pass-through stub here so the layout is testable on its own:
    ```js
    'use strict';

    const HEIGHT = 5;

    const GLYPHS = {
      H: ['#   #', '#   #', '#####', '#   #', '#   #'],
      E: ['#####', '#    ', '#### ', '#    ', '#####'],
      L: ['#    ', '#    ', '#    ', '#    ', '#####'],
      O: [' ### ', '#   #', '#   #', '#   #', ' ### '],
      W: ['#   #', '#   #', '# # #', '## ##', '#   #'],
      R: ['#### ', '#   #', '#### ', '#  # ', '#   #'],
      D: ['#### ', '#   #', '#   #', '#   #', '#### '],
      ' ': ['     ', '     ', '     ', '     ', '     '],
    };

    // Color hook — replaced with real ANSI coloring in P01-T02.
    function paint(colorIndex, segment) {
      return segment;
    }

    function renderBanner(text = 'HELLO WORLD') {
      const chars = text.toUpperCase().split('');
      let colorIndex = 0;
      const perChar = chars.map((ch) => {
        const glyph = GLYPHS[ch] || GLYPHS[' '];
        if (ch === ' ') return glyph.slice();
        const painted = glyph.map((row) => paint(colorIndex, row));
        colorIndex += 1;
        return painted;
      });
      const lines = [];
      for (let r = 0; r < HEIGHT; r += 1) {
        lines.push(perChar.map((g) => g[r]).join(' '));
      }
      return lines.join('\n') + '\n';
    }

    module.exports = { renderBanner, paint, GLYPHS, HEIGHT };
    ```

- [ ] **Step 4: Run test, confirm pass**
    Run: `node --test test/banner.test.js`
    Expected: PASS — banner has 5 rows, a single trailing newline, and a visible word gap (FR-1, FR-2, DD-2, DD-4)

### P01-T02: Add rainbow coloring to the renderer
Establishes per-letter rainbow coloring via raw ANSI 256-color escapes with a reset after each letter, and locks the color contract with unit tests. After this task the renderer emits a fully colored banner string.

**Task type:** code
**Requirements:** FR-3, FR-7, NFR-3, AD-2, AD-4, DD-1, DD-3
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Modify: `src/banner.js`
- Test: `test/banner.test.js`

- [ ] **Step 1: Write the failing test (FR-3, FR-7, DD-1, DD-3)**
    Append to `test/banner.test.js`:
    ```js
    test('banner emits ANSI 256-color foreground escapes', () => {
      const out = renderBanner();
      assert.match(out, /\x1b\[38;5;\d+m/, 'at least one foreground color escape present');
    });

    test('every color open is matched by a reset so color never bleeds', () => {
      const out = renderBanner();
      const opens = (out.match(/\x1b\[38;5;\d+m/g) || []).length;
      const resets = (out.match(/\x1b\[0m/g) || []).length;
      assert.strictEqual(opens, resets, 'one reset per color open');
    });

    test('palette holds the seven rainbow colors in order', () => {
      const { PALETTE } = require('../src/banner.js');
      assert.strictEqual(PALETTE.length, 7, 'red→orange→yellow→green→cyan→blue→purple');
    });
    ```

- [ ] **Step 2: Run test, confirm it fails**
    Run: `node --test test/banner.test.js`
    Expected: FAIL — `paint` is still a pass-through and `PALETTE` is not exported, so the color and palette assertions fail (FR-3, FR-7)

- [ ] **Step 3: Implement minimal code (FR-3, NFR-3, AD-2, AD-4, DD-1, DD-3)**
    In `src/banner.js`, add the fixed rainbow palette and make `paint` emit real ANSI 256-color escapes with a reset, then export `PALETTE`:
    ```js
    const RESET = '\x1b[0m';

    // red, orange, yellow, green, cyan, blue, purple — xterm-256 codes.
    const PALETTE = [196, 208, 226, 46, 51, 21, 93];

    function paint(colorIndex, segment) {
      const code = PALETTE[colorIndex % PALETTE.length];
      return `\x1b[38;5;${code}m${segment}${RESET}`;
    }
    ```
    Update the export line to also expose `PALETTE`:
    ```js
    module.exports = { renderBanner, paint, GLYPHS, PALETTE, HEIGHT };
    ```
    `renderBanner` already calls `paint(colorIndex, row)` once per visible letter, so color now advances one palette step per letter (DD-1) and resets after each (DD-3) using raw ANSI for modern terminals (NFR-3, AD-2). Tests run on Node's built-in runner (AD-4).

- [ ] **Step 4: Run test, confirm pass**
    Run: `node --test test/banner.test.js`
    Expected: PASS — color escapes present, opens match resets, palette length is 7 (FR-3, FR-7, DD-1, DD-3)

## P02: CLI Entrypoint and Packaging
Delivers the runnable CLI surface around the renderer: a single-invocation entrypoint that prints the banner once and exits 0, npm `start`/`test` scripts, the Node 18+ engine pin with zero runtime dependencies, and user-facing documentation. When the phase completes, a clean checkout runs end-to-end via `npm start`.

**Requirements:** FR-4, FR-5, FR-6, FR-8, NFR-1, NFR-2, NFR-4, AD-3
**Target repos:** RAD-PLAN-BENCH

**Execution order:**
    T01 → T02

### P02-T01: Wire CLI entrypoint and npm scripts
Establishes `index.js` as the run-once entrypoint that prints the rendered banner and exits cleanly, plus a `package.json` with start/test scripts, the engine pin, and an empty runtime-dependency set. After this task `npm start` prints the banner.

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
    Create `index.js` — the only place that performs I/O (AD-3); it renders once, writes, and lets the process exit 0 without reading args or stdin:
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

### P02-T02: Write README and usage docs
Establishes the user-facing documentation: install steps, how to run via `node index.js` and `npm start`, the supported Node version, and a static showcase of the banner. This is the doc surface that makes the project shareable.

**Task type:** doc
**Requirements:** FR-8, NFR-1, NFR-2
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `README.md`

- [ ] **Step 1: Write the README skeleton and usage (FR-8)**
    Create `README.md` with a title, a one-line description, and a "Usage" section documenting both invocations:
    ```markdown
    # RAD-PLAN-BENCH

    A zero-dependency Node.js CLI that prints "HELLO WORLD" in large rainbow ASCII art.

    ## Usage

    ```bash
    node index.js
    # or
    npm start
    ```
    ```
    The two documented commands must match the `start` script and entrypoint shipped in P02-T01 (FR-8).

- [ ] **Step 2: Document requirements and zero-dependency footprint (NFR-1, NFR-2)**
    Add a "Requirements" section stating the project needs Node.js 18+ and has no runtime dependencies (the CLI runs from a bare checkout). Note that tests run with `npm test` on Node's built-in runner (NFR-1, NFR-2).

- [ ] **Step 3: Add the banner showcase (FR-8)**
    Add a "Showcase" section with a fenced code block showing the static ASCII-art layout of "HELLO WORLD" (uncolored, since markdown cannot render ANSI) so readers see the shape before running it (FR-8).
