# claude-plugin/

## Purpose

A self-contained npm package (`@rad-orchestration/claude-plugin-source`) whose `npm run build` produces the publishable Claude marketplace plugin. The source package is never published; `npm pack` runs against `output/` after build.

## How it works

`build-scripts/build.js` exports `runBuild(opts)` and is the single entry point. It executes 13 steps in fixed order, fail-fast:

1. **adapter-engine** — runs `harness-adapters/engine/build.js --harness=claude` (skippable in tests via `opts.skipAdapterEngine`)
2. **clean-output** — wipes `output/`
3. **copy-agents** / **copy-skills** — copies adapter output from `harness-adapters/output/claude/`
4. **copy-runtime-config** — stages `runtime-config/orchestration.yml` and `runtime-config/templates/` under `_install-source/` (not the plugin root) so the bootstrap hook can hydrate them to `~/.radorc/` and then delete the staging dir, leaving no shadow copy
5. **emit-cli-bundle** — bundles `cli/src/` into `radorch.mjs` via `emitCliBundle` and ships it to `output/skills/rad-orchestration/scripts/radorch.mjs`
6. **prune-scripts-sources** — removes `.ts` sources, tests, and tooling from `output/skills/rad-orchestration/scripts/`; retains only `.js`, `.mjs`, and `.gitignore`
7. **emit-ui-bundle** — builds Next.js standalone via `emitUiBundle`
8. **emit-hook-bundle** — bundles `hooks/bootstrap.mjs` and copies verbatim files via `emitHookBundle`
9. **expand-tokens** — substitutes `${SKILLS_ROOT}` and `${PLUGIN_ROOT}` tokens and applies agent namespacing (`rad-orc:<name>`) via `expandTokens`; runs through a staging dir to avoid mid-walk read-after-write
10. **copy-plugin-manifest** — copies `.claude-plugin/plugin.json` verbatim
11. **synthesize-package-json** — merges wrapper `package.json` with `plugin.json`; `plugin.json.version` always wins; writes to `output/package.json`
12. **copy-manifest-catalog** — copies `manifests/v*.json` to `output/manifests/`
13. **validate** — calls `validatePluginTree` to confirm required artifacts, agent presence, namespaced dispatch tokens, version manifest, and size budget

`opts.rootDir` is the repo root. `opts.greenfieldRel` (default `'.'`) names the relative path to the greenfield folder; tests pass `'.'` to use a synthetic fixture tree.

## Source layout

- `build-scripts/` — `build.js`, `validate.js`, `synthesize-package-json.js`, `parity-check.js`
- `.claude-plugin/plugin.json` — plugin metadata; its `version` field is the authoritative version for the published package
- `hooks/` — hook source; see `hooks/AGENTS.md`
- `lib/install/` — install state machine; see `lib/install/AGENTS.md`
- `manifests/` — per-version file manifests (`v*.json`)
- `output/` — gitignored build output; canonical npm-pack source
- `dogfood-marketplace/` — gitignored ephemeral marketplace tree created and managed by the `rad-test-claude-plugin` skill for local `/plugin install` testing; see "Dogfood install" below

## Dogfood install

