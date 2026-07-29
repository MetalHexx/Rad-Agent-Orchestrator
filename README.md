# Rad Orchestration System

A document-driven agent orchestration system that takes software projects from idea through planning, execution, and review on top of native AI coding-assistant primitives plus a small Node.js pipeline.

- Adapts to your repository's existing skills — the Planner picks up downstream skills authored in your repo without further configuration.
- Four review-intensity tiers — `extra-high` (maximum defense in depth) through `low` (quick exploration) — selected at planning time.
- Coder agents follow a strict RED-GREEN TDD cycle on code tasks: write a failing test, watch it fail, implement the minimum to pass.
- Documents are the inter-agent API — every step writes a structured markdown artifact, so the trail from idea to merged code is fully auditable.
- Human gates are first-class — humans approve the plan before any code is written and approve the final result before the project closes.

## How It Flows

```mermaid
flowchart TD
    IDEA(["Idea"]) --> BRAIN(["Brainstorm (optional)"])
    BRAIN --> REQ(["Requirements"])
    REQ --> PLAN(["Master Plan"])
    PLAN --> GATE1{{"Human Gate"}}

    subgraph LOOP ["Phase Loop"]
        direction TB
        subgraph TLOOP ["Task Loop"]
            direction TB
            EXEC(["Execute Task"]) --> COMMIT(["Commit (if enabled)"])
            COMMIT --> REVIEW(["Code Review"])
            REVIEW --> TGATE{{"Task Gate"}}
        end
        TLOOP --> PREVIEW(["Phase Review"])
        PREVIEW --> PGATE{{"Phase Gate"}}
    end

    GATE1 --> LOOP
    LOOP --> FINAL(["Final Review"])
    FINAL --> GATE2{{"Human Gate"}}
    GATE2 --> DONE(["Done"])
```

## Supported Harnesses

| Harness | Install / entry point | Status |
|---------|-----------------------|--------|
| Claude Code | `radorch` installer wires the project's `.claude/` agents and skills | Supported |
| Copilot VS Code | Custom agents, skills, prompt files, and instruction files via the Copilot extension | Supported |
| Copilot CLI | Same agent and skill definitions consumed by the Copilot CLI | Supported |

More coming soon — see [harnesses.md](docs/harnesses.md) for per-harness detail.

## Monitoring Dashboard

A real-time Next.js dashboard visualizes project state, pipeline progress, documents, and configuration by reading the `state.json` in each project — no service to run, no database to wire up.

![Dashboard screenshot](assets/dashboard-screenshot.png)

[Learn more about the dashboard →](docs/dashboard.md)

## Documentation

| Page | Description |
|------|-------------|
| [Install](docs/INSTALL.md) | Per-harness install instructions — plugin (recommended) vs. standard installer, upgrade, uninstall. |
| [Getting Started](docs/getting-started.md) | Install the system, walk through your first project, learn the common commands. |
| [Pipeline](docs/pipeline.md) | The planning and execution flow, human gates, corrective cycles, error handling. |
| [Agents](docs/agents.md) | Each agent's role, tool access, write permissions, and where it sits in the flow. |
| [Skills](docs/skills.md) | The six user-invoked slash commands — what each does, when to use it, and what it produces. |
| [Configuration](docs/configuration.md) | The `orchestration.yml` reference — every option explained with sensible defaults. |
| [Project Structure](docs/project-structure.md) | File layout, naming conventions, document types, and state management. |
| [Plugins](docs/plugins.md) | Install rad-orchestration as a plugin via your harness's marketplace. |
| [Monitoring Dashboard](docs/dashboard.md) | Dashboard startup, features, data sources, and real-time update behavior. |
| [Harnesses](docs/harnesses.md) | Per-harness install detail, entry points, and current support status. |

## Design Principles

1. **Documents as interfaces** — Agents never share memory. Every interaction is mediated by a structured markdown document.
2. **Sole-writer policy** — Every document type has exactly one agent that may write it.
3. **Self-contained handoffs** — The Coder reads only its task handoff. Everything it needs is inlined.
4. **Deterministic where possible** — Routing, triage, and validation are pure functions; LLMs handle judgment work.
5. **Human in the loop** — Critical gates are enforced. Humans approve plans and final results.
6. **Continuous verification** — Every task is reviewed against the plan before it is committed.
7. **Zero dependencies** — Node.js built-ins only for the pipeline itself; no `npm install` required to run it.

## License

See LICENSE for details.
