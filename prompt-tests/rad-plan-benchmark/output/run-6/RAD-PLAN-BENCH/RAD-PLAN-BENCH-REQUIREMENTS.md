---
project: "RAD-PLAN-BENCH"
type: requirements
status: "draft"
approved_at: null
created: "2026-06-27"
project-type: side-project
repos: [RAD-PLAN-BENCH]
repo-group: null
requirement_count: 22
author: "planner-agent"
---

# RAD-PLAN-BENCH — Requirements

RAD-PLAN-BENCH is a tiny, dependency-free Node.js CLI that prints "HELLO WORLD" in large blocky ASCII-art letters, each letter colored in a cycling rainbow spectrum (red → orange → yellow → green → cyan → blue → purple). It runs once, writes the banner to the terminal, and exits. The point is a result that feels finished and shareable the instant it runs, while staying small enough to build in a single sprint.

The intended audience is a developer kicking the tires on a new toolchain who wants an immediately satisfying "hello world" rather than a boring one. Success is a clean single-invocation banner that renders correctly on modern terminals, ships with a passing unit test and a usage README, and carries no runtime dependencies.

## Goals

- Print "HELLO WORLD" as large ASCII-art typography in a single terminal invocation.
- Color each letter through a repeating seven-color rainbow cycle using raw ANSI escape codes.
- Keep the project dependency-free at runtime — Node.js built-ins only.
- Ship at least one unit test that asserts banner structure and the presence of color codes.
- Provide a README with usage instructions and a showcase of the output.
- Stay buildable in one sprint with deliberately narrow scope.

## Non-Goals

- No CLI flags or options (`--word`, `--style`, `--speed`).
- No configuration files or interactive/shell mode.
- No character-by-character or wave reveal animation in v1 (deferred future iteration).
- No web version, HTTP API, or library/package export surface.
- No guaranteed parity on legacy terminals that lack ANSI support.
- No performance tuning or large-output handling.

## Functional Requirements

### FR-1: Print HELLO WORLD banner
**Tags:** FR-1, banner, output
The CLI renders the literal text "HELLO WORLD" as multi-line ASCII-art letters to standard output. The word break between "HELLO" and "WORLD" is preserved as a visible gap.

### FR-2: Large blocky letterforms
**Tags:** FR-2, ascii-art, typography
Each character is drawn from a fixed ASCII-art font that is 3–5 rows tall, producing large, readable blocky glyphs. All required letters (H, E, L, O, W, R, D) and the space separator are defined.

### FR-3: Rainbow per-letter coloring
**Tags:** FR-3, color, rainbow
Each rendered letter is assigned the next color in the rainbow sequence, cycling red → orange → yellow → green → cyan → blue → purple and wrapping back to red. Color advances per letter, not per row, so a multi-row letter is a single solid color.

### FR-4: Single invocation, run-once
**Tags:** FR-4, cli, lifecycle
Running the entrypoint (`node index.js` or `npm start`) prints the banner exactly once and exits with status code 0. There is no loop, prompt, or wait for input.

### FR-5: No input or arguments
**Tags:** FR-5, cli, no-args
The program ignores any command-line arguments and reads no stdin. Behavior is identical regardless of how it is invoked, with no error on extra args.

### FR-6: npm start script
**Tags:** FR-6, npm, packaging
`package.json` defines a `start` script that runs the entrypoint, so `npm start` is an equivalent invocation to `node index.js`.

### FR-7: Unit test for output structure and color
**Tags:** FR-7, testing, verification
A unit test invokes the banner-producing function and asserts (a) the output contains the expected number of ASCII-art rows and (b) at least one ANSI color escape sequence is present in the output.

### FR-8: README usage and showcase
**Tags:** FR-8, docs, readme
The README documents installation, how to run the CLI, the expected Node version, and includes a static showcase of what the banner looks like.

## Non-Functional Requirements

### NFR-1: Zero runtime dependencies
**Tags:** NFR-1, dependencies, footprint
The shipped CLI uses only Node.js built-in modules at runtime. The `dependencies` block in `package.json` is empty; any tooling lives in `devDependencies` only.

### NFR-2: Node.js 18+ LTS
**Tags:** NFR-2, runtime, compatibility
The project targets Node.js 18 or newer (modern LTS) and declares this via an `engines` field. No syntax or API beyond that baseline is used.

### NFR-3: Modern-terminal rendering
**Tags:** NFR-3, terminal, ansi
Output renders correctly on terminals with ANSI escape support (modern macOS/Linux terminals, Windows Terminal). Legacy terminals without ANSI support are explicitly out of scope.

### NFR-4: Fast single-run completion
**Tags:** NFR-4, performance
The banner prints and the process exits effectively instantly (well under one second) on a typical developer machine, since output is a small fixed string.

### NFR-5: Minimal, scannable codebase
**Tags:** NFR-5, maintainability, simplicity
The implementation stays small and readable — a single entrypoint plus a small rendering module — so the whole project can be read in a few minutes.

## Architectural Decisions

### AD-1: Hardcoded ASCII-art font
**Tags:** AD-1, ascii-art, font
**Resolves:** FR-2
The letterforms are stored as a hardcoded glyph map (per-character arrays of row strings) in the source rather than generated via a third-party library such as figlet. This keeps the project dependency-free and the output deterministic.

### AD-2: Raw ANSI escape codes for color
**Tags:** AD-2, color, ansi
**Resolves:** FR-3
Coloring uses raw ANSI SGR escape sequences (e.g. `\x1b[38;5;{n}m` 256-color or `\x1b[{n}m` codes) emitted directly, rather than a coloring library such as chalk. The seven rainbow colors are defined as a fixed ordered palette constant.

### AD-3: Pure render function separated from I/O
**Tags:** AD-3, structure, testability
**Resolves:** FR-7
Banner construction is a pure function that returns the colored multi-line string; the entrypoint is the only place that writes to stdout. This separation makes the renderer unit-testable without capturing process output.

### AD-4: Node built-in test runner
**Tags:** AD-4, testing, tooling
**Resolves:** FR-7
Tests run on Node's built-in `node:test` runner with `node:assert`, invoked via an npm `test` script. No external test framework is added, preserving the zero-runtime-dependency posture (and minimal devDependencies).

### AD-5: Two-module layout
**Tags:** AD-5, structure, layout
**Resolves:** FR-4
The codebase is two source files: a renderer module exporting the pure banner function (glyphs + palette + assembly) and an `index.js` entrypoint that calls it and prints. `package.json` ties them together with `start` and `test` scripts.

## Design Decisions

### DD-1: Rainbow palette order
**Tags:** DD-1, color, palette
**Resolves:** FR-3
The rainbow palette is the fixed ordered list red, orange, yellow, green, cyan, blue, purple. Letter N takes palette index `N mod 7`, giving a continuous spectrum across the 10 visible letters of "HELLOWORLD".

### DD-2: Centered word gap
**Tags:** DD-2, layout, spacing
**Resolves:** FR-1
"HELLO" and "WORLD" are separated by a fixed blank-glyph gap (a few spaces wide per row) so the two words read as a single banner with a clear break, rather than running together.

### DD-3: Color reset after each letter
**Tags:** DD-3, color, ansi
**Resolves:** FR-3
Each colored glyph segment is terminated with an ANSI reset (`\x1b[0m`) so color never bleeds past the banner into the user's subsequent shell prompt.

### DD-4: Trailing newline and clean output
**Tags:** DD-4, output, formatting
**Resolves:** FR-1
The banner ends with a single trailing newline and no leading blank lines, so the output sits cleanly in the terminal scrollback without extra padding.
