---
project: RAD-MASTER-BENCH-V1
phase: 2
task: 1
title: Author usage README and showcase
status: pending
requirement_tags:
  - FR-8
  - NFR-1
  - NFR-2
  - NFR-3
repos:
  - RAD-MASTER-BENCH-V1
author: explosion-script
created: '2026-06-29T20:07:42.211Z'
type: task_handoff
---

# P02-T01: Author usage README and showcase

Establishes the project's documentation: how to install and run the CLI, the supported runtime, the dependency-free posture, and a static, ANSI-stripped showcase of the rendered banner.

**Task type:** doc
**Requirements:** FR-8, NFR-1, NFR-2, NFR-3
**Target repos:** RAD-MASTER-BENCH-V1
**Files for RAD-MASTER-BENCH-V1:**
- Create: `README.md`

- [ ] **Step 1: Author README.md (FR-8, NFR-1, NFR-2, NFR-3)**
Create `README.md` with exactly the content below. It documents installation and how to run the CLI via `npm start` or `node index.js` (FR-8), states the Node.js 18+ requirement (NFR-2), states the zero-runtime-dependency posture so no install step is needed (NFR-1), states the modern-ANSI-terminal requirement (NFR-3), and embeds the static ANSI-stripped showcase of the banner.

````markdown
# RAD-MASTER-BENCH-V1

Prints **HELLO WORLD** as large, blocky ASCII-art letters, each colored through
a repeating rainbow spectrum (red, orange, yellow, green, cyan, blue, purple).
One run, one banner, then it exits.

## Requirements

- Node.js 18 or newer (modern LTS).
- A terminal with ANSI escape support (modern macOS/Linux terminals or Windows
  Terminal). Legacy terminals without ANSI color are not supported.

## Install

```bash
git clone <repo-url>
cd RAD-MASTER-BENCH-V1
```

No dependency install is required — this project uses only Node.js built-in
modules and ships with zero runtime dependencies.

## Usage

```bash
npm start
# or
node index.js
```

The banner prints once and the process exits. Command-line arguments and stdin
are ignored, so the output is identical no matter how you invoke it.

## Showcase

The live banner is rainbow-colored, one color per letter. With colors stripped,
the ASCII-art structure looks like this:

```text
#   # ##### #     #      ###     #   #  ###  ####  #     #### 
#   # #     #     #     #   #     #   # #   # #   # #     #   #
##### ####  #     #     #   #     # # # #   # ####  #     #   #
#   # #     #     #     #   #     ## ## #   # #  #  #     #   #
#   # ##### ##### #####  ###     #   #  ###  #   # ##### #### 
```

## Tests

```bash
npm test
```

Tests run on Node's built-in `node:test` runner, so no test framework needs to
be installed.
````

- [ ] **Step 2: Verify the showcase matches real output (FR-8)**
Generate the ANSI-stripped banner and confirm it matches the README's showcase block character-for-character. The strip uses `String.fromCharCode(27)` and a backslash-free pattern, so it is portable across shells.
Run: `node -e "const e=String.fromCharCode(27); const s=require('./banner.js').renderBanner(); process.stdout.write(s.replace(new RegExp(e+'[^m]*m','g'),''))"`
Expected: five lines of `#` and space characters spelling HELLO WORLD, identical to the `text` block embedded in Step 1 (FR-8).

- [ ] **Step 3: Verify the README documents the runtime contract (NFR-1, NFR-2, NFR-3)**
Confirm the README states the Node 18+ requirement (NFR-2), the zero-dependency/no-install posture (NFR-1), and the modern-ANSI-terminal requirement (NFR-3), and that the documented `npm start` and `node index.js` commands both produce the banner (FR-8).
