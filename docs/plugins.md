# Plugins

rad-orchestration ships as a Claude Code plugin you install through your harness's marketplace. Once installed, every orchestration skill, agent, and the dashboard UI is available without cloning the repo.

## Install

    /plugin marketplace add radancy-pe/rai-ops-plugin-marketplace
    /plugin install rad-orc@radancy

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

- `/rad-orc:rad-ui-start` — launch the dashboard UI
- `/rad-orc:rad-brainstorm` — kick off a brainstorming session
- `/rad-orc:rad-plan` — start the planning pipeline

## Updates and uninstall

Update with `/plugin update radancy`. Uninstall with `/plugin uninstall rad-orc@radancy`. Project state under `~/.radorc/projects/` is preserved across both — uninstall does not delete your work.

## Per-harness support

| Harness | Plugin install | Legacy install (`npx rad-orc`) |
|---|---|---|
| Claude Code | Supported | Supported |
| Copilot CLI | Supported | Supported |
| Copilot in VS Code | Supported | Supported |