`output/` is the npm-pack source — what real installs eventually pull from the marketplace. But Claude Code's `/plugin install` cannot consume `output/` directly. Per [Anthropic's marketplace spec](https://code.claude.com/docs/en/plugin-marketplaces), a plugin's `source` in `marketplace.json` must be one of: a relative-path string starting with `./` (resolving to a subpath of the marketplace root), or an object form (`github`, `url`, `git-subdir`, `npm`). Parent-directory traversal (`../`) and absolute paths are explicitly rejected.

So the dogfood marketplace stages the plugin as a `./<subpath>` of its own root:

```
dogfood-marketplace/
├── .claude-plugin/
│   └── marketplace.json         # source: "./plugins/rad-orc"
└── plugins/
    └── rad-orc/                 # copy of output/
```

The `.agents/skills/rad-test-claude-plugin/SKILL.md` skill is the operational entry point. It builds, copies `output/` into `plugins/rad-orc/`, writes `marketplace.json`, and hands off `/plugin marketplace add` + `/plugin install` commands. The layout intentionally matches the legacy `rad-test-plugin-release` prompt's layout so both dogfood channels feel the same.

The copy is per-skill-invocation. Iterating means re-running the skill after each build — `output/` is the truth, the marketplace tree is a derived snapshot.

## Coding conventions

- `build.js` calls each step through the local `step(name, fn)` wrapper which times and labels every phase; all step failures throw with a prefixed message.
- Paths are always resolved via `path.resolve` / `path.join` from `rootDir`; no hardcoded absolute paths.
- `output/` is wiped clean at the start of every build; the output tree is never partially updated.

## Telemetry hook wiring (FR-14)

Telemetry hooks are declared statically in `hooks/hooks.json` and deployed verbatim into `output/hooks/hooks.json` by the `emit-hook-bundle` build step. The plugin runtime registers them when Claude Code loads the plugin.

### Three-event set in hooks.json

| Hook event | `matcher` | Shim invoked |
|---|---|---|
| `PostToolUse` | `Agent` | `telemetry-capture.mjs` |
| `Stop` | _(none)_ | `telemetry-capture.mjs` |
| `SessionEnd` | _(none)_ | `telemetry-capture.mjs` |

Each entry's command is the standard plugin dynamic-import launcher (`node -e "const r=process.env.CLAUDE_PLUGIN_ROOT||''; ...import(...telemetry-capture.mjs)"`) — the same pattern used by all other plugin hooks to resolve the shim relative to `CLAUDE_PLUGIN_ROOT`. The `PostToolUse` entry carries `"matcher": "Agent"` so it fires only on `Agent`-type tool calls.

### source ↔ output parity

`hooks/hooks.json` (source) and `output/hooks/hooks.json` (build artifact) must be identical. The `emit-hook-bundle` step copies `hooks.json` verbatim to `output/hooks/`. If you edit `hooks/hooks.json` you must rebuild (`node build-scripts/build.js`) to update `output/hooks/hooks.json`. The parity test (`tests/parity-validation.test.mjs`) can be used to verify file-set equality against a legacy payload, but day-to-day the simplest check is `diff hooks/hooks.json output/hooks/hooks.json`.

### telemetry-capture.mjs shim

`telemetry-capture.mjs` is single-source from `harness-installers/shared/hooks/telemetry-capture.mjs` (AD-8). The `emit-hook-bundle` build step copies it (along with `session-preamble.mjs`) from `sharedHooksDir` into `output/hooks/`. Do not create a plugin-local copy; always update the shim in `harness-installers/shared/hooks/`.

### `telemetry/` sacred-folder skip

The plugin installer does not write to `~/.radorc/telemetry/`. The sacred-folder skip is enforced by the standard installer's `remove-files.js` (see `harness-installers/standard/AGENTS.md`) and applies equally to any plugin-delivered manifest entry targeting that path. Plugin hooks never write directly to `~/.radorc/telemetry/`; writing is performed by the CLI's `telemetry capture` subcommand invoked inside the shim.

## Rules for making updates

- Step order is load-bearing: adapter output must exist before `copy-agents`/`copy-skills`; bundles must exist before `expand-tokens`; `validate` must run last.
- `validatePluginTree`'s `REQUIRED_ARTIFACTS` list in `validate.js` must stay in sync with what the build actually produces.
- Adding a new step: place it in the correct position in `runBuild`, update the step-count comment, and update `validate.js` if a new required artifact is introduced.
- `synthesizePackageJson` hard-codes `name: '@rad-orchestration/claude-plugin'`; changing the published package name requires updating it there.
- Tests in `tests/` cover the build orchestration end-to-end; run them after any build-script change.
- Adding or changing a telemetry hook event: edit `hooks/hooks.json`, rebuild, and verify `output/hooks/hooks.json` is updated. If the `PostToolUse` matcher or the three-event set changes, update this AGENTS.md and `harness-installers/standard/AGENTS.md` to keep documentation in sync.
