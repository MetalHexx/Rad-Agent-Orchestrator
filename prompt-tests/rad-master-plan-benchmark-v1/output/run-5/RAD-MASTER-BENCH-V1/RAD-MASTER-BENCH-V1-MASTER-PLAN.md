---
project: "RAD-MASTER-BENCH-V1"
type: master_plan
status: "draft"
created: "2026-06-29"
project-type: side-project
repos: ["RAD-MASTER-BENCH-V1"]
repo-group: null
total_phases: 2
total_tasks: 5
author: "planner-agent"
---

# RAD-MASTER-BENCH-V1 — Master Plan

## Introduction

RAD-MASTER-BENCH-V1 is a dependency-free Node.js CLI that prints "HELLO WORLD" as large blocky ASCII-art letters, each one colored through a repeating seven-color rainbow, then exits cleanly. The implementation is two small source modules — a pure renderer that builds the colored banner string and a thin entrypoint that writes it to stdout — verified by Node's built-in test runner and documented by a usage README.

The plan delivers the project scaffold and the pure renderer first, so the banner can be produced and unit-tested in isolation, then wires the run-once entrypoint and writes the README that showcases the output. No runtime dependencies are introduced at any step; everything leans on Node.js built-ins only.

## P01: Rendering Engine and Project Scaffold

Delivers a runnable, fully tested rendering core: a `package.json` that pins Node 18+ and wires `start`/`test` scripts with zero dependencies, plus a pure renderer module that turns "HELLO WORLD" into a rainbow-colored multi-line banner string. When this phase completes, `npm test` passes and the renderer produces the colored banner without any process I/O.

**Requirements:** FR-1, FR-2, FR-3, FR-6, FR-7, NFR-1, NFR-2, NFR-3, NFR-5, AD-1, AD-2, AD-3, AD-4, AD-5, DD-1, DD-2, DD-3, DD-4
**Target repos:** RAD-MASTER-BENCH-V1

**Execution order:**
    T01
       → T02
          → T03 (depends on T02)

### P01-T01: Scaffold project manifest and scripts

Establishes the package manifest that pins the Node 18+ runtime, exposes `npm start` and `npm test`, and guarantees an empty runtime-dependency set. This is the contract that ties the two source modules together and keeps the project dependency-free.

**Task type:** config
**Requirements:** FR-6, NFR-1, NFR-2, AD-4, AD-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `package.json`

- [ ] **Step 1: Author package.json with metadata, engines, and scripts (NFR-2, AD-5)**
    Create `package.json` declaring the entrypoint, the Node 18+ engines floor, the `start` and `test` scripts, and empty dependency blocks:
    ```json
    {
      "name": "rad-master-bench-v1",
      "version": "1.0.0",
      "description": "Print HELLO WORLD as large rainbow ASCII-art in the terminal, dependency-free.",
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
      "devDependencies": {},
      "license": "MIT"
    }
    ```
- [ ] **Step 2: Confirm start and test scripts resolve to the entrypoint and built-in runner**
    Run: `node -e "const p=require('./package.json'); if(p.scripts.start!=='node index.js'||p.scripts.test!=='node --test')process.exit(1)"`
    Expected: exit 0 — `start` runs the entrypoint and `test` runs the Node built-in runner (FR-6, AD-4)
- [ ] **Step 3: Confirm the runtime dependency set is empty**
    Run: `node -e "const p=require('./package.json'); if(Object.keys(p.dependencies||{}).length)process.exit(1)"`
    Expected: exit 0 — no runtime dependencies are declared (NFR-1)
- [ ] **Step 4: Confirm the Node 18+ engines floor is declared**
    Run: `node -e "const p=require('./package.json'); if(!/>=\s*18/.test(p.engines.node))process.exit(1)"`
    Expected: exit 0 — the engines field pins Node 18 or newer (NFR-2)

### P01-T02: Define glyph font and rainbow palette

Establishes the hardcoded ASCII-art font and the fixed rainbow color palette as the renderer module's data layer. Every required letter and the inter-word space are stored as fixed-size glyphs, and the seven rainbow colors are stored as raw ANSI escape constants.

**Task type:** code
**Requirements:** FR-2, AD-1, AD-2, DD-1, NFR-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `renderer.js`
- Test: `test/glyphs.test.js`

