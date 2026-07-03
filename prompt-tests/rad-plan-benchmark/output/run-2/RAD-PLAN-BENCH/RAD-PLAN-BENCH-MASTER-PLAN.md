---
project: "RAD-PLAN-BENCH"
type: master_plan
status: "draft"
created: "2026-06-27"
project-type: side-project
repos: [RAD-PLAN-BENCH]
repo-group: null
total_phases: 2
total_tasks: 5
author: "planner-agent"
---

# RAD-PLAN-BENCH — Master Plan

## Introduction

RAD-PLAN-BENCH is a single-command Node.js CLI that prints "HELLO WORLD" as large, blocky ASCII-art letters, each painted a different color cycling through the rainbow. The implementation is deliberately tiny: hardcoded glyphs, `chalk` for portable color, the Node built-in test runner, and a single `index.js` entrypoint that composes the banner and exits.

The plan builds the banner engine first — scaffold, glyph assembly, then rainbow coloring and centered layout as an importable, testable function — and then delivers the user-facing surface: the single-shot CLI entrypoint and a usage README. The project doubles as a small, end-to-end stress test of the orchestration pipeline rather than of the problem itself.

## P01: Banner Rendering Engine

Establishes the importable banner core: a scaffolded ESM project, a hardcoded glyph map that assembles "HELLO WORLD" into five aligned rows, and a rainbow colorizer that wraps each letter in a spectrum color and centers the block with vertical padding. When this phase completes, `renderBanner()` returns a finished, colored, centered multi-line string ready for any caller.

**Requirements:** FR-1, FR-2, FR-3, FR-4, NFR-1, NFR-2, NFR-3, AD-1, AD-2, AD-3, AD-4, DD-1, DD-2, DD-3
**Target repos:** RAD-PLAN-BENCH

**Execution order:**
    T01 → T02 → T03

### P01-T01: Scaffold ESM project and dependencies

Stand up the project manifest so the runtime engine, the lone `chalk` dependency, and the `start`/`test` entrypoints are declared and resolvable. This establishes the minimal, single-dependency ESM footprint the rest of the work builds on.

**Task type:** config
**Requirements:** FR-3, NFR-1, NFR-3, AD-3, AD-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `package.json`

- [ ] **Step 1: Author `package.json` with ESM, engine baseline, scripts, and the single dependency**
    Create `package.json` exactly as below. `"type": "module"` enables ESM for chalk v5; `engines.node` declares the Node 18+ baseline (NFR-3); `chalk` is the only production dependency (NFR-1); the `start` script aliases `node index.js` (FR-3, AD-3) and `test` runs the built-in runner (AD-4).
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
      "license": "MIT",
      "dependencies": {
        "chalk": "^5.3.0"
      }
    }
    ```

- [ ] **Step 2: Install the single production dependency**
    Run: `npm install`
    Expected: command exits 0; `chalk` resolves into `node_modules/chalk` and no other production dependency is added (NFR-1).

- [ ] **Step 3: Verify chalk resolves under ESM and reports a color level**
    Run: `node --input-type=module -e "import chalk from 'chalk'; process.stdout.write(String(chalk.level))"`
    Expected: prints a single digit `0`–`3` — chalk imported successfully under ESM and negotiated a terminal color level rather than throwing (NFR-1, NFR-2).

### P01-T02: Assemble ASCII-art glyph banner

Build the hardcoded glyph map and the composition function that turns "HELLO WORLD" into five aligned text rows. This delivers the deterministic, dependency-free letterform engine with a pluggable per-letter styling hook.

**Task type:** code
**Requirements:** FR-1, FR-4, NFR-1, AD-1, AD-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `banner.js`
- Test: `banner.test.js`

- [ ] **Step 1: Write the failing structural test for glyph composition**
    Create `banner.test.js` with the cases below. They assert the composed banner is five rows tall, every row carries glyph fill, and the plain (uncolored) row width matches the computed width — verifying the hardcoded glyph assembly produces a clear, aligned phrase (FR-1, AD-1, FR-4).
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { composeBanner, bannerWidth } from './banner.js';

    test('composeBanner returns five glyph rows', () => {
      const rows = composeBanner('HELLO WORLD');
      assert.equal(rows.length, 5);
    });

    test('every composed row carries glyph fill', () => {
      const rows = composeBanner('HELLO WORLD');
      for (const row of rows) {
        assert.ok(row.includes('#'), 'row should contain glyph fill characters');
      }
    });

    test('plain row width equals bannerWidth', () => {
      const rows = composeBanner('HELLO WORLD');
      assert.equal(rows[0].length, bannerWidth('HELLO WORLD'));
    });
    ```

