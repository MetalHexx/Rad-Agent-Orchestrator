---
project: RAD-PLAN-BENCH
phase: 1
task: 2
title: Author ASCII glyph data module
status: pending
requirement_tags:
  - FR-1
  - AD-3
  - DD-2
  - NFR-5
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:35:15.252Z'
type: task_handoff
---

# P01-T02: Author ASCII glyph data module

Delivers the hardcoded, deterministic ASCII letterforms for every character in "HELLO WORLD" plus a lookup helper, with no external art library. Each glyph shares a common height so letters align on a single baseline.

**Task type:** code
**Requirements:** FR-1, AD-3, DD-2, NFR-5
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `src/art.js`
- Test: `test/art.test.js`

- [ ] **Step 1: Write the failing test (FR-1, DD-2, AD-3)**
    Create `test/art.test.js` asserting the glyph table is uniform-height, each glyph is internally rectangular, and every character of "HELLO WORLD" resolves (FR-1, DD-2, AD-3).
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert';
    import { GLYPHS, GLYPH_HEIGHT, glyphFor } from '../src/art.js';

    test('every glyph shares the common height and is internally rectangular', () => {
      assert.ok(GLYPH_HEIGHT >= 3 && GLYPH_HEIGHT <= 5);
      for (const [char, rows] of Object.entries(GLYPHS)) {
        assert.strictEqual(rows.length, GLYPH_HEIGHT, `${char} height`);
        const width = rows[0].length;
        for (const row of rows) {
          assert.strictEqual(row.length, width, `${char} row width`);
        }
      }
    });

    test('glyphFor resolves letters case-insensitively', () => {
      assert.deepStrictEqual(glyphFor('h'), GLYPHS.H);
    });

    test('every character of HELLO WORLD has a glyph', () => {
      for (const ch of 'HELLO WORLD') {
        assert.doesNotThrow(() => glyphFor(ch));
      }
    });
    ```

- [ ] **Step 2: Run test, confirm it fails**
    Run: `node --test test/art.test.js`
    Expected: FAIL — `src/art.js` does not exist yet, so the import cannot be resolved (FR-1).

- [ ] **Step 3: Implement the glyph data and lookup (FR-1, AD-3, DD-2, NFR-5)**
    Create `src/art.js` with hardcoded 5-row blocky glyphs and a case-insensitive lookup that throws on unknown characters. The art is inline data, not library-generated (AD-3); all glyphs are 5 rows tall for a shared baseline (DD-2); the data stays tiny (NFR-5) and covers FR-1.
    ```js
    export const GLYPH_HEIGHT = 5;

    export const GLYPHS = {
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
      ' ': [
        '   ',
        '   ',
        '   ',
        '   ',
        '   ',
      ],
    };

    export function glyphFor(char) {
      const glyph = GLYPHS[char.toUpperCase()];
      if (!glyph) {
        throw new Error(`No glyph defined for character: ${JSON.stringify(char)}`);
      }
      return glyph;
    }
    ```

- [ ] **Step 4: Run test, confirm pass**
    Run: `node --test test/art.test.js`
    Expected: PASS — all glyphs are 5 rows, internally rectangular, and every character of "HELLO WORLD" resolves (FR-1, DD-2, AD-3).
