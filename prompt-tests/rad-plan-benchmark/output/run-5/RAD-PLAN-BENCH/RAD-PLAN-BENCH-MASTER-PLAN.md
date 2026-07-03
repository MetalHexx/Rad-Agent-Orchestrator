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

RAD-PLAN-BENCH is a single-entrypoint Node.js CLI that prints "HELLO WORLD" as large, blocky ASCII art with each letter painted a rainbow color, then exits. The build is split into a rendering core — scaffold, ASCII glyph assembly, and colorization — followed by the CLI delivery layer that wires the core to stdout and documents the result.

The rendering logic lives in pure functions returning strings so the output is assertable without spawning a process, while the entrypoint stays a thin I/O shell. Tests use Node's built-in `node:test` runner to keep the dependency footprint to chalk alone.

## P01: Banner Rendering Core

This phase delivers a fully tested, colorizable ASCII banner: a scaffolded project, a pure renderer that assembles centered "HELLO WORLD" glyph art, and a rainbow colorization layer with a plain-text fallback. When complete, calling the core functions yields the finished banner string ready for output.

**Requirements:** FR-1, FR-2, FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-5, AD-2, AD-3, AD-4, AD-5, DD-1, DD-2, DD-3
**Target repos:** RAD-PLAN-BENCH

**Execution order:**
    T01 → T02 → T03

### P01-T01: Scaffold project and tooling

Establish the Node.js project skeleton: package metadata, engine range, npm scripts, and the single chalk dependency. This task makes `npm start` and `npm test` resolvable and pins the runtime to modern LTS.

**Task type:** config
**Requirements:** FR-4, NFR-1, NFR-2, AD-5
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: Author `package.json` with engines, scripts, and chalk dep (NFR-1, NFR-2, AD-5, FR-4)**
    Create `package.json` declaring ESM, the Node LTS engine floor, the two npm scripts, and chalk as the sole runtime dependency:
    ```json
    {
      "name": "rad-plan-bench",
      "version": "1.0.0",
      "description": "Prints HELLO WORLD as rainbow ASCII art.",
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
      },
      "license": "MIT"
    }
    ```
- [ ] **Step 2: Add `.gitignore` for node artifacts (NFR-1)**
    Create `.gitignore` so dependency and OS noise stays out of the repo:
    ```gitignore
    node_modules/
    npm-debug.log*
    .DS_Store
    ```
- [ ] **Step 3: Install dependencies and confirm scripts resolve (NFR-1, AD-5)**
    Run: `npm install`
    Expected: chalk installed under `node_modules/`; `npm start` and `npm test` are recognized scripts (NFR-1, AD-5).

### P01-T02: Build ASCII banner renderer

Implement the pure rendering core that turns "HELLO WORLD" into centered, multi-row blocky ASCII art from a hardcoded glyph map. The renderer returns structured per-letter rows so the colorization layer can paint each letter independently.

**Task type:** code
**Requirements:** FR-1, FR-5, NFR-5, AD-2, AD-4, DD-2, DD-3
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `src/glyphs.js`
- Create: `src/banner.js`
- Test: `test/banner.test.js`

