# Configuration

`orchestration.yml` is the single configuration file for the orchestration system. It lives at `~/.radorc/orchestration.yml`. The file controls pipeline limits, human-gate behavior, and source-control automation. Sensible defaults ship out of the box; most users never need to edit it.

## orchestration.yml

The full canonical shape with default values:

```yaml
# orchestration.yml
version: "1.0"
package_version: 1.3.1
default_template: ask
limits:
  max_retries_per_task: 5
  max_consecutive_review_rejections: 3
human_gates:
  after_planning: true
  execution_mode: "ask"
  after_final_review: true
source_control:
  auto_commit: "ask"
  auto_pr: "ask"
```

Edit the file in place, or use the dashboard's gear panel (see [dashboard.md](dashboard.md)) for an interactive UI.

### version

Configuration schema version. Always `"1.0"` for this release.

### package_version

The rad-orchestration package version that wrote this file. Updated automatically on install and upgrade.

### default_template

Default review-intensity tier the planner proposes when starting a new project. Accepts `ask`, `extra-high`, `high`, `medium`, or `low`. The default `ask` defers the choice to project-creation time. Tier names map to the four templates under `~/.radorc/templates/`.

### limits.max_retries_per_task

Maximum automatic retries before the pipeline escalates a stuck task to a human. Default `5`; integer.

### limits.max_consecutive_review_rejections

Maximum review rejections before the pipeline escalates to a human gate. Default `3`; integer.

### human_gates.after_planning

Gate the pipeline for human approval after the Master Plan is authored. Default `true`. This gate is always enforced unless explicitly overridden per project.

### human_gates.execution_mode

Granularity of execution-time human gates. Accepts `ask`, `phase`, `task`, or `autonomous`. `ask` prompts at execution start; `phase` gates between phases; `task` gates between tasks; `autonomous` runs without gates. Default `ask`.

### human_gates.after_final_review

Gate the pipeline for human approval after the comprehensive review and before commit or PR creation. Default `true`. Always enforced.

### source_control.auto_commit

Behavior for automatic commits at the end of each approved task or phase. Accepts `always` (commit without prompting), `ask` (prompt before each project run), or `never` (skip commits). Default `ask`.

### source_control.auto_pr

Behavior for automatic pull-request creation after final approval. Accepts `always`, `ask`, or `never`. Default `ask`.

## Process Templates

The review-intensity tier (`extra-high`, `high`, `medium`, `low`) and the Phase/Task Size are selected at planning time, not in `orchestration.yml`. See [pipeline.md](pipeline.md#process-templates).

## State and Snapshots

`state.json` is the resumable record of a project. It lives at `~/.radorc/projects/{PROJECT-NAME}/state.json` and tracks project identity, planning progress, phase and task state, review verdicts, and source-control references. The pipeline writes it after every action.

When a project is created, the pipeline copies `limits`, `human_gates`, and `source_control` modes out of `orchestration.yml` into `state.json` and locks them in. Subsequent runs read from the snapshot, not from `orchestration.yml`. Editing `orchestration.yml` mid-project has no effect on that project; new values apply only to projects created afterward.

The selected process template is similarly snapshotted into the project folder as `template.yml`. The template in effect when the project was created stays in effect for its entire lifetime.
