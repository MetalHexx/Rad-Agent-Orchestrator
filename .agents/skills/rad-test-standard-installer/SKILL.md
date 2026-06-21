---
name: rad-test-standard-installer
description: 'Build, pack, and end-to-end install-test the greenfield standard installer (`rad-orc` npm package) against a single harness. Builds via `node harness-installers/standard/build-scripts/build.js`, packs `output/`, runs `npx ./<tarball> --yes --harness <h>`, verifies post-install state via `radorch doctor` and the per-harness manifest sha. Use when asked to "smoke-test the greenfield standard installer", "test the new npm installer install", or "validate the standard installer end-to-end".'
---

# rad-test-standard-installer

**Where this fits.** `rad-test-standard-installer` is the greenfield counterpart to `.agents/prompts/rad-test-release.prompt.md` (legacy installer) and mirrors the single-harness smoke-test discipline of `.agents/skills/rad-test-claude-plugin/SKILL.md` (plugin channel). Both the greenfield and legacy channels support `npx rad-orc` install for the standard harness targets (Claude Code, GitHub Copilot VS Code, GitHub Copilot CLI), but they use different build chains:

- `.agents/prompts/rad-test-release.prompt.md` → **legacy** build (`npm run build:installer` at repo root, output at `cli/dist/installers/`)
- **this skill** → **greenfield** build (`node harness-installers/standard/build-scripts/build.js`, output at `harness-installers/standard/output/`)

Pick the one matching the channel you want to validate. Single-harness per run keeps the diagnostic focused; you can re-run the skill for the other harnesses afterward. You do **not** install or verify the installer yourself — you build, pack, hand off the exact command for the user to run, and then verify the installed artifacts.

## When to Use This Skill

- Smoke-testing the greenfield standard installer end-to-end before publishing.
- Verifying that a greenfield build change reaches a real harness install via `npx rad-orc`.
- Reproducing a user-reported install issue against the current greenfield build.

## Prerequisites

- Node.js and npm installed.
- Working directory is anywhere inside the repo clone (the skill resolves repo root itself).
- **A single root install is required on a fresh clone** (see Step 2 below). The repo uses npm workspaces; `build.js` and the shared `build-helpers` modules all resolve `esbuild`, `next`, and other executables from the hoisted root `node_modules/.bin`. On a fresh clone that directory does not exist, so the fix is to run `npm install` once at the repo root — this installs all workspace packages and hoists every binary into the root `node_modules/.bin`.

## Workflow

### Step 1 — Pick a harness

Which harness do you want to smoke-test the standard installer against? Single-harness per run keeps the diagnostic focused; you can re-run the skill for the other harnesses afterward.

Use the `AskUserQuestion` tool:

```
question: "Which harness do you want to smoke-test the standard installer against? Single-harness per run keeps the diagnostic focused; you can re-run the skill for the other harnesses afterward."
options:
  - label: "Claude Code"
    value: "claude"
    description: "Install lands at ~/.claude/. Default if your install ran on a system where ~/.claude is present."
  - label: "GitHub Copilot (VS Code)"
    value: "copilot-vscode"
    description: "Install lands at ~/.copilot/. Folder mutex with copilot-cli — installing one removes the other from install.json."
  - label: "GitHub Copilot CLI"
    value: "copilot-cli"
    description: "Install lands at ~/.copilot/. Folder mutex with copilot-vscode."
```

Save the choice as `{harness}`.

### Step 2 — Resolve repo root and preflight dependency health

Resolve the repo root:

```
git rev-parse --show-toplevel
```

Use the result as `{repoRoot}` for every subsequent path.

Before running the build, run a dependency-health preflight. Why this is required: the repo uses npm workspaces and all executables (`esbuild`, `next`, `tsx`) are hoisted into the root `node_modules/.bin`. A missing or incomplete root install means the build cannot find those binaries and will fail.

Run this PowerShell block:

```powershell
$ErrorActionPreference = 'Stop'

# Guard: verify the root install is present and required binaries are hoisted.
if (-not (Test-Path (Join-Path "{repoRoot}" 'node_modules\.bin\next.cmd')) -and
    -not (Test-Path (Join-Path "{repoRoot}" 'node_modules\.bin\next'))) {
  npm install --prefix "{repoRoot}"
}
if (-not (Test-Path (Join-Path "{repoRoot}" 'node_modules\.bin\esbuild.cmd')) -and
    -not (Test-Path (Join-Path "{repoRoot}" 'node_modules\.bin\esbuild'))) {
  npm install --prefix "{repoRoot}"
}
```

Expected: the root `node_modules/.bin` contains `next` and `esbuild`. If `npm install` fails, stop and report — the build cannot proceed.

