---
project: RAD-PLAN-BENCH
phase: 1
task: 2
title: Build letterform geometry assembler
status: pending
requirement_tags:
  - FR-2
  - FR-4
  - FR-5
  - AD-1
  - AD-3
  - DD-2
  - DD-3
  - DD-4
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:16:35.234Z'
type: task_handoff
---

# P01-T02: Build letterform geometry assembler

Establishes the hardcoded blocky letterforms and a pure function that assembles
them into the uncolored, equal-width banner geometry, plus a centering helper
that pads each line relative to terminal width.

**Task type:** code
**Requirements:** FR-2, FR-4, FR-5, AD-1, AD-3, DD-2, DD-3, DD-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `letterforms.js`
- Create: `render.js`
- Test: `render.test.js`

- [ ] **Step 1: Write the failing test (FR-2, FR-4, DD-2, DD-3, DD-4)**
    Create `render.test.js` asserting the geometry shape and centering behavior —
    five equal-width rows, the exact assembled width of "HELLO WORLD", a visible
    word gap, and leading-space centering with an 80-column fallback:
    ```js
    const { test } = require('node:test');
    const assert = require('node:assert/strict');
    const { assemblePlain, centerLines } = require('./render');

    test('assemblePlain renders five rows', () => {
      const lines = assemblePlain('HELLO WORLD');
      assert.equal(lines.length, 5);
    });

    test('assemblePlain rows share an equal width', () => {
      const lines = assemblePlain('HELLO WORLD');
      const widths = new Set(lines.map((line) => line.length));
      assert.equal(widths.size, 1);
    });

    test('assemblePlain produces the expected banner width', () => {
      const lines = assemblePlain('HELLO WORLD');
      assert.equal(lines[0].length, 63);
    });

    test('centerLines pads with leading spaces', () => {
      const padded = centerLines(['##', '##'], 10);
      assert.equal(padded[0], '    ##');
    });

    test('centerLines falls back to a default width', () => {
      const padded = centerLines(['##'], undefined);
      assert.ok(padded[0].length > 2);
    });
    ```

- [ ] **Step 2: Run the test, confirm it fails**
    Run: `npm test`
    Expected: FAIL — `render.js` does not yet exist, so the `require('./render')`
    import throws and all five cases error (FR-2, FR-4, FR-5)

- [ ] **Step 3: Implement the letterforms and geometry assembler (AD-1, DD-2, DD-4, FR-4, DD-3)**
    Create `letterforms.js` with hardcoded, fixed-height blocky glyphs (no figlet
    or runtime generator) for every character in "HELLO WORLD" plus a full-height
    blank glyph for the inter-word space:
    ```js
    const LETTERFORMS = {
      H: ['#   #', '#   #', '#####', '#   #', '#   #'],
      E: ['#####', '#    ', '#### ', '#    ', '#####'],
      L: ['#    ', '#    ', '#    ', '#    ', '#####'],
      O: ['#####', '#   #', '#   #', '#   #', '#####'],
      W: ['#   #', '#   #', '# # #', '## ##', '#   #'],
      R: ['#### ', '#   #', '#### ', '#  # ', '#   #'],
      D: ['#### ', '#   #', '#   #', '#   #', '#### '],
    };

    const SPACE_GLYPH = ['   ', '   ', '   ', '   ', '   '];
    const GLYPH_HEIGHT = 5;
    const LETTER_GAP = 1;

    module.exports = { LETTERFORMS, SPACE_GLYPH, GLYPH_HEIGHT, LETTER_GAP };
    ```
    Create `render.js` with a pure, importable `assemblePlain` that joins glyph
    rows with a one-space gap into equal-width uncolored lines, and a
    `centerLines` helper that pads each line by the leading-space margin measured
    against the terminal width, defaulting to 80 columns when width is unavailable
    (AD-3, DD-2, DD-4, FR-4, DD-3):
    ```js
    const {
      LETTERFORMS,
      SPACE_GLYPH,
      GLYPH_HEIGHT,
      LETTER_GAP,
    } = require('./letterforms');

    const DEFAULT_COLUMNS = 80;

    function glyphFor(ch) {
      if (ch === ' ') return SPACE_GLYPH;
      const glyph = LETTERFORMS[ch];
      if (!glyph) throw new Error(`No letterform for character: ${ch}`);
      return glyph;
    }

    function assemblePlain(text) {
      const gap = ' '.repeat(LETTER_GAP);
      const rows = Array.from({ length: GLYPH_HEIGHT }, () => []);
      for (const ch of text) {
        const glyph = glyphFor(ch);
        for (let r = 0; r < GLYPH_HEIGHT; r += 1) {
          rows[r].push(glyph[r]);
        }
      }
      return rows.map((segments) => segments.join(gap));
    }

    function centerLines(lines, columns) {
      const total = columns || DEFAULT_COLUMNS;
      const width = Math.max(...lines.map((line) => line.length));
      const pad = ' '.repeat(Math.max(0, Math.floor((total - width) / 2)));
      return lines.map((line) => pad + line);
    }

    module.exports = { assemblePlain, centerLines, glyphFor, DEFAULT_COLUMNS };
    ```

- [ ] **Step 4: Run the test, confirm it passes**
    Run: `npm test`
    Expected: PASS — all five geometry and centering cases succeed (FR-2, FR-4, FR-5)