- [ ] **Step 2: Run the test, confirm it fails**
    Run: `node --test banner.test.js`
    Expected: FAIL — `banner.js` does not yet exist / `composeBanner` and `bannerWidth` are not exported, so the import cannot resolve (FR-1, AD-1).

- [ ] **Step 3: Implement the glyph map and composition function**
    Create `banner.js` with the hardcoded glyph constants and assembly logic below. Each of H, E, L, O, W, R, D is a five-row, five-column string block (AD-1); the inter-word space is rendered as blank columns; `composeBanner` accepts an optional `colorize(letterIndex, segment)` hook (defaulting to identity) so coloring can be layered on later without changing assembly. No external ASCII-art library is used (NFR-1).
    ```js
    const GLYPH_HEIGHT = 5;
    const LETTER_GAP = ' ';
    const SPACE_GAP = '   ';
    const WORD = 'HELLO WORLD';

    const GLYPHS = {
      H: ['#   #', '#   #', '#####', '#   #', '#   #'],
      E: ['#####', '#    ', '#### ', '#    ', '#####'],
      L: ['#    ', '#    ', '#    ', '#    ', '#####'],
      O: [' ### ', '#   #', '#   #', '#   #', ' ### '],
      W: ['#   #', '#   #', '# # #', '## ##', '#   #'],
      R: ['#### ', '#   #', '#### ', '#  # ', '#   #'],
      D: ['#### ', '#   #', '#   #', '#   #', '#### '],
    };

    const identity = (index, segment) => segment;

    export function composeBanner(text = WORD, colorize = identity) {
      const rows = Array.from({ length: GLYPH_HEIGHT }, () => '');
      let letterIndex = 0;
      for (const ch of text) {
        if (ch === ' ') {
          for (let r = 0; r < GLYPH_HEIGHT; r++) rows[r] += SPACE_GAP;
          continue;
        }
        const glyph = GLYPHS[ch];
        const idx = letterIndex;
        for (let r = 0; r < GLYPH_HEIGHT; r++) {
          rows[r] += colorize(idx, glyph[r]) + LETTER_GAP;
        }
        letterIndex++;
      }
      return rows;
    }

    export function bannerWidth(text = WORD) {
      let width = 0;
      for (const ch of text) {
        width += ch === ' '
          ? SPACE_GAP.length
          : GLYPHS[ch][0].length + LETTER_GAP.length;
      }
      return width;
    }
    ```

- [ ] **Step 4: Run the test, confirm it passes**
    Run: `node --test banner.test.js`
    Expected: PASS — three tests green; the banner is five rows tall with glyph fill and the plain width matches `bannerWidth` (FR-1, FR-4, AD-1).

### P01-T03: Apply rainbow color and centered layout

Layer the fixed rainbow spectrum onto each letter and center the assembled block with blank-line padding above and below. This completes `renderBanner()` as the finished, colored, centered output any caller can print.

**Task type:** code
**Requirements:** FR-1, FR-2, FR-4, NFR-2, AD-2, AD-4, DD-1, DD-2, DD-3
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Modify: `banner.js`
- Test: `banner.test.js`

