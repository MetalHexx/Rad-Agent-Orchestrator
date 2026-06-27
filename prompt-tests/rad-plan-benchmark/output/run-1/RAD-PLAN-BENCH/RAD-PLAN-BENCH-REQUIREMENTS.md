---
project: "RAD-PLAN-BENCH"
type: requirements
status: "draft"
approved_at: null
created: "2026-06-27"
project-type: side-project
repos: [RAD-PLAN-BENCH]
repo-group: null
requirement_count: 20
author: "planner-agent"
---

# RAD-PLAN-BENCH — Requirements

RAD-PLAN-BENCH is a tiny, fun Node.js command-line program that prints "HELLO WORLD" as large, blocky ASCII-art letters, with each letter painted a different color cycling through the rainbow spectrum. It runs once on a single invocation, draws its art centered in the terminal, and exits — no flags, no configuration, no interactive mode. It is built for developers who want an immediately satisfying, shareable starter artifact, and it doubles as a deliberately simple end-to-end exercise of the orchestration pipeline.

Success means a developer can clone the repo, run `npm start` (or `node index.js`), and see a colorful "HELLO WORLD" banner within seconds on any modern terminal. The implementation stays dead simple — a single render path, minimal dependencies, and a small unit-test suite that proves the output structure and color codes are present.

## Goals

- Display "HELLO WORLD" as large ASCII-art typography (blocky letters, 3–5 lines tall).
- Color each letter a distinct rainbow hue, cycling red → orange → yellow → green → cyan → blue → purple and looping.
- Run once on a single invocation and exit cleanly with no flags or config.
- Center the rendered art in the terminal output.
- Keep dependencies minimal and the build completable in a single sprint.
- Ship a small unit-test suite and a README that showcases the art and usage.

## Non-Goals

- User-facing flags or options (`--word`, `--style`, `--speed`).
- Configuration files of any kind.
- Interactive mode, a shell, or a long-running process.
- The character-by-character "reveal"/wave animation (deferred as a potential future iteration, not in v1).
- Guaranteed cross-terminal parity beyond "readable on most modern terminals."
- Performance optimization, large-output handling, a web version, or an API.

## Functional Requirements

### FR-1: Single-invocation CLI entrypoint
**Tags:** FR-1, cli, entrypoint

The program runs from a single command (`node index.js` or `npm start`), renders its output once, and exits with a success status. It accepts no arguments and reads no input.

### FR-2: Large ASCII-art "HELLO WORLD"
**Tags:** FR-2, ascii-art, typography

The program renders the literal text "HELLO WORLD" as large, blocky ASCII-art letters that are 3–5 lines tall and visually readable as the words.

### FR-3: Per-letter rainbow coloring
**Tags:** FR-3, color, rainbow

Each rendered letter is colored a distinct hue, cycling through the rainbow spectrum (red → orange → yellow → green → cyan → blue → purple) and looping back to red when the sequence is exhausted across the letters.

### FR-4: Centered output
**Tags:** FR-4, layout, centering

The assembled ASCII-art banner is horizontally centered in the terminal output based on the available terminal width, falling back to a sensible default width when the width is not detectable.

### FR-5: Unit test suite
**Tags:** FR-5, testing, verification

A unit-test suite verifies the program's observable output, including at minimum that the rendered banner has the expected multi-line structure and that ANSI color codes are present in the colored output.

### FR-6: README with usage and showcase
**Tags:** FR-6, docs, readme

A README documents how to install and run the program and showcases the ASCII-art output so a reader understands what the program produces before running it.

### FR-7: Project manifest and start script
**Tags:** FR-7, packaging, npm

A `package.json` declares the project metadata, an `npm start` script that runs the entrypoint, an `npm test` script that runs the test suite, and only the minimal dependencies the implementation requires.

## Non-Functional Requirements

### NFR-1: Minimal dependencies
**Tags:** NFR-1, dependencies, simplicity

The program prefers Node.js builtins and keeps third-party dependencies to the smallest viable set, with `chalk` permitted solely for cross-platform terminal coloring.

### NFR-2: Modern-terminal readability
**Tags:** NFR-2, compatibility, ansi

Colored output renders correctly on most modern terminals (including Windows Terminal, macOS Terminal, and common Linux emulators); per-terminal parity beyond this is explicitly not guaranteed.

### NFR-3: Node.js runtime target
**Tags:** NFR-3, runtime, node

The program targets a modern Node.js LTS runtime, version 18 or newer, and does not rely on APIs unavailable in that range.

### NFR-4: Single-sprint buildability
**Tags:** NFR-4, simplicity, scope

The codebase stays small enough to build and review in a single sprint — a single render path, no scope creep, and no external design or asset-production work.

## Architectural Decisions

### AD-1: Hardcoded ASCII-art letterforms
**Tags:** AD-1, ascii-art, dependencies
**Resolves:** FR-2

ASCII-art letterforms for the characters in "HELLO WORLD" are hardcoded as data within the project rather than generated by a runtime library such as figlet. This keeps the dependency surface minimal and the output deterministic.

### AD-2: Coloring via chalk
**Tags:** AD-2, color, chalk
**Resolves:** FR-3, NFR-2

Color is applied using the `chalk` library, which handles ANSI color emission and cross-platform terminal support. This is the one permitted third-party runtime dependency.

### AD-3: Separation of render logic from output
**Tags:** AD-3, structure, testability
**Resolves:** FR-5

Banner-building logic (assembling letterforms and applying colors) is implemented as a pure, importable function distinct from the side-effecting console write. The entrypoint composes the pure builder with a single `console.log`, so tests can assert on the returned string without capturing stdout.

### AD-4: No animation in v1
**Tags:** AD-4, scope, static-render
**Resolves:** FR-1

The v1 program renders the full banner in a single synchronous pass and exits; there is no timed reveal, no async delay loop, and no animation code path. The reveal/wave effect is a deferred future idea, not part of this build.

### AD-5: Module format and layout
**Tags:** AD-5, structure, packaging

The project is a single small Node.js package with a top-level entrypoint (`index.js`), a separately importable render module, and a colocated test file. A consistent module system (CommonJS or ESM) is used throughout, declared in `package.json`.

## Design Decisions

### DD-1: Rainbow palette and sequence
**Tags:** DD-1, color, palette
**Resolves:** FR-3

The rainbow palette is the ordered sequence red, orange, yellow, green, cyan, blue, purple. Colors are assigned to letters in this order and wrap around when there are more letters than palette entries, producing a continuous rainbow across the full "HELLO WORLD" string.

### DD-2: Blocky letterform style
**Tags:** DD-2, typography, ascii-art
**Resolves:** FR-2

Letterforms use a uniform blocky style, all letters sharing a consistent fixed height of 3–5 rows so the banner reads as clean horizontal lines. Letters are separated by a small consistent gap of spaces for legibility.

### DD-3: Centering behavior
**Tags:** DD-3, layout, centering
**Resolves:** FR-4

The banner is centered by measuring the widest rendered line and padding each line with leading spaces relative to the terminal width (`process.stdout.columns`), defaulting to an 80-column assumption when the width is unavailable. Padding is applied to the uncolored geometry so color codes do not distort alignment.

### DD-4: Whitespace handling for the space between words
**Tags:** DD-4, layout, spacing
**Resolves:** FR-2

The space between "HELLO" and "WORLD" is rendered as a visible gap of blank columns spanning the full letter height, keeping the two words distinct while preserving the single-banner alignment.