- [ ] **Step 1: Write the failing test (FR-1, FR-5, DD-2, DD-3, AD-4)**
    Create `test/banner.test.js`:
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { renderLetters, assembleRows, centerRows, GLYPH_HEIGHT } from '../src/banner.js';

    test('renderLetters returns one block per visible char with fixed height', () => {
      const letters = renderLetters('HELLO WORLD');
      assert.equal(letters.length, 'HELLO WORLD'.length);
      for (const l of letters) {
        assert.equal(l.rows.length, GLYPH_HEIGHT);
      }
    });

    test('assembleRows joins blocks into GLYPH_HEIGHT lines containing all letters', () => {
      const rows = assembleRows(renderLetters('HELLO WORLD'));
      assert.equal(rows.length, GLYPH_HEIGHT);
      const joined = rows.join('\n');
      for (const ch of 'HELOWRD') assert.ok(joined.includes('#'), `expected fill blocks for ${ch}`);
    });

    test('centerRows left-pads every row to the field width', () => {
      const rows = centerRows(['abc', 'de'], 11);
      assert.ok(rows.every((r) => r.length >= 'abc'.length));
      assert.equal(rows[0].indexOf('a'), rows[1].indexOf('d'));
    });
    ```
- [ ] **Step 2: Run test, confirm it fails (FR-1)**
    Run: `npm test -- test/banner.test.js`
    Expected: FAIL — `src/banner.js` and `src/glyphs.js` do not exist yet (FR-1).
- [ ] **Step 3: Implement the glyph map and renderer (FR-1, FR-5, AD-2, AD-4, DD-2, DD-3)**
    Create `src/glyphs.js` with a hardcoded 5-row glyph per required letter (AD-2, DD-2):
    ```js
    export const GLYPH_HEIGHT = 5;

    // Each glyph is GLYPH_HEIGHT rows of equal width; '#' = fill, ' ' = blank.
    export const GLYPHS = {
      H: ['#   #', '#   #', '#####', '#   #', '#   #'],
      E: ['#####', '#    ', '#### ', '#    ', '#####'],
      L: ['#    ', '#    ', '#    ', '#    ', '#####'],
      O: [' ### ', '#   #', '#   #', '#   #', ' ### '],
      W: ['#   #', '#   #', '# # #', '## ##', '#   #'],
      R: ['#### ', '#   #', '#### ', '#  # ', '#   #'],
      D: ['#### ', '#   #', '#   #', '#   #', '#### '],
      ' ': ['     ', '     ', '     ', '     ', '     '],
    };
    ```
    Create `src/banner.js` as pure functions (AD-4) that render, space, and center (DD-2, DD-3):
    ```js
    import { GLYPHS, GLYPH_HEIGHT } from './glyphs.js';

    export { GLYPH_HEIGHT };

    // One block per character: { char, rows: string[] of length GLYPH_HEIGHT }.
    export function renderLetters(text) {
      return [...text].map((char) => {
        const glyph = GLYPHS[char] ?? GLYPHS[' '];
        return { char, rows: glyph.slice() };
      });
    }

    // Join per-letter blocks into GLYPH_HEIGHT lines, one blank column between letters (DD-2).
    export function assembleRows(letters) {
      const rows = [];
      for (let r = 0; r < GLYPH_HEIGHT; r++) {
        rows.push(letters.map((l) => l.rows[r]).join(' '));
      }
      return rows;
    }

    // Left-pad each row so the block is centered in a field of `width` columns (FR-5, DD-3).
    export function centerRows(rows, width = 80) {
      const max = Math.max(...rows.map((r) => r.length));
      const pad = max >= width ? 0 : Math.floor((width - max) / 2);
      const prefix = ' '.repeat(pad);
      return rows.map((r) => prefix + r);
    }
    ```
- [ ] **Step 4: Run test, confirm pass (FR-1, FR-5, NFR-5)**
    Run: `npm test -- test/banner.test.js`
    Expected: PASS — letters render at fixed height, assemble into the banner, and center correctly (FR-1, FR-5, NFR-5).

### P01-T03: Add rainbow colorization with fallback

Layer rainbow coloring onto the rendered letters: each visible letter gets the next color in the spectrum, cycling through the palette, while spaces stay uncolored. A plain-text path emits no escape codes when color is unsupported.

**Task type:** code
**Requirements:** FR-2, FR-6, NFR-3, NFR-5, AD-3, DD-1
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `src/colorize.js`
- Test: `test/colorize.test.js`

- [ ] **Step 1: Write the failing test (FR-2, FR-6, DD-1)**
    Create `test/colorize.test.js`:
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { RAINBOW, colorLines } from '../src/colorize.js';
    import { renderLetters, assembleRows } from '../src/banner.js';

    const tag = (name) => (s) => `<${name}>${s}</${name}>`;
    const fakePalette = RAINBOW.map((name) => tag(name));

    test('RAINBOW is the seven-color spectrum in order', () => {
      assert.deepEqual(RAINBOW, ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple']);
    });

    test('colorLines wraps each visible letter and cycles the palette (FR-2, DD-1)', () => {
      const letters = renderLetters('HELLO WORLD');
      const lines = colorLines(letters, fakePalette).join('\n');
      assert.ok(lines.includes('<red>'));   // first visible letter
      assert.ok(lines.includes('<blue>'));  // palette cycled past 7 letters
    });

    test('colorLines with identity palette injects no markup (FR-6)', () => {
      const identity = RAINBOW.map(() => (s) => s);
      const plain = colorLines(renderLetters('HELLO WORLD'), identity).join('\n');
      const bare = assembleRows(renderLetters('HELLO WORLD')).join('\n');
      assert.equal(plain, bare);
    });
    ```
