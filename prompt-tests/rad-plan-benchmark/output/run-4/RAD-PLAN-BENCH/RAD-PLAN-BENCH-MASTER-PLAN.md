---
project: "RAD-PLAN-BENCH"
type: master_plan
status: "draft"
created: "2026-06-27"
project-type: side-project
repos: ["RAD-PLAN-BENCH"]
repo-group: null
total_phases: 2
total_tasks: 6
author: "planner-agent"
---

# RAD-PLAN-BENCH — Master Plan

## Introduction

RAD-PLAN-BENCH is a tiny Node.js CLI that prints "HELLO WORLD" as a large, blocky ASCII-art banner with each letter painted a different rainbow hue, then exits. It is built as a clean end-to-end exercise of the planning-and-execution pipeline: a single `npm start` produces a centered, multicolored banner that works on modern terminals including Windows, backed by a minimal-dependency codebase and automated tests.

The build splits along its natural seams. The first phase delivers the dependency-free foundations — the package manifest and the two leaf modules (hardcoded glyph data and the rainbow palette) that have no I/O. The second phase composes those leaves into a centered banner, wires the one-shot entrypoint, and ships the README, leaving a runnable, documented, tested program.

## P01: Data and Palette Foundations
This phase establishes the runnable project skeleton and the two pure leaf modules everything else composes: the hardcoded ASCII glyph data and the rainbow color palette. When it completes, `npm test` runs, `chalk` is the lone installed dependency, and the glyph and color modules are independently verified.

**Requirements:** FR-1, FR-2, FR-5, NFR-1, NFR-2, NFR-3, NFR-4, NFR-5, AD-2, AD-3, AD-5, AD-6, DD-1, DD-2, DD-3
**Target repos:** RAD-PLAN-BENCH

**Execution order:**
    T01 → T02
        → T03

### P01-T01: Initialize package manifest and scripts
Establishes a runnable, testable project skeleton with `chalk` as the single dependency and the `start`/`test` scripts wired. After this task `npm test` executes the Node built-in runner and the Node 18 floor is declared.

**Task type:** config
**Requirements:** FR-5, NFR-1, NFR-3, NFR-5, AD-2, AD-5, AD-6, NFR-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: Write `package.json` with scripts, engines, and the single dependency (AD-5, FR-5, NFR-3, AD-2)**
    Create `package.json` exactly as below. `type: module` enables ESM (chalk v5 is ESM-only); `start` runs the entrypoint and `test` runs the Node built-in runner; `engines` declares the Node 18 floor; `chalk` is the only runtime dependency (AD-5, FR-5, NFR-3, AD-2, AD-6).
    ```json
    {
      "name": "rad-plan-bench",
      "version": "1.0.0",
      "description": "Prints HELLO WORLD as a rainbow ASCII-art banner and exits.",
      "type": "module",
      "main": "index.js",
      "scripts": {
        "start": "node index.js",
        "test": "node --test"
      },
      "engines": {
        "node": ">=18"
      },
      "dependencies": {
        "chalk": "^5.3.0"
      }
    }
    ```

- [ ] **Step 2: Write `.gitignore` to keep the tree minimal (NFR-1, NFR-5)**
    Create `.gitignore` with the single line below so installed packages stay out of version control and the code surface remains tiny (NFR-1, NFR-5).
    ```gitignore
    node_modules/
    ```

- [ ] **Step 3: Install the single dependency (NFR-1, AD-2)**
    Run: `npm install chalk@^5.3.0`
    Expected: `node_modules/chalk` is created and `package-lock.json` is written; no other runtime dependency is added (NFR-1, AD-2).

- [ ] **Step 4: Verify the test script is wired to the Node built-in runner (AD-6, NFR-4)**
    Run: `npm test`
    Expected: PASS — the `node --test` runner executes and exits 0 (it reports 0 tests discovered, since none exist yet), confirming the test script is correctly wired (AD-6, NFR-4).

### P01-T02: Author ASCII glyph data module
Delivers the hardcoded, deterministic ASCII letterforms for every character in "HELLO WORLD" plus a lookup helper, with no external art library. Each glyph shares a common height so letters align on a single baseline.

