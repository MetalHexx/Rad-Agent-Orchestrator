# Working With PRs

Open the project's pull request(s) yourself, with `gh`, once the final review is approved and the PR gate is cleared. The action envelope carries `data.context.repos[]`; each entry has `name`, `path`, `branch`, and `base_branch`. Run every `gh` command from the repo's own `path`. One PR per repo.

**Keep it to the minimum `gh` calls.** Every shell call re-reads your whole context, so don't pad this flow with confirmatory round-trips. The detect call (step 1) must stand alone — you read its output to decide whether to create. After that, `gh pr create` prints the new PR's URL on stdout: capture it from there. Do **not** re-run `gh pr list`, `gh pr view`, or `git status` afterward to confirm the PR exists — the create output already told you.

## 1. Detect an existing PR (idempotent)

A retry must not open a duplicate. Before creating, check for an open PR from the branch:

    gh pr list --head "<branch>" --base "<base_branch>" --state open --json url --jq '.[0].url'

- Non-empty → a PR already exists; reuse that URL and skip creation for this repo.
- Empty → create the PR (below).

## 2. Compose the body from the final review

The PR description comes from the final-review document at `state.final_review.doc_path`. Summarize the delivered work — do not paste the whole review, summarize the body of work elegantly for a reviewer to clearly understand the changes and their impact. Write that summary as literal prose into its own file. `<path>` in step 3 means *that file* — its content is the PR body. Never let `<path>` resolve to a path, link, or "see doc X" reference standing in for the summary; it must be the summary itself.

## 3. Create the DRAFT PR

Every PR opens as a **draft** — draft mode signals to human reviewers that the change may still need work before it's ready to merge, so never omit `--draft`.

**Always pass `--body-file "<path>"`. Never pass `--body`, and never `--body ""`.** `<path>` is the file you wrote in step 2 — its content, verbatim, is the entire PR body.

    gh pr create --head "<branch>" --base "<base_branch>" --title "<project-name>" --body-file "<path>" --draft

Capture the returned PR URL.

## 4. Cross-link sibling PRs (multi-repo projects)

When a project spans more than one repo, open every repo's PR first, then edit each PR body to link the others so a reviewer can navigate the full change set. Write the updated body — the original summary plus sibling links — as literal prose into its own file; `<updated-body-with-sibling-links>` below means *that file*, never a path or link standing in for its content.

**Always pass `--body-file "<updated-body-with-sibling-links>"`. Never pass `--body`.**

    gh pr edit "<pr-url>" --body-file "<updated-body-with-sibling-links>"

Single-repo projects skip this step.

## 5. Report the result

Relay one entry per repo:

    { "name": "<repo>", "pr_url": "<url-or-null>" }

- Created or reused → the URL.
- Creation failed or a pre-condition was unmet → `pr_url: null`; the pipeline records the attempt as null and proceeds to the human gate.

A side-project has no remote and no pull-request surface — it never reaches this reference (`auto_pr` is `never`).