- [ ] **Step 2: Run test, confirm it fails (FR-2)**
    Run: `npm test -- test/colorize.test.js`
    Expected: FAIL — `src/colorize.js` does not exist yet (FR-2).
- [ ] **Step 3: Implement colorization with injected palette (FR-2, FR-6, NFR-3, AD-3, DD-1)**
    Create `src/colorize.js` taking a palette of color functions so production wiring passes chalk and tests pass fakes (AD-3, NFR-3):
    ```js
    import { GLYPH_HEIGHT } from './glyphs.js';

    // Rainbow order, mapped to chalk color names downstream (DD-1).
    export const RAINBOW = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'];

    // letters: [{ char, rows }]; palette: array of (s) => string color fns aligned to RAINBOW.
    // Each visible letter takes the next palette entry, cycling; spaces stay bare (FR-2, FR-6, DD-1).
    export function colorLines(letters, palette) {
      let colorIdx = 0;
      const colored = letters.map((l) => {
        if (l.char === ' ') return l.rows.slice();
        const paint = palette[colorIdx % palette.length];
        colorIdx += 1;
        return l.rows.map((row) => paint(row));
      });
      const rows = [];
      for (let r = 0; r < GLYPH_HEIGHT; r++) {
        rows.push(colored.map((block) => block[r]).join(' '));
      }
      return rows;
    }
    ```
- [ ] **Step 4: Run test, confirm pass (FR-2, FR-6, NFR-5)**
    Run: `npm test -- test/colorize.test.js`
    Expected: PASS — letters cycle through the rainbow and the identity palette yields bare text (FR-2, FR-6, NFR-5).

## P02: CLI Delivery

This phase delivers the runnable program and its documentation: a thin entrypoint that builds the colored banner, centers it, writes it to stdout exactly once, and exits, plus a README that showcases the result. When complete, `npm start` prints the rainbow banner end-to-end.

**Requirements:** FR-3, FR-4, FR-6, NFR-3, NFR-4, NFR-5, NFR-6, AD-1, AD-3, DD-3, DD-4
**Target repos:** RAD-PLAN-BENCH

**Execution order:**
    T01 → T02

### P02-T01: Wire CLI entrypoint and stdout output

Build the thin I/O shell that composes the renderer and colorizer with chalk, centers the banner, and writes it to stdout with a single trailing newline before exiting. Chalk's auto color detection provides the plain-text fallback path.

**Task type:** code
**Requirements:** FR-3, FR-4, FR-6, NFR-3, NFR-4, NFR-5, AD-1, AD-3, DD-3, DD-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `src/render.js`
- Create: `index.js`
- Test: `test/render.test.js`