**Task type:** code
**Requirements:** FR-1, AD-3, DD-2, NFR-5
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `src/art.js`
- Test: `test/art.test.js`

- [ ] **Step 1: Write the failing test (FR-1, DD-2, AD-3)**
    Create `test/art.test.js` asserting the glyph table is uniform-height, each glyph is internally rectangular, and every character of "HELLO WORLD" resolves (FR-1, DD-2, AD-3).
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert';
    import { GLYPHS, GLYPH_HEIGHT, glyphFor } from '../src/art.js';

    test('every glyph shares the common height and is internally rectangular', () => {
      assert.ok(GLYPH_HEIGHT >= 3 && GLYPH_HEIGHT <= 5);
      for (const [char, rows] of Object.entries(GLYPHS)) {
        assert.strictEqual(rows.length, GLYPH_HEIGHT, `${char} height`);
        const width = rows[0].length;
        for (const row of rows) {
          assert.strictEqual(row.length, width, `${char} row width`);
        }
      }
    });

    test('glyphFor resolves letters case-insensitively', () => {
      assert.deepStrictEqual(glyphFor('h'), GLYPHS.H);
    });

    test('every character of HELLO WORLD has a glyph', () => {
      for (const ch of 'HELLO WORLD') {
        assert.doesNotThrow(() => glyphFor(ch));
      }
    });
    ```

- [ ] **Step 2: Run test, confirm it fails**
    Run: `node --test test/art.test.js`
    Expected: FAIL — `src/art.js` does not exist yet, so the import cannot be resolved (FR-1).

- [ ] **Step 3: Implement the glyph data and lookup (FR-1, AD-3, DD-2, NFR-5)**
    Create `src/art.js` with hardcoded 5-row blocky glyphs and a case-insensitive lookup that throws on unknown characters. The art is inline data, not library-generated (AD-3); all glyphs are 5 rows tall for a shared baseline (DD-2); the data stays tiny (NFR-5) and covers FR-1.
    ```js
    export const GLYPH_HEIGHT = 5;

    export const GLYPHS = {
      H: [
        '#   #',
        '#   #',
        '#####',
        '#   #',
        '#   #',
      ],
      E: [
        '#####',
        '#    ',
        '#### ',
        '#    ',
        '#####',
      ],
      L: [
        '#    ',
        '#    ',
        '#    ',
        '#    ',
        '#####',
      ],
      O: [
        ' ### ',
        '#   #',
        '#   #',
        '#   #',
        ' ### ',
      ],
      W: [
        '#   #',
        '#   #',
        '# # #',
        '## ##',
        '#   #',
      ],
      R: [
        '#### ',
        '#   #',
        '#### ',
        '#  # ',
        '#   #',
      ],
      D: [
        '#### ',
        '#   #',
        '#   #',
        '#   #',
        '#### ',
      ],
      ' ': [
        '   ',
        '   ',
        '   ',
        '   ',
        '   ',
      ],
    };

    export function glyphFor(char) {
      const glyph = GLYPHS[char.toUpperCase()];
      if (!glyph) {
        throw new Error(`No glyph defined for character: ${JSON.stringify(char)}`);
      }
      return glyph;
    }
    ```

- [ ] **Step 4: Run test, confirm pass**
    Run: `node --test test/art.test.js`
    Expected: PASS — all glyphs are 5 rows, internally rectangular, and every character of "HELLO WORLD" resolves (FR-1, DD-2, AD-3).

### P01-T03: Build rainbow color palette module
Delivers the spectral color palette and a per-index color selector built on `chalk`, so adjacent letters render as distinct hues that wrap after seven colors. Color is applied via chalk so it degrades gracefully off a TTY.

**Task type:** code
**Requirements:** FR-2, NFR-2, AD-2, DD-1, DD-3
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `src/colors.js`
- Test: `test/colors.test.js`

- [ ] **Step 1: Write the failing test (FR-2, DD-1, AD-2)**
    Create `test/colors.test.js`. It forces chalk's color level on so escape sequences are emitted in the non-TTY test process, then asserts the palette has seven spectral hues, wraps at the boundary, and produces distinct, escaped output per index (FR-2, DD-1, AD-2).
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert';
    import chalk from 'chalk';

    chalk.level = 3;

    const { RAINBOW, colorForIndex } = await import('../src/colors.js');

    test('palette holds seven spectral hues and wraps', () => {
      assert.strictEqual(RAINBOW.length, 7);
      assert.strictEqual(colorForIndex(0), colorForIndex(7));
    });

    test('each index paints a distinct, escaped string', () => {
      const first = colorForIndex(0)('X');
      const second = colorForIndex(1)('X');
      assert.match(first, /\[/);
      assert.notStrictEqual(first, second);
    });
    ```

