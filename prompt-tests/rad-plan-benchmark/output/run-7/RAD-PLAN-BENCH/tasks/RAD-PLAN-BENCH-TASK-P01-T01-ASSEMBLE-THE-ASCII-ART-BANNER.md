---
project: RAD-PLAN-BENCH
phase: 1
task: 1
title: Assemble the ASCII-art banner
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
created: '2026-06-27T20:51:11.320Z'
type: task_handoff
---

# P01-T01: Assemble the ASCII-art banner

Establishes the hardcoded glyph font and the pure assembler that lays "HELLO WORLD" out as a multi-row blocky banner with a clean word gap and a trailing newline, with coloring left as a pass-through stub. This is the structural skeleton the next task colors in.

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

    test('banner renders HEIGHT rows ending in a single trailing newline', () => {
      const out = renderBanner();
      assert.ok(out.endsWith('\n'), 'output ends with a trailing newline');
      assert.ok(!out.endsWith('\n\n'), 'only a single trailing newline');
      const rows = out.replace(/\n$/, '').split('\n');
      assert.strictEqual(rows.length, HEIGHT, 'one line per glyph row');
    });

    test('banner shows a visible gap between HELLO and WORLD', () => {
      const firstRow = renderBanner().split('\n')[0];
      assert.match(firstRow, /\s{3,}/, 'word gap reads as a run of spaces');
    });
    ```

- [ ] **Step 2: Run test, confirm it fails**
    Run: `node --test test/banner.test.js`
    Expected: FAIL — `src/banner.js` does not exist yet, so the require throws (FR-1, FR-2)

- [ ] **Step 3: Implement minimal code (FR-1, FR-2, AD-1, AD-3, AD-5, DD-2, DD-4, NFR-5)**
    Create `src/banner.js` with a hardcoded 5-row glyph map and a pure assembler. Coloring is a pass-through stub here so the layout is testable on its own:
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
    function paint(colorIndex, segment) {
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
    Expected: PASS — banner has 5 rows, a single trailing newline, and a visible word gap (FR-1, FR-2, DD-2, DD-4)
