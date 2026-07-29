# Rad Orchestration ("rad-orc") Installation Guide

This file is designed to be read by AI coding assistants. If you're an LLM helping a user install rad-orc, identify which harness you're currently running in (Claude Code, GitHub Copilot CLI, or GitHub Copilot in VS Code) and follow that section below.

## What rad-orc ships as

rad-orc is a document-driven, multi-agent SDLC orchestration system: skills (`/rad-brainstorm`, `/rad-plan`, `/rad-execute`, plus dashboard-control skills), coder/reviewer agents, a deterministic pipeline engine, and a Next.js monitoring dashboard. It ships two ways, and **both give you the identical skill/agent set** — they differ only in distribution mechanism:

- **Marketplace plugin** — installed via your harness's `/plugin` command from a satellite marketplace repo. Nothing is written into your project; the skills/agents live in the plugin's own install location and are namespaced (`rad-orc:rad-plan`, etc.). Updates are a single `/plugin marketplace update` command.
- **Standard installer** (`npx rad-orc`) — writes the compiled agent/skill files into your **home directory** (`~/.claude` for Claude Code, `~/.copilot` for either Copilot variant) — never into the current repo. Useful if you want to inspect/customize the shipped files, or your harness doesn't support plugins yet.

**Recommendation: install the plugin for whichever harness you're currently running in.** It's less invasive (no files added to the user's repo), updates are a single command, and it's the actively maintained default path. Fall back to the standard installer only if the user prefers vendored files, needs to customize the shipped skills/agents, or the plugin path fails for some reason.

## Prerequisites

- **Node.js >= 18** — required for both the `npx rad-orc` installer and (indirectly) the plugin's bundled pipeline runtime.
- One of: Claude Code, GitHub Copilot CLI, or GitHub Copilot in VS Code (agent mode enabled).

## Claude Code

### Option A: Plugin Install (Recommended)

Run in Claude Code:

```
/plugin marketplace add MetalHexx/rad-orc-marketplace
/plugin install rad-orc@rad-orc-marketplace
```

Restart your session. After restart, `/rad-orc:rad-brainstorm`, `/rad-orc:rad-plan`, `/rad-orc:rad-ui-start`, etc. are available — type `/` to see the full namespaced list.

### Option B: Standard Installer

```
npx rad-orc --harness claude
```

This writes agents and skills into `~/.claude` (your home directory, not the current repo). Re-running `npx rad-orc` later upgrades an existing install (removes orphaned files from the prior version, writes new ones, and prompts before touching anything you've locally modified).

## GitHub Copilot CLI

### Option A: Plugin Install (Recommended)

Run in the Copilot CLI:

```
/plugin marketplace add MetalHexx/rad-orc-marketplace
/plugin install rad-orc@rad-orc-marketplace
```

### Option B: Standard Installer

```
npx rad-orc --harness copilot-cli
```

This writes agents and skills into `~/.copilot` (your home directory, not the current repo). Note: `~/.copilot` is shared with the Copilot VS Code standard install below — installing one standard variant evicts the other's registry entry from that shared folder (a plugin install of either variant can still coexist alongside it).

## GitHub Copilot in VS Code

Install the GitHub Copilot extension and enable **agent mode** in VS Code settings first — standard Copilot Chat mode does not expose slash-command routing.

### Option A: Plugin Install (Recommended)

Run in Copilot Chat (agent mode):

```
/plugin marketplace add MetalHexx/rad-orc-marketplace
/plugin install rad-orc-vscode@rad-orc-marketplace
```

### Option B: Standard Installer

```
npx rad-orc --harness copilot-vscode
```

This writes agents, skills, prompt files, and instruction files into `~/.copilot` (your home directory, not the current repo). Note: `~/.copilot` is shared with the Copilot CLI standard install above — installing one standard variant evicts the other's registry entry from that shared folder (a plugin install of either variant can still coexist alongside it).

## One-shot / non-interactive install

Both installer paths support skipping confirmation prompts. For the standard installer:

```
npx rad-orc --harness <claude|copilot-vscode|copilot-cli> --yes
```

## State location

Project state (brainstorms, requirements, plans, task handoffs, review reports) lives at `~/.radorc/projects/`, regardless of which install path or harness you used. This is preserved across plugin updates/uninstalls and across standard-installer upgrades/uninstalls — your in-progress work is never deleted by an install operation.

## Verification

After installing, in a fresh session in your repo:

- Type `/` and confirm the rad-orc skills appear (`rad-brainstorm`, `rad-plan`, `rad-execute` at minimum — namespaced as `rad-orc:rad-plan` etc. on a plugin install).
- Run `/rad-ui-start` (or `/rad-orc:rad-ui-start` on a plugin install) to launch the monitoring dashboard — it should open in your browser automatically.
- Run `/rad-brainstorm` to confirm the pipeline responds.

## Updating

- **Plugin install:** `/plugin marketplace update rad-orc-marketplace` — this refreshes every plugin sourced from that marketplace (there is no per-plugin update command; Claude Code updates at the marketplace level).
- **Standard installer:** re-run `npx rad-orc --harness <name>`. This upgrades in place as an uninstall-of-old + install-of-new; locally-modified files trigger a confirmation prompt before being touched.

## Uninstalling

- **Plugin install:** `/plugin uninstall rad-orc@rad-orc-marketplace` (or `rad-orc-vscode@rad-orc-marketplace`).
- **Standard installer:**

  ```
  npx rad-orc uninstall --harness <claude|copilot-vscode|copilot-cli>
  ```

  Reads the installed manifest version and removes only the files it lists; locally-modified files surface in a confirmation prompt first. `~/.radorc/projects/` is never touched by uninstall.

## Further reading

Once installed, see [getting-started.md](getting-started.md) (first-project walkthrough), [harnesses.md](harnesses.md) (per-harness detail and gotchas), [plugins.md](plugins.md) (plugin specifics), and [dashboard.md](dashboard.md) (monitoring UI).