- [ ] **Step 1: Write the failing test (FR-3, FR-6, DD-3, DD-4)**
    Create `test/render.test.js` exercising the composition function that `index.js` will call:
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { buildBanner } from '../src/render.js';

    test('buildBanner returns a single trailing-newline string with no leading blank line (DD-4)', () => {
      const out = buildBanner({ color: false });
      assert.equal(typeof out, 'string');
      assert.ok(out.endsWith('\n'));
      assert.ok(!out.startsWith('\n'));
    });

    test('buildBanner({color:false}) contains the banner fill and no ANSI escapes (FR-6)', () => {
      const out = buildBanner({ color: false });
      assert.ok(out.includes('#'));
      assert.ok(!out.includes('['));
    });

    test('buildBanner({color:true}) injects ANSI escape codes (FR-2)', () => {
      const out = buildBanner({ color: true });
      assert.ok(out.includes('['));
    });
    ```
- [ ] **Step 2: Run test, confirm it fails (FR-3)**
    Run: `npm test -- test/render.test.js`
    Expected: FAIL — `src/render.js` does not exist yet (FR-3).
- [ ] **Step 3: Implement the composition module and entrypoint (FR-3, FR-4, FR-6, NFR-3, NFR-4, AD-1, AD-3, DD-3, DD-4)**
    Create `src/render.js` mapping the rainbow names to chalk and composing the pipeline (AD-3, DD-3, DD-4):
    ```js
    import { Chalk } from 'chalk';
    import { renderLetters, assembleRows, centerRows } from './banner.js';
    import { RAINBOW, colorLines } from './colorize.js';

    const TEXT = 'HELLO WORLD';
    const WIDTH = 80;

    // chalk color names; 'orange'/'purple' fall back to nearest chalk names.
    const CHALK_NAMES = {
      red: 'red', orange: 'yellow', yellow: 'yellow',
      green: 'green', cyan: 'cyan', blue: 'blue', purple: 'magenta',
    };

    export function buildBanner({ color } = {}) {
      const letters = renderLetters(TEXT);
      const useColor = color ?? true;
      let rows;
      if (useColor) {
        const chalk = new Chalk({ level: 1 });
        const palette = RAINBOW.map((name) => (s) => chalk[CHALK_NAMES[name]](s));
        rows = colorLines(letters, palette);
      } else {
        rows = assembleRows(letters);
      }
      return centerRows(rows, WIDTH).join('\n') + '\n';
    }
    ```
    Create `index.js` as the thin shell that runs once and exits (AD-1, FR-3, FR-4, NFR-4):
    ```js
    import { buildBanner } from './src/render.js';

    // Ignore any args (FR-4); chalk auto-detects color support for the live stream (FR-6).
    const supportsColor = process.stdout.isTTY === true;
    process.stdout.write(buildBanner({ color: supportsColor }));
    process.exit(0);
    ```
- [ ] **Step 4: Run test, confirm pass (FR-3, FR-6, NFR-5)**
    Run: `npm test -- test/render.test.js`
    Expected: PASS — colored and plain composition both behave; output ends in one newline (FR-3, FR-6, NFR-5).

### P02-T02: Author README usage showcase

Document installation, the run command, and the visual result so the project is self-evident to anyone cloning it. The README anchors the single-command run surface and shows an ASCII preview of the banner.

**Task type:** doc
**Requirements:** FR-4, NFR-6
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `README.md`

- [ ] **Step 1: Write install and usage sections (FR-4, NFR-6)**
    Create `README.md` with a title, one-line description, and an Install/Usage section documenting the single-command run surface:
    ```markdown
    # RAD-PLAN-BENCH

    Prints **HELLO WORLD** as large ASCII art, each letter painted across the rainbow.

    ## Install
    ```
    npm install
    ```

    ## Usage
    ```
    npm start
    ```
    Runs once, prints the banner, and exits. No flags, no config.
    ```
    The Usage section names `npm start` as the only command (FR-4, NFR-6).
- [ ] **Step 2: Add an ASCII preview and requirements note (NFR-6, NFR-2)**
    Append a "Preview" section showing the uncolored banner shape and a note that Node.js >= 18 is required:
    ```markdown
    ## Preview
    ```
    #   # #####         #     #     #####
    #   # #             #     #     #   #
    ##### ####          #     #     #   #
    #   # #             #     #     #   #
    #   # #####         #####  ##### #####
    ```
    > Colors render in any modern terminal (macOS, Linux, Windows Terminal); plain text elsewhere.

    Requires Node.js >= 18.
    ```
    The preview makes the output self-evident and records the runtime floor (NFR-6, NFR-2).
