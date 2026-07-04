# Agents

The orchestration system ships five agents, each with a defined role, scoped tool access, and a narrow write surface.

Agents are not directly invoked by users — your main agent (Claude Code or GitHub Copilot) drives the pipeline via slash commands and dispatches work to the right agent at the right time. Brainstorming, planning, and pipeline orchestration itself run as skills directly on your main agent; only execution and review are handed off to the specialized agents below.

Typically, dispatched agents are capped at the highest model tier you have selected in your main agent chat. So even if Coder-Senior defaults to Opus, if you're using Sonnet in your main chat, your Coder-Senior will run with Sonnet.

## Model Routing

| Agent | Model |
|-------|-------|
| Coder-Junior | haiku |
| Coder | sonnet |
| Coder-Senior | opus |
| Reviewer-Junior | haiku |
| Reviewer | sonnet |

The three Coder tiers exist to route tasks between haiku, sonnet, and opus by complexity — junior for straightforward changes, default for typical work, senior for complex or high-stakes work. The two Reviewer tiers follow the same idea: Reviewer-Junior handles simple, task-scope reviews; Reviewer handles standard and complex tasks plus every phase and final review.

## Agent Details

### Coder-Junior

Coder-Junior executes one task end-to-end from a self-contained task handoff. For code tasks, it follows a mechanical RED-GREEN cycle: write a failing test first, implement until the test passes, then run the full suite to confirm no regressions. Assigned to straightforward tasks where the implementation steps are explicit and the scope is narrow.  Currently, Haiku 4.5 is the model this agent will use.

### Coder

Coder executes one task end-to-end from a self-contained task handoff. For code tasks, it follows the same RED-GREEN cycle as the other Coder tiers: failing test first, implement until green, full suite last. Assigned to typical work that fits a mid-tier model.  Currently, Sonnet 4.6 is the model this agent will use.

### Coder-Senior

Coder-Senior executes one task end-to-end from a self-contained task handoff, following the same RED-GREEN cycle. Assigned to complex or architecturally significant tasks where deeper reasoning is warranted.  Currently, Opus 4.7 is the model this agent will use.

### Reviewer

The Reviewer reads the task output against the requirement audit and produces a structured review document. Its quality pass may flag speculative additions and pattern duplication when they appear; it does not prescribe implementation style beyond what the requirements specify. Review findings drive corrective task handoffs when changes are needed.  Currently, Sonnet 4.6 is the model this agent will use.

### Reviewer-Junior

Reviewer-Junior evaluates code the same way the Reviewer does — reading the task output against the requirement audit and producing a structured review document — but is scoped narrowly to simple, task-scope reviews. There is no junior tier at phase or final scope; those always run on Reviewer.  Currently, Haiku 4.5 is the model this agent will use.

## Next Steps

- [Skills](skills.md) — Explore the skills agents use
