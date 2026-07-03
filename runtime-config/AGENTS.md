# runtime-config/

## Purpose

Source of truth for harness-neutral runtime configuration. Installers copy this content verbatim to `~/.radorc/`; nothing here is transformed, templated, or made harness-specific.

## How it works

Two types of content:

**`orchestration.yml`** — system configuration read by every project's pipeline. Current fields: `version`, `default_template`, `limits` (`max_retries_per_task`), `human_gates` (`after_planning`, `execution_mode`, `after_final_review`), `source_control` (`auto_commit`, `auto_pr`).

**`templates/`** — four review-intensity tier templates that the pipeline engine loads when a project is started. Each file defines a `template` header (`id`, `version`, `description`) and a `nodes` DAG:
- `extra-high.yml` — per-task code review + phase review + final review
- `high.yml` — per-task code review + final review (no phase review)
- `medium.yml` — phase review + final review (no per-task review)
- `low.yml` — final review only

The `build-scripts/build.js` `copy-runtime-config` step copies `orchestration.yml` and `templates/` into `output/`; the plugin's `installManifestFiles` then places them under `~/.radorc/`.

## Coding conventions

- No per-harness conditionals, no harness names, no adapter-specific paths.
- No runtime variable substitution; all values are static literals.
- YAML only; no JSON equivalents.

## Rules for making updates

- `orchestration.yml` is user-owned after install; changes here update only fresh installs or plugin updates, not existing user copies.
- Adding a new template: create a new `.yml` in `templates/`, add a matching entry to the manifest at `harness-installers/claude-plugin/manifests/v*.json`, and verify the build copies it correctly.
- Renaming an existing template file: update every reference in `orchestration.yml`, pipeline runtime code, and the manifest catalog.
- No adapter pass reads this folder at build time — the harness-adapters engine does not touch `runtime-config/`. Keep it that way.
