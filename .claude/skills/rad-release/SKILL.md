---
name: rad-release
description: Drive the end-to-end release flow locally — context, version bump, build, validate, commit, publish, sync, tag, and post-release dev bump.
---

## Step 1 — Gather context

Run `node .claude/skills/rad-release/scripts/gather-context.mjs` from the repo root. This module reads the current version from `cli/package.json`, resolves the active branch via `git branch --show-current`, determines whether the working tree is dirty via `git status --porcelain`, and attempts to locate the most recent `v*` release tag via `git describe --tags --abbrev=0 --match "v*"` (returns `null` when no matching tag exists yet — expected on first release). Print the four-field result for operator awareness before proceeding.

## Step 2 — Up-front questions

Using the harness question tool (`AskUserQuestion` on Claude Code), present the operator with two decisions before any mutation occurs:

1. **Target version** — show the `currentVersion` gathered in step 1 and the `lastReleaseTag` (or "none yet" when `null`). Suggest the next version: if `currentVersion` is a pre-release (`-alpha.N` / `-beta.N`), suggest bumping the pre-release counter; if stable, suggest a patch bump. Ask the operator to confirm or supply a different target.

2. **Merge to main** — if `currentBranch` is not `main`, ask whether the operator wants to squash-merge to `main` after the release commit lands (step 7). This is an up-front question collected before any mutation, not a mid-flow approval gate. Two mid-flow approval gates follow: CHANGELOG approval in step 5 and post-release dev-bump confirmation in step 12.

Both answers are carried forward into subsequent gates.

## Step 3 — Lockstep version bump

Invoke `node .claude/skills/rad-release/scripts/bump-version.mjs --from <currentVersion> --to <new>` where `<currentVersion>` is the value gathered in step 1 and `<new>` is the target version confirmed in step 2. Both flags are required — the engine fails fast if either is missing so the operator cannot accidentally bump from an assumed prior. This performs the lockstep bump across all carrier locations: wrapper `package.json` files, plugin authoritative version sources, per-version manifest catalog file renames (with internal `version` field updated), and a hardcoded-literal sweep. A final re-grep halts loudly if any stray copy of the prior version remains after the sweep.

## Step 4 — Build + validate

Invoke `node .claude/skills/rad-release/scripts/build-and-validate.mjs` from the repo root. This first runs `node harness-installers/standard/build-scripts/build.js`, the standard installer build, which translates the canonical `harness-files/` agents+skills for all three harnesses and emits `output/` + manifests (the same artifact published to npm in step 8). It then runs `node build-scripts/build.js` from each of the three plugin directories (`claude-plugin`, `copilot-cli-plugin`, `copilot-vscode-plugin`), where each plugin's build script internally invokes the Gate 3 validator. A non-zero exit from any sub-step halts the flow immediately and prints the captured stderr to the operator.

After build-and-validate succeeds, invoke `node .claude/skills/rad-release/scripts/check-size-budget.mjs` to enforce the per-plugin tarball size budget (57,671,680 bytes = 50 MB + 10% headroom). Any plugin exceeding the budget halts the flow with a message naming the failing plugin and its measured size.

## Step 5 — CHANGELOG draft + approval gate

Run `node .claude/skills/rad-release/scripts/changelog-and-commit.mjs --draft --to <new>` to invoke `draftChangelog`. Pass the commit log since the last release tag (or the full history on first release) as the `commits` array. The draft produces a `## v{version} — {date}` heading with three subsections — `### What's New` (feat: commits), `### What's Fixed` (fix: commits), and `### Changes` (everything else).

Present the full drafted body to the operator using the harness question tool (`AskUserQuestion` on Claude Code). Frame the question with the full drafted CHANGELOG text inline so the operator can read it without switching context. Offer a single labelled option **Approve and commit**. If the operator wants to edit, they paste a revised body into the "Other / custom" field and resubmit — the revised text is used as `approvedChangelog` in step 6. This is the first of two mid-flow approval gates (the second is dev-bump confirmation in step 12).

First-release callouts (new `rad-orc` npm package, plugins first appearing on the satellite) are **not** auto-generated. The operator authors them by hand inside this gate when relevant.

## Step 6 — Single commit

Once the operator approves the CHANGELOG body, invoke `commitRelease` from `changelog-and-commit.mjs` with:

```js
await commitRelease({ repoRoot, version, approvedChangelog });
```

