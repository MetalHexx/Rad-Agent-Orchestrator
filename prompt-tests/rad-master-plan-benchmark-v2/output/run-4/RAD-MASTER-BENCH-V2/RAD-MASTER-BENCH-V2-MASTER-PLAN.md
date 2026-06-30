---
project: "RAD-MASTER-BENCH-V2"
type: master_plan
status: draft
created: "2026-06-29"
project-type: side-project
repos: ["RAD-MASTER-BENCH-V2"]
repo-group: null
total_phases: 1
total_tasks: 3
---

# RAD-MASTER-BENCH-V2 — Master Plan

## Introduction

RAD-MASTER-BENCH-V2 is a tiny, dependency-free Node.js CLI that prints "HELLO WORLD" as
large blocky ASCII-art letters, each tinted through a repeating seven-color rainbow, on a
single run. The whole project is a pure renderer module, a thin stdout entrypoint, a manifest
with empty runtime deps, one unit test, and a usage README — small enough to finish in a
single sprint while feeling finished and shareable the moment it runs.

The work lands as one integration phase: build the colored banner subsystem and its test,
wrap it in a run-once CLI with a zero-dependency manifest, then document it with a static
showcase. The pure `renderBanner()` function is the load-bearing seam — everything testable
lives there, and `index.js` is the only place that writes to stdout.

## Execution Map

**P01 · Rainbow Hello-World CLI** · repos: RAD-MASTER-BENCH-V2 · order: T01→T02→T03

| Task | Repo | Complexity | What it does |
|---|---|---|---|
| T01 | RAD-MASTER-BENCH-V2 | standard | Pure rainbow renderer (glyph map + 7-color ANSI palette + `renderBanner()`) plus its `node:test` unit test. |
| T02 | RAD-MASTER-BENCH-V2 | simple | Run-once `index.js` entrypoint and the zero-dependency `package.json` (engines, `start`/`test` scripts). |
| T03 | RAD-MASTER-BENCH-V2 | simple | `README.md` with install/run/Node-version usage and a static banner showcase. |

## P01: Rainbow Hello-World CLI

When this phase completes the project is shippable end-to-end: `npm start` (or `node index.js`)
prints the rainbow "HELLO WORLD" banner and exits 0, `npm test` passes against the pure
renderer, the runtime dependency surface is empty, and the README gets a newcomer from clone to
banner in seconds. The three tasks meet at one seam — the test script in `package.json` (T02)
runs the test file authored in T01, and the README showcase (T03) reflects the banner T01/T02
produce.

### P01-T01: Build the pure rainbow renderer and its unit test

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

### P01-T02: Wire the run-once CLI entrypoint and zero-dependency manifest

The thin shell around the renderer: an entrypoint that prints the banner exactly once and exits
cleanly, and a `package.json` that declares the zero-dependency, modern-Node posture and the
`start`/`test` scripts. When it lands, `node index.js` and `npm start` both print the banner, and
`npm test` runs the T01 test — the project is runnable and verifiable from a clean clone.

**Task type:** code
**Complexity:** simple
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `index.js` (the sole I/O boundary — imports `renderBanner` from `renderer.js`, writes
  the result to stdout once, exits 0).
- Create: `package.json` (empty runtime `dependencies`, `engines.node`, `start`/`test` scripts;
  module type consistent with the `import`/`export` style chosen in T01).

**The change**
- `index.js` is intentionally tiny — call the pure function and print:
  ```js
  import { renderBanner } from "./renderer.js";
  process.stdout.write(renderBanner());
  // run-once: no loop, no stdin read, no arg parsing; falls off the end → exit 0
  ```
  Ignore any command-line arguments and read no stdin; extra args must not raise an error.
  Do not append an extra newline here — `renderBanner()` already ends with exactly one.
- `package.json` contract:
  ```json
  {
    "name": "rad-master-bench-v2",
    "version": "1.0.0",
    "type": "module",
    "engines": { "node": ">=18" },
    "scripts": { "start": "node index.js", "test": "node --test" },
    "dependencies": {}
  }
  ```
  `dependencies` is empty (built-ins only); any tooling would live in `devDependencies`.
  `"type": "module"` is required because T01 ships ESM (`export`/`renderBanner` is imported via
  `import` above) — without it `node index.js` throws `SyntaxError: Cannot use import statement
  outside a module`. Keep the manifest and the source module style consistent: ESM source ↔
  `"type": "module"`.
- **The seam to get right:** the `test` script must discover T01's `renderer.test.js`. `node --test`
  auto-discovers `*.test.js` files, so the filename from T01 and this script are the contract —
  if T01 named the test differently, the glob must still match. And `engines.node >= 18` is what
  makes `node --test` available, so the baseline and the script agree.

**Done when**
- `node index.js` prints the rainbow banner exactly once and exits with status 0; passing extra
  arguments changes nothing and raises no error.
- `npm start` is equivalent to `node index.js`; `npm test` runs the renderer unit test and passes.
- `package.json` has an empty `dependencies` block and declares `engines.node >= 18`.

**Testing**
- No new test file — this task is exercised by T01's unit test running through the `npm test`
  script and by the manual run-once acceptance above (`node index.js` → banner, exit 0).
- Skip asserting the manifest's static field values in a test; they're config, verified by the
  scripts actually running, not by snapshotting JSON.

### P01-T03: Write the usage README with a static showcase

The front door: a README that takes a newcomer from clone to banner in seconds and shows the
result without making them run it. When it lands, the project documents how to install and run,
states the supported Node version, and shows what the output looks like.

**Task type:** doc
**Complexity:** simple
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `README.md` (installation, how to run, supported Node version, and a static showcase of
  the banner output).

**The change**
- Document, concisely: cloning/installing, running via both `node index.js` and `npm start`,
  running the test via `npm test`, and the supported Node baseline (18+, matching `engines.node`).
- Include a static **showcase** of the banner so the result is visible without running it — a
  fenced code block of the ASCII-art "HELLO WORLD" (a plain-text approximation of the blocky art
  is fine; the live terminal output is colored). Note that colors render on ANSI-capable terminals.
- Keep it short and skimmable — this is a one-sprint side project, not a manual. State that there
  are no flags or configuration (run-once by design), consistent with the Non-Goals.

**Done when**
- `README.md` covers install, run (`node index.js` / `npm start`), test (`npm test`), and the
  Node 18+ requirement.
- It contains a static showcase block of the banner output and notes that coloring requires an
  ANSI-capable terminal.

**Testing**
- None — this is a documentation deliverable. Do not add a test that asserts the README's prose or
  the showcase text; such content-assertion tests are brittle and protect nothing. A human read
  for accuracy is the check.
