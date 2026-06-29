---
project: "RAD-MASTER-BENCH-V2"
type: requirements
status: draft
created: "2026-06-29"
project-type: side-project
repos: [RAD-MASTER-BENCH-V2]
repo-group: null
requirement_count: 6
---

# RAD-MASTER-BENCH-V2 — Requirements

RAD-MASTER-BENCH-V2 is a small, dependency-free Node.js CLI that prints "HELLO WORLD" as
large blocky ASCII-art letters, each colored through a repeating rainbow spectrum, on a
single invocation. The aim is an output that feels finished and shareable the moment it runs
while staying small enough to build in one sprint — a "hello world" that is fun rather than
dull, rendering cleanly on modern ANSI terminals with a passing unit test, a usage README,
and no runtime dependencies.

## Goals

- Print "HELLO WORLD" as large ASCII-art typography from a single terminal invocation.
- Color each letter through a repeating seven-color rainbow cycle using raw ANSI escape codes.
- Keep the project free of runtime dependencies — Node.js built-ins only.
- Ship at least one unit test asserting banner structure and presence of color codes.
- Provide a README with usage instructions and a showcase of the output.
- Keep scope narrow enough to finish in a single sprint.

## Non-Goals

- No CLI flags or options (`--word`, `--style`, `--speed`).
- No configuration files, interactive mode, or shell.
- No character-by-character or wave reveal animation in v1 (deferred to a future iteration).
- No web version, HTTP API, or reusable library export surface.
- No guaranteed rendering parity on legacy terminals lacking ANSI support.
- No performance tuning or large-output handling.

## Affected Repositories

| Repository | Role | Nature of change |
|---|---|---|
| `RAD-MASTER-BENCH-V2` | The standalone rainbow-hello CLI (side-project — no registered repo) | New: renderer module, CLI entrypoint, package manifest, unit test, and README. |

## Requirements

### R1: HELLO WORLD ASCII banner

The CLI's core output — "HELLO WORLD" rendered as large, readable ASCII-art typography.

- Renders the literal text "HELLO WORLD" as multi-line ASCII-art letters to standard output,
  with a visible gap between the two words.
- Each glyph is drawn from a fixed ASCII-art font 3–5 rows tall; the letters H, E, L, O, W,
  R, D and the inter-word space are all defined.
- "HELLO" and "WORLD" are separated by a fixed blank-glyph gap (a few spaces wide per row) so
  the words read as one banner with a clear break.
- The banner ends with a single trailing newline and no leading blank lines, so it sits
  cleanly in terminal scrollback.
- **Technical:** letterforms are a hardcoded glyph map (per-character arrays of row strings)
  in source — no figlet-style library — keeping output deterministic and dependency-free.

### R2: Per-letter rainbow coloring

Every letter is tinted through a repeating rainbow spectrum, advancing one color per letter.

- Each rendered letter takes the next color in the sequence red → orange → yellow → green →
  cyan → blue → purple, wrapping back to red; color advances per letter, so every row of a
  given letter shares one color.
- Letter N takes palette index `N mod 7`, giving a continuous spectrum across the visible
  letters of "HELLOWORLD".
- **Technical:** coloring uses raw ANSI SGR escape sequences emitted directly (no chalk); the
  seven colors are a fixed ordered palette constant. Each colored glyph segment is terminated
  with an ANSI reset (`\x1b[0m`) so color never bleeds into the user's subsequent prompt.

### R3: Single-invocation CLI lifecycle

A run-once command — no flags, no input, clean exit.

- Running the entrypoint (`node index.js` or `npm start`) prints the banner exactly once and
  exits with status code 0 — no loop, prompt, or wait for input.
- The program ignores any command-line arguments and reads no stdin; behavior is identical
  regardless of invocation, and extra arguments raise no error.
- **Technical:** `package.json` defines a `start` script that runs the entrypoint, making
  `npm start` equivalent to `node index.js`.

### R4: Zero-dependency packaging & runtime posture

The project ships with an empty runtime dependency surface and a modern Node baseline.

- The shipped CLI uses only Node.js built-in modules at runtime; the `dependencies` block in
  `package.json` is empty (any tooling lives in `devDependencies`).
- Targets Node.js 18 or newer (modern LTS), declared via an `engines` field; no API beyond
  that baseline is used.
- **Technical:** the codebase is two source files — a renderer module exporting the pure
  banner function (glyphs + palette + assembly) and an `index.js` entrypoint that calls it
  and prints — tied together by `start` and `test` scripts in `package.json`.

### R5: Unit-tested pure renderer

The banner builder is a pure, testable function, exercised by a built-in-runner unit test.

- A unit test invokes the banner-producing function and asserts that (a) the output has the
  expected number of ASCII-art rows and (b) at least one ANSI color escape sequence is present.
- **Technical:** banner construction is a pure function returning the colored multi-line
  string; the entrypoint is the only place that writes to stdout, making the renderer testable
  without capturing process output. Tests run on Node's built-in `node:test` + `node:assert`,
  invoked via an npm `test` script, preserving the zero-runtime-dependency posture.

### R6: Usage README & showcase

A README that gets a newcomer from clone to banner in seconds.

- Documents installation, how to run the CLI, and the supported Node version.
- Includes a static showcase of the banner output so the result is visible without running it.

## Technical Specification

**Architecture.** Two source files plus a manifest and a test:

- `renderer` module — owns the hardcoded glyph map, the ordered rainbow palette constant, and
  the pure `renderBanner()` assembly (glyph lookup → per-letter colorization → row join).
  Returns a single colored multi-line string; performs no I/O.
- `index.js` entrypoint — calls `renderBanner()` and writes the result to stdout exactly once,
  then exits 0. The only I/O boundary in the project.
- `package.json` — empty `dependencies`; `engines.node >= 18`; `start` and `test` scripts.

| Concern | Decision |
|---|---|
| Font | Hardcoded per-character row-string arrays (deterministic, no library). |
| Color | Raw ANSI SGR escapes; fixed 7-color palette; reset after each letter. |
| Palette mapping | Letter N → palette index `N mod 7`. |
| Test runner | `node:test` + `node:assert`, via `npm test` (devDependencies only). |

**Quality attributes.** Output renders correctly on ANSI-capable terminals (modern
macOS/Linux terminals and Windows Terminal); legacy non-ANSI terminals are out of scope. The
process prints and exits effectively instantly (well under one second) since the output is a
small fixed string. The implementation stays small and scannable — one entrypoint plus a
small renderer — readable end-to-end in a few minutes.

### Testing Approach

Unit level only. The pure `renderBanner()` function is the seam: one `node:test` case asserts
the expected ASCII-art row count and the presence of at least one ANSI color escape. No
integration or e2e layer is warranted for a single run-once command. The test runs via
`npm test` and pulls in no runtime dependencies.

## Key Files & Modules

- `RAD-MASTER-BENCH-V2`: `index.js` (entrypoint / sole stdout boundary), the renderer module
  (glyph map + palette + pure `renderBanner()`), `package.json` (empty runtime deps, `engines`,
  `start`/`test` scripts), the renderer unit test, and `README.md` (usage + showcase).
