---
project: RAD-MASTER-BENCH-V2
phase: 1
task: 1
title: Build pure rainbow renderer and unit test
status: pending
complexity: standard
repos:
  - RAD-MASTER-BENCH-V2
created: '2026-06-30T02:40:09.823Z'
type: task_handoff
---

# P01-T01: Build pure rainbow renderer and unit test

The core of the project: a pure module that assembles "HELLO WORLD" as multi-line ASCII-art
typography, tints each letter through a repeating rainbow, and returns it as one colored
string — plus the unit test that exercises it. Once it lands, the banner can be produced and
asserted without any stdout capture, and the rest of the CLI is just wiring.

**Task type:** code
**Complexity:** standard
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `renderer.js` (the hardcoded glyph map, the ordered rainbow palette, and the pure
  `renderBanner()` assembly — performs no I/O).
- Create: `test/renderer.test.js` (the `node:test` + `node:assert` unit test; `node --test`
  discovers files under `test/`).

**The change**
- Export a pure renderer plus the constants the test needs to assert structure without
  re-deriving the art:
  ```js
  // renderer.js — shapes, not the bodies
  const GLYPHS = { H: ['…','…','…','…','…'], E: [...], L, O, W, R, D, ' ': [...] };
  // every glyph is the SAME number of rows (pick one height in 3–5) so a row-wise join aligns
  const PALETTE = [ /* 7 ANSI SGR escapes, in order: red, orange, yellow, green, cyan, blue, purple */ ];
  const RESET = '\x1b[0m';
  function renderBanner() { /* → single colored multi-line string */ }
  module.exports = { renderBanner, PALETTE, GLYPHS };
  ```
- Define glyphs for the letters actually used — `H E L O W R D` — plus a blank inter-word
  space glyph (a few columns of spaces per row) that produces the visible gap between HELLO
  and WORLD. All glyphs share one row height.
- Color advances **per visible letter**: the i-th visible letter of `HELLOWORLD` takes
  `PALETTE[i % 7]`, so the two words read as one continuous spectrum. The inter-word space is
  a blank glyph and is **not** counted in `i` and **not** colored.
- Each colored glyph segment is terminated with `RESET` so color never bleeds into the user's
  next prompt. Use raw ANSI SGR escapes directly — no `chalk`, no figlet library.
- Assemble row-by-row: for each glyph row index, concatenate that row across all glyphs in
  left-to-right order (with each glyph's color applied and reset), join the rows with `\n`,
  and end with exactly one trailing `\n` and no leading blank line.
- **The seam to get right:** three things bite here — (a) every glyph must have an identical
  row count or the row-wise join shears the letters; (b) the mod-7 index runs over the 10
  visible letters of HELLOWORLD, not over raw characters including the space, or the spectrum
  desyncs at the word break; (c) a missing `RESET` after a letter bleeds color downstream.
  Note: orange and purple aren't in the basic 8-color ANSI set — reach for 256-color
  (`\x1b[38;5;{n}m`) or 24-bit (`\x1b[38;2;{r};{g};{b}m`) SGR for those; the renderer's job is
  just that the palette is seven ordered, distinct colors.

**Done when**
- `renderBanner()` returns a multi-line string whose line count equals the fixed glyph height,
  with a visible gap between HELLO and WORLD, exactly one trailing newline, and no leading
  blank line.
- At least one ANSI color escape (`\x1b[…m`) is present and each colored letter is followed by
  a reset.
- The module imports nothing outside Node built-ins (it needs none) and writes nothing to
  stdout.

**Testing**
- Unit (`node:test` + `node:assert`), mirroring R5: assert (a) the rendered output has the
  expected number of ASCII-art rows (the glyph height), and (b) at least one ANSI color
  escape sequence is present in the output. Account for the single trailing newline when
  counting rows — `trimEnd()` before `split('\n')`, or expect `height + 1` segments (the last
  empty) — so the count assertion doesn't go off-by-one against R1's mandated trailing `\n`.
- Worth adding cheaply: assert a visible inter-word gap exists and that the output ends in a
  single `\n` — both are structural, not content-exact.
- Skip asserting the literal glyph art or the exact ordered color sequence — that just
  re-asserts the implementation and breaks on any font or palette tweak.

## Execution Notes

_(none yet — appended at runtime)_