- [ ] **Step 1: Write the failing tests for coloring, looping, and layout**
    Append the cases below to `banner.test.js` (add `import chalk from 'chalk';` to the existing imports). They force a deterministic color level for the non-TTY test runner, then assert the output carries ANSI escapes (FR-2, AD-2, NFR-2, FR-4), that the spectrum loops after seven steps (DD-1, DD-2), and that the block is centered with blank padding lines top and bottom (DD-3, FR-1).
    ```js
    import chalk from 'chalk';
    import { renderBanner, rainbowColor } from './banner.js';

    test('renderBanner output contains ANSI color escapes', () => {
      chalk.level = 1;
      const out = renderBanner('HELLO WORLD', 80);
      assert.match(out, /\[/);
    });

    test('rainbow spectrum loops after seven steps', () => {
      chalk.level = 1;
      assert.equal(rainbowColor(0, 'x'), rainbowColor(7, 'x'));
      assert.notEqual(rainbowColor(0, 'x'), rainbowColor(1, 'x'));
    });

    test('renderBanner is centered with blank padding top and bottom', () => {
      const out = renderBanner('HELLO WORLD', 80);
      const lines = out.split('\n');
      assert.equal(lines[0], '');
      assert.equal(lines[lines.length - 1], '');
      assert.ok(lines.length >= 7);
      assert.ok(lines[1].startsWith(' '), 'body rows are left-padded for centering');
    });
    ```
    Note: setting `chalk.level` is test-only; `banner.js` itself never sets the level, so runtime auto-detection (NFR-2) is preserved.

- [ ] **Step 2: Run the test, confirm it fails**
    Run: `node --test banner.test.js`
    Expected: FAIL — `renderBanner` and `rainbowColor` are not yet exported from `banner.js`, so the new cases error on import (FR-2, DD-1, DD-3).

- [ ] **Step 3: Implement the rainbow colorizer and centered layout**
    Modify `banner.js`: add `import chalk from 'chalk';` at the top, and append the spectrum, the per-letter colorizer, and the layout function below. `RAINBOW` is the fixed red → orange → yellow → green → cyan → blue → purple cycle as portable hex values applied through `chalk.hex` (DD-1, AD-2); `rainbowColor` advances one hue per letter and wraps via modulo (DD-2); `renderBanner` composes with the colorizer, computes left padding from the terminal width, and frames the block with blank lines above and below (DD-3, FR-1, NFR-2).
    ```js
    import chalk from 'chalk';

    const RAINBOW = [
      '#ff0000', // red
      '#ff7f00', // orange
      '#ffff00', // yellow
      '#00ff00', // green
      '#00ffff', // cyan
      '#0000ff', // blue
      '#8b00ff', // purple
    ];

    export function rainbowColor(index, text) {
      const hex = RAINBOW[index % RAINBOW.length];
      return chalk.hex(hex)(text);
    }

    export function renderBanner(text = WORD, columns = process.stdout.columns || 80) {
      const rows = composeBanner(text, rainbowColor);
      const width = bannerWidth(text);
      const pad = ' '.repeat(Math.max(0, Math.floor((columns - width) / 2)));
      const body = rows.map((row) => pad + row);
      return ['', ...body, ''].join('\n');
    }
    ```

- [ ] **Step 4: Run the test, confirm it passes**
    Run: `node --test banner.test.js`
    Expected: PASS — all cases green; output carries ANSI escapes, the spectrum loops after seven hues, and the block is centered with blank padding lines (FR-2, DD-1, DD-2, DD-3, FR-4).

## P02: CLI Delivery And Documentation

Delivers the user-facing surface on top of the engine: a single-shot `index.js` that writes the rainbow banner to stdout and exits cleanly with no arguments or state, plus a usage README that shows how to install, run, and what the output looks like. When this phase completes, both `node index.js` and `npm start` print the banner and exit, verified by an automated subprocess test.

**Requirements:** FR-3, FR-4, FR-5, AD-3, AD-5, DD-4
**Target repos:** RAD-PLAN-BENCH

**Execution order:**
    T01 → T02

### P02-T01: Wire single-shot CLI entrypoint

Create the `index.js` entrypoint that renders the banner once, writes it to stdout in one synchronous pass, and exits — no argument parsing, no config, no persistent state. An automated subprocess test confirms the single-shot run produces a colored, multi-line banner and exits cleanly.

**Task type:** code
**Requirements:** FR-3, FR-4, AD-3, AD-5, DD-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `index.js`
- Test: `cli.test.js`

