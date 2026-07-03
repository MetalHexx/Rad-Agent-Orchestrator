---
project: RAD-MASTER-BENCH-V2
phase: 1
task: 1
title: Build the pure rainbow renderer and its test
status: pending
complexity: standard
repos:
  - RAD-MASTER-BENCH-V2
created: '2026-06-30T03:45:17.207Z'
type: task_handoff
---

# P01-T01: Build the pure rainbow renderer and its test

Build the heart of the project: a pure function that assembles the colored "HELLO
WORLD" banner as a single multi-line string, doing no I/O, alongside the unit test that
pins its shape. Once this lands, the banner can be produced and asserted without
touching stdout, and the entrypoint task has a stable function to call.

**Task type:** code
**Complexity:** standard
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `renderer.js` (the glyph map, the ordered rainbow palette constant, and the
  pure `renderBanner()` assembly; the only export surface).
- Create: `renderer.test.js` (one `node:test` case exercising `renderBanner()`).

**The change**
- Export a pure assembly function plus the constants it builds on:
  ```js
  // renderer.js  (CommonJS)
  const PALETTE = [ /* 7 ANSI SGR escape strings, in spectrum order:
                       red, orange, yellow, green, cyan, blue, purple */ ];
  const GLYPHS = { /* 'H','E','L','O','W','R','D' and ' ' -> array of row strings */ };
  function renderBanner() { /* -> single colored multi-line string */ }
  module.exports = { renderBanner, PALETTE, GLYPHS };
  ```
- **Glyph map.** Each glyph is an array of fixed-height row strings — use **5 rows**
  per glyph, every row of a given glyph the same width — drawn as blocky ASCII-art.
  Define exactly the characters the banner needs: `H E L O W R D` and a space/gap
  glyph. No figlet-style library; the map is hardcoded so output is deterministic.
- **Palette.** A fixed ordered array of 7 raw ANSI SGR escape strings. Basic 16-color
  ANSI has no clean orange/purple, so prefer 256-color foreground codes, e.g.
  `"\x1b[38;5;196m"` (red), `208` (orange), `226` (yellow), `46` (green), `51` (cyan),
  `21` (blue), `129` (purple) — exact codes are the coder's call, but the array must be
  exactly 7 entries in spectrum order.
- **Per-letter coloring.** Color advances **once per visible letter**, so every row of a
  given letter shares one color. Visible letter at position `N` (counting only the
  letters of `HELLOWORLD`, 0-indexed) takes `PALETTE[N % 7]`. Each colored glyph segment
  is terminated with an ANSI reset `"\x1b[0m"` so color never bleeds into the next glyph
  or the user's prompt.
- **Assembly.** Render "HELLO", then a fixed blank-glyph inter-word gap (a few spaces
  wide on every row), then "WORLD"; the two words read as one banner with a clear break.
  For each of the 5 rows, concatenate that row of each glyph (each letter's row wrapped
  in its color + reset), join glyphs left-to-right, then join the 5 rows with `\n`. The
  string ends with a single trailing newline and has no leading blank line.
- **The seam to get right:** the palette index counts **visible letters only** — the
  inter-word gap must **not** advance the index, or the spectrum shifts by one across
  "WORLD". So the sequence is H=0, E=1, L=2, L=3, O=4, W=5, O=6, R=7, L=8, D=9, mapped
  through `% 7`. Keep `renderBanner()` free of any `process.stdout`/`console` call — I/O
  belongs only to the entrypoint in T02.

**Done when**
- `require('./renderer').renderBanner()` returns a multi-line string whose art body is
  5 rows tall, ends in a single `\n`, and contains the colored "HELLO" and "WORLD"
  separated by a visible gap.
- The string contains ANSI SGR color escapes and an ANSI reset after each colored
  letter; rendering it in an ANSI terminal shows each letter in the next rainbow color.
- `renderer.js` performs no I/O.
- `renderer.test.js` passes under `node --test`.

**Testing**
- One `node:test` + `node:assert` case: call `renderBanner()`, split on `\n`, and assert
  the art-row count is the expected fixed height (5, allowing for the trailing newline),
  and that the output contains at least one ANSI color escape (e.g. matches `/\x1b\[/`).
- Skip asserting the exact glyph pixels or the exact byte sequence of the banner — that
  is brittle and re-asserts the font; cover row count and the presence of color, which is
  the contract that carries risk.

## Execution Notes

_(none yet — appended at runtime)_
