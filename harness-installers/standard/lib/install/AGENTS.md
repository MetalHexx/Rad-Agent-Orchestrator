# `harness-installers/standard/lib/install/`

Everything in the standard channel that touches a user's disk. One harness at a time, driven by a
committed path catalog, with the guard rails that keep an install from destroying data it did not
create.

## How it works

`install-harness.js` is the orchestrator, and `index.js` is its **only** non-test caller — the wizard
picks a harness and returns; it never installs anything.

Where files actually land: manifest entries destinate to `${HARNESS_ROOT}/…` (`agents/`, `skills/`,
`hooks/`) or `${RAD_HOME}/…` (`action-events/`, `communication-styles/`, `docs/`). `hydrateUserData` writes
`~/.radorc/orchestration.yml`, `templates/`, `ui/`, and creates `projects/` and `logs/` — none of it
catalogued in any manifest. The registry is `~/.radorc/install.json`. For the Claude harness only,
`~/.claude/settings.json` gains marked hook entries. **No manifest has a `plugins/` entry** — the
standard channel does not write plugin roots.

`INSTALL_KEYS` is `claude`, `claude-plugin`, `copilot-cli`, `copilot-cli-plugin`, `copilot-vscode`,
and `copilot-vscode-plugin`. The standard installer writes only the non-plugin keys; the plugin
slugs are reserved so both channels share one `install.json` shape and so the coexistence detector
can see entries written by either.

## Conventions

- **Paths are injected — except the home directory, which mostly is not.** `bundleRoot`,
  `sharedRoot`, and `settingsPath` arrive as parameters, and `userDataPaths({ home })` accepts an
  injected home. The prescribed idiom has a **known deviation**: `ui-stop.js` passes a `home`, while
  `install-files.js`, `install-harness.js`, `hydrate-user-data.js`, `remove-files.js`,
  `uninstall-harness.js`, and `expand-tokens.js` all call `userDataPaths()` bare and resolve
  `os.homedir()`; their suites redirect `HOME`/`USERPROFILE` for the whole process instead. Pass a
  `home` in new code, and do not assume a test can isolate one of the deviating paths by argument
  alone — `remove-files.js` and `hydrate-user-data.js` are among them, and both delete: the first
  removes manifest entries, the second wipes the prior `ui/` before its atomic rename.
- **`install.json` is the source of truth for "is this installed?"** Never infer it from files on
  disk. `loadRegistry` degrades a missing, unreadable, or shape-drifted file to `{ harnesses: {} }`
  rather than throwing.
- **Error messages name the observed state, the attempted action, and the recovery path.**
  `install-harness.js`'s refusal to install over a newer version is the reference: what is
  installed, what was delivering, and what to run instead.
- **Non-critical post-install work is wrapped and swallowed.** Coexistence notices and stderr writes
  never abort an install that otherwise succeeded.

## Hazards

### Nothing here reads the repo

Every install-time read comes from `opts.bundleRoot` or `opts.sharedRoot` — paths inside the unpacked
tarball. `harness-adapters/output/` and `runtime-config/` do not exist on a user's machine. Any new
read must be of something the build staged into the payload and catalogued, or it will work in the
repo and fail in the field.

### Sacred paths abort rather than skipping — but only uninstall is preflighted

These guards **throw** instead of warning:

- Any manifest entry resolving to `repo-registry.yml` or `repo-registry.local.yml` — refused on both
  install and uninstall.
- Any manifest entry resolving under a catalog's `custom/` slot (`action-events`,
  `communication-styles`) — refused on uninstall.

Others are skipped silently with a logged line: `~/.radorc/projects/` on install and uninstall, and
`~/.radorc/telemetry/` on uninstall. Uninstall additionally refuses the whole operation if any
resolved destination falls outside both the harness root and `~/.radorc/`.

**Where the guard runs differs by direction, and the difference is load-bearing.** Uninstall walks
every manifest entry in a validation pass of its own before deleting anything, and
`uninstall-harness.js` runs a further containment preflight ahead of that — so a poisoned entry
stops the operation with nothing removed. Install validates *inside* the copy loop, so an entry
refused late in the manifest throws only after the earlier entries have already been written. The
refusal is a stop, not a rollback; do not describe the install path as atomic.

