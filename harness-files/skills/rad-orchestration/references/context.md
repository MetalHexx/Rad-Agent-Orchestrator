# Orchestration System Context

This skill defines a **document-driven agent orchestration system** built on the host harness's native primitives (custom agents, skills, prompt files, instruction files). The system takes software projects from idea through planning, execution, and review using a small set of specialized agents.

## How It Works

- **Brainstorm an idea**: Use `rad-brainstorm` skill to collaboratively explore and refine a project idea and scribe the Requirements doc (via `rad-create-plans`) before starting the pipeline.
- **Start project planning**: Use the `rad-plan` skill once a Requirements doc exists. It consumes the approved requirements and builds the Master Plan + audit.
- **Execute a project plan**: Use the `rad-execute` skill to run the execution pipeline for a project when a plan is ready for execution.
- **Continue a project**: You can pick up from where a project left off by signaling the `radorch.mjs` script and signal the `start` event.  See the `references/pipeline-guide.md`.

>Note:  You should urge a user to go through brainstorming before planning if their idea is still vague.  The brainstorming process is designed to help them clarify their idea and give the main agent more to work with when it comes time to author the formal plans.

## Agents
These are your available agents. Each has a specific role in the planning and execution process and especially designed for use within this system.  

| Agent | Purpose |
|-------|---------|
| `@coder` | Executes coding tasks from self-contained task handoffs — and commits its own work when directed |
| `@coder-junior` | Executes simpler coding tasks with additional guardrails |
| `@coder-senior` | Executes complex coding tasks with expanded autonomy |
| `@reviewer` | Reviews code and phases against planning documents |
| `@reviewer-junior` | Reviews simple-complexity task code against planning documents |

> You could use other available agents if needed, particularly for specialized tasks or corrective actions, but these are the ones that the pipeline system is designed around.  Prefer instructing agents to use skills you find in the system if needed.

## Configuration

System configuration lives in `~/.radorc/orchestration.yml`. It controls:
- Pipeline limits (`max_retries_per_task`, the sole corrective budget gate)
- Human gate defaults
- Source control mode (`auto_commit`, `auto_pr`)

## Project Files
Stored at `~/.radorc/projects/{PROJECT-NAME}/`.  See `references/document-conventions.md` for detailed naming and content standards.