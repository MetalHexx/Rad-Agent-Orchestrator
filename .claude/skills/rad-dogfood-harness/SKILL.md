---
name: rad-dogfood-harness
description: Rebuild the standard installer and reinstall one harness (claude, copilot-vscode, or copilot-cli) locally — build the rad-orc tarball, stop the UI, uninstall then reinstall the harness, restart the UI. Use to dogfood canonical harness-files/ agent and skill edits into ~/.claude or ~/.copilot.
user-invocable: true
---

# rad-dogfood-harness

Rebuild the standard installer and reinstall one harness so your canonical `harness-files/` agent and skill edits land in `~/.claude` (or `~/.copilot`).

## Workflow

### Step 1 — Pick the harness

`AskUserQuestion`: `claude` / `copilot-vscode` / `copilot-cli`. Save the choice as `{harness}`.

### Step 2 — Build and pack

```
node harness-installers/standard/build-scripts/build.js
cd harness-installers/standard && npm pack
```

Read `{version}` from `harness-installers/standard/package.json`; the tarball is `harness-installers/standard/rad-orc-{version}.tgz` — capture its path as `{tarballPath}`. Stop and report if either command exits non-zero.

### Step 3 — Stop the UI

Invoke `/rad-ui-stop`.

### Step 4 — Uninstall the harness

```
npx file:{tarballPath} uninstall --yes --harness {harness}
```

### Step 5 — Reinstall the harness

```
npx file:{tarballPath} --yes --harness {harness}
```

Expected: exit 0 and a post-install summary listing `{harness}`.

### Step 6 — Start the UI

Invoke `/rad-ui-start` and report the `data.url`.

## Notes

- The `file:` prefix is required on npm 11+; `uninstall` must come before the flags.
- One harness per run.
- Redeploying `claude` from inside a Claude session briefly removes `~/.claude/skills/rad-*` during uninstall — keep the step order (`/rad-ui-stop` before uninstall, `/rad-ui-start` after reinstall).
- On a fresh clone, run `npm install` once at the repo root first so the build can resolve `esbuild` and `next`.
