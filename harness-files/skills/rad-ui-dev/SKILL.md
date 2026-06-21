---
name: rad-ui-dev
description: Start the radorch dashboard UI dev server (next dev, live reload) from the source repo, auto-building the @rad-orchestration/* lib dist first.
user-invocable: true
---

# rad-ui-dev

Launch the dashboard **dev build** with Fast Refresh. Unlike `rad-ui-start` (which runs the
production standalone server from `~/.radorc/ui` via the installed CLI), this is a
**source-repo / dogfood** operation: it runs `next dev` against the working tree, so the repo
and its `node_modules` must be present (it is not meant for an installed end-user plugin).

Run the launcher in the background from the rad-orc-source `ui/` workspace:

```
npm run dev:live          # auto-wires RADORCH_CLI_PATH + auto-builds the @rad-orchestration/* lib dist, then next dev
```

For live library editing (rebuild a lib and restart `next dev` whenever its `lib/*/src`
changes), use the watch variant instead:

```
npm run dev:live:watch    # dev:live + --watch-libs
```

`dev:live` builds the UI's `@rad-orchestration/*` workspace deps (`dist/`) **before** starting
`next dev`, so the data path is never stale on launch — this is the whole point of the skill;
no manual `cd lib/<pkg> && npm run build` step is needed. (Add `--skip-libs` to skip that
startup build for a fast pure-UI session.) If the local CLI bundle (`cli/dist/bin/radorch.js`)
is missing it prints a warning and continues — read-only surfaces still work, but gate actions
and the compose Preview 500 until you build the CLI (`cd cli && npm run build`).

After launching, wait for `Ready` / `Local:` in the output, then report the URL —
**http://localhost:3000** — to the user. Surface any lib build failure verbatim (the launcher
exits non-zero rather than starting `next dev` on a broken `dist`).

To stop it, terminate the dev process tree holding port 3000 (it is a plain `next dev`
process — `rad-ui-stop` does **not** apply; that targets the production `radorch ui` server
tracked by a PID file).