- [ ] **Step 1: Write the failing test (FR-2, AD-1, DD-1)**
    Create `test/glyphs.test.js` asserting that every required glyph exists at the fixed height and width, and that the palette is the seven-color rainbow expressed as raw ANSI codes:
    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const {
      GLYPHS,
      GLYPH_HEIGHT,
      GLYPH_WIDTH,
      PALETTE,
      RESET,
    } = require('../renderer');

    const REQUIRED = ['H', 'E', 'L', 'O', 'W', 'R', 'D', ' '];

    test('every required glyph is defined with the standard height', () => {
      for (const ch of REQUIRED) {
        assert.ok(Array.isArray(GLYPHS[ch]), `missing glyph for "${ch}"`);
        assert.strictEqual(GLYPHS[ch].length, GLYPH_HEIGHT);
      }
    });

    test('every glyph row has the fixed glyph width', () => {
      for (const ch of REQUIRED) {
        for (const row of GLYPHS[ch]) {
          assert.strictEqual(row.length, GLYPH_WIDTH);
        }
      }
    });

    test('palette is the seven-color rainbow as raw ANSI codes', () => {
      assert.strictEqual(PALETTE.length, 7);
      for (const code of PALETTE) {
        assert.match(code, /^\x1b\[38;5;\d+m$/);
      }
    });

    test('reset is the ANSI SGR reset sequence', () => {
      assert.strictEqual(RESET, '\x1b[0m');
    });
    ```
- [ ] **Step 2: Run the test, confirm it fails**
    Run: `node --test test/glyphs.test.js`
    Expected: FAIL — `Cannot find module '../renderer'` because the renderer module does not exist yet (FR-2)
- [ ] **Step 3: Implement the glyph map and palette constants (AD-1, AD-2, DD-1)**
    Create `renderer.js` with the fixed-size glyph map (each character is five rows of six columns, the last column blank for inter-letter spacing), the seven rainbow ANSI codes in spectrum order, and the reset code:
    ```js
    'use strict';

    const GLYPH_HEIGHT = 5;
    const GLYPH_WIDTH = 6;

    const GLYPHS = {
      H: ['#   # ', '#   # ', '##### ', '#   # ', '#   # '],
      E: ['##### ', '#     ', '####  ', '#     ', '##### '],
      L: ['#     ', '#     ', '#     ', '#     ', '##### '],
      O: [' ###  ', '#   # ', '#   # ', '#   # ', ' ###  '],
      W: ['#   # ', '#   # ', '# # # ', '## ## ', '#   # '],
      R: ['####  ', '#   # ', '####  ', '#  #  ', '#   # '],
      D: ['####  ', '#   # ', '#   # ', '#   # ', '####  '],
      ' ': ['      ', '      ', '      ', '      ', '      '],
    };

    const RESET = '\x1b[0m';

    const PALETTE = [
      '\x1b[38;5;196m',
      '\x1b[38;5;208m',
      '\x1b[38;5;226m',
      '\x1b[38;5;46m',
      '\x1b[38;5;51m',
      '\x1b[38;5;21m',
      '\x1b[38;5;129m',
    ];

    module.exports = { GLYPH_HEIGHT, GLYPH_WIDTH, GLYPHS, PALETTE, RESET };
    ```
- [ ] **Step 4: Run the test, confirm it passes**
    Run: `node --test test/glyphs.test.js`
    Expected: PASS — all glyphs are fixed-size and the seven-color rainbow palette is defined (FR-2, DD-1)

### P01-T03: Assemble the colored banner renderer

Establishes the pure `renderBanner` function that composes the glyph rows into a multi-line banner, advances the rainbow color per visible letter, separates the two words with a blank glyph, resets color after each colored segment, and returns the finished string with a single trailing newline. The function performs no I/O, making it directly unit-testable.

**Task type:** code
**Requirements:** FR-1, FR-3, FR-7, AD-2, AD-3, NFR-3, NFR-5, DD-1, DD-2, DD-3, DD-4
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Modify: `renderer.js`
- Test: `test/renderer.test.js`

- [ ] **Step 1: Write the failing test (FR-1, FR-3, FR-7, DD-2, DD-3, DD-4)**
    Create `test/renderer.test.js` asserting the row count, the presence of color codes, balanced color/reset pairs, the inter-word blank glyph, and clean trailing/leading whitespace:
    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const { renderBanner, GLYPH_HEIGHT, GLYPH_WIDTH } = require('../renderer');

    const SPACE_CELL_START = 'HELLO'.length * GLYPH_WIDTH;

    function plainRows(output) {
      return output
        .replace(/\n$/, '')
        .split('\n')
        .map((row) => row.replace(/\x1b\[[0-9;]*m/g, ''));
    }

    test('banner renders exactly the glyph-height number of rows', () => {
      const rows = plainRows(renderBanner());
      assert.strictEqual(rows.length, GLYPH_HEIGHT);
    });

    test('banner includes at least one ANSI color escape sequence', () => {
      assert.match(renderBanner(), /\x1b\[38;5;\d+m/);
    });

    test('every colored letter is reset so color never bleeds', () => {
      const output = renderBanner();
      const opens = (output.match(/\x1b\[38;5;\d+m/g) || []).length;
      const resets = (output.match(/\x1b\[0m/g) || []).length;
      assert.ok(opens > 0);
      assert.strictEqual(opens, resets);
    });

    test('the inter-word gap is a full blank glyph between the two words', () => {
      for (const row of plainRows(renderBanner())) {
        assert.strictEqual(
          row.slice(SPACE_CELL_START, SPACE_CELL_START + GLYPH_WIDTH),
          '      ',
        );
      }
    });

    test('banner ends with a single trailing newline and no leading blank line', () => {
      const output = renderBanner();
      assert.ok(output.endsWith('\n'));
      assert.ok(!output.startsWith('\n'));
    });
    ```
- [ ] **Step 2: Run the test, confirm it fails**
    Run: `node --test test/renderer.test.js`
    Expected: FAIL — `renderBanner is not a function` because the renderer module does not export it yet (FR-1)
- [ ] **Step 3: Implement the pure render function (FR-1, FR-3, AD-2, AD-3, DD-1, DD-2, DD-3, DD-4)**
    Append `renderBanner` to `renderer.js` and update the exports. The function colors only visible letters (the space consumes no palette index), wraps each colored glyph segment with the reset, and ends with one trailing newline:
    ```js
    function renderBanner() {
      const text = 'HELLO WORLD';
      const colors = [];
      let letterIndex = 0;
      for (const ch of text) {
        if (ch === ' ') {
          colors.push(null);
        } else {
          colors.push(PALETTE[letterIndex % PALETTE.length]);
          letterIndex += 1;
        }
      }

      const lines = [];
      for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
        let line = '';
        for (let i = 0; i < text.length; i += 1) {
          const glyphRow = GLYPHS[text[i]][row];
          const color = colors[i];
          line += color === null ? glyphRow : `${color}${glyphRow}${RESET}`;
        }
        lines.push(line);
      }

      return `${lines.join('\n')}\n`;
    }

    module.exports = {
      GLYPH_HEIGHT,
      GLYPH_WIDTH,
      GLYPHS,
      PALETTE,
      RESET,
      renderBanner,
    };
    ```
    Replace the existing `module.exports = { GLYPH_HEIGHT, GLYPH_WIDTH, GLYPHS, PALETTE, RESET };` line from the previous task with the expanded exports shown above.
- [ ] **Step 4: Run the test, confirm it passes**
    Run: `node --test test/renderer.test.js`
    Expected: PASS — the renderer returns a five-row rainbow banner with a blank word gap, reset color segments, and one trailing newline (FR-1, FR-3, FR-7, NFR-3, DD-2, DD-3, DD-4)

## P02: CLI Entrypoint and Documentation

Delivers the user-facing surface: a run-once entrypoint that prints the banner and exits cleanly while ignoring arguments and stdin, and a README that documents installation, usage, the supported Node version, and a static showcase. When this phase completes, `npm start` renders the rainbow banner on a modern terminal and the project is fully documented.

**Requirements:** FR-4, FR-5, FR-8, NFR-1, NFR-2, NFR-3, NFR-4, NFR-5, AD-3, AD-4, AD-5
**Target repos:** RAD-MASTER-BENCH-V1

**Execution order:**
    T01 (depends on the P01 renderer)
    T02 (independent; documents the finished tool)

### P02-T01: Wire the run-once CLI entrypoint

Establishes the thin `index.js` entrypoint — the only module that writes to stdout — which calls the pure renderer once, prints the banner, ignores any arguments, reads no stdin, and exits with status 0. An integration test spawns the process to confirm the run-once, argument-agnostic behavior.

**Task type:** code
**Requirements:** FR-4, FR-5, NFR-4, AD-3, AD-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `index.js`
- Test: `test/cli.test.js`

- [ ] **Step 1: Write the failing test (FR-4, FR-5)**
    Create `test/cli.test.js` that spawns the entrypoint as a child process; `execFileSync` throws on a non-zero exit, so a successful call confirms exit 0, and passing extra arguments confirms they are ignored:
    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const { execFileSync } = require('node:child_process');
    const path = require('node:path');

    const ENTRY = path.join(__dirname, '..', 'index.js');

    test('entrypoint prints the banner and exits 0 even with extra arguments', () => {
      const output = execFileSync(process.execPath, [ENTRY, '--unused', 'ignored'], {
        encoding: 'utf8',
      });
      const lines = output.replace(/\n$/, '').split('\n');
      assert.strictEqual(lines.length, 5);
      assert.match(output, /\x1b\[38;5;\d+m/);
      assert.ok(output.endsWith('\n'));
    });

    test('entrypoint output is identical across runs and reads no stdin', () => {
      const first = execFileSync(process.execPath, [ENTRY], { encoding: 'utf8' });
      const second = execFileSync(process.execPath, [ENTRY], { encoding: 'utf8' });
      assert.strictEqual(first, second);
    });
    ```
- [ ] **Step 2: Run the test, confirm it fails**
    Run: `node --test test/cli.test.js`
    Expected: FAIL — `execFileSync` throws `ENOENT` because `index.js` does not exist yet (FR-4)
- [ ] **Step 3: Implement the entrypoint (FR-4, FR-5, NFR-4, AD-3, AD-5)**
    Create `index.js` that requires the renderer and writes the banner once to stdout; it reads no `process.argv` and no stdin, and lets the process exit naturally with status 0 after the write drains:
    ```js
    #!/usr/bin/env node
    'use strict';

    const { renderBanner } = require('./renderer');

    process.stdout.write(renderBanner());
    ```
- [ ] **Step 4: Run the test, confirm it passes**
    Run: `node --test test/cli.test.js`
    Expected: PASS — the entrypoint prints the banner once and exits 0 regardless of arguments, completing effectively instantly (FR-4, FR-5, NFR-4)

### P02-T02: Write the usage and showcase README

Establishes the README that documents how to install and run the CLI, the supported Node version, the modern-terminal expectation, and a static plain-text showcase of the banner output. This is the shareable front door that frames the project as dependency-free and small.

**Task type:** doc
**Requirements:** FR-8, NFR-1, NFR-2, NFR-3, NFR-5, AD-4
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `README.md`

- [ ] **Step 1: Author the full README (FR-8, NFR-1, NFR-2, NFR-3, NFR-5, AD-4)**
    Create `README.md` with the title, dependency-free framing, requirements (Node 18+, ANSI terminal), install and usage instructions, a static plain-text showcase that matches the renderer output, and the test command:
    ````markdown
    # Rainbow HELLO WORLD

    Prints **HELLO WORLD** as large, blocky ASCII-art letters, each colored through a repeating seven-color rainbow (red, orange, yellow, green, cyan, blue, purple), then exits cleanly. It uses only Node.js built-in modules — zero runtime dependencies.

    ## Requirements

    - **Node.js 18 or newer** (modern LTS). The floor is enforced by the `engines` field in `package.json`.
    - A terminal with **ANSI / 256-color support** — modern macOS and Linux terminals, and Windows Terminal. Legacy terminals without ANSI support are out of scope.

    ## Installation

    ```bash
    git clone <repository-url>
    cd rad-master-bench-v1
    ```

    There is nothing to install: the project pulls in no runtime dependencies.

    ## Usage

    ```bash
    npm start
    ```

    or equivalently:

    ```bash
    node index.js
    ```

    The banner prints exactly once and the process exits. Any command-line arguments are ignored and no input is read from stdin.

    ## Showcase

    In an ANSI terminal each letter is rainbow-colored. Rendered as plain text the banner looks like this:

    ```
    #   # ##### #     #      ###        #   #  ###  ####  #     ####
    #   # #     #     #     #   #       #   # #   # #   # #     #   #
    ##### ####  #     #     #   #       # # # #   # ####  #     #   #
    #   # #     #     #     #   #       ## ## #   # #  #  #     #   #
    #   # ##### ##### #####  ###        #   #  ###  #   # ##### ####
    ```

    ## Testing

    ```bash
    npm test
    ```

    This runs the Node.js built-in test runner (`node --test`) over the unit tests, which assert the banner's row structure and the presence of ANSI color codes.
    ````
- [ ] **Step 2: Verify the README documents install, usage, and the Node 18 floor (FR-8, NFR-2)**
    Run: `node -e "const r=require('fs').readFileSync('README.md','utf8'); process.exit(r.includes('npm start') && /Node\.js 18/.test(r) && r.includes('node --test') ? 0 : 1)"`
    Expected: exit 0 — the README names the run command, the Node 18 floor, and the built-in test runner (FR-8, NFR-2, AD-4)
- [ ] **Step 3: Verify the showcase block matches the rendered banner (FR-8, NFR-5)**
    Run: `node -e "const {renderBanner}=require('./renderer'); const r=require('fs').readFileSync('README.md','utf8'); const lines=renderBanner().replace(/\x1b\[[0-9;]*m/g,'').split('\n').map(l=>l.trimEnd()).filter(Boolean); for(const l of lines){ if(!r.includes(l)){ console.error('missing showcase line'); process.exit(1);} } console.log('ok');"`
    Expected: prints `ok` and exits 0 — every plain banner row appears in the README showcase, keeping docs and output in sync (FR-8, NFR-5)
