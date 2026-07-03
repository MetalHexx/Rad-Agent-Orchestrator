---
project: RAD-PLAN-BENCH
phase: 1
task: 2
title: Assemble ASCII-art glyph banner
status: pending
requirement_tags:
  - FR-1
  - FR-4
  - NFR-1
  - AD-1
  - AD-4
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:18:51.301Z'
type: task_handoff
---

# P01-T02: Assemble ASCII-art glyph banner

Build the hardcoded glyph map and the composition function that turns "HELLO WORLD" into five aligned text rows. This delivers the deterministic, dependency-free letterform engine with a pluggable per-letter styling hook.

**Task type:** code
**Requirements:** FR-1, FR-4, NFR-1, AD-1, AD-4
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `banner.js`
- Test: `banner.test.js`

- [ ] **Step 1: Write the failing structural test for glyph composition**
    Create `banner.test.js` with the cases below. They assert the composed banner is five rows tall, every row carries glyph fill, and the plain (uncolored) row width matches the computed width — verifying the hardcoded glyph assembly produces a clear, aligned phrase (FR-1, AD-1, FR-4).
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { composeBanner, bannerWidth } from './banner.js';

    test('composeBanner returns five glyph rows', () => {
      const rows = composeBanner('HELLO WORLD');
      assert.equal(rows.length, 5);
    });

    test('every composed row carries glyph fill', () => {
      const rows = composeBanner('HELLO WORLD');
      for (const row of rows) {
        assert.ok(row.includes('#'), 'row should contain glyph fill characters');
      }
    });

    test('plain row width equals bannerWidth', () => {
      const rows = composeBanner('HELLO WORLD');
      assert.equal(rows[0].length, bannerWidth('HELLO WORLD'));
    });
    ```

- [ ] **Step 2: Run the test, confirm it fails**
    Run: `node --test banner.test.js`
    Expected: FAIL — `banner.js` does not yet exist / `composeBanner` and `bannerWidth` are not exported, so the import cannot resolve (FR-1, AD-1).

- [ ] **Step 3: Implement the glyph map and composition function**
    Create `banner.js` with the hardcoded glyph constants and assembly logic below. Each of H, E, L, O, W, R, D is a five-row, five-column string block (AD-1); the inter-word space is rendered as blank columns; `composeBanner` accepts an optional `colorize(letterIndex, segment)` hook (defaulting to identity) so coloring can be layered on later without changing assembly. No external ASCII-art library is used (NFR-1).
    ```js
    const GLYPH_HEIGHT = 5;
    const LETTER_GAP = ' ';
    const SPACE_GAP = '   ';
    const WORD = 'HELLO WORLD';

    const GLYPHS = {
      H: ['#   #', '#   #', '#####', '#   #', '#   #'],
      E: ['#####', '#    ', '#### ', '#    ', '#####'],
      L: ['#    ', '#    ', '#    ', '#    ', '#####'],
      O: [' ### ', '#   #', '#   #', '#   #', ' ### '],
      W: ['#   #', '#   #', '# # #', '## ##', '#   #'],
      R: ['#### ', '#   #', '#### ', '#  # ', '#   #'],
      D: ['#### ', '#   #', '#   #', '#   #', '#### '],
    };

    const identity = (index, segment) => segment;

    export function composeBanner(text = WORD, colorize = identity) {
      const rows = Array.from({ length: GLYPH_HEIGHT }, () => '');
      let letterIndex = 0;
      for (const ch of text) {
        if (ch === ' ') {
          for (let r = 0; r < GLYPH_HEIGHT; r++) rows[r] += SPACE_GAP;
          continue;
        }
        const glyph = GLYPHS[ch];
        const idx = letterIndex;
        for (let r = 0; r < GLYPH_HEIGHT; r++) {
          rows[r] += colorize(idx, glyph[r]) + LETTER_GAP;
        }
        letterIndex++;
      }
      return rows;
    }

    export function bannerWidth(text = WORD) {
      let width = 0;
      for (const ch of text) {
        width += ch === ' '
          ? SPACE_GAP.length
          : GLYPHS[ch][0].length + LETTER_GAP.length;
      }
      return width;
    }
    ```

- [ ] **Step 4: Run the test, confirm it passes**
    Run: `node --test banner.test.js`
    Expected: PASS — three tests green; the banner is five rows tall with glyph fill and the plain width matches `bannerWidth` (FR-1, FR-4, AD-1).
