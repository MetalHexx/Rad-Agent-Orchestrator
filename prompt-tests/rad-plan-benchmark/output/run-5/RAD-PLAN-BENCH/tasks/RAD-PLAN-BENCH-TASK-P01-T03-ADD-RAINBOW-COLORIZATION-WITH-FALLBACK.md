---
project: RAD-PLAN-BENCH
phase: 1
task: 3
title: Add rainbow colorization with fallback
status: pending
requirement_tags:
  - FR-2
  - FR-6
  - NFR-3
  - NFR-5
  - AD-3
  - DD-1
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:48:06.163Z'
type: task_handoff
---

# P01-T03: Add rainbow colorization with fallback

Layer rainbow coloring onto the rendered letters: each visible letter gets the next color in the spectrum, cycling through the palette, while spaces stay uncolored. A plain-text path emits no escape codes when color is unsupported.

**Task type:** code
**Requirements:** FR-2, FR-6, NFR-3, NFR-5, AD-3, DD-1
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Create: `src/colorize.js`
- Test: `test/colorize.test.js`

- [ ] **Step 1: Write the failing test (FR-2, FR-6, DD-1)**
    Create `test/colorize.test.js`:
    ```js
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { RAINBOW, colorLines } from '../src/colorize.js';
    import { renderLetters, assembleRows } from '../src/banner.js';

    const tag = (name) => (s) => `<${name}>${s}</${name}>`;
    const fakePalette = RAINBOW.map((name) => tag(name));

    test('RAINBOW is the seven-color spectrum in order', () => {
      assert.deepEqual(RAINBOW, ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple']);
    });

    test('colorLines wraps each visible letter and cycles the palette (FR-2, DD-1)', () => {
      const letters = renderLetters('HELLO WORLD');
      const lines = colorLines(letters, fakePalette).join('\n');
      assert.ok(lines.includes('<red>'));   // first visible letter
      assert.ok(lines.includes('<blue>'));  // palette cycled past 7 letters
    });

    test('colorLines with identity palette injects no markup (FR-6)', () => {
      const identity = RAINBOW.map(() => (s) => s);
      const plain = colorLines(renderLetters('HELLO WORLD'), identity).join('\n');
      const bare = assembleRows(renderLetters('HELLO WORLD')).join('\n');
      assert.equal(plain, bare);
    });
    ```
- [ ] **Step 2: Run test, confirm it fails (FR-2)**
    Run: `npm test -- test/colorize.test.js`
    Expected: FAIL — `src/colorize.js` does not exist yet (FR-2).
- [ ] **Step 3: Implement colorization with injected palette (FR-2, FR-6, NFR-3, AD-3, DD-1)**
    Create `src/colorize.js` taking a palette of color functions so production wiring passes chalk and tests pass fakes (AD-3, NFR-3):
    ```js
    import { GLYPH_HEIGHT } from './glyphs.js';

    // Rainbow order, mapped to chalk color names downstream (DD-1).
    export const RAINBOW = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'];

    // letters: [{ char, rows }]; palette: array of (s) => string color fns aligned to RAINBOW.
    // Each visible letter takes the next palette entry, cycling; spaces stay bare (FR-2, FR-6, DD-1).
    export function colorLines(letters, palette) {
      let colorIdx = 0;
      const colored = letters.map((l) => {
        if (l.char === ' ') return l.rows.slice();
        const paint = palette[colorIdx % palette.length];
        colorIdx += 1;
        return l.rows.map((row) => paint(row));
      });
      const rows = [];
      for (let r = 0; r < GLYPH_HEIGHT; r++) {
        rows.push(colored.map((block) => block[r]).join(' '));
      }
      return rows;
    }
    ```
- [ ] **Step 4: Run test, confirm pass (FR-2, FR-6, NFR-5)**
    Run: `npm test -- test/colorize.test.js`
    Expected: PASS — letters cycle through the rainbow and the identity palette yields bare text (FR-2, FR-6, NFR-5).
