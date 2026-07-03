---
name: rad-log-error
description: 'Use this when the radorch.mjs pipeline envelope returns ok: false, when an agent produces invalid output, or when manual intervention is needed or any other issue occurs during a pipeline execution.'
user-invocable: false
---

# Log Error Skill

## When to Use This Skill

The Orchestrator invokes this skill when the `radorch pipeline signal` envelope returns `ok: false`. This is near-mandatory — whenever the pipeline signals a failure, the error must be logged so there is a persistent, structured record of what went wrong, when, and what (if anything) was done to recover. This skill should also be used when an agent produces invalid output or when manual intervention is needed.

## Workflow

1. **Determine the error log file path**: `{PROJECT-DIR}/{NAME}-ERROR-LOG.md` (e.g., `~/.radorc/projects/MYAPP/MYAPP-ERROR-LOG.md`)

2. **If the file does not exist** — create it using the bundled template at `templates/ERROR-LOG.md`, fill the frontmatter fields (`project`, `created`, `last_updated`), then write the first entry as `## Error 1`

3. **If the file already exists** — read the existing file, read `entry_count` from frontmatter to determine the next entry number, increment `entry_count`, update `last_updated`, and append the new entry section after the last `---` horizontal rule

4. **Entry numbering** is sequential starting at 1

5. **Append-only rule** — never modify or delete existing entries; only append new entries and update frontmatter counters

## Entry Template

Each entry appended to the error log must use this exact structure:

```markdown
## Error {N}: {Brief Symptom Title}

| Field | Value |
|-------|-------|
| **Entry** | {N} |
| **Timestamp** | {ISO-8601} |
| **Pipeline Event** | {event name, e.g. `task_completed`} |
| **Pipeline Action** | {resolved action at failure, or `N/A`} |
| **Severity** | {`critical` | `high` | `medium` | `low`} |
| **Phase** | {phase index or `N/A`} |
| **Task** | {task index or `N/A`} |

### Symptom

{1-3 sentences: observable failure}

### Pipeline Output

```json
{Raw JSON from pipeline engine}
```

### Root Cause

{1-3 sentences, or "Under investigation."}

### Workaround Applied

{Recovery action, or "None — awaiting fix."}

---
```

### Entry Field Contract

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Entry | integer ≥ 1 | Yes | Sequential entry number |
| Timestamp | ISO-8601 string | Yes | When the error occurred |
| Pipeline Event | string | Yes | Event being processed at failure time |
| Pipeline Action | string \| `'N/A'` | Yes | Resolved action at failure, or `'N/A'` if pre-resolution |
| Severity | `'critical'` \| `'high'` \| `'medium'` \| `'low'` | Yes | Per severity classification guide |
| Phase | integer \| `'N/A'` | Yes | Current phase index |
| Task | integer \| `'N/A'` | Yes | Current task index |
| Symptom | markdown text | Yes | Observable failure description (1-3 sentences) |
| Pipeline Output | JSON code block | Yes | Raw `{ ok: false, ... }` envelope from the `radorch pipeline signal` subcommand |
| Root Cause | markdown text | Yes | Diagnosis or "Under investigation." |
| Workaround Applied | markdown text | Yes | Recovery action or "None — awaiting fix." |

## Severity Classification Guide

| Severity | Criteria | Examples |
|----------|----------|---------|
| `critical` | Pipeline cannot proceed; blocks all execution | Unmapped action, validation error, phase initialization failure |
| `high` | Pipeline produces incorrect state but doesn't crash | Wrong action returned, task stuck in wrong status |
| `medium` | Pipeline works around the issue with degraded behavior | Status synonym normalized instead of matching directly |
| `low` | Cosmetic or informational; no pipeline impact | Verbose error message, minor output formatting issue |

## Template

[ERROR-LOG.md](./templates/ERROR-LOG.md)