If Step 3 later fails with a Next.js SWC-native error such as `Failed to load SWC binary for win32/x64` or `next-swc... is not a valid Win32 application`, remove and reinstall the root `node_modules` before retrying:

```powershell
Remove-Item -Recurse -Force (Join-Path "{repoRoot}" 'node_modules') -ErrorAction SilentlyContinue
npm install --prefix "{repoRoot}"
```

Then re-run Step 3 once.

### Step 3 — Build the greenfield standard installer

From the repo root:

```
node harness-installers/standard/build-scripts/build.js
```

> Expected: exit 0; `harness-installers/standard/output/` populated; `output/<harness>/manifests/v<version>.json` exists. (The publish `package.json` lives at the source root `standard/package.json` — the build does not write a top-level `output/package.json`.)
>
> On first run (or any run after `node_modules` was deleted at the root), expect the root `npm install` from Step 2 to run. The `ui/` install is typically the longest (~1 min on a cold network).
>
> On Windows and Linux, `next build` (invoked during `emit-ui-bundle`) emits a non-fatal `Module not found: Can't resolve 'fsevents'` warning. `fsevents` is a macOS-only file-watcher used by `chokidar` (a transitive `next` dependency); the warning is cosmetic and the build completes normally. Ignore unless the build's overall exit code is non-zero.

If the build fails, stop and report the failure. Do not continue.

### Step 4 — Pack the tarball

Navigate to the installer source directory and pack. The pack site is `standard/` (not `output/`) because the source-side `standard/package.json` is the publish package — its `files` allowlist names `index.js`, `lib/`, and `output/` so the per-harness payloads and the shared `output/ui/` (including its vendored `node_modules/`) all end up in the tarball:

```
cd {repoRoot}\harness-installers\standard
npm pack
```

Capture the resulting tarball filename (matching pattern `rad-orc-<version>.tgz`) as `{tarballPath}`. Read `standard/package.json` to confirm the version and note it as `{version}` — you will print it in the handoff message so the user can confirm it after install.

Expected: `npm pack` exits 0; the tarball file exists at `{tarballPath}`.

### Step 5 — Install against the picked harness

Before installing, provide the user with the exact command they must run in their shell:

```
npx file:{tarballPath} --yes --harness {harness}
```

The `file:` prefix is required on npm 11+ — without it, `npm exec` treats the raw tarball path as a command name instead of a package spec and silently exits 0. Post-publish users invoke this as `npx rad-orc` (no path, no `file:` prefix); the prefix is only for local smoke-testing.

Instruct the user to run this command and report back when the install completes. Do **not** run the install yourself.

Expected: exit 0; banner renders; per-harness spinner resolves to a green check; post-install summary lists the harness; the four `/rad-` command pointers appear.

### Step 6 — Verify the install

Once the user reports the install is complete, verify the installed artifacts by reading three sources:

1. **install.json version match**: Read `~/.radorc/install.json` and confirm that `harnesses.<harness>.version === {version}`.

2. **Sentinel file check**: Confirm that `~/.<harness-dir>/skills/rad-orchestration/scripts/radorch.mjs` exists (sentinel for installed pipeline).

3. **Per-harness manifest sha validation**: Load the manifest at `{repoRoot}/harness-installers/standard/output/{harness}/manifests/v{version}.json`. For every file entry in the manifest, read `~/.<harness-dir>/<skill-or-agent-path>` on disk and compute its sha256 hash. Compare each computed hash to the manifest's recorded sha for that file. All hashes must match.

### Step 7 — Run radorch doctor

Run `radorch doctor` from inside the installed harness's slash-command surface:

```
/radorch doctor
```

Confirm the following rows in the output are green:
- `install-json-shape`
- `version-match`
- `multi-harness-install-table`

The now-retired `bootstrap-skeleton` row should **not** appear (its absence is the validation signal that the new pipeline initialization succeeded).

If any of these checks fail, stop and report — the install is incomplete.

### Step 8 — Cleanup

Use the `AskUserQuestion` tool to ask before removing the tarball:

```
question: "Delete the tarball at {tarballPath}? Keeping it around lets you re-run the install in another shell; removing it keeps the repo clean."
options:
  - label: "Yes, delete the tarball"
    value: "delete"
    description: "Removes {tarballPath}. Safe — the build artifacts in output/ stay intact."
  - label: "No, keep the tarball"
    value: "keep"
    description: "Leaves {tarballPath} on disk for additional install attempts."
```

If the user picks **delete**:

```powershell
Remove-Item -Force {tarballPath}
```

Run it. Confirm the file is gone.

If the user picks **keep**, no action is needed.

### Step 9 — Summary

Finish with a one-line summary that names `{harness}`, `{version}`, and the manifest-sha match result:

> Smoke-test complete: `{harness}` v`{version}` installed and verified (manifest sha: all files match).
