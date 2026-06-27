---
project: RAD-PLAN-BENCH
phase: 1
task: 2
title: Build ASCII banner renderer
status: pending
requirement_tags:
  - FR-1
  - FR-5
  - NFR-5
  - AD-2
  - AD-4
  - DD-2
  - DD-3
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:48:06.163Z'
type: task_handoff
---

# P01-T02: Build ASCII banner renderer

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
