---
project: RAD-MASTER-BENCH-V1
phase: 1
task: 2
title: Build pure rainbow banner renderer
status: pending
requirement_tags:
  - FR-1
  - FR-2
  - FR-3
  - FR-7
  - NFR-1
  - NFR-3
  - NFR-5
  - AD-1
  - AD-2
  - AD-3
  - AD-4
  - DD-1
  - DD-2
  - DD-3
  - DD-4
repos:
  - RAD-MASTER-BENCH-V1
author: explosion-script
created: '2026-06-29T20:58:10.234Z'
type: task_handoff
---

# P01-T02: Build pure rainbow banner renderer

Establishes the pure render function that assembles the colored multi-line "HELLO WORLD" banner from a hardcoded glyph font and a fixed rainbow palette. Returns a string with no I/O, making it directly unit-testable.

**Task type:** code
**Requirements:** FR-1, FR-2, FR-3, FR-7, NFR-1, NFR-3, NFR-5, AD-1, AD-2, AD-3, AD-4, DD-1, DD-2, DD-3, DD-4
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `renderer.js`
- Test: `test/renderer.test.js`

- [ ] **Step 1: Write the failing test (FR-7, FR-1, FR-3, DD-3, DD-4)**
    Create `test/renderer.test.js`. It invokes the banner-producing function and asserts the output has the expected number of ASCII-art rows and contains at least one ANSI color escape; it also pins the per-letter color reset and the clean trailing-newline output. Uses Node's built-in `node:test` and `node:assert`, keeping the zero-runtime-dependency posture.

    ```js
    'use strict';

    const test = require('node:test');
    const assert = require('node:assert');
    const { renderBanner } = require('../renderer');

    // Matches a raw ANSI 256-color SGR foreground sequence.
    const ANSI_COLOR = /\x1b\[38;5;\d+m/;

    test('renders the banner as exactly five ASCII-art rows', () => {
      const rows = renderBanner().replace(/\n$/, '').split('\n');
      assert.strictEqual(rows.length, 5);
    });

    test('includes at least one ANSI color escape sequence', () => {
      assert.match(renderBanner(), ANSI_COLOR);
    });

    test('resets color after each glyph so it never bleeds into the prompt', () => {
      assert.ok(renderBanner().includes('\x1b[0m'));
    });

    test('ends with a single trailing newline and no leading blank line', () => {
      const banner = renderBanner();
      assert.ok(banner.endsWith('\n'));
      assert.ok(!banner.endsWith('\n\n'));
      assert.ok(!banner.startsWith('\n'));
    });
    ```

- [ ] **Step 2: Run test, confirm it fails**
    Run: `node --test test/renderer.test.js`
    Expected: FAIL — `require('../renderer')` cannot be resolved because `renderer.js` does not exist yet, so every test errors at load (FR-7).

- [ ] **Step 3: Implement the renderer (FR-1, FR-2, FR-3, NFR-1, NFR-3, NFR-5, AD-1, AD-2, AD-3, DD-1, DD-2, DD-3, DD-4)**
    Create `renderer.js`. Glyphs are a hardcoded per-character row-string map (H, E, L, O, W, R, D, plus the inter-word space), keeping the project dependency-free and deterministic. Color comes from a fixed ordered palette of raw ANSI SGR codes; letter N takes palette index `N mod 7` so color advances once per visible letter and every row of a letter shares one color. Each colored glyph segment is terminated with an ANSI reset so color never bleeds; the two words are separated by a blank-glyph gap; the function returns a multi-line string ending in a single newline with no leading blank line. The function performs no I/O.

    ```js
    'use strict';

    // ANSI reset — terminates each colored glyph so color never bleeds past the
    // banner into the user's shell prompt.
    const RESET = '\x1b[0m';

    // Fixed, ordered rainbow palette as raw ANSI 256-color SGR foreground codes:
    // red, orange, yellow, green, cyan, blue, purple.
    const PALETTE = [
      '\x1b[38;5;196m', // red
      '\x1b[38;5;208m', // orange
      '\x1b[38;5;226m', // yellow
      '\x1b[38;5;46m',  // green
      '\x1b[38;5;51m',  // cyan
      '\x1b[38;5;21m',  // blue
      '\x1b[38;5;129m', // purple
    ];

    // Every glyph is exactly this many rows tall.
    const GLYPH_HEIGHT = 5;

    // Hardcoded blocky font: one entry per required character plus the
    // inter-word space. Each value is an array of GLYPH_HEIGHT row strings.
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

    const TEXT = 'HELLO WORLD';
    const LETTER_GAP = ' ';

    // Pure function: returns the full colored banner as a multi-line string.
    function renderBanner() {
      const lines = [];
      for (let row = 0; row < GLYPH_HEIGHT; row++) {
        const segments = [];
        let colorIndex = 0;
        for (const char of TEXT) {
          const glyph = GLYPHS[char];
          if (char === ' ') {
            // Blank-glyph gap between the two words; not part of the color cycle.
            segments.push(glyph[row]);
          } else {
            const color = PALETTE[colorIndex % PALETTE.length];
            segments.push(color + glyph[row] + RESET);
            colorIndex += 1;
          }
        }
        lines.push(segments.join(LETTER_GAP));
      }
      return lines.join('\n') + '\n';
    }

    module.exports = { renderBanner };
    ```

- [ ] **Step 4: Run test, confirm pass**
    Run: `node --test test/renderer.test.js`
    Expected: PASS — banner has five rows, contains ANSI color and reset sequences, and ends in a single trailing newline (FR-7, FR-1, FR-3, DD-3, DD-4).