- [ ] **Step 2: Run test, confirm it fails**
    Run: `node --test test/colors.test.js`
    Expected: FAIL — `src/colors.js` does not exist yet, so the dynamic import rejects (FR-2).

- [ ] **Step 3: Implement the palette and selector (FR-2, NFR-2, AD-2, DD-1, DD-3)**
    Create `src/colors.js` exposing the spectral palette in order red, orange, yellow, green, cyan, blue, purple, and a selector that wraps modulo the palette length. Color flows through chalk, which detects terminal capability and disables color off a TTY (AD-2, NFR-2); the spectral order and wrap satisfy DD-1; returning a whole-string painter supports per-letter coloring (DD-3) and FR-2.
    ```js
    import chalk from 'chalk';

    export const RAINBOW = [
      chalk.red,
      chalk.hex('#FFA500'),
      chalk.yellow,
      chalk.green,
      chalk.cyan,
      chalk.blue,
      chalk.magenta,
    ];

    export function colorForIndex(index) {
      return RAINBOW[index % RAINBOW.length];
    }
    ```

- [ ] **Step 4: Run test, confirm pass**
    Run: `node --test test/colors.test.js`
    Expected: PASS — the palette has seven hues, `colorForIndex(0)` and `colorForIndex(7)` are the same painter, and adjacent indices emit distinct escaped strings (FR-2, DD-1, AD-2).

## P02: Banner Assembly and Delivery
This phase composes the glyph data and palette into a colored, centered banner, wires the one-shot entrypoint that prints it and exits, and ships the README. When it completes, `npm start` and `node index.js` both render the centered rainbow banner and the repository documents how to run it.

**Requirements:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, NFR-2, NFR-3, NFR-4, AD-1, AD-4, AD-6, DD-3, DD-4
**Target repos:** RAD-PLAN-BENCH

**Execution order:**
    T01 → T02 → T03

### P02-T01: Assemble and center the banner
Joins per-letter glyphs side by side into colored rows and centers them against the terminal width, with a fixed fallback width and zero-clamped padding for narrow or non-interactive contexts. Each letter is painted a single advancing hue while inter-word space stays uncolored.

**Task type:** code
**Requirements:** FR-1, FR-4, AD-4, DD-3, DD-4, NFR-4, AD-6
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `src/banner.js`
- Test: `test/banner.test.js`

