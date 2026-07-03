---
project: "RAD-MASTER-BENCH-V1"
type: master_plan
status: "draft"
created: "2026-06-29"
project-type: side-project
repos: ["RAD-MASTER-BENCH-V1"]
repo-group: null
total_phases: 2
total_tasks: 3
author: "planner-agent"
---

# RAD-MASTER-BENCH-V1 — Master Plan

## Introduction

RAD-MASTER-BENCH-V1 is a small, dependency-free Node.js CLI that prints "HELLO WORLD" as large blocky ASCII-art letters, each colored through a repeating seven-color rainbow cycle emitted with raw ANSI escape codes. The build is a two-module layout: a pure renderer module that assembles the colored multi-line banner string, and a thin entrypoint that is the only place that writes to standard output. A package manifest wires `npm start` and `npm test`, and the whole thing leans exclusively on Node.js built-ins.

The plan is two phases. The first phase builds the working CLI end-to-end — the renderer with its hardcoded glyph font and rainbow palette, then the entrypoint and package manifest that make `npm start` run it once and exit cleanly. The second phase ships the usage README with a static showcase of the banner.

## P01: Rainbow Banner CLI

This phase delivers a runnable CLI: a unit-tested pure renderer that produces the colored "HELLO WORLD" banner, plus an entrypoint and package manifest so `npm start` (or `node index.js`) prints the banner exactly once and exits with status 0, using only Node.js built-ins.

**Requirements:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, NFR-1, NFR-2, NFR-3, NFR-4, NFR-5, AD-1, AD-2, AD-3, AD-4, AD-5, DD-1, DD-2, DD-3, DD-4
**Target repos:** RAD-MASTER-BENCH-V1

**Execution order:**
    T01 → T02 (entrypoint requires the renderer module)

### P01-T01: Build rainbow banner renderer

Establishes the pure rendering core: a hardcoded ASCII-art font and a fixed rainbow palette assembled into the colored multi-line "HELLO WORLD" banner string, with no I/O. A unit test pins the row count, the presence of ANSI color, and the trailing-newline contract.

**Task type:** code
**Requirements:** FR-1, FR-2, FR-3, FR-7, NFR-5, AD-1, AD-2, AD-3, AD-4, AD-5, DD-1, DD-2, DD-3, DD-4
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `banner.js`
- Test: `test/banner.test.js`

- [ ] **Step 1: Write the failing renderer test (FR-7, AD-3, AD-4)**
Create `test/banner.test.js`. The test imports the pure renderer (no process output captured), asserts the banner has exactly the expected number of ASCII-art rows (FR-1, FR-2), asserts at least one ANSI color escape sequence is present by checking for the CSI introducer ESC + `[` (FR-3, AD-2), and asserts a single trailing newline with no doubled newline (DD-4). It runs on the Node built-in test runner (AD-4). The ANSI escape character is built with `String.fromCharCode(27)` so the test source carries no non-printable control bytes.

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { renderBanner, GLYPH_HEIGHT } = require('../banner.js');

// CSI introducer: ESC (0x1B) followed by '['. Built from a char code so the
// source stays free of non-printable control bytes.
const CSI = String.fromCharCode(27) + '[';

test('renders the expected number of ASCII-art rows', () => {
  const output = renderBanner();
  const rows = output.split('\n').filter((line) => line.length > 0);
  assert.strictEqual(rows.length, GLYPH_HEIGHT);
});

test('emits at least one ANSI color escape sequence', () => {
  const output = renderBanner();
  assert.ok(output.includes(CSI));
});

test('ends with exactly one trailing newline', () => {
  const output = renderBanner();
  assert.ok(output.endsWith('\n'));
  assert.ok(!output.endsWith('\n\n'));
});
```

- [ ] **Step 2: Run the test, confirm it fails**
Run: `node --test test/banner.test.js`
Expected: FAIL — `banner.js` does not exist yet, so the `require('../banner.js')` throws `Cannot find module` before any assertion runs (FR-7, AD-5).

- [ ] **Step 3: Implement the renderer module (FR-1, FR-2, FR-3, NFR-5, AD-1, AD-2, AD-3, AD-5, DD-1, DD-2, DD-3, DD-4)**
Create `banner.js` exactly as below. It builds the ANSI escape character with `String.fromCharCode(27)` (no control bytes in source), defines the fixed ordered rainbow palette as raw ANSI SGR foreground codes (AD-2, DD-1), and a hardcoded glyph map of equal-width row strings for H/E/L/O/W/R/D plus the inter-word space (AD-1, FR-2, DD-2). The pure `renderBanner()` advances one palette color per visible letter — the space glyph consumes no color index — wraps every colored cell with an ANSI reset so color never bleeds (DD-3), and returns the joined rows with one trailing newline (FR-1, DD-4). The module performs no I/O (AD-3) and exports the pure function (AD-5). It stays small and scannable (NFR-5).

```js
'use strict';

