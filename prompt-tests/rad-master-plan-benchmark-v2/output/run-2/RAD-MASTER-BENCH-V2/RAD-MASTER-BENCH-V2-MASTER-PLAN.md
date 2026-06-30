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

RAD-MASTER-BENCH-V2 is a small, dependency-free Node.js CLI that prints "HELLO WORLD" as
large blocky ASCII-art letters, each tinted through a repeating seven-color rainbow, on a
single run. It is built to feel finished and shareable the moment it runs while staying small
enough to land in one sprint — a pure renderer plus a thin entrypoint, a zero-dependency
manifest, a unit test, and a usage README.

The work is one integration unit sized as two large slices: the complete runnable CLI —
rainbow renderer, one-shot entrypoint, zero-dep manifest, and the renderer's unit test, end to
end — and the README that makes the result visible without running it.

## Execution Map

**P01 · Rainbow Hello-World CLI** · repos: RAD-MASTER-BENCH-V2 · order: T01→T02

| Task | Repo | Complexity | What it does |
|---|---|---|---|
| T01 | RAD-MASTER-BENCH-V2 | standard | The full runnable CLI end-to-end — pure rainbow `renderBanner()` (glyph map + ANSI palette), one-shot `index.js` entrypoint, zero-dependency `package.json`, and the `node:test` renderer unit test — R1, R2, R3, R4, R5. |
| T02 | RAD-MASTER-BENCH-V2 | simple | Usage README with install/run/Node-version/test commands and a static banner showcase — R6. |

## P01: Rainbow Hello-World CLI

When this phase completes the project is a runnable, tested, documented CLI: `npm start` (and
`node index.js`) prints a rainbow "HELLO WORLD" banner once and exits 0, `npm test` passes
against the pure renderer with zero runtime dependencies installed, and the README shows the
output without running it. T01 builds and wires the entire CLI as one slice — pure core, I/O
shell, manifest, and test; T02 documents it.

### P01-T01: Build the runnable rainbow-hello CLI

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

### P01-T02: Write usage README with showcase

Document the CLI so a newcomer goes from clone to banner in seconds: how to run it, the
supported Node version, how to run the test, and a static snapshot of the output so the result
is visible without running anything.

**Task type:** doc
**Complexity:** simple
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `README.md` (usage + showcase).

**The change**
- Cover, concisely: installation (clone; no `npm install` step is needed since there are zero
  runtime dependencies), how to run (`node index.js` or `npm start`), the supported Node version
  (18+, matching `engines`), and how to run the test (`npm test`).
- Include a static **showcase** of the banner — a fenced code block snapshot of the
  "HELLO WORLD" ASCII art — with a one-line note that the letters render in rainbow color on an
  ANSI-capable terminal (since the escape codes don't survive a plain Markdown block).

**Done when**
- README documents install, the run command, the supported Node version, and the test command.
- README includes a static banner showcase block so the output is visible without running the
  CLI.

**Testing**
- Doc task — no automated test. Don't add a test asserting README prose or the showcase text;
  static-content assertions are brittle by nature.