- [ ] **Step 1: Write the failing CLI integration test**
    Create `cli.test.js` with the case below. It spawns `node index.js` (with `FORCE_COLOR=1` so the child process emits ANSI deterministically), and asserts the run exits cleanly, prints a non-empty multi-line banner, and includes color escapes — verifying the single-shot invocation end to end (FR-3, FR-4).
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { execFileSync } from 'node:child_process';
    import { fileURLToPath } from 'node:url';
    import { dirname } from 'node:path';

    const here = dirname(fileURLToPath(import.meta.url));

    test('CLI prints a colored multi-line banner and exits cleanly', () => {
      const out = execFileSync('node', ['index.js'], {
        cwd: here,
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '1' },
      });
      const lines = out.split('\n');
      assert.ok(lines.length >= 6, 'banner spans multiple lines');
      assert.ok(out.trim().length > 0, 'banner is non-empty');
      assert.match(out, /\[/);
    });
    ```
    Note: `execFileSync` throws on a non-zero exit code, so a clean success exit is asserted implicitly by the call not throwing (FR-3).

- [ ] **Step 2: Run the test, confirm it fails**
    Run: `node --test cli.test.js`
    Expected: FAIL — `index.js` does not yet exist, so the spawned `node index.js` exits non-zero and `execFileSync` throws (FR-3, FR-4).

- [ ] **Step 3: Implement the single-shot entrypoint**
    Create `index.js` exactly as below. It imports the finished `renderBanner`, writes the banner plus a trailing newline to stdout in one synchronous pass, and falls off the end so the process exits cleanly. It reads no arguments, no config, and holds no state (AD-5), and produces a single static frame with no animation or redraw (DD-4). This shares the one code path used by both `node index.js` and `npm start` (AD-3, FR-3).
    ```js
    import { renderBanner } from './banner.js';

    process.stdout.write(renderBanner() + '\n');
    ```

- [ ] **Step 4: Run the test, confirm it passes**
    Run: `node --test cli.test.js`
    Expected: PASS — the spawned single-shot run exits 0 and prints a non-empty, multi-line, ANSI-colored banner (FR-3, FR-4, DD-4).

### P02-T02: Document usage in README

Author the README so a newcomer can understand what the project does, install the single dependency, run it both supported ways, and see a sample of the rainbow output. This completes the usage-focused documentation surface.

**Task type:** doc
**Requirements:** FR-5, FR-3, AD-3
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `README.md`

- [ ] **Step 1: Write the README with purpose, install, run, and sample output**
    Create `README.md` with the content below. It states what the project does, how to install, both run paths (`node index.js` and `npm start`), and a fenced sample of the ASCII-art output (FR-5). The documented run commands match the `package.json` entrypoints (FR-3, AD-3).
    ```markdown
    # RAD-PLAN-BENCH

    A tiny Node.js CLI that prints **HELLO WORLD** as large, blocky ASCII-art
    letters, each painted a different color cycling through the rainbow. It runs
    once, prints its banner, and exits — no flags, no config.

    ## Requirements

    - Node.js 18 or newer.

    ## Install

    ```sh
    npm install
    ```

    The only runtime dependency is [`chalk`](https://github.com/chalk/chalk) for
    portable terminal color.

    ## Run

    Either command prints the same banner and exits:

    ```sh
    node index.js
    # or
    npm start
    ```

    ## Sample output

    Each letter is rendered in a rainbow color (red → orange → yellow → green →
    cyan → blue → purple), centered with padding:

    ```text
    #   # ##### #     #      ###    #   #  ###  ####  #     ####
    #   # #     #     #     #   #   #   # #   # #   # #     #   #
    ##### #### #     #     #   #   # # # #   # ####  #     #   #
    #   # #     #     #     #   #   ## ## #   # #  #  #     #   #
    #   # ##### ##### #####  ###    #   #  ###  #   # ##### ####
    ```

    ## Test

    ```sh
    npm test
    ```
    ```

- [ ] **Step 2: Verify the documented run command produces the banner**
    Run: `npm start`
    Expected: prints the centered, multi-line rainbow "HELLO WORLD" banner and exits 0, confirming the README's run instructions are accurate (FR-5, FR-3).