// ANSI escape character (0x1B), built from a char code so this source carries
// no non-printable control bytes.
const ESC = String.fromCharCode(27);

// Fixed ordered rainbow palette as raw ANSI SGR foreground codes:
// red, orange, yellow, green, cyan, blue, purple.
const PALETTE = [
  ESC + '[38;5;196m', // red
  ESC + '[38;5;208m', // orange
  ESC + '[38;5;226m', // yellow
  ESC + '[38;5;46m',  // green
  ESC + '[38;5;51m',  // cyan
  ESC + '[38;5;21m',  // blue
  ESC + '[38;5;129m', // purple
];

// Emitted after every colored glyph segment so color never bleeds past it.
const RESET = ESC + '[0m';

// Every glyph is this many rows tall.
const GLYPH_HEIGHT = 5;

// Hardcoded ASCII-art font: per-character arrays of equal-width row strings.
const GLYPHS = {
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
  // Inter-word gap: a blank glyph separating HELLO and WORLD.
  ' ': [
    '   ',
    '   ',
    '   ',
    '   ',
    '   ',
  ],
};

const TEXT = 'HELLO WORLD';

// Pure function: returns the fully colored, multi-line banner string.
// No I/O — the caller is responsible for writing it to standard output.
function renderBanner() {
  const segments = [];
  let colorIndex = 0;
  for (const char of TEXT) {
    const rows = GLYPHS[char];
    if (char === ' ') {
      // The gap consumes no color index, keeping the spectrum continuous
      // across the visible letters of HELLOWORLD.
      segments.push({ rows, color: null });
    } else {
      segments.push({ rows, color: PALETTE[colorIndex % PALETTE.length] });
      colorIndex += 1;
    }
  }

  const lines = [];
  for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
    const cells = segments.map((segment) => {
      const cell = segment.rows[row];
      return segment.color ? segment.color + cell + RESET : cell;
    });
    lines.push(cells.join(' '));
  }

  return lines.join('\n') + '\n';
}

module.exports = { renderBanner, GLYPH_HEIGHT, PALETTE };
```

- [ ] **Step 4: Run the test, confirm it passes**
Run: `node --test test/banner.test.js`
Expected: PASS — the banner is exactly 5 rows tall, contains the ANSI CSI introducer (one palette color per visible letter, each reset), and ends with a single trailing newline (FR-7, FR-2, FR-3, DD-4).

### P01-T02: Wire CLI entrypoint and package manifest

Establishes the runnable surface: an entrypoint that is the sole writer to standard output, printing the banner once and exiting cleanly while ignoring arguments and stdin, plus a package manifest that wires `npm start`/`npm test`, declares the Node 18+ engine, and keeps runtime dependencies empty. An integration test drives the CLI as a child process to confirm the behavior end-to-end.

**Task type:** code
**Requirements:** FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-3, NFR-4, AD-3, AD-4, AD-5
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `index.js`
- Create: `package.json`
- Test: `test/cli.test.js`

- [ ] **Step 1: Write the failing CLI integration test (FR-4, FR-5, NFR-3)**
Create `test/cli.test.js`. It spawns the entrypoint as a child process with extra arguments to prove they are ignored (FR-5), asserts the run exits with status 0 (`execFileSync` throws on any non-zero exit, so reaching the assertions proves exit 0) and printed the banner once with the expected row count (FR-4), and asserts the output carries the ANSI CSI introducer so it renders on a modern terminal (NFR-3).

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ENTRY = path.join(__dirname, '..', 'index.js');
const CSI = String.fromCharCode(27) + '[';

test('prints the banner once and exits 0, even with extra arguments', () => {
  const output = execFileSync(process.execPath, [ENTRY, '--unused', 'extra'], {
    encoding: 'utf8',
  });
  const rows = output.split('\n').filter((line) => line.length > 0);
  assert.strictEqual(rows.length, 5);
  assert.ok(output.includes(CSI));
});
```

- [ ] **Step 2: Run the test, confirm it fails**
Run: `node --test test/cli.test.js`
Expected: FAIL — `index.js` does not exist yet, so the spawned process errors with `Cannot find module`, exits non-zero, and `execFileSync` throws (FR-4, AD-5).

- [ ] **Step 3: Implement the entrypoint and package manifest (FR-4, FR-5, FR-6, NFR-1, NFR-2, NFR-4, AD-3, AD-4, AD-5)**
Create `index.js` exactly as below: it requires the renderer module and is the only place that writes to standard output (AD-3, AD-5), writing the banner exactly once. It reads no arguments and no stdin (FR-5); with nothing keeping the event loop alive, the process exits naturally and effectively instantly with status 0 (FR-4, NFR-4).

