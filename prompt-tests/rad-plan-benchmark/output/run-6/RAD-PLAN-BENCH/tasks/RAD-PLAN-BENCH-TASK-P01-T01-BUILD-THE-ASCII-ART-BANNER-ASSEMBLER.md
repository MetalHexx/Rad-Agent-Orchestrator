---
project: RAD-PLAN-BENCH
phase: 1
task: 1
title: Build the ASCII-art banner assembler
status: pending
requirement_tags:
  - FR-1
  - FR-2
  - AD-1
  - AD-3
  - AD-5
  - DD-2
  - DD-4
  - NFR-5
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:56:44.089Z'
type: task_handoff
---

# P01-T01: Build the ASCII-art banner assembler

Establishes the hardcoded glyph font and the pure assembly that lays "HELLO WORLD" out as a multi-row blocky banner with a clean word gap and trailing newline, with color hooks left as a no-op pass-through. This is the structural skeleton the coloring task colors in.

**Task type:** code
**Requirements:** FR-1, FR-2, AD-1, AD-3, AD-5, DD-2, DD-4, NFR-5
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `src/banner.js`
- Test: `test/banner.test.js`

- [ ] **Step 1: Write the failing test (FR-1, FR-2, DD-2, DD-4)**
    Create `test/banner.test.js`:
    ```js
    const test = require('node:test');
    const assert = require('node:assert');
    const { renderBanner, HEIGHT } = require('../src/banner.js');

    test('banner renders HEIGHT rows with a trailing newline', () => {
      const out = renderBanner();
      assert.ok(out.endsWith('\n'), 'output ends with a single trailing newline');
      const rows = out.replace(/\n$/, '').split('\n');
      assert.strictEqual(rows.length, HEIGHT, 'one line per glyph row');
    });

    test('banner preserves a visible gap between the two words', () => {
      const out = renderBanner();
      const firstRow = out.split('\n')[0];
      assert.match(firstRow, /\s{3,}/, 'word gap shows as a run of spaces');
    });
    ```

- [ ] **Step 2: Run test, confirm it fails**
    Run: `node --test test/banner.test.js`
    Expected: FAIL — `src/banner.js` does not exist yet, so the import throws (FR-1, FR-2)

- [ ] **Step 3: Implement minimal code (FR-1, FR-2, AD-1, AD-3, AD-5, DD-2, DD-4, NFR-5)**
    Create `src/banner.js` with a hardcoded 5-row glyph map and a pure assembler. Coloring is a pass-through stub here so the structure is testable on its own:
    ```js
    'use strict';

    const HEIGHT = 5;

    const GLYPHS = {
      H: ['#   #', '#   #', '#####', '#   #', '#   #'],
      E: ['#####', '#    ', '#### ', '#    ', '#####'],
      L: ['#    ', '#    ', '#    ', '#    ', '#####'],
      O: [' ### ', '#   #', '#   #', '#   #', ' ### '],
      W: ['#   #', '#   #', '# # #', '## ##', '#   #'],
      R: ['#### ', '#   #', '#### ', '#  # ', '#   #'],
      D: ['#### ', '#   #', '#   #', '#   #', '#### '],
      ' ': ['     ', '     ', '     ', '     ', '     '],
    };

    // Color hook — replaced with real ANSI coloring in P01-T02.
    function paint(code, segment) {
      return segment;
    }

    function renderBanner(text = 'HELLO WORLD') {
      const chars = text.toUpperCase().split('');
      let colorIndex = 0;
      const perChar = chars.map((ch) => {
        const glyph = GLYPHS[ch] || GLYPHS[' '];
        if (ch === ' ') return glyph.slice();
        const painted = glyph.map((row) => paint(colorIndex, row));
        colorIndex += 1;
        return painted;
      });
      const lines = [];
      for (let r = 0; r < HEIGHT; r += 1) {
        lines.push(perChar.map((g) => g[r]).join(' '));
      }
      return lines.join('\n') + '\n';
    }

    module.exports = { renderBanner, paint, GLYPHS, HEIGHT };
    ```

- [ ] **Step 4: Run test, confirm pass**
    Run: `node --test test/banner.test.js`
    Expected: PASS — banner has 5 rows, trailing newline, and a visible word gap (FR-1, FR-2, DD-2, DD-4)
