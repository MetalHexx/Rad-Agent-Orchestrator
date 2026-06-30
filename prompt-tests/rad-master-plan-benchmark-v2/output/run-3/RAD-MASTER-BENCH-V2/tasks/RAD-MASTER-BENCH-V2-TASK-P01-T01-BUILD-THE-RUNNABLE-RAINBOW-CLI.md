---
project: RAD-MASTER-BENCH-V2
phase: 1
task: 1
title: Build the runnable rainbow CLI
status: pending
complexity: standard
repos:
  - RAD-MASTER-BENCH-V2
created: '2026-06-30T03:21:00.745Z'
type: task_handoff
---

# P01-T01: Build the runnable rainbow CLI

Build the complete, runnable program in one slice: a pure renderer module that owns the
hardcoded glyph map, the ordered rainbow palette, and the `renderBanner()` assembly; a thin
`index.js` entrypoint that prints it once and exits; a zero-dependency `package.json` with
`start`/`test` scripts and a Node 18+ engine; and a `node:test` unit test over the renderer.
When it lands, running the CLI prints the colored banner and `npm test` passes. Covers R1–R5.

**Task type:** code
**Complexity:** standard
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `renderer.js` (the pure module — glyph map + palette constant + `renderBanner()`; no I/O).
- Create: `index.js` (the sole stdout boundary — calls `renderBanner()`, writes once, exits 0).
- Create: `package.json` (empty `dependencies`; `engines.node >= 18`; `start` + `test` scripts).
- Create: `renderer.test.js` (the `node:test` unit test over the renderer).

**The change**
- Renderer is a pure function — no I/O, returns the colored multi-line string:
  ```js
  // renderer.js
  function renderBanner() { /* glyph lookup → per-letter colorize → join rows */ }
  module.exports = { renderBanner };
  ```
- Glyph map: per-character arrays of equal-height row strings, **3–5 rows tall**, defined for
  `H E L O W R D` and the inter-word space. "HELLO" and "WORLD" are separated by a fixed
  blank-glyph gap (a few spaces wide on every row) so the two words read as one banner with a
  clear break. All glyphs in the map share the same row count so rows align when joined.
- Palette: a **fixed ordered constant of 7 raw ANSI SGR escape strings** in the order
  red → orange → yellow → green → cyan → blue → purple. Letter index `N` takes
  `palette[N % 7]`, advancing one color **per letter** (every row of a given letter shares that
  letter's color), giving a continuous spectrum across the 10 visible letters of "HELLOWORLD".
  Each colored glyph segment is terminated with a reset (`\x1b[0m`) so color never bleeds into
  the user's next prompt.
  - **The seam to get right:** the 8-color SGR set has no "orange" or true "purple" — emit those
    two via 256-color SGR (e.g. orange `\x1b[38;5;208m`, purple `\x1b[38;5;93m`) so all seven are
    distinct; keep the palette one ordered array of escape strings either way.
- Assembly: build each output row by concatenating, for every letter, `palette[N%7]` + that
  letter's row slice + `\x1b[0m`, then join the rows with `\n`. The banner ends with a **single
  trailing newline** and has **no leading blank lines**.
- `index.js`: `const { renderBanner } = require('./renderer'); process.stdout.write(renderBanner());`
  then a clean exit 0. It **ignores all argv and reads no stdin** — extra arguments raise no
  error; behavior is identical regardless of invocation.
- `package.json`: `"dependencies": {}`, `"engines": { "node": ">=18" }`,
  `"scripts": { "start": "node index.js", "test": "node --test" }` (any tooling, if added, goes
  in `devDependencies` only — but none is required here).

**Done when**
- `node index.js` and `npm start` each print the multi-line "HELLO WORLD" banner exactly once
  and exit 0; a visible word gap separates "HELLO" and "WORLD"; output ends with one trailing
  newline and no leading blank line.
- The banner is colored: ANSI escape sequences are present and each letter advances one step
  through the seven-color cycle.
- Passing extra CLI args (e.g. `node index.js --foo bar`) changes nothing and raises no error.
- `npm test` passes; `dependencies` in `package.json` is empty and `engines.node` is `>=18`.

**Testing**
- One `node:test` case invoking `renderBanner()` that asserts (a) the output has the expected
  number of ASCII-art rows (the glyph height) and (b) at least one ANSI color escape (`\x1b[`)
  is present in the returned string. Inherit the Requirements Testing Approach — unit level only.
- Skip: snapshotting the exact banner text, asserting specific color codes per letter, or any
  test that captures `process.stdout`. The pure renderer is the seam — test it directly, not
  the entrypoint's output. Don't assert exact glyph art (brittle on any font tweak).

## Execution Notes

_(none yet — appended at runtime)_