```js
'use strict';

const { renderBanner } = require('./banner.js');

// The entrypoint is the only place that performs I/O. Command-line arguments
// and stdin are ignored; the banner is written exactly once and the process
// exits naturally with status 0.
process.stdout.write(renderBanner());
```

Then create `package.json` exactly as below: a `start` script makes `npm start` equivalent to `node index.js` (FR-6), a `test` script runs the Node built-in test runner (AD-4), `engines.node` declares the Node 18+ LTS baseline (NFR-2), and `dependencies` is empty with no `devDependencies` because the test runner is built in (NFR-1).

```json
{
  "name": "rad-master-bench-v1",
  "version": "1.0.0",
  "description": "Prints HELLO WORLD as large rainbow ASCII-art letters.",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "test": "node --test"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {},
  "license": "MIT"
}
```

- [ ] **Step 4: Run the test suite, confirm it passes**
Run: `npm test`
Expected: PASS — `node --test` discovers and passes both `test/cli.test.js` and `test/banner.test.js`, proving the CLI prints the banner once and exits 0 with arguments ignored (FR-4, FR-5) and the `test` script is correctly wired (AD-4). Also run `npm start` and confirm it prints the colored banner exactly once and returns to the prompt (FR-6, NFR-3).

## P02: Usage Documentation

This phase delivers the user-facing README: install and run instructions, the supported Node version, the zero-dependency posture, the modern-terminal requirement, and a static showcase of the banner output.

**Requirements:** FR-8, NFR-1, NFR-2, NFR-3
**Target repos:** RAD-MASTER-BENCH-V1

**Execution order:**
    T01 (requires the working CLI delivered by P01)

### P02-T01: Author usage README and showcase

Establishes the project's documentation: how to install and run the CLI, the supported runtime, the dependency-free posture, and a static, ANSI-stripped showcase of the rendered banner.

**Task type:** doc
**Requirements:** FR-8, NFR-1, NFR-2, NFR-3
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `README.md`

- [ ] **Step 1: Author README.md (FR-8, NFR-1, NFR-2, NFR-3)**
Create `README.md` with exactly the content below. It documents installation and how to run the CLI via `npm start` or `node index.js` (FR-8), states the Node.js 18+ requirement (NFR-2), states the zero-runtime-dependency posture so no install step is needed (NFR-1), states the modern-ANSI-terminal requirement (NFR-3), and embeds the static ANSI-stripped showcase of the banner.

````markdown
# RAD-MASTER-BENCH-V1

Prints **HELLO WORLD** as large, blocky ASCII-art letters, each colored through
a repeating rainbow spectrum (red, orange, yellow, green, cyan, blue, purple).
One run, one banner, then it exits.

## Requirements

- Node.js 18 or newer (modern LTS).
- A terminal with ANSI escape support (modern macOS/Linux terminals or Windows
  Terminal). Legacy terminals without ANSI color are not supported.

## Install

```bash
git clone <repo-url>
cd RAD-MASTER-BENCH-V1
```

No dependency install is required — this project uses only Node.js built-in
modules and ships with zero runtime dependencies.

## Usage

```bash
npm start
# or
node index.js
```

The banner prints once and the process exits. Command-line arguments and stdin
are ignored, so the output is identical no matter how you invoke it.

## Showcase

The live banner is rainbow-colored, one color per letter. With colors stripped,
the ASCII-art structure looks like this:

```text
#   # ##### #     #      ###     #   #  ###  ####  #     #### 
#   # #     #     #     #   #     #   # #   # #   # #     #   #
##### ####  #     #     #   #     # # # #   # ####  #     #   #
#   # #     #     #     #   #     ## ## #   # #  #  #     #   #
#   # ##### ##### #####  ###     #   #  ###  #   # ##### #### 
```

## Tests

```bash
npm test
```

Tests run on Node's built-in `node:test` runner, so no test framework needs to
be installed.
````

- [ ] **Step 2: Verify the showcase matches real output (FR-8)**
Generate the ANSI-stripped banner and confirm it matches the README's showcase block character-for-character. The strip uses `String.fromCharCode(27)` and a backslash-free pattern, so it is portable across shells.
Run: `node -e "const e=String.fromCharCode(27); const s=require('./banner.js').renderBanner(); process.stdout.write(s.replace(new RegExp(e+'[^m]*m','g'),''))"`
Expected: five lines of `#` and space characters spelling HELLO WORLD, identical to the `text` block embedded in Step 1 (FR-8).

- [ ] **Step 3: Verify the README documents the runtime contract (NFR-1, NFR-2, NFR-3)**
Confirm the README states the Node 18+ requirement (NFR-2), the zero-dependency/no-install posture (NFR-1), and the modern-ANSI-terminal requirement (NFR-3), and that the documented `npm start` and `node index.js` commands both produce the banner (FR-8).
