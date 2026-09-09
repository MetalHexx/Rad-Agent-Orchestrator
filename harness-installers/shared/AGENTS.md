# `harness-installers/shared/`

The one place a variant may reach for something it did not author. Its children have **opposite lifetimes** — get this wrong and you will put runtime code where build code belongs:

- [`build-helpers/`](./build-helpers/AGENTS.md) — **build time.** Imported by every variant's
  `build-scripts/build.js` via relative path. Never shipped to a user's machine.
- [`hooks/`](./hooks/AGENTS.md) — **runtime.** Both shims execute on the end user's machine, spawned
  by the harness's own hook runtime. Every build stages them into its output.

## How it works

Nothing here is a published entry point. `build-helpers/` has a `package.json`
(`@rad-orchestration/build-helpers`, private) so it can carry `esbuild` and `tar` as workspace
dependencies; callers still import the files by relative path, not by package name. `hooks/` has no
`package.json` at all — the shims are copied, never resolved.

The dependency direction is **variant → shared, never shared → variant.** No file here may import,
require, or read anything inside an installer package.

## Conventions

- **New shared utilities belong here only if genuinely variant-agnostic.** Anything that names a
  variant, a harness, or a destination path belongs in the installer package that owns it.
- **Conventions here are per-child, not folder-wide.** They differ in shape as well as lifetime:
  `build-helpers/` exports one `opts` object per function and keeps its I/O inside the paths it is
  handed, while the `hooks/` shims export positional and zero-argument functions as test seams.
  Read the child file before applying a rule you found in the sibling.

### Installer-blindness is the prescribed idiom, not a property you can assume

The rule is that no file here references a variant package name, a hardcoded destination path, a
token key, or an agent-name list. It holds for `expandTokens`, `emitCliBundle`, and `emitUiBundle`.
It does **not** hold for the helpers that were placed here for discipline-consistency rather
than because they were blind:

- `emit-hook-bundle.js` hardcodes the plugin `hooks/` filenames it copies verbatim and the shim
  filenames it stages; its own header calls it "plugin-specific by nature".
- `manifest-parity.js` hardcodes the `_install-source` directory name and `ui.tgz`, both of which are
  plugin-layout facts the standard installer does not share.

Write new helpers to the rule. Do not infer from them that the rule is optional, and do not
"fix" them without moving their callers first.

## When a change here ripples

- **Changed a `build-helpers/` parameter shape or return value?** These are imported by relative
  path and nothing resolves the import until that build or suite runs, so a missed caller fails in
  the CI job for the variant you did not touch. The caller set differs per helper — `emitHookBundle`
  has no standard-builder caller, and `checkInstallSourceParity` is imported by no builder at all,
  only the plugin variants' `tests/manifest-payload-parity.test.mjs` — so grep for the export you
  changed. Detail: [`build-helpers/AGENTS.md`](./build-helpers/AGENTS.md)

- **Changed anything under `hooks/`?** That is shipped code, not tooling. It reaches users only
  through a build and a reinstall, it runs against a CLI bundle it resolves by path, and it fails
  **silently** by contract — there is no build error and no non-zero exit to notice. Detail:
  [`hooks/AGENTS.md`](./hooks/AGENTS.md)

- **Adding a file here that a variant will import?** Add it to the child `AGENTS.md` that owns it and
  confirm which lifetime it has. A build-time helper that ends up staged into output, or
  a runtime shim that ends up imported by a build script, breaks the only distinction this folder
  exists to hold. Detail: [`../AGENTS.md`](../AGENTS.md)

## Commands

Nothing here builds. The guard suites run from the repo root and are **not** picked up by any
workspace `npm test`:

```
node --test harness-installers/shared/build-helpers/tests/*.test.mjs
node --test harness-installers/shared/build-helpers/__tests__/*.test.mjs
node --test harness-installers/shared/hooks/tests/*.test.mjs
```

To confirm a change actually reaches an installer's output, run the variant builds — see
[`../AGENTS.md`](../AGENTS.md).

## Further reading

- [`build-helpers/AGENTS.md`](./build-helpers/AGENTS.md) — per-helper contracts
- [`hooks/AGENTS.md`](./hooks/AGENTS.md) — the shims, their resolution strategy, and the never-throw
  contract
- [`../AGENTS.md`](../AGENTS.md) — the variants that consume this folder, and the manifest discipline
