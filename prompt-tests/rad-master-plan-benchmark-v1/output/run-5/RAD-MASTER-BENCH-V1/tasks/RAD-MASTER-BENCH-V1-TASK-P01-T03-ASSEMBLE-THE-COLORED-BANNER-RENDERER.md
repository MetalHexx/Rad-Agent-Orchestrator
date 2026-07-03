---
project: RAD-MASTER-BENCH-V1
phase: 1
task: 3
title: Assemble the colored banner renderer
status: pending
requirement_tags:
  - FR-1
  - FR-3
  - FR-7
  - AD-2
  - AD-3
  - NFR-3
  - NFR-5
  - DD-1
  - DD-2
  - DD-3
  - DD-4
repos:
  - RAD-MASTER-BENCH-V1
author: explosion-script
created: '2026-06-29T21:19:55.172Z'
type: task_handoff
---

# P01-T03: Assemble the colored banner renderer

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
