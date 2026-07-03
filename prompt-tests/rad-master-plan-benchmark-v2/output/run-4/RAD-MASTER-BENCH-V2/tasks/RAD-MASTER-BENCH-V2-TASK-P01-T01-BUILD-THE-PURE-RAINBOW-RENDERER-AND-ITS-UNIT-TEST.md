---
project: RAD-MASTER-BENCH-V2
phase: 1
task: 1
title: Build the pure rainbow renderer and its unit test
status: pending
complexity: standard
repos:
  - RAD-MASTER-BENCH-V2
created: '2026-06-30T03:36:53.924Z'
type: task_handoff
---

# P01-T01: Build the pure rainbow renderer and its unit test

The heart of the project: a pure module that turns the literal text "HELLO WORLD" into a single
colored, multi-line ASCII-art string, plus a `node:test` case that locks its structure. No I/O
happens here — the function returns a string, which is what makes it testable without capturing
process output. When it lands, the banner subsystem is complete and verified, ready for the
entrypoint to print.

**Task type:** code
**Complexity:** standard
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `renderer.js` (the hardcoded glyph map, the ordered rainbow palette constant, and the
  pure `renderBanner()` assembly; performs no I/O — returns a string).
- Create: `renderer.test.js` (one `node:test` case exercising `renderBanner()`).

**The change**
- Export a pure assembly function and the constants it composes from:
  ```js
  // renderer.js
  export const PALETTE = [ /* 7 ANSI SGR escape strings, ordered */ ];
  // red → orange → yellow → green → cyan → blue → purple
  export const GLYPHS = { /* 'H','E','L','O','W','R','D' and ' ' → array of row strings */ };
  export function renderBanner() { /* … */ } // returns the colored multi-line "HELLO WORLD" banner
  ```
- **Glyph map.** Each glyph is an array of equal-length, equal-count row strings (pick a single
  fixed height in the 3–5 row range — 5 reads as "large/blocky"). Define exactly the letters used
  by "HELLO WORLD" — `H E L O W R D` — plus a blank space glyph whose rows are a few spaces wide,
  used as the inter-word gap. All glyphs share the same row count so the banner assembles cleanly
  row-by-row. This is a deterministic hardcoded map — no figlet-style library.
- **Palette + per-letter coloring.** `PALETTE` is a fixed ordered 7-entry constant of raw ANSI
  SGR escape sequences for red, orange, yellow, green, cyan, blue, purple. Because plain 16-color
  ANSI has no clean orange/purple, use 256-color (`\x1b[38;5;{n}m`) or truecolor
  (`\x1b[38;2;{r};{g};{b}m`) escapes — your choice, but the seven must read as a recognizable
  rainbow. Coloring advances **one color per visible letter** (the space is not colored and does
  not advance the index): the Nth visible letter of `HELLOWORLD` takes `PALETTE[N % 7]`, so
  H=0,E=1,L=2,L=3,O=4,W=5,O=6,R=0,L=1,D=2. Every row of a given letter shares that one color.
- **Assembly contract.** For each row index, concatenate the glyphs left to right; wrap each
  letter's row segment as `{PALETTE[idx]}{rowText}{RESET}` where `RESET` is `\x1b[0m`, so color
  never bleeds past a letter or into the user's next prompt. "HELLO" and "WORLD" are separated by
  the blank-glyph gap on every row. Join the rows with `\n`. The result has **no leading blank
  lines and ends with exactly one trailing newline**, so it sits cleanly in scrollback.
- **The seam to get right:** the rainbow index counts visible letters only — do not advance it on
  the inter-word space, or "WORLD" shifts a color and R2's `N % 7` mapping breaks. And every
  colored segment must be reset; a missing `\x1b[0m` leaks color into the terminal afterward.
- **Unit test (`renderer.test.js`).** Using `node:test` + `node:assert` only (no runtime deps):
  invoke `renderBanner()` and assert (a) the output has the expected number of ASCII-art rows —
  the fixed glyph height — and (b) at least one ANSI color escape (`\x1b[` … `m`) is present in
  the string. **Count rows against the trailing-newline contract:** `renderBanner()` ends with
  exactly one `\n`, so `banner.split('\n').length` is `height + 1` (a trailing empty segment).
  Either strip the trailing newline before splitting (`banner.replace(/\n$/, '').split('\n').length
  === height`) or assert `=== height + 1` — don't assert `split('\n').length === height` or the
  test goes spuriously RED. Assert structure and the presence of color, not exact glyph art.

**Done when**
- `renderBanner()` returns a single multi-line string spelling "HELLO WORLD" in blocky ASCII art
  with a visible gap between the words, no leading blank line, and exactly one trailing newline.
- Each visible letter is wrapped in its `PALETTE[N % 7]` color and terminated with `\x1b[0m`; the
  space carries no color and does not advance the palette index.
- `renderer.test.js` passes under `node --test`, asserting the row count and the presence of at
  least one ANSI escape.

**Testing**
- Cover the two behaviors that carry risk: the rendered row count matches the fixed glyph height
  (counted per the trailing-newline note above), and at least one ANSI color escape is present.
  Optionally assert that a `\x1b[0m` reset appears.
- Skip asserting the exact glyph bitmaps or the precise palette codes — those are brittle to a
  reword of the art and don't protect a contract. No snapshot of the full banner string.

## Execution Notes

_(none yet — appended at runtime)_
