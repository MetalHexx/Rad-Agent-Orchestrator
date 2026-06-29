---
project: RAD-MASTER-BENCH-V1
phase: 1
task: 1
title: Build rainbow banner renderer
status: pending
requirement_tags:
  - FR-1
  - FR-2
  - FR-3
  - FR-7
  - NFR-5
  - AD-1
  - AD-2
  - AD-3
  - AD-4
  - AD-5
  - DD-1
  - DD-2
  - DD-3
  - DD-4
repos:
  - RAD-MASTER-BENCH-V1
author: explosion-script
created: '2026-06-29T20:07:42.211Z'
type: task_handoff
---

# P01-T01: Build rainbow banner renderer

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