- [ ] **Step 1: Write the failing test (FR-1, FR-4, DD-4, DD-3)**
    Create `test/banner.test.js`. It forces chalk color on, then asserts the assembled banner spans the glyph height, carries color escapes, left-pads when the terminal is wider than the banner, and clamps padding to zero on a narrow terminal (FR-1, FR-4, DD-4, DD-3).
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert';
    import chalk from 'chalk';

    chalk.level = 3;

    const { assembleRows, centerBanner, FALLBACK_WIDTH } = await import('../src/banner.js');
    const { GLYPH_HEIGHT } = await import('../src/art.js');

    test('assembled banner spans the glyph height', () => {
      const { coloredRows } = assembleRows('HELLO WORLD');
      assert.strictEqual(coloredRows.length, GLYPH_HEIGHT);
    });

    test('assembled banner carries color escape sequences', () => {
      const { coloredRows } = assembleRows('HELLO WORLD');
      assert.match(coloredRows.join('\n'), /\[/);
    });

    test('a wide terminal left-pads every banner line', () => {
      const lines = centerBanner('HELLO WORLD', 200);
      assert.ok(lines.every((line) => line.startsWith(' ')));
    });

    test('a narrow terminal clamps padding to zero', () => {
      const { width } = assembleRows('HELLO WORLD');
      assert.ok(width > 1);
      const lines = centerBanner('HELLO WORLD', 1);
      assert.ok(!lines[0].startsWith(' '));
    });

    test('an undefined width falls back to the reference width', () => {
      assert.strictEqual(typeof FALLBACK_WIDTH, 'number');
      const padded = centerBanner('HELLO WORLD', undefined);
      const direct = centerBanner('HELLO WORLD', FALLBACK_WIDTH);
      assert.deepStrictEqual(padded, direct);
    });
    ```

- [ ] **Step 2: Run test, confirm it fails**
    Run: `node --test test/banner.test.js`
    Expected: FAIL — `src/banner.js` does not exist yet, so the dynamic import rejects (FR-1, FR-4).

- [ ] **Step 3: Implement assembly and centering (FR-1, FR-4, AD-4, DD-3, DD-4)**
    Create `src/banner.js` composing the glyph and color modules (AD-4). It paints each non-space letter with the next advancing hue while leaving inter-word space uncolored (DD-3), measures width from the uncolored rows so escape codes never inflate the layout, left-pads each line by `(cols - width) / 2` clamped to zero (DD-4), and falls back to a fixed reference width when columns are unavailable (FR-4). The joined glyph rows realize FR-1.
    ```js
    import { glyphFor, GLYPH_HEIGHT } from './art.js';
    import { colorForIndex } from './colors.js';

    export const FALLBACK_WIDTH = 80;

    export function assembleRows(text) {
      const coloredRows = Array.from({ length: GLYPH_HEIGHT }, () => '');
      const plainRows = Array.from({ length: GLYPH_HEIGHT }, () => '');
      const chars = [...text];
      let colorIndex = 0;

      chars.forEach((char, i) => {
        const glyph = glyphFor(char);
        const isLast = i === chars.length - 1;
        const isSpace = char === ' ';
        const paint = isSpace ? null : colorForIndex(colorIndex);
        const gap = isLast ? '' : ' ';

        for (let r = 0; r < GLYPH_HEIGHT; r++) {
          const cell = glyph[r];
          coloredRows[r] += (paint ? paint(cell) : cell) + gap;
          plainRows[r] += cell + gap;
        }

        if (!isSpace) {
          colorIndex += 1;
        }
      });

      return { coloredRows, width: plainRows[0].length };
    }

    export function centerBanner(text, terminalWidth) {
      const { coloredRows, width } = assembleRows(text);
      const cols = Number.isInteger(terminalWidth) ? terminalWidth : FALLBACK_WIDTH;
      const pad = Math.max(0, Math.floor((cols - width) / 2));
      const padding = ' '.repeat(pad);
      return coloredRows.map((row) => padding + row);
    }
    ```

- [ ] **Step 4: Run test, confirm pass**
    Run: `node --test test/banner.test.js`
    Expected: PASS — the banner spans the glyph height, carries color escapes, left-pads on a wide terminal, clamps to zero on a narrow one, and falls back to the reference width when columns are undefined (FR-1, FR-4, DD-4, NFR-4, AD-6).

### P02-T02: Wire the one-shot entrypoint
Delivers `index.js`, the composing entrypoint that reads the terminal width, prints the centered rainbow banner once, and lets the process exit 0 without looping or waiting. A spawned smoke test proves the full `node index.js` path renders a multi-line colored banner.

**Task type:** code
**Requirements:** FR-2, FR-3, FR-5, NFR-2, AD-1
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `index.js`
- Test: `test/index.test.js`

- [ ] **Step 1: Write the failing test (FR-3, FR-5, FR-2)**
    Create `test/index.test.js`. It spawns the entrypoint with `FORCE_COLOR=3` so chalk emits escapes through the pipe, asserts the process exits 0 (a non-zero exit makes `execFileSync` throw), and asserts the output is a multi-line colored banner (FR-3, FR-5, FR-2).
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert';
    import { execFileSync } from 'node:child_process';
    import { fileURLToPath } from 'node:url';

    const entrypoint = fileURLToPath(new URL('../index.js', import.meta.url));

    test('node index.js prints a multi-line colored banner and exits 0', () => {
      const output = execFileSync('node', [entrypoint], {
        env: { ...process.env, FORCE_COLOR: '3' },
        encoding: 'utf8',
      });
      const lines = output.replace(/\n$/, '').split('\n');
      assert.strictEqual(lines.length, 5);
      assert.match(output, /\[/);
    });
    ```

- [ ] **Step 2: Run test, confirm it fails**
    Run: `node --test test/index.test.js`
    Expected: FAIL — `index.js` does not exist yet, so `node index.js` exits non-zero and `execFileSync` throws (FR-3, FR-5).

- [ ] **Step 3: Implement the entrypoint (FR-3, FR-5, FR-2, NFR-2, AD-1)**
    Create `index.js` as the single composing entrypoint (AD-1). It reads `process.stdout.columns` (undefined off a TTY, where centering falls back), writes the centered rainbow banner once (FR-2, FR-5), and returns so the process exits 0 naturally without an explicit `process.exit`, ensuring buffered stdout flushes and nothing stays resident (FR-3). Chalk inside the banner pipeline handles graceful color degradation off a TTY (NFR-2).
    ```js
    import { centerBanner } from './src/banner.js';

    const TEXT = 'HELLO WORLD';

    function main() {
      const lines = centerBanner(TEXT, process.stdout.columns);
      process.stdout.write(lines.join('\n') + '\n');
    }

    main();
    ```

- [ ] **Step 4: Run test, confirm pass**
    Run: `node --test test/index.test.js`
    Expected: PASS — the spawned `node index.js` exits 0 and prints a five-line banner containing color escapes (FR-3, FR-5, FR-2).

### P02-T03: Write README usage and showcase
Ships a README that explains installing and running the program and shows a representation of the banner so a reader understands the result before running it. This is the final piece that makes the project reproducible and shareable.

**Task type:** doc
**Requirements:** FR-6, FR-5, NFR-3
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `README.md`

- [ ] **Step 1: Write the README with install, run, and showcase sections (FR-6, FR-5, NFR-3)**
    Create `README.md` with the content below. It states the Node 18+ floor (NFR-3), documents both `npm start` and the direct `node index.js` invocation (FR-5), and shows a plain-text representation of the banner so the result is understood before running (FR-6).
    ````markdown
    # RAD-PLAN-BENCH

    A tiny Node.js CLI that prints **HELLO WORLD** as a large, blocky ASCII-art
    banner, painting each letter a different rainbow hue, then exits.

    ## Requirements

    - Node.js 18 LTS or newer.

    ## Install

    ```bash
    npm install
    ```

    ## Run

    ```bash
    npm start
    # or, equivalently:
    node index.js
    ```

    Both commands print the same centered, rainbow-colored banner and exit.

    ## What you'll see

    The banner renders in color in your terminal; here it is without color:

    ```
    #   # ##### #     #      ###    #   #  ###  ####  #     ####
    #   # #     #     #     #   #   #   # #   # #   # #     #   #
    ##### ####  #     #     #   #   # # # #   # ####  #     #   #
    #   # #     #     #     #   #   ## ## #   # #  #  #     #   #
    #   # ##### ##### #####  ###    #   #  ###  #   # ##### ####
    ```

    ## Test

    ```bash
    npm test
    ```
    ````

- [ ] **Step 2: Verify the README renders and the commands it documents are accurate (FR-6, FR-5)**
    Run: `npm start`
    Expected: a centered rainbow "HELLO WORLD" banner prints and the process exits, matching the invocation and showcase the README documents (FR-6, FR-5).
