---
project: RAD-MASTER-BENCH-V1
phase: 1
task: 2
title: Define glyph font and rainbow palette
status: pending
requirement_tags:
  - FR-2
  - AD-1
  - AD-2
  - DD-1
  - NFR-5
repos:
  - RAD-MASTER-BENCH-V1
author: explosion-script
created: '2026-06-29T21:19:55.172Z'
type: task_handoff
---

# P01-T02: Define glyph font and rainbow palette

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
