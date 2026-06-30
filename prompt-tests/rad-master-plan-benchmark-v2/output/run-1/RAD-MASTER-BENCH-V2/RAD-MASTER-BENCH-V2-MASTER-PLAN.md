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

RAD-MASTER-BENCH-V2 is a small, dependency-free Node.js CLI that prints "HELLO WORLD" as
large blocky ASCII-art letters, each tinted through a repeating seven-color rainbow, on a
single run. The whole thing is two source files — a pure renderer and a thin entrypoint —
plus a manifest, a unit test, and a usage README, built to feel finished and shareable the
moment it runs.

The work is one integration unit: a rendering engine (glyph map + ANSI palette + pure
`renderBanner()`) with its unit test, the runnable zero-dependency CLI shell that prints it
once and exits, and a README that gets a newcomer from clone to banner in seconds. It lands
in a single phase of three large slices.

## Execution Map

**P01 · Rainbow Hello-World CLI** · repos: RAD-MASTER-BENCH-V2 · order: T01→T02→T03

| Task | Repo | Complexity | What it does |
|---|---|---|---|
| T01 | RAD-MASTER-BENCH-V2 | standard | Pure renderer (glyph map + rainbow palette + `renderBanner()`) and its `node:test` unit test — R1, R2, R5. |
| T02 | RAD-MASTER-BENCH-V2 | simple | `index.js` entrypoint (print once, exit 0, ignore args) + zero-dependency `package.json` (`engines`, `start`/`test`) — R3, R4. |
| T03 | RAD-MASTER-BENCH-V2 | simple | Usage README with install/run/Node-version and a static banner showcase — R6. |

## P01: Rainbow Hello-World CLI

When this phase completes the project is a runnable, tested, documented CLI: `npm start`
prints a rainbow "HELLO WORLD" banner and exits 0, `npm test` passes against the pure
renderer, and the README shows the output without running it. T01 builds the pure core the
other two slices depend on; T02 wraps it in a runnable zero-dep shell; T03 documents it.

### P01-T01: Build pure rainbow renderer and unit test

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

### P01-T02: Wire entrypoint and zero-dependency manifest

Wrap the pure renderer in the runnable CLI: a one-shot `index.js` that prints the banner once
and exits cleanly, and a `package.json` that declares a modern Node baseline, an empty runtime
dependency surface, and the `start`/`test` scripts. Once it lands, `npm start` and `node
index.js` both produce the banner and `npm test` runs the renderer test.

**Task type:** code
**Complexity:** simple
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `index.js` (the sole stdout boundary — calls `renderBanner()` and prints).
- Create: `package.json` (manifest: empty runtime deps, `engines`, `start`/`test` scripts).

**The change**
- `index.js` is a thin I/O wrapper over the pure renderer:
  ```js
  const { renderBanner } = require('./renderer');
  process.stdout.write(renderBanner());
  // no explicit process.exit() — the process exits 0 once the event loop drains
  ```
  It ignores `process.argv` entirely (extra arguments raise no error), reads no stdin, and is
  the only place in the project that writes to stdout — keeping the renderer pure and testable.
- **Do not call `process.exit(0)` immediately after the write.** `process.exit()` can terminate
  before `process.stdout` flushes when stdout is a pipe or a redirected file, truncating the
  banner; a clean run already exits 0 when the event loop drains. If an explicit exit is ever
  needed, put it in the write callback — `process.stdout.write(renderBanner(), () => process.exit(0))` —
  or set `process.exitCode = 0` instead.
- `package.json` shape:
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
  `node index.js`; `test` runs the built-in runner so the renderer test executes with no
  runtime or dev dependency installed.
- **The seam to get right:** all stdout stays in `index.js` — don't move printing into the
  renderer, and don't add flag parsing or an arg-validation branch (R3 is explicitly
  argument-agnostic).

**Done when**
- `node index.js` and `npm start` each print the rainbow banner exactly once and exit with
  status 0.
- `node index.js --anything extra` prints the same banner and exits 0 with no error.
- `package.json` has an empty `dependencies` block and `engines.node` of `>=18`, and
  `npm test` invokes the built-in test runner.

**Testing**
- No new automated test here — the entrypoint is a thin wrapper and the renderer is already
  covered by T01. A manual `node index.js` / `npm start` smoke check confirms the one-shot
  print-and-exit.
- Skip a stdout-capture test that re-asserts the full banner string — it would only duplicate
  T01's renderer assertions against brittle exact output.

### P01-T03: Write usage README with showcase

Document the CLI so a newcomer goes from clone to banner in seconds: how to run it, the
supported Node version, and a static snapshot of the output so the result is visible without
running anything.

**Task type:** doc
**Complexity:** simple
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `README.md` (usage + showcase).

**The change**
- Cover, concisely: installation (clone; no `npm install` step is needed since there are zero
  runtime dependencies), how to run (`node index.js` or `npm start`), the supported Node
  version (18+, matching `engines`), and how to run the test (`npm test`).
- Include a static **showcase** of the banner — a fenced code block snapshot of the
  "HELLO WORLD" ASCII art — with a one-line note that the letters render in rainbow color on an
  ANSI-capable terminal (since the escape codes don't survive a plain Markdown block).

**Done when**
- README documents install, the run command, the supported Node version, and the test command.
- README includes a static banner showcase block so the output is visible without running the
  CLI.

**Testing**
- Doc task — no automated test. Don't add a test that asserts README prose or the showcase
  text; static-content assertions are brittle by nature.
