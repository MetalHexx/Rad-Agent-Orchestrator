---
project: RAD-PLAN-BENCH
phase: 1
task: 3
title: Apply rainbow color and centered layout
status: pending
requirement_tags:
  - FR-1
  - FR-2
  - FR-4
  - NFR-2
  - AD-2
  - AD-4
  - DD-1
  - DD-2
  - DD-3
repos:
  - RAD-PLAN-BENCH
author: explosion-script
created: '2026-06-27T17:18:51.301Z'
type: task_handoff
---

# P01-T03: Apply rainbow color and centered layout

Layer the fixed rainbow spectrum onto each letter and center the assembled block with blank-line padding above and below. This completes `renderBanner()` as the finished, colored, centered output any caller can print.

**Task type:** code
**Requirements:** FR-1, FR-2, FR-4, NFR-2, AD-2, AD-4, DD-1, DD-2, DD-3
**Target repos:** RAD-PLAN-BENCH
**Files for RAD-PLAN-BENCH:**
- Modify: `banner.js`
- Test: `banner.test.js`

- [ ] **Step 1: Write the failing tests for coloring, looping, and layout**
    Append the cases below to `banner.test.js` (add `import chalk from 'chalk';` to the existing imports). They force a deterministic color level for the non-TTY test runner, then assert the output carries ANSI escapes (FR-2, AD-2, NFR-2, FR-4), that the spectrum loops after seven steps (DD-1, DD-2), and that the block is centered with blank padding lines top and bottom (DD-3, FR-1).
    ```js
    import chalk from 'chalk';
    import { renderBanner, rainbowColor } from './banner.js';

    test('renderBanner output contains ANSI color escapes', () => {
      chalk.level = 1;
      const out = renderBanner('HELLO WORLD', 80);
      assert.match(out, /\[/);
    });

    test('rainbow spectrum loops after seven steps', () => {
      chalk.level = 1;
      assert.equal(rainbowColor(0, 'x'), rainbowColor(7, 'x'));
      assert.notEqual(rainbowColor(0, 'x'), rainbowColor(1, 'x'));
    });

    test('renderBanner is centered with blank padding top and bottom', () => {
      const out = renderBanner('HELLO WORLD', 80);
      const lines = out.split('\n');
      assert.equal(lines[0], '');
      assert.equal(lines[lines.length - 1], '');
      assert.ok(lines.length >= 7);
      assert.ok(lines[1].startsWith(' '), 'body rows are left-padded for centering');
    });
    ```
    Note: setting `chalk.level` is test-only; `banner.js` itself never sets the level, so runtime auto-detection (NFR-2) is preserved.

- [ ] **Step 2: Run the test, confirm it fails**
    Run: `node --test banner.test.js`
    Expected: FAIL — `renderBanner` and `rainbowColor` are not yet exported from `banner.js`, so the new cases error on import (FR-2, DD-1, DD-3).

- [ ] **Step 3: Implement the rainbow colorizer and centered layout**
    Modify `banner.js`: add `import chalk from 'chalk';` at the top, and append the spectrum, the per-letter colorizer, and the layout function below. `RAINBOW` is the fixed red → orange → yellow → green → cyan → blue → purple cycle as portable hex values applied through `chalk.hex` (DD-1, AD-2); `rainbowColor` advances one hue per letter and wraps via modulo (DD-2); `renderBanner` composes with the colorizer, computes left padding from the terminal width, and frames the block with blank lines above and below (DD-3, FR-1, NFR-2).
    ```js
    import chalk from 'chalk';

    const RAINBOW = [
      '#ff0000', // red
      '#ff7f00', // orange
      '#ffff00', // yellow
      '#00ff00', // green
      '#00ffff', // cyan
      '#0000ff', // blue
      '#8b00ff', // purple
    ];

    export function rainbowColor(index, text) {
      const hex = RAINBOW[index % RAINBOW.length];
      return chalk.hex(hex)(text);
    }

    export function renderBanner(text = WORD, columns = process.stdout.columns || 80) {
      const rows = composeBanner(text, rainbowColor);
      const width = bannerWidth(text);
      const pad = ' '.repeat(Math.max(0, Math.floor((columns - width) / 2)));
      const body = rows.map((row) => pad + row);
      return ['', ...body, ''].join('\n');
    }
    ```

- [ ] **Step 4: Run the test, confirm it passes**
    Run: `node --test banner.test.js`
    Expected: PASS — all cases green; output carries ANSI escapes, the spectrum loops after seven hues, and the block is centered with blank padding lines (FR-2, DD-1, DD-2, DD-3, FR-4).
