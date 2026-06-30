---
project: RAD-MASTER-BENCH-V2
phase: 1
task: 1
title: Build the runnable rainbow-hello CLI
status: pending
complexity: standard
repos:
  - RAD-MASTER-BENCH-V2
created: '2026-06-30T03:09:44.964Z'
type: task_handoff
---

# P01-T01: Build the runnable rainbow-hello CLI

The whole working CLI as one vertical slice: a pure renderer that assembles "HELLO WORLD" as
multi-line ASCII-art typography and tints each letter through a repeating rainbow, the one-shot
`index.js` entrypoint that prints it and exits, the zero-dependency `package.json` that wires
`start`/`test` on a modern Node baseline, and the `node:test` unit test that exercises the
renderer. Once it lands, `npm start` produces the banner and `npm test` is green — the CLI is
complete and only the README remains.

**Task type:** code
**Complexity:** standard
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `renderer.js` (the hardcoded glyph map, the ordered rainbow palette constant, and the
  pure `renderBanner()` assembly — performs no I/O).
- Create: `index.js` (the sole stdout boundary — calls `renderBanner()` and prints once).
- Create: `package.json` (manifest: empty runtime `dependencies`, `engines.node >= 18`,
  `start`/`test` scripts).
- Create: `test/renderer.test.js` (the `node:test` + `node:assert` unit test; `node --test`
  discovers files under `test/`).

**The change**
- **Renderer (pure core).** Export the renderer plus the constants the test needs to assert
  structure without re-deriving the art:
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
    space glyph (a few columns of spaces per row) producing the visible gap between HELLO and
    WORLD. All glyphs share one row height (3–5 rows).
  - Color advances **per visible letter**: the i-th visible letter of `HELLOWORLD` takes
    `PALETTE[i % 7]`, so the two words read as one continuous spectrum. The inter-word space is
    a blank glyph — **not** counted in `i` and **not** colored.
  - Each colored glyph segment is terminated with `RESET` so color never bleeds into the user's
    next prompt. Raw ANSI SGR escapes emitted directly — no `chalk`, no figlet library.
  - Assemble row-by-row: for each glyph row index, concatenate that row across all glyphs
    left-to-right (each glyph colored then reset), join rows with `\n`, end with exactly one
    trailing `\n` and no leading blank line.
- **Entrypoint (I/O shell).** `index.js` is a thin wrapper over the pure renderer:
  ```js
  const { renderBanner } = require('./renderer');
  process.stdout.write(renderBanner());
  // no explicit process.exit() — the process exits 0 once the event loop drains
  ```
  It ignores `process.argv` entirely (extra args raise no error), reads no stdin, and is the
  only place that writes to stdout. **Do not call `process.exit(0)` right after the write** — it
  can terminate before stdout flushes on a pipe/redirect and truncate the banner; a clean run
  already exits 0 when the event loop drains. If an explicit exit is ever needed, put it in the
  write callback or set `process.exitCode`.
- **Manifest (zero-dep posture).** `package.json` shape:
  ```json
  {
    "name": "rad-master-bench-v2",
    "version": "1.0.0",
    "private": true,
    "engines": { "node": ">=18" },
    "scripts": { "start": "node index.js", "test": "node --test" },
    "dependencies": {}
  }
  ```
  `dependencies` stays empty (Node built-ins only); `start` makes `npm start` equivalent to
  `node index.js`; `test` runs the built-in runner so the renderer test executes with nothing
  installed.
- **The seams to get right:** three bite in the renderer — (a) every glyph must have an
  identical row count or the row-wise join shears the letters; (b) the mod-7 index runs over the
  10 visible letters of HELLOWORLD, not over raw characters including the space, or the spectrum
  desyncs at the word break; (c) a missing `RESET` after a letter bleeds color downstream. And
  one at the I/O boundary — keep all stdout in `index.js` (don't print from the renderer) and
  add no flag-parsing/arg-validation branch (R3 is explicitly argument-agnostic). Note: orange
  and purple aren't in the basic 8-color ANSI set — reach for 256-color (`\x1b[38;5;{n}m`) or
  24-bit (`\x1b[38;2;{r};{g};{b}m`) SGR; the renderer's job is just seven ordered, distinct
  colors.

**Done when**
- `renderBanner()` returns a multi-line string whose line count equals the fixed glyph height,
  with a visible gap between HELLO and WORLD, exactly one trailing newline, and no leading blank
  line; at least one ANSI color escape (`\x1b[…m`) is present and each colored letter is
  followed by a reset.
- `node index.js` and `npm start` each print the rainbow banner exactly once and exit status 0;
  `node index.js --anything extra` prints the same banner and exits 0 with no error.
- `package.json` has an empty `dependencies` block and `engines.node` of `>=18`, and `npm test`
  invokes the built-in test runner and passes; the renderer module imports nothing outside Node
  built-ins and writes nothing to stdout.

**Testing**
- Unit (`node:test` + `node:assert`), mirroring R5: assert (a) the rendered output has the
  expected number of ASCII-art rows (the glyph height), and (b) at least one ANSI color escape
  sequence is present. Account for the single trailing newline when counting rows — `trimEnd()`
  before `split('\n')`, or expect `height + 1` segments (last empty) — so the count assertion
  doesn't go off-by-one against R1's mandated trailing `\n`. Worth adding cheaply: a visible
  inter-word gap exists and the output ends in a single `\n`.
- A manual `node index.js` / `npm start` smoke check confirms the one-shot print-and-exit; no
  stdout-capture test for the entrypoint — it's a thin wrapper already covered by the renderer
  assertions.
- Skip asserting the literal glyph art or the exact ordered color sequence — that re-asserts the
  implementation and breaks on any font or palette tweak.

## Execution Notes

_(none yet — appended at runtime)_
