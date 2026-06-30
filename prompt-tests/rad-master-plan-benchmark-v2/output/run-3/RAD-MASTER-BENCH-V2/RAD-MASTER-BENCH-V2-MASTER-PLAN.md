---
project: "RAD-MASTER-BENCH-V2"
type: master_plan
status: draft
created: "2026-06-29"
project-type: side-project
repos: ["RAD-MASTER-BENCH-V2"]
repo-group: null
total_phases: 1
total_tasks: 2
---

# RAD-MASTER-BENCH-V2 — Master Plan

## Introduction

RAD-MASTER-BENCH-V2 is a tiny, dependency-free Node.js CLI that prints "HELLO WORLD" as large
blocky ASCII-art letters, each tinted through a repeating seven-color rainbow, on a single run.
The whole program is a pure renderer module behind one stdout entrypoint, packaged with an
empty runtime-dependency surface and a Node 18+ baseline.

The work is small enough that one phase carries it end to end: build the runnable, unit-tested
CLI as a single vertical slice, then document it. Sizing is **Large** — each task is a full
feature slice touching multiple layers, so the renderer, entrypoint, manifest, and test land
together rather than as separate fragments.

## Execution Map

**P01 · Rainbow HELLO WORLD CLI** · repos: RAD-MASTER-BENCH-V2 · order: T01→T02

| Task | Repo | Complexity | What it does |
|---|---|---|---|
| T01 | RAD-MASTER-BENCH-V2 | standard | Build the runnable, zero-dependency rainbow CLI — pure renderer (glyphs + palette), stdout entrypoint, manifest, and the unit test. |
| T02 | RAD-MASTER-BENCH-V2 | simple | Write the usage README with a static showcase of the banner output. |

## P01: Rainbow HELLO WORLD CLI

When this phase completes, `node index.js` (and `npm start`) prints the rainbow "HELLO WORLD"
banner once and exits 0, `npm test` passes against the pure renderer, the runtime dependency
surface is empty, and a README documents how to run it. The renderer/entrypoint/manifest/test
land as one slice (T01); the README documents the result (T02).

### P01-T01: Build the runnable rainbow CLI

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

### P01-T02: Write the usage README with showcase

Write the project README so a newcomer goes from clone to banner in seconds: install/run steps,
the supported Node version, and a static showcase of the output so the result is visible without
running it. Covers R6. Depends on T01 having settled the run commands and the banner shape.

**Task type:** doc
**Complexity:** simple
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `README.md` (usage + showcase).

**The change**
- Document, in order: what the CLI is (one line), how to run it (`node index.js` **or**
  `npm start`), how to run the test (`npm test`), and the supported Node baseline (18+, matching
  `package.json` `engines`).
- Include a **static showcase** of the banner — a fenced code block holding the rendered
  "HELLO WORLD" ASCII-art so the output is visible on the page without running the CLI. (Show the
  glyph shapes as plain text; raw ANSI escapes don't render in Markdown, so describe that the live
  output is rainbow-colored rather than pasting escape codes.)
- Keep run commands and the Node version consistent with the `package.json` scripts/`engines`
  produced in T01 — this is the cross-task seam: the README must match the actual `start`/`test`
  scripts and engine baseline, not invent its own.

**Done when**
- README documents install, run (`node index.js` / `npm start`), test (`npm test`), and the
  Node 18+ requirement.
- README contains a static ASCII-art showcase block of the banner output.
- Run commands and Node version in the README match `package.json` exactly.

**Testing**
- No automated test — this is a doc task; correctness is that the commands and Node version match
  `package.json` and the showcase reflects the real banner shape.
- Skip any test that asserts the README's exact prose (brittle content-assertion).
