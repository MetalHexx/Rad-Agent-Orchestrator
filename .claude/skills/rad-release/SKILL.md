---
name: rad-release
description: Drive the release flow locally — context, version reconcile, build, validate, CHANGELOG, commit, sync plugins to the marketplace, and tag/push (which triggers the CI npm publish + GitHub Release), then a post-release dev bump.
---

The local skill owns everything up to and including the `v{version}` tag push. The
main-repo tag push is the trigger for CI: `.github/workflows/publish.yml` builds and
publishes the standard installer (`rad-orc`) to npm and cuts the GitHub Release. The npm
credential lives in CI (the `NPM_TOKEN` repo secret), not on the operator's machine.

## Step 1 — Gather context

Run `node .claude/skills/rad-release/scripts/gather-context.mjs` from the repo root. This module reads the current version from `cli/package.json`, resolves the active branch via `git branch --show-current`, determines whether the working tree is dirty via `git status --porcelain`, and attempts to locate the most recent `v*` release tag via `git describe --tags --abbrev=0 --match "v*"` (returns `null` when no matching tag exists yet — expected on first release). Print the four-field result for operator awareness before proceeding.

## Step 2 — Up-front questions

Using the harness question tool (`AskUserQuestion` on Claude Code), present the operator with two decisions before any mutation occurs:

1. **Target version** — show the `currentVersion` gathered in step 1 and the `lastReleaseTag` (or "none yet" when `null`). Suggest the next version. **Release-in-place is the common case:** the previous release's post-release dev bump (step 10) already advanced the in-tree version, so if there is no `v{currentVersion}` tag yet, offer **releasing `currentVersion` as-is** as the default — this selects the no-re-bump path in step 3. Otherwise (the tree is at an already-released version), suggest the next pre-release counter (`-alpha.N` / `-beta.N`) or, if stable, a patch bump. Ask the operator to confirm or supply a different target.

2. **Merge to main** — if `currentBranch` is not `main`, ask whether the operator wants to squash-merge to `main` after the release commit lands (step 7). This is an up-front question collected before any mutation, not a mid-flow approval gate. Two mid-flow approval gates follow: CHANGELOG approval in step 5 and post-release dev-bump confirmation in step 10.

Both answers are carried forward into subsequent gates.

## Step 3 — Lockstep version reconcile

If the confirmed target **equals** `currentVersion` (the release-in-place path from step 2), **skip the bump entirely** — every carrier already holds the target version, and the engine deliberately refuses a `from === to` no-op. Proceed straight to step 4.

Otherwise invoke `node .claude/skills/rad-release/scripts/bump-version.mjs --from <currentVersion> --to <new>` where `<currentVersion>` is the value gathered in step 1 and `<new>` is the target confirmed in step 2. Both flags are required — the engine fails fast if either is missing so the operator cannot accidentally bump from an assumed prior. This performs the lockstep bump across all carrier locations: wrapper `package.json` files (version field **and** any intra-repo `@rad-orchestration/*` dependency pin, kept in lockstep so `npm install` still resolves), plugin authoritative version sources, a hardcoded-literal sweep, and the two version fields in each nested per-workspace lockfile (`cli`, `ui`, `harness-adapters/engine`). Per-version manifest catalog files (under `MANIFEST_DIRS`) are deliberately **not** touched by this step — the installer's upgrade path requires every prior version's manifest to stay bundled (AD-4) so upgraders can resolve whatever version they're currently on, so those files accumulate rather than get renamed; the new version's manifest is emitted fresh by the build step (step 4) alongside every manifest already checked into the repo. A final re-grep halts loudly on any stray copy of the prior version left after the sweep — the guard excludes the graph-subsystem sandbox fixture (`prompt-tests/_handoff-sandbox/**`), incidental test/doc fixtures, and any historical manifest catalog file (which permanently and correctly retains its own version literal), none of which are release carriers.

## Step 4 — Build + validate

Invoke `node .claude/skills/rad-release/scripts/build-and-validate.mjs` from the repo root. This first runs `node harness-installers/standard/build-scripts/build.js`, the standard installer build, which builds the lib dependencies (repo-registry / work-graph / telemetry), translates the canonical `harness-files/` agents+skills for all three harnesses, packs the UI as `ui.tgz`, and emits `harness-installers/standard/output/` + manifests — the same artifact CI publishes to npm after the tag push in step 9. It then runs `node build-scripts/build.js` from each of the three plugin directories under `harness-installers/` (`harness-installers/claude-plugin`, `harness-installers/copilot-cli-plugin`, `harness-installers/copilot-vscode-plugin`), where each plugin's build script internally invokes the Gate 3 validator. A non-zero exit from any sub-step halts the flow immediately and prints the captured stderr to the operator.

After build-and-validate succeeds, invoke `node .claude/skills/rad-release/scripts/check-size-budget.mjs` to enforce the per-plugin tarball size budget (57,671,680 bytes = 50 MB + 10% headroom). Any plugin exceeding the budget halts the flow with a message naming the failing plugin and its measured size.

## Step 5 — CHANGELOG draft + approval gate

Run `node .claude/skills/rad-release/scripts/changelog-and-commit.mjs --draft --to <new>` to invoke `draftChangelog`. Pass the commit log since the last release tag (or the full history on first release) as the `commits` array. The draft produces a `## v{version} — {date}` heading with three subsections — `### What's New` (feat: commits), `### What's Fixed` (fix: commits), and `### Changes` (everything else).

