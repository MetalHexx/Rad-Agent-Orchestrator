# Plugins

rad-orchestration ships as a Claude Code plugin you install through your harness's marketplace. Once installed, every orchestration skill, agent, and the dashboard UI is available without cloning the repo.

## Install

    /plugin marketplace add MetalHexx/RadOrchestration
    /plugin install rad-orchestration

Restart your session. After restart, the slash-command surface is populated and the orchestration loop is fully available.

## What ships in the plugin

- Every `rad-*` skill (brainstorm, plan, execute, review, source-control, UI lifecycle, dashboard control)
- Every orchestration agent (coder, coder-junior, coder-senior, reviewer)
- The dashboard UI (Next.js standalone server)
- The pipeline runtime (single bundled `pipeline.js`)

## State location

Project state lives at `~/.radorc/projects/` (state preserved on uninstall).

## Slash command surface

Plugin-shipped skills are namespaced with the plugin's id. A few examples:

- `/rad-orchestration:rad-ui-start` — launch the dashboard UI
- `/rad-orchestration:rad-brainstorm` — kick off a brainstorming session
- `/rad-orchestration:rad-plan` — start the planning pipeline

## Updates and uninstall

Update with `/plugin update rad-orchestration`. Uninstall with `/plugin uninstall rad-orchestration`. Project state under `~/.radorc/projects/` is preserved across both — uninstall does not delete your work.

## Per-harness support

| Harness | Plugin install | Legacy install (`npx rad-orchestration`) |
|---|---|---|
| Claude Code | Supported | Supported |
| Copilot CLI | Not yet | Supported |
| Copilot in VS Code | Not yet | Supported |
