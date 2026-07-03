---
project: RAD-PLAN-BENCH
phase: 1
task: 3
title: Add rainbow coloring to the banner
status: pending
requirement_tags:
  - FR-3
  - FR-5
  - AD-2
  - AD-3
  - DD-1
  - NFR-2
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:16:35.234Z'
type: task_handoff
---

# P01-T03: Add rainbow coloring to the banner

Establishes the public `buildBanner` function that paints each letter a distinct
rainbow hue via `chalk`, cycling the ordered palette and wrapping it across the
full string while centering on the uncolored geometry so color codes do not
distort alignment.

**Task type:** code
**Requirements:** FR-3, FR-5, AD-2, AD-3, DD-1, NFR-2
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Modify: `render.js`
- Test: `render.test.js`

- [ ] **Step 1: Write the failing test (FR-3, DD-1, NFR-2)**
    Append cases to `render.test.js` that force `chalk` color output and assert
    ANSI escape codes are emitted, that the colored banner keeps its five-line
    structure, and that the exported palette is the ordered seven-hue rainbow
    starting at red:
    ```js
    const { buildBanner, PALETTE } = require('./render');

    test('buildBanner emits ANSI color codes', () => {
      require('chalk').level = 3;
      const banner = buildBanner('HELLO WORLD', 80);
      assert.match(banner, /\[/);
    });

    test('buildBanner renders five colored lines', () => {
      require('chalk').level = 3;
      const banner = buildBanner('HELLO WORLD', 80);
      assert.equal(banner.split('\n').length, 5);
    });

    test('buildBanner uses the full ordered rainbow palette', () => {
      assert.equal(PALETTE.length, 7);
      assert.equal(PALETTE[0], '#FF0000');
    });
    ```

- [ ] **Step 2: Run the test, confirm it fails**
    Run: `npm test`
    Expected: FAIL — `buildBanner` and `PALETTE` are not yet exported from
    `render.js`, so the new cases throw on undefined references (FR-3, FR-5)

- [ ] **Step 3: Implement rainbow coloring (AD-2, DD-1, NFR-2, AD-3)**
    Modify `render.js` to require `chalk`, define the ordered red→orange→yellow→
    green→cyan→blue→purple palette, and add the pure `buildBanner` function: it
    paints each non-space glyph with the next palette hue (wrapping when the
    string is longer than the palette), leaves the word gap uncolored, joins
    colored glyph rows with the one-space gap, and pads using the uncolored
    geometry width so ANSI codes never distort centering. `chalk` is the sole
    coloring path, giving cross-platform ANSI support on modern terminals.
    Add `require('chalk')` at the top of the file:
    ```js
    const chalk = require('chalk');
    ```
    Add the palette and builder, then extend `module.exports`:
    ```js
    const PALETTE = [
      '#FF0000', // red
      '#FF7F00', // orange
      '#FFFF00', // yellow
      '#00FF00', // green
      '#00FFFF', // cyan
      '#0000FF', // blue
      '#8B00FF', // purple
    ];

    function buildBanner(text = 'HELLO WORLD', columns = process.stdout.columns) {
      const gap = ' '.repeat(LETTER_GAP);
      const coloredRows = Array.from({ length: GLYPH_HEIGHT }, () => []);
      let colorIndex = 0;
      for (const ch of text) {
        const glyph = glyphFor(ch);
        let paint = (segment) => segment;
        if (ch !== ' ') {
          const hex = PALETTE[colorIndex % PALETTE.length];
          paint = (segment) => chalk.hex(hex)(segment);
          colorIndex += 1;
        }
        for (let r = 0; r < GLYPH_HEIGHT; r += 1) {
          coloredRows[r].push(paint(glyph[r]));
        }
      }
      const coloredLines = coloredRows.map((segments) => segments.join(gap));
      const plainLines = assemblePlain(text);
      const total = columns || DEFAULT_COLUMNS;
      const width = Math.max(...plainLines.map((line) => line.length));
      const pad = ' '.repeat(Math.max(0, Math.floor((total - width) / 2)));
      return coloredLines.map((line) => pad + line).join('\n');
    }

    module.exports = {
      assemblePlain,
      centerLines,
      buildBanner,
      glyphFor,
      PALETTE,
      DEFAULT_COLUMNS,
    };
    ```

- [ ] **Step 4: Run the test, confirm it passes**
    Run: `npm test`
    Expected: PASS — the geometry, centering, ANSI-code, line-count, and palette
    cases all succeed (FR-3, FR-5, AD-2, DD-1)