Present the full drafted body to the operator using the harness question tool (`AskUserQuestion` on Claude Code). Frame the question with the full drafted CHANGELOG text inline so the operator can read it without switching context. Offer a single labelled option **Approve and commit**. If the operator wants to edit, they paste a revised body into the "Other / custom" field and resubmit — the revised text is used as `approvedChangelog` in step 6. This is the first of two mid-flow approval gates (the second is dev-bump confirmation in step 10).

The approved `## v{version}` block is also the **source of the GitHub Release notes**: CI slices exactly this block out of `CHANGELOG.md` after the tag push (step 9), so anything the operator wants users to read belongs here. First-release callouts are **not** auto-generated — the operator authors them by hand inside this gate when relevant (e.g. the `rad-orchestration → rad-orc` package rename, the `~/.radorc` storage standardization, plugins first appearing on the satellite).

## Step 6 — Single commit

Once the operator approves the CHANGELOG body, invoke `commitRelease` from `changelog-and-commit.mjs` with:

```js
await commitRelease({ repoRoot, version, approvedChangelog });
```

`commitRelease` prepends the approved entry above the previous most-recent `## v` block in `CHANGELOG.md`, then runs `git add -A` followed by exactly one `git commit -m "chore: bump version to v{version}"`. This single commit bundles every bumped carrier, every renamed manifest catalog (already `git mv`'d by step 3), the regenerated per-harness manifest files, the rewritten nested lockfiles, and the approved CHANGELOG body (atomicity). No second `git commit` invocation is permitted anywhere in the release flow between step 3 and step 7. (On the release-in-place path there is no bump, so this commit lands just the CHANGELOG entry.)

## Step 7 — Squash-merge to main

Only executed when the operator answered **yes** to the merge-to-main question in step 2. Run the three commands below verbatim from the repo root (no separate module — inline shell invocation):

```sh
git checkout main
git merge --squash <releaseBranch>
git commit -m "chore: release v<version>"
```

Where `<releaseBranch>` is the branch name captured in step 1 and `<version>` is the target version confirmed in step 2. The squash collapses the entire release branch into one logical commit on `main`. If the operator answered no in step 2, skip this step entirely and proceed to step 8.

## Step 8 — Sync built plugin artifacts into satellite

Invoke `syncSatelliteAndTag` from `node .claude/skills/rad-release/scripts/sync-satellite-and-tag.mjs` with the operator-confirmed `satelliteRoot`. At skill start-time, if the sibling path `../rad-orc-marketplace` is not a git checkout, prompt the operator via the harness question tool for the absolute path to their local satellite clone. The module replaces each of the three plugin payload directories (`claude-plugin`, `copilot-cli-plugin`, `rad-orc-vscode`) wholesale from the freshly built `output/` trees, then rewrites both marketplace catalogs shape-aware: the Claude catalog (`.claude-plugin/marketplace.json`) uses the nested `git-subdir` shape and gets each `plugins[*].source.ref` pinned to the new `v{version}` tag (Claude Code honors install-time refs); the Copilot catalog (`.github/plugin/marketplace.json`) uses the flat / `pluginRoot` shape required for VS Code Copilot install-persistence and gets each `plugins[*].version` field bumped to the bare new version — VS Code Copilot has no install-time tag-pin, so installs always pull the freshest payload from satellite `main` on its 24-hour update cycle, and the `version` field is surfaced in the Plugins UI for display only. Finally, it commits the satellite with `release: v{version}`. Any non-zero spawn exit halts the flow with the failing operation surfaced.

## Step 9 — Tag and push (triggers CI publish + Release)

The same module then tags both the main repo and the satellite repo with the matching `v{version}` and pushes `HEAD` plus the new tag from each repo to its `origin` using the operator's local git credentials.

**Pushing the main-repo `v{version}` tag triggers the `.github/workflows/publish.yml` CI workflow.** That workflow verifies the tag matches the standard installer's `package.json` version, runs a root `npm install`, builds the standard installer, runs its manifest-drift gate and test suite, publishes `rad-orc` to npm (`npm publish --access public --provenance`, authenticated via the `NPM_TOKEN` repo secret), and cuts a GitHub Release whose notes are the `## v{version}` block sliced out of the approved `CHANGELOG.md`. The standard-installer npm publish is therefore CI-owned; the operator's machine never holds the npm credential.

Roll-forward (a follow-up release) is the only recovery posture once tags have been pushed. (Prerequisite: the `NPM_TOKEN` repo secret must exist — a granular/automation npm token that can publish the `rad-orc` package. Until the package has ≥1 published version, npm trusted publishing / OIDC is unavailable, so the token path is required for the first release.)

## Step 10 — Post-release in-tree dev bump

After the tag and push gates complete in step 9, invoke `suggestNextDev(currentVersion)` where `currentVersion` is the version confirmed in step 2. This returns the next pre-release version — for example, `1.0.0-alpha.9` → `1.0.0-alpha.10`. Present this suggestion via the harness question tool (`AskUserQuestion` on Claude Code) with the option to accept the suggestion or supply a custom next-dev version. This is the second-and-final mid-flow approval gate (the first being CHANGELOG approval in step 5 — only those two pause points exist). On confirmation, invoke `runDevBump` with the confirmed `from` (the just-released version) and `to` (the suggested or custom next-dev version) to perform the post-release bump. This module invokes the same `bumpVersion` lockstep used at release-time (carriers, intra-repo pins, regenerated per-version manifests, and nested lockfiles), stages all changed files via `git add -A`, commits with the subject `chore: post-release dev bump to v{to}`, and pushes using the operator's local git credentials. On decline, the skill exits cleanly and the working tree remains at the just-released version.
