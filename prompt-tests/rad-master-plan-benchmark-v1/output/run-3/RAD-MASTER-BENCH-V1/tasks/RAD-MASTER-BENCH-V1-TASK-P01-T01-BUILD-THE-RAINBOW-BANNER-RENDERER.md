---
project: RAD-MASTER-BENCH-V1
phase: 1
task: 1
title: Build the rainbow banner renderer
status: pending
requirement_tags:
  - FR-1
  - FR-2
  - FR-3
  - FR-6
  - FR-7
  - NFR-1
  - NFR-2
  - NFR-3
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
created: '2026-06-29T20:42:01.677Z'
type: task_handoff
---

# P01-T01: Build the rainbow banner renderer

Establishes the pure renderer that turns "HELLO WORLD" into a colored, multi-line ASCII-art string, plus the zero-dependency packaging and unit tests that lock its structure and coloring.

**Task type:** code
**Requirements:** FR-1, FR-2, FR-3, FR-6, FR-7, NFR-1, NFR-2, NFR-3, NFR-5, AD-1, AD-2, AD-3, AD-4, AD-5, DD-1, DD-2, DD-3, DD-4
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `renderer.js`
- Create: `package.json`
- Test: `test/renderer.test.js`

- [ ] **Step 1: Write the failing renderer test (FR-7, FR-3, DD-3, DD-4)**
    Create `test/renderer.test.js` with the exact content below. It exercises the pure renderer directly (no stdout capture), asserting row count, presence of an ANSI color escape, presence of a color reset, and clean top/bottom framing.
    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const { renderBanner } = require('../renderer');

    test('banner renders exactly five ASCII-art rows', () => {
      const banner = renderBanner();
      const lines = banner.split('\n');
      assert.strictEqual(lines[lines.length - 1], '');
      assert.strictEqual(lines.slice(0, -1).length, 5);
    });

    test('banner contains at least one ANSI color escape', () => {
      const banner = renderBanner();
      assert.match(banner, /\x1b\[38;5;\d+m/);
    });

    test('banner resets color after each colored letter', () => {
      const banner = renderBanner();
      assert.ok(banner.includes('\x1b[0m'));
    });

    test('banner has no leading blank line and ends with one newline', () => {
      const banner = renderBanner();
      assert.ok(!banner.startsWith('\n'));
      assert.ok(banner.endsWith('\n'));
      assert.ok(!banner.endsWith('\n\n'));
    });
    ```

- [ ] **Step 2: Run the renderer test, confirm it fails**
    Run: `node --test test/renderer.test.js`
    Expected: FAIL — `Cannot find module '../renderer'`; the renderer module does not exist yet (FR-7).

- [ ] **Step 3: Implement the renderer and package scaffold (FR-1, FR-2, FR-3, NFR-1, NFR-2, NFR-5, AD-1, AD-2, AD-3, AD-4, AD-5, DD-1, DD-2, DD-3, DD-4)**
    Create `renderer.js` with the exact content below. It holds a hardcoded glyph map (H, E, L, O, W, R, D, and the inter-word space), a fixed seven-color rainbow palette of raw ANSI SGR codes, and a pure `renderBanner` function that advances color per visible letter (index mod 7), resets color after each glyph segment, leaves a blank-glyph word gap, and returns a single trailing-newline string with no leading blank line.
    ```js
    'use strict';

    const ROWS = 5;

    const GLYPHS = {
      H: ['#   #', '#   #', '#####', '#   #', '#   #'],
      E: ['#####', '#    ', '#### ', '#    ', '#####'],
      L: ['#    ', '#    ', '#    ', '#    ', '#####'],
      O: [' ### ', '#   #', '#   #', '#   #', ' ### '],
      W: ['#   #', '#   #', '# # #', '## ##', '#   #'],
      R: ['#### ', '#   #', '#### ', '#  # ', '#   #'],
      D: ['#### ', '#   #', '#   #', '#   #', '#### '],
      ' ': ['   ', '   ', '   ', '   ', '   '],
    };

    const PALETTE = [
      '\x1b[38;5;196m', // red
      '\x1b[38;5;208m', // orange
      '\x1b[38;5;226m', // yellow
      '\x1b[38;5;46m',  // green
      '\x1b[38;5;51m',  // cyan
      '\x1b[38;5;21m',  // blue
      '\x1b[38;5;129m', // purple
    ];

    const RESET = '\x1b[0m';

    function renderBanner() {
      const word = 'HELLO WORLD';
      const lines = Array.from({ length: ROWS }, () => '');
      let letterIndex = 0;

      for (const ch of word) {
        const glyph = GLYPHS[ch];
        if (!glyph) {
          continue;
        }
        if (ch === ' ') {
          for (let r = 0; r < ROWS; r += 1) {
            lines[r] += glyph[r];
          }
          continue;
        }
        const color = PALETTE[letterIndex % PALETTE.length];
        for (let r = 0; r < ROWS; r += 1) {
          lines[r] += color + glyph[r] + RESET + ' ';
        }
        letterIndex += 1;
      }

      return lines.map((line) => line.replace(/\s+$/, '')).join('\n') + '\n';
    }

    module.exports = { renderBanner, PALETTE, RESET };
    ```
    Create `package.json` with the exact content below. It declares an empty `dependencies` block, pins Node 18+ via `engines`, and wires `start` and `test` scripts to the Node built-in test runner — keeping the project free of runtime and dev dependencies.
    ```json
    {
      "name": "rad-master-bench-v1",
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
      "license": "MIT",
      "dependencies": {},
      "devDependencies": {}
    }
    ```

- [ ] **Step 4: Run the test suite, confirm it passes**
    Run: `npm test`
    Expected: PASS — all four renderer assertions pass; the banner is five rows tall, carries ANSI color and reset escapes, and is cleanly framed (FR-7, NFR-3).
