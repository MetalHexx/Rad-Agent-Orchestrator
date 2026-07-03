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

RAD-PLAN-BENCH is a zero-dependency Node.js CLI that prints "HELLO WORLD" as large blocky ASCII-art letters, each colored through a repeating rainbow spectrum, then exits. The work splits into a pure renderer that builds the colored multi-line banner string and a thin CLI/packaging layer that prints it and ships a test, README, and package metadata.

Phase 1 delivers the renderer and its unit tests: a hardcoded glyph font, the rainbow palette, and a pure assembly function with full color handling. Phase 2 wires the runnable entrypoint, npm scripts, engine constraint, and documentation so `npm start` produces the banner on a clean Node 18+ install.

## P01: Rainbow Banner Renderer
Delivers a pure, unit-tested renderer module that turns the text "HELLO WORLD" into a centered, multi-row ASCII-art banner with each letter colored through the rainbow palette. When the phase completes, calling the render function returns the finished colored string with no I/O performed.

**Requirements:** FR-1, FR-2, FR-3, FR-7, NFR-3, NFR-5, AD-1, AD-2, AD-3, AD-4, AD-5, DD-1, DD-2, DD-3, DD-4
**Target repos:** RAD-PLAN-BENCH

**Execution order:**
    T01 → T02

### P01-T01: Build the ASCII-art banner assembler
Establishes the hardcoded glyph font and the pure assembly that lays "HELLO WORLD" out as a multi-row blocky banner with a clean word gap and trailing newline, with color hooks left as a no-op pass-through. This is the structural skeleton the coloring task colors in.

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

    test('banner renders HEIGHT rows with a trailing newline', () => {
      const out = renderBanner();
      assert.ok(out.endsWith('\n'), 'output ends with a single trailing newline');
      const rows = out.replace(/\n$/, '').split('\n');
      assert.strictEqual(rows.length, HEIGHT, 'one line per glyph row');
    });

    test('banner preserves a visible gap between the two words', () => {
      const out = renderBanner();
      const firstRow = out.split('\n')[0];
      assert.match(firstRow, /\s{3,}/, 'word gap shows as a run of spaces');
    });
    ```

- [ ] **Step 2: Run test, confirm it fails**
    Run: `node --test test/banner.test.js`
    Expected: FAIL — `src/banner.js` does not exist yet, so the import throws (FR-1, FR-2)

- [ ] **Step 3: Implement minimal code (FR-1, FR-2, AD-1, AD-3, AD-5, DD-2, DD-4, NFR-5)**
    Create `src/banner.js` with a hardcoded 5-row glyph map and a pure assembler. Coloring is a pass-through stub here so the structure is testable on its own:
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
    function paint(code, segment) {
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
    Expected: PASS — banner has 5 rows, trailing newline, and a visible word gap (FR-1, FR-2, DD-2, DD-4)

### P01-T02: Add rainbow coloring and renderer tests
Establishes per-letter rainbow coloring via raw ANSI escapes with a reset after each letter, and locks the renderer's color contract with unit tests. After this task the renderer emits a fully colored banner string.

**Task type:** code
**Requirements:** FR-3, FR-7, NFR-3, AD-2, AD-4, DD-1, DD-3
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Modify: `src/banner.js`
- Test: `test/banner.test.js`

- [ ] **Step 1: Write the failing test (FR-3, FR-7, DD-1, DD-3)**
    Append to `test/banner.test.js`:
    ```js
    test('banner emits ANSI 256-color escapes', () => {
      const { renderBanner } = require('../src/banner.js');
      const out = renderBanner();
      assert.match(out, /\x1b\[38;5;\d+m/, 'at least one foreground color escape present');
    });

    test('each colored segment is reset so color does not bleed', () => {
      const { renderBanner } = require('../src/banner.js');
      const out = renderBanner();
      const opens = (out.match(/\x1b\[38;5;\d+m/g) || []).length;
      const resets = (out.match(/\x1b\[0m/g) || []).length;
      assert.strictEqual(opens, resets, 'every color open has a matching reset');
    });

    test('palette has the seven rainbow colors in order', () => {
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
    Update the `module.exports` line to also export `PALETTE`:
    ```js
    module.exports = { renderBanner, paint, GLYPHS, PALETTE, HEIGHT };
    ```
    The existing `renderBanner` already calls `paint(colorIndex, row)` per non-space letter, so coloring now advances one palette step per visible letter (DD-1) and resets after each (DD-3) using raw ANSI for modern terminals (NFR-3, AD-2).

- [ ] **Step 4: Run test, confirm pass**
    Run: `node --test test/banner.test.js`
    Expected: PASS — color escapes present, opens match resets, palette length is 7 (FR-3, FR-7, DD-1, DD-3)

## P02: CLI Entrypoint and Packaging
Delivers the runnable CLI surface around the renderer: a single-invocation entrypoint that prints the banner once and exits 0, npm `start`/`test` scripts, the Node 18+ engine constraint with zero runtime dependencies, and user-facing documentation. When the phase completes, a clean checkout runs end-to-end via `npm start`.

**Requirements:** FR-4, FR-5, FR-6, FR-8, NFR-1, NFR-2, NFR-4, AD-3
**Target repos:** RAD-PLAN-BENCH

**Execution order:**
    T01 → T02

### P02-T01: Wire CLI entrypoint and npm scripts
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

### P02-T02: Write README and run docs
Establishes user-facing documentation: install steps, how to run via `node index.js` and `npm start`, the supported Node version, and a static showcase of the banner. This is the doc surface that makes the project shareable.

**Task type:** doc
**Requirements:** FR-8, NFR-1, NFR-2
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `README.md`

- [ ] **Step 1: Write the README skeleton and usage (FR-8)**
    Create `README.md` with a title, one-line description, and a "Usage" section documenting both invocations:
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
    Add a "Requirements" section stating the project needs Node.js 18+ and has no runtime dependencies (`npm install` is optional; the CLI runs from a bare checkout). State that tests run with `npm test` on Node's built-in runner (NFR-1, NFR-2).

- [ ] **Step 3: Add the banner showcase (FR-8)**
    Add a "Showcase" section with a fenced code block showing the static ASCII-art layout of "HELLO WORLD" (uncolored, since markdown cannot render ANSI) so readers see the shape before running it (FR-8).
