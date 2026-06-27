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

RAD-PLAN-BENCH is a small, dependency-free Node.js CLI that prints "HELLO WORLD" as large blocky ASCII-art letters, with each letter colored through a repeating rainbow spectrum (red → orange → yellow → green → cyan → blue → purple). It runs on a single invocation, writes the banner to the terminal, and exits cleanly. The aim is an output that feels finished and shareable the moment it runs, while staying small enough to build in one sprint.

The audience is a developer trying out a new toolchain who wants a "hello world" that is fun rather than dull. Success is a clean single-run banner that renders correctly on modern ANSI terminals, ships with a passing unit test and a usage README, and pulls in no runtime dependencies.

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

## Functional Requirements

### FR-1: Print HELLO WORLD banner
**Tags:** FR-1, banner, output
The CLI renders the literal text "HELLO WORLD" as multi-line ASCII-art letters to standard output, preserving a visible gap between the two words.

### FR-2: Large blocky letterforms
**Tags:** FR-2, ascii-art, typography
Each character is drawn from a fixed ASCII-art font 3–5 rows tall, producing large readable glyphs. The required letters (H, E, L, O, W, R, D) and the inter-word space are all defined.

### FR-3: Rainbow per-letter coloring
**Tags:** FR-3, color, rainbow
Each rendered letter takes the next color in the rainbow sequence — red → orange → yellow → green → cyan → blue → purple — wrapping back to red. Color advances per letter, so every row of a given letter shares one color.

### FR-4: Single invocation, run-once
**Tags:** FR-4, cli, lifecycle
Running the entrypoint (`node index.js` or `npm start`) prints the banner exactly once and exits with status code 0. There is no loop, prompt, or wait for input.

### FR-5: No input or arguments
**Tags:** FR-5, cli, no-args
The program ignores any command-line arguments and reads no stdin. Behavior is identical regardless of invocation, with no error raised on extra arguments.

### FR-6: npm start script
**Tags:** FR-6, npm, packaging
`package.json` defines a `start` script that runs the entrypoint, making `npm start` equivalent to `node index.js`.

### FR-7: Unit test for output structure and color
**Tags:** FR-7, testing, verification
A unit test invokes the banner-producing function and asserts that (a) the output has the expected number of ASCII-art rows and (b) at least one ANSI color escape sequence is present.

### FR-8: README usage and showcase
**Tags:** FR-8, docs, readme
The README documents installation, how to run the CLI, the supported Node version, and includes a static showcase of the banner output.

## Non-Functional Requirements

### NFR-1: Zero runtime dependencies
**Tags:** NFR-1, dependencies, footprint
The shipped CLI uses only Node.js built-in modules at runtime. The `dependencies` block in `package.json` is empty; any tooling lives in `devDependencies`.

### NFR-2: Node.js 18+ LTS
**Tags:** NFR-2, runtime, compatibility
The project targets Node.js 18 or newer (modern LTS) and declares this via an `engines` field. No API beyond that baseline is used.

### NFR-3: Modern-terminal rendering
**Tags:** NFR-3, terminal, ansi
Output renders correctly on terminals with ANSI escape support (modern macOS/Linux terminals and Windows Terminal). Legacy terminals without ANSI support are out of scope.

### NFR-4: Fast single-run completion
**Tags:** NFR-4, performance
The banner prints and the process exits effectively instantly (well under one second) on a typical developer machine, as the output is a small fixed string.

### NFR-5: Minimal, scannable codebase
**Tags:** NFR-5, maintainability, simplicity
The implementation stays small and readable — a single entrypoint plus a small rendering module — so the whole project can be read in a few minutes.

## Architectural Decisions

### AD-1: Hardcoded ASCII-art font
**Tags:** AD-1, ascii-art, font
**Resolves:** FR-2
Letterforms are stored as a hardcoded glyph map (per-character arrays of row strings) in source rather than generated via a library such as figlet, keeping the project dependency-free and the output deterministic.

### AD-2: Raw ANSI escape codes for color
**Tags:** AD-2, color, ansi
**Resolves:** FR-3
Coloring uses raw ANSI SGR escape sequences emitted directly rather than a library such as chalk. The seven rainbow colors are defined as a fixed ordered palette constant.

### AD-3: Pure render function separated from I/O
**Tags:** AD-3, structure, testability
**Resolves:** FR-7
Banner construction is a pure function returning the colored multi-line string; the entrypoint is the only place that writes to stdout, making the renderer unit-testable without capturing process output.

### AD-4: Node built-in test runner
**Tags:** AD-4, testing, tooling
**Resolves:** FR-7
Tests run on Node's built-in `node:test` runner with `node:assert`, invoked via an npm `test` script, preserving the zero-runtime-dependency posture with minimal devDependencies.

### AD-5: Two-module layout
**Tags:** AD-5, structure, layout
**Resolves:** FR-4
The codebase is two source files: a renderer module exporting the pure banner function (glyphs + palette + assembly) and an `index.js` entrypoint that calls it and prints. `package.json` ties them together with `start` and `test` scripts.

## Design Decisions

### DD-1: Rainbow palette order
**Tags:** DD-1, color, palette
**Resolves:** FR-3
The rainbow palette is the fixed ordered list red, orange, yellow, green, cyan, blue, purple. Letter N takes palette index `N mod 7`, giving a continuous spectrum across the visible letters of "HELLOWORLD".

### DD-2: Centered word gap
**Tags:** DD-2, layout, spacing
**Resolves:** FR-1
"HELLO" and "WORLD" are separated by a fixed blank-glyph gap (a few spaces wide per row) so the two words read as one banner with a clear break rather than running together.

### DD-3: Color reset after each letter
**Tags:** DD-3, color, ansi
**Resolves:** FR-3
Each colored glyph segment is terminated with an ANSI reset (`\x1b[0m`) so color never bleeds past the banner into the user's subsequent shell prompt.

### DD-4: Trailing newline and clean output
**Tags:** DD-4, output, formatting
**Resolves:** FR-1
The banner ends with a single trailing newline and no leading blank lines, so the output sits cleanly in terminal scrollback without extra padding.
