---
project: RAD-PLAN-BENCH
phase: 2
task: 1
title: Assemble and center the banner
status: pending
requirement_tags:
  - FR-1
  - FR-4
  - AD-4
  - DD-3
  - DD-4
  - NFR-4
  - AD-6
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:35:15.252Z'
type: task_handoff
---

# P02-T01: Assemble and center the banner

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
