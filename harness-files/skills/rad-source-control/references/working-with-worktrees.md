# Working With Worktrees

This document covers the interactive, main-session create-plus-cleanup workflow for worktrees: how to provision them from the command line, gate the source-control initialization on their success, and clean them up. Before deciding anything, establish where the user is standing.

---

## Step 1: Locate

Run:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" project locate
```

Read the following fields from `data` in the returned envelope:

| Field | Meaning |
|---|---|
| `kind` | Where you are: `worktree` \| `main-clone` \| `side-project` \| `none` |
| `worktree_name` | The worktree set name (present when `kind === 'worktree'` or `kind === 'side-project'`) |
| `repo` | The repo this directory belongs to (present when `kind === 'worktree'` or `kind === 'main-clone'`) |
| `projects` | The project(s) associated with this location (array; may be empty) |
| `branch` | The current branch at this path (present when `kind === 'worktree'` or `kind === 'main-clone'`) |

The `project locate` call establishes where the user is standing — it is the prerequisite for any worktree decision.

The observable model is exactly two calls: provision then record. Examine the returned envelope; from it, decide whether to run `worktree create` (or `side-project init` for a side-project) and then `source-control init`. Gate the second call on the first — do not run `source-control init` until the provisioning call succeeds.

**Make no more calls than the flow requires.** Every shell call re-reads your whole context. Use the `locate` envelope you already have, and gate `source-control init` on the `worktree create` (or `side-project init`) result you already have — don't insert extra `radorch project locate`, `git status`, or other probe calls to re-confirm state between steps. The provision→record pair (plus the one `locate`) is the whole happy path; anything beyond it is targeted recovery, not routine verification.

---

## Step 2: Gate the Second Call on the First

After running `radorch worktree create`, inspect its per-repo result array before calling `radorch source-control init`.

**Parse the result array** from `data.repos` in the `worktree create` envelope. Each entry carries a `created` flag and, on failure, an `error` field.

**Gate rule:**

- If every repo entry has `error: null` → all repos are present (some freshly `created: true`, some idempotent no-ops with `created: false, error: null`). Proceed to `radorch source-control init`.
- If any repo entry has `error != null` (equivalently `errorType != null`) → surface that repo's name and its error, then re-run `radorch worktree create --project X --repo <failed>` before calling init. Do not call `source-control init` until every repo entry has `error: null`.

**Failure semantics** meet in this skill: `worktree create` isolates per-repo failures so a single bad repo does not block the others; `source-control init` fails loud on any missing worktree (naming the specific repo and pointing at the recovery command). The skill closes the loop — the CLI commands themselves stay mechanical and never prompt.

**Partial success (exit code `1`)** means some repos created and some failed. Surface each failure with its `error` string and the targeted recovery command:

```
radorch worktree create --project X --repo <failed-repo>
```

Once recovery succeeds, run `source-control init` normally.

---

## Cleanup: Remove Worktrees

To remove a project's worktrees, run:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" worktree remove --project <name>
```

To remove a single repo's worktree (targeted recovery or corruption fix):

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" worktree remove --project <name> --repo <repo>
```

> **Shared `worktree_name` warning:** If two projects share the same `worktree_name` (e.g., a follow-up correction project reusing a parent's worktree), `worktree remove` operates on the physical directories under that `worktree_name`. Removing them affects every project pointing at the same set. The pipeline never auto-destroys worktrees; this operation is always manual and user-confirmed.
