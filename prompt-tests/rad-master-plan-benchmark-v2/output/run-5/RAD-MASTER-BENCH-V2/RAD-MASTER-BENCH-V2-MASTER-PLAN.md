---
project: "RAD-MASTER-BENCH-V2"
type: master_plan
status: draft
created: "2026-06-29"
project-type: side-project
repos: ["RAD-MASTER-BENCH-V2"]
repo-group: null
total_phases: 2
total_tasks: 3
---

# RAD-MASTER-BENCH-V2 — Master Plan

## Introduction

RAD-MASTER-BENCH-V2 is a tiny, dependency-free Node.js CLI that prints "HELLO WORLD"
as large blocky ASCII-art letters, each tinted through a repeating rainbow spectrum,
on a single invocation. The win is an output that feels finished and shareable the
moment it runs while staying small enough to read end-to-end in a few minutes.

The work breaks down along the project's one real seam: the **pure renderer** (glyph
map, rainbow palette, colorized assembly) versus the **I/O boundary** (the entrypoint
that writes once and exits, plus the zero-dependency manifest). The renderer is built
and unit-tested first so the entrypoint has a stable contract to call; the README is
authored last, once there is real output to showcase.

## Execution Map

**P01 · Rainbow banner renderer & CLI** · repos: RAD-MASTER-BENCH-V2 · order: T01→T02

| Task | Repo | Complexity | What it does |
|---|---|---|---|
| T01 | RAD-MASTER-BENCH-V2 | standard | Pure `renderBanner()` — hardcoded glyph map, ordered rainbow palette, per-letter colorized assembly, plus its `node:test` unit test |
| T02 | RAD-MASTER-BENCH-V2 | simple | `index.js` entrypoint (the sole stdout boundary) and the zero-dependency `package.json` (empty deps, `engines`, `start`/`test` scripts) |

**P02 · Documentation & showcase** · repos: RAD-MASTER-BENCH-V2 · order: T01

| Task | Repo | Complexity | What it does |
|---|---|---|---|
| T01 | RAD-MASTER-BENCH-V2 | simple | Usage README — install, how to run, supported Node version, and a static showcase of the banner |

## P01: Rainbow banner renderer & CLI

When this phase completes there is a working, tested command: running the entrypoint
prints the full rainbow "HELLO WORLD" banner once and exits 0, with the banner-building
logic isolated in a pure, unit-tested function and the package declaring a zero
runtime-dependency posture. T01 builds and tests the pure renderer; T02 wires the I/O
boundary and packaging around the contract T01 exports.

### P01-T01: Build the pure rainbow renderer and its test

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

### P01-T02: Wire the entrypoint and zero-dependency package

Add the thin I/O boundary and the package manifest around the renderer: an entrypoint
that prints the banner exactly once and exits cleanly, and a `package.json` that pins
the zero-dependency, modern-Node posture with `start`/`test` scripts. Once this lands the
project is a runnable, installable command.

**Task type:** code
**Complexity:** simple
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `index.js` (the entrypoint — the only place that writes to stdout).
- Create: `package.json` (manifest: empty runtime deps, `engines`, `start`/`test`
  scripts).

**The change**
- `index.js`: require the renderer and write its banner to stdout once, then let the
  process exit 0 naturally:
  ```js
  const { renderBanner } = require('./renderer');
  process.stdout.write(renderBanner());
  ```
  It must ignore any command-line arguments and read no stdin — extra args raise no
  error and behavior is identical regardless of invocation. No explicit non-zero exit.
- `package.json`: CommonJS; `"dependencies": {}` (empty — Node built-ins only);
  `"engines": { "node": ">=18" }`; scripts `"start": "node index.js"` and
  `"test": "node --test"`. `node:test`/`node:assert` are built-ins, so no
  `devDependencies` are required.
- **The seam to get right:** `npm start` must be equivalent to `node index.js`, and the
  entrypoint is the *sole* stdout boundary — do not move any rendering or printing logic
  back into the renderer module.

**Done when**
- `node index.js` prints the full rainbow banner exactly once and exits with status 0.
- `npm start` produces identical output to `node index.js`.
- Passing extra arguments (e.g. `node index.js --whatever`) changes nothing and raises
  no error.
- `package.json` has an empty `dependencies` block and declares `engines.node >= 18`.

**Testing**
- No new automated test is warranted here beyond the renderer test from T01; the
  entrypoint is a one-line I/O shim. Manually verify `node index.js` and `npm start` both
  print the banner once and exit 0, and that `npm test` runs the renderer test green.
- Skip a test that captures process stdout to re-assert the banner bytes — it would only
  duplicate the renderer test against a brittle snapshot.

## P02: Documentation & showcase

When this phase completes a newcomer can go from clone to banner in seconds: the README
documents install, invocation, and the supported Node version, and shows a static
snapshot of the output so the result is visible without running it.

### P02-T01: Author the usage README with output showcase

Write the project README so the finished command is self-explanatory: how to install and
run it, what Node version it needs, and a static showcase of the banner so a reader sees
the result before running anything.

**Task type:** doc
**Complexity:** simple
**Target repo:** RAD-MASTER-BENCH-V2

**Files**
- Create: `README.md` (usage instructions + a static showcase of the banner output).

**The change**
- Document installation (clone, no `npm install` step needed since there are no runtime
  dependencies), how to run the CLI (`node index.js` and the `npm start` equivalent), and
  the supported Node version (18+, matching the manifest `engines`).
- Include a static showcase of the banner: a fenced code block containing the ASCII-art
  "HELLO WORLD" so the shape and layout are visible in the README even though terminal
  colors don't render in Markdown. Note in a line of prose that the live output is
  rainbow-colored per letter.
- Keep it short and scannable — a newcomer should reach a rendered banner in seconds.

**Done when**
- `README.md` covers installation, the run command(s), and the Node 18+ requirement.
- It contains a fenced code block showing the ASCII-art banner as a static showcase.
- The documented run commands match the actual `start` script and entrypoint.

**Testing**
- No automated test — this is documentation. Verify by reading: the commands shown match
  `package.json`/`index.js`, and the showcased banner matches the real output shape.
- Skip any test that asserts on the README's prose or exact bytes; static-content
  assertions are brittle by nature.