Containment must never be a bare prefix match — a sibling directory whose name merely shares a
prefix (`<root>-backup/`, `telemetry-archive/`) must not be treated as inside. Two idioms are in
use and both are safe: `remove-files.js`'s `isUnder` runs a `path.relative` test, while
`uninstall-harness.js`'s outside-both-roots refusal and `install-files.js`'s `projects/` skip
compare with `startsWith(root + path.sep)`, where the trailing separator is what defeats the
shared-prefix case. Do not drop that separator, and do not replace `isUnder` with a comparison
that lacks it.

### Uninstall prunes empty ancestors, and stops at the first thing it did not create

After removing manifest entries, every ancestor directory up to — but not including — the harness
root is removed if and only if its `readdir` comes back empty. A single user-authored file keeps that
directory and everything above it alive. The harness root itself is never removed, and this
empty-ancestor pruning walk never reaches into `~/.radorc/` at all — it only walks ancestors of a
removed file up to the harness root. That is narrower than "nothing under `~/.radorc/` is touched by
uninstall": the `${RAD_HOME}`-destined manifest entries (`action-events/`, `communication-styles/`,
`docs/`) are still individually deleted by `removeManifestFiles` — only the pruning of their
enclosing directories is out of scope for this walk.

### `${HARNESS_ROOT}` / `${RAD_HOME}` is a two-sided contract with the build

`emit-manifest.js` writes those tokens into `destinationPath`; `expand-tokens.js` here resolves them.
Neither side validates the other, and the uninstall containment guard throws on anything it cannot
place. Adding a destination root means editing both files in the same change.

### Content tokens are expanded only under `agents/` and `skills/`

`isContentExpandable` gates on a bundle-path prefix. `${PLUGIN_ROOT}` or `${SKILLS_ROOT}` written into
a hook shim, an action-event file, a communication style, a tier template, or a doc page ships
**literally** to the user's disk — no build error, no test.

### Installing one Copilot variant evicts the other from the registry

`copilot-cli` and `copilot-vscode` share `~/.copilot/` with incompatible agent content, so the mutex
map removes the partner's `install.json` entry. Plugin-channel entries are deliberately absent from
that map: they are preserved and surfaced as a coexistence warning, because plugin lifecycle belongs
to the harness, not to this installer.

## When a change here ripples

- **Changed the manifest shape, a destination token, or which paths are protected?** The manifest is
  generated by `emit-manifest.js`, and the two sides only agree by convention. A token this side
  cannot resolve makes uninstall throw; a path the build starts emitting into an unprotected root is
  removable user data. Detail: [`../../build-scripts/AGENTS.md`](../../build-scripts/AGENTS.md)

- **Adding a harness?** Several tables here key off the harness name and none of them fail loudly:
  `harness-paths.js`'s folder map, and `install-json.js`'s `INSTALL_KEYS`, `FOLDER_MUTEX_PARTNERS`,
  and `PLUGIN_COEXIST_PARTNERS`. `harnessRoot` throws on an unknown key; the others silently treat
  the new harness as having no partners. Detail: [`../../AGENTS.md`](../../AGENTS.md)

- **Changed where a hook shim installs, or which events are wired?** The `settings.json` entries
  written here embed absolute paths built from the manifest's drop location, and the shims themselves
  are single-sourced elsewhere. A shim renamed or re-homed on one side leaves a hook command pointing
  at nothing, and hooks fail silently by contract. Detail:
  [`../../../shared/hooks/AGENTS.md`](../../../shared/hooks/AGENTS.md)

- **Changed `install.json`'s shape or the coexistence tables?** The plugin installers write the same
  file, and `cli/`'s own install-json reader mirrors the on-disk plugin probes used here. A shape
  change on one side is invisible to the other until a user has both channels installed. Detail:
  [`../../../AGENTS.md`](../../../AGENTS.md), [`cli/AGENTS.md`](../../../../cli/AGENTS.md)

## Commands

```
node --test harness-installers/standard/tests/install/*.test.mjs
npm test -w harness-installers/standard
```

**Never exercise a change against your real home directory** — `~/.radorc/`, `~/.claude/`, and
`~/.copilot/` are not sandboxed and the removal paths are destructive. Every suite here injects a
temp home; do the same.

## Further reading

- [`../../AGENTS.md`](../../AGENTS.md) — the package, the marker-keyed hook registration, and the
  manifest discipline
- [`../../build-scripts/AGENTS.md`](../../build-scripts/AGENTS.md) — what produces the manifests this
  folder consumes
- [`../../../shared/hooks/AGENTS.md`](../../../shared/hooks/AGENTS.md) — the shims this folder wires
  up
