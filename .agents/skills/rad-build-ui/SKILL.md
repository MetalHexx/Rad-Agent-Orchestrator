---
name: rad-build-ui
description: 'Build the Next.js dashboard UI from source and redeploy it to the running install at ~/.radorc/ui for local testing. Packs a standalone bundle via harness-installers/shared/build-helpers/emit-ui-bundle.js, stops the detached UI server, atomically swaps ONLY ~/.radorc/ui (never the full installer hydrate, so config/registry/templates are untouched), and restarts. Use when asked to "build and deploy the UI", "rebuild the dashboard", "redeploy the UI to ~/.radorc/ui", or to see local ui/ source changes in the real detached server.'
---

# rad-build-ui

**Where this fits.** This is the fast inner-loop for testing changes to the dashboard `ui/` in the *real* detached server (`radorch ui start`, which runs `~/.radorc/ui/ui/server.js`) — not `next dev`. It reuses the installer's own bundler (`emit-ui-bundle.js`) so the deployed layout is identical to a real install, but it deploys **only** the `ui/` directory. It deliberately does **not** run the full installer hydrate (`harness-installers/standard/lib/install/hydrate-user-data.js`), which would also overwrite the four shipped tier templates and could touch other user data — so `~/.radorc/orchestration.yml`, `repo-registry.yml`, `projects/`, and `logs/` are never modified. The dashboard runs on a configurable port (default 1337, via `ui.port` in `orchestration.yml`).

## When to Use This Skill

- You changed something under `ui/` and want to see it in the detached dashboard (configurable port, default 1337 via `ui.port` in `orchestration.yml`).
- You need a production-parity build (standalone) deployed to `~/.radorc/ui`, not the `next dev` server.
- You are about to browser-test the dashboard against the real install.

Do **not** use this for a full release/publish — that is `rad-release` / the standard installer.

## Prerequisites

- Node.js + npm installed; you are anywhere inside the repo clone (the skill resolves repo root itself).
- The repo uses npm workspaces and `next` is hoisted into the root `node_modules/.bin`. On a fresh clone run `npm install` once at the repo root, or the `next build` step cannot find its binary.
- `lib/repo-registry` must be built (`lib/repo-registry/dist/` present) — the UI externalizes `@rad-orchestration/repo-registry` and output-traces its `dist/`. Build it with `npm --prefix lib/repo-registry run build` if `dist/` is missing or stale.

## Workflow

### Step 1 — Resolve repo root and preflight

```
git rev-parse --show-toplevel
```

Use the result as `{repoRoot}`. Confirm `next` is hoisted (run `npm install --prefix "{repoRoot}"` if missing):

```powershell
if (-not (Test-Path (Join-Path "{repoRoot}" 'node_modules\.bin\next.cmd')) -and
    -not (Test-Path (Join-Path "{repoRoot}" 'node_modules\.bin\next'))) {
  npm install --prefix "{repoRoot}"
}
```

Confirm `lib/repo-registry/dist` exists; if not: `npm --prefix "{repoRoot}/lib/repo-registry" run build`.

### Step 2 — Build & pack the UI bundle

Build **before** stopping the server (the build runs in the repo, not in `~/.radorc/ui`, so it does not affect the running server — this minimizes downtime, and if the build fails the UI keeps running). `emit-ui-bundle.js` runs `npm run build-standalone` in `ui/`, then packs `.next/standalone` + `.next/static` + `public/` into one gzipped tarball.

Run from `{repoRoot}` (the `emitUiBundle` function takes `source` = the `ui/` dir, `target` = the `.tgz` path):

```powershell
node --input-type=module -e @'
import { emitUiBundle } from 'file:///{repoRoot-fwd}/harness-installers/shared/build-helpers/emit-ui-bundle.js';
await emitUiBundle({
  source: '{repoRoot-fwd}/ui',
  target: '{repoRoot-fwd}/harness-installers/standard/output/ui.tgz',
});
console.log('BUNDLE_DONE');
'@
```

`{repoRoot-fwd}` is `{repoRoot}` with forward slashes (Node accepts them on Windows). This step is the long pole (~30–90s for `next build`); run it in the background and wait for `BUNDLE_DONE`.

> A non-fatal `Module not found: Can't resolve 'fsevents'` warning during `next build` is cosmetic (macOS-only watcher); ignore unless the exit code is non-zero.

Expected: `harness-installers/standard/output/ui.tgz` exists and `BUNDLE_DONE` printed.

### Step 3 — Stop the running UI

Stop via the **`rad-ui-stop`** skill (or directly `radorch ui stop`). The stop must precede the swap: on Windows the running `node server.js` locks files in `~/.radorc/ui`, so the directory cannot be replaced while it runs. Confirm stopped with `radorch ui status` (`running:false`).

### Step 4 — Swap `~/.radorc/ui` (scoped — do NOT run the full hydrate)

Extract the tarball into a temp dir, then atomically replace **only** the `ui` directory:

```powershell
$dest = Join-Path $env:USERPROFILE '.radorc\ui'
$tmp  = Join-Path $env:USERPROFILE ('.radorc\ui.tmp-' + $PID)
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $tmp | Out-Null
tar -xzf "{repoRoot}\harness-installers\standard\output\ui.tgz" -C $tmp
Remove-Item -Recurse -Force $dest -ErrorAction SilentlyContinue
Rename-Item $tmp $dest
```

The deployed layout has the server at `~/.radorc/ui/ui/server.js`. Nothing else under `~/.radorc` is touched.

### Step 5 — Start the UI

Start via the **`rad-ui-start`** skill (or directly `radorch ui start`). It probes ports 1337–1347 (the configurable default range, anchored to the `ui.port` setting), writes `~/.radorc/runtime/ui.pid`, and returns `data.url`.

### Step 6 — Verify

- `radorch ui status` → `running:true` with a `url`.
- Open the returned URL (from the `status` command or the `data.url` from the `start` command; default `http://localhost:1337` if `ui.port` is not overridden) and confirm the change is live. Note: the dashboard sets a build/version label; a hard refresh (Ctrl+Shift+R) avoids a stale cached bundle.

## Safety notes

- **Scoped deploy only.** This swaps `~/.radorc/ui` and nothing else. Never run `hydrate-user-data.js` here — it also rewrites the shipped tier templates and is meant for full installs.
- **Stop before swap.** Skipping the stop causes a file-lock/`EBUSY` failure on Windows mid-swap, which can leave `~/.radorc/ui` half-removed. If that happens, re-extract the tarball into `~/.radorc/ui` and start again.
- **Build artifact location.** `harness-installers/standard/output/` is gitignored; the `ui.tgz` there is disposable.