`commitRelease` prepends the approved entry above the previous most-recent `## v` block in `CHANGELOG.md`, then runs `git add -A` followed by exactly one `git commit -m "chore: bump version to v{version}"`. This single commit bundles every bumped carrier, every renamed manifest catalog (already `git mv`'d by step 3), the regenerated per-harness manifest files, and the approved CHANGELOG body (atomicity). No second `git commit` invocation is permitted anywhere in the release flow between step 3 and step 7.

## Step 7 — Squash-merge to main

Only executed when the operator answered **yes** to the merge-to-main question in step 2. Run the three commands below verbatim from the repo root (no separate module — inline shell invocation):

```sh
git checkout main
git merge --squash <releaseBranch>
git commit -m "chore: release v<version>"
```

Where `<releaseBranch>` is the branch name captured in step 1 and `<version>` is the target version confirmed in step 2. The squash collapses the entire release branch into one logical commit on `main`. If the operator answered no in step 2, skip this step entirely and proceed to step 8.

## Step 8 — Publish standard installer to npm

Invoke `node .claude/skills/rad-release/scripts/publish-npm.mjs` from the repo root. This module runs `npm publish --access public` from the local npm credentials held on the operator's machine. No `--provenance` flag is passed — the local-skill publish workflow accepts the loss of OIDC attestation and does not emit a signed provenance statement. The published package name is `rad-orc`, with the version taken from the lockstep bump produced in step 3 — for the first release, this is the alpha-N value carried forward from the current `cli/package.json`, not a fresh `0.0.1`. A non-zero exit halts the release and surfaces the npm error to the operator.

## Step 9 — Sync built plugin artifacts into satellite

Invoke `syncSatelliteAndTag` from `node .claude/skills/rad-release/scripts/sync-satellite-and-tag.mjs` with the operator-confirmed `satelliteRoot`. At skill start-time, if the sibling path `../rad-orc-marketplace` is not a git checkout, prompt the operator via the harness question tool for the absolute path to their local satellite clone. The module replaces each of the three plugin payload directories (`claude-plugin`, `copilot-cli-plugin`, `rad-orc-vscode`) wholesale from the freshly built `output/` trees, then rewrites both marketplace catalogs shape-aware: the Claude catalog (`.claude-plugin/marketplace.json`) uses the nested `git-subdir` shape and gets each `plugins[*].source.ref` pinned to the new `v{version}` tag (Claude Code honors install-time refs); the Copilot catalog (`.github/plugin/marketplace.json`) uses the flat / `pluginRoot` shape required for VS Code Copilot install-persistence and gets each `plugins[*].version` field bumped to the bare new version — VS Code Copilot has no install-time tag-pin, so installs always pull the freshest payload from satellite `main` on its 24-hour update cycle, and the `version` field is surfaced in the Plugins UI for display only. Finally, it commits the satellite with `release: v{version}`. Any non-zero spawn exit halts the flow with the failing operation surfaced.

## Step 10 — Tag and push

The same module then tags both the main repo and the satellite repo with the matching `v{version}` and pushes `HEAD` plus the new tag from each repo to its `origin` using the operator's local git credentials (no CI involvement). End-user installs of the plugins remain anonymous after this gate, and roll-forward (a follow-up release) is the only recovery posture once tags have been pushed.

## Step 11 — Generate workspace-local release notes

Invoke `node .claude/skills/rad-release/scripts/generate-release-notes.mjs` after the tag/push gate in step 10. This module writes `RELEASE-NOTES-v{version}.md` to the repo root with a four-section shape: `## What's New` (from whatsNew section), `## What's Fixed` (from whatsFixed section), `## Changes` (from changes section), and `## Package` (shipped artifacts table). Empty sections are omitted except `## Package`, which is always present. The file is intentionally outside `.gitignore` so the operator sees it in their working tree, but the skill never stages or commits it — the operator pastes its contents into the GitHub release UI for the matching tag and then deletes the local file locally.

## Step 12 — Post-release in-tree dev bump

After the tag and push gates complete in step 10, invoke `suggestNextDev(currentVersion)` where `currentVersion` is the version confirmed in step 2. This returns the next pre-release version — for example, `1.0.0-alpha.10` → `1.0.0-alpha.11`. Present this suggestion via the harness question tool (`AskUserQuestion` on Claude Code) with the option to accept the suggestion or supply a custom next-dev version. This is the second-and-final mid-flow approval gate (the first being CHANGELOG approval in step 5 — only those two pause points exist). On confirmation, invoke `runDevBump` with the confirmed `from` (the current version) and `to` (the suggested or custom next-dev version) to perform the post-release bump. This module invokes the same `bumpVersion` lockstep used at release-time, regenerates per-version manifests, stages all carrier files plus any regenerated `package-lock.json` files via `git add -A`, commits with the subject `chore: post-release dev bump to v{to}`, and pushes using the operator's local git credentials. On decline, the skill exits cleanly and the working tree remains at the just-released version.
