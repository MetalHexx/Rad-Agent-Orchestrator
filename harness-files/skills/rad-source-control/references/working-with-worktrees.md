# Working With Worktrees

This is the interactive, main-session create-plus-cleanup workflow. It is reached via `rad-execute` routing (not a subagent spawn). Before deciding anything, establish where the user is standing.

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
| `branch` | The current branch at this path (present when `kind === 'worktree'`) |

The observable model is exactly two calls: provision then record. Use the locate result to decide which provisioning path applies, then execute both calls in that order.

**Make no more calls than the flow requires.** Every shell call re-reads your whole context. Decide the case from the `locate` envelope you already have, and gate `source-control init` on the `worktree create` result you already have (Step 3) — don't insert extra `radorch project locate`, `git status`, or other probe calls to re-confirm state between steps. The provision→record pair (plus the one `locate`) is the whole happy path; anything beyond it is targeted recovery, not routine verification.

---

## Step 2: Decide — Five-Case Flow

Match the locate result and the target project's needs to one of the five cases below. Cases A, B, and C are silent — no prompts. Prompts fire only at the genuine forks: C′, D, and E.

| Case | Situation | Action |
|---|---|---|
| **A — Fresh standard** | `kind === 'none'` or `kind === 'main-clone'` and the project is a `standard` type | Run `radorch worktree create --project X` → `radorch source-control init --project X`. No prompt. |
| **B — Side-project** | Project type is `side-project` | Run `radorch side-project init --project X` → `radorch source-control init --project X`. No prompt. |
| **C — Standing in the target's worktree** | `kind === 'worktree'` and `projects` contains the target project | `worktree create` is a no-op (already exists and is idempotent) → run `radorch source-control init --project X`. No prompt. |
| **C′ — Different project's worktree** | `kind === 'worktree'` and `projects` does NOT contain the target project | Confirm intent: "You are in `<worktree_name>` (project `<projects[0]>`). Continue on the same branch and reuse this worktree for `X`?" On confirmation: run `radorch worktree create --project X --worktree-name <worktree_name>` → `radorch source-control init --project X --worktree-name <worktree_name>`. Branch is inherited from the current worktree (`branch`). |
| **D — Main clone, no worktree wanted** | `kind === 'main-clone'` and the user declines worktree creation | Ask: "Record this main clone as the working directory for project `X` (in-place mode)?" On confirmation: run `radorch source-control init --project X --in-place`. |
| **E — Reused set missing a needed repo** | Reusing an existing worktree set (case C or C′) but one or more of the project's repos has no worktree yet | Ask: "The repo `<missing>` has no worktree under `<worktree_name>`. Pull it in now?" On confirmation: run `radorch worktree create --worktree-name <worktree_name> --repo <missing>` → `radorch source-control init --project X`. |

> **Case C′ note:** the follow-up project lands on the reused project's existing branch, on top of the prior work. This is the deliberate correction-project signal — launching from inside a completed project's worktree means you want to land changes there.

---

## Step 3: Gate the Second Call on the First

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
