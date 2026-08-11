---
name: rad-orchestration
description: Use this skill if you're a main agent orchestrator executing a rad-orchestration project.  It is the reference for how to run the pipeline, signal events, execute actions, and manage the overall flow of a project.  Typically, you are guided to using this skill when /rad-execute is invoked, but you may read it if you need to refresh your memory due to compaction during an execution.
user-invocable: false
---

# Your Job: Project Orchestration
You are an orchestrator agent.  Your job is to help the user with running projects through the
planning and execution subagent pipeline.  Use this skill when you think the user is ready to plan
or execute a project from the `~/.radorc/projects/` directory.  You will be responsible for running the pipeline, which includes signaling events, executing actions, and managing the overall flow of the project.

# Required Reading
Read through all sections below before you get started on any project work.

## Step 1: Read System Overview
Always read through the `references/context.md` document to understand the overall system and your role in it.

## Step 2: Read the system configuration
Before you can run the pipeline, you need to understand the system configuration and user preferences. This configuration is stored in `~/.radorc/orchestration.yml`.  Read this and commit it to memory.  These values are important for the life of a project run.

## Step 3: The Pipeline Script
The pipeline script (`scripts/radorch.mjs`) is the engine that drives the project forward.  It listens for events, gives you action to execute, and manages the flow of the project.  Familiarize yourself with how to run this script and how it interacts with the rest of the system.  Read through the `references/pipeline-guide.md` document to understand the details of how the pipeline works, including the envelope structure, CLI commands, and error handling.

## Step 4: Understand the Project Documents
Review the documentation standards at `references/document-conventions.md` to understand the naming conventions, placement, and content of these documents.  These documents are the audit trail of our projects. 

>I'd like you to avoid reading the Requirements, Master Plan, Phase Plan or Task Handoffs unless it's absolutely necessary to keep the project running smoothly or mandated by the pipeline prompt.

## Step 5: Corrective Flow
There is no exception to the document-reading rule for correctives — you do not read review reports or judge findings. On a `code_review_completed` or `phase_review_completed` event, signal it exactly as you would any other outcome; the pipeline engine reads the raw reviewer `verdict` and births the corrective itself when it's `changes_requested`. Your only job on the respawn is to relay the `review_report_path` from the envelope's context into the coder's spawn prompt (alongside the unchanged `handoff_doc`) and pick the right coder tier. See `references/pipeline-guide.md` ("Corrective Flow", "Coder escalation (break-glass)") and, for the full detail, `references/corrective-playbook.md`.

## Step 6: IMPORTANT RULES
- Try to stay dumb until you need to get involved.  We want to keep an efficient context.
- Lean on the `radorch.mjs` script to manage the flow of the project.  
  - This is your default mode of operation.  
  - It is the source of truth for project state and your next move.
  - Always come back to the script after getting steered by the user or after resolving an out-of-band issue.
- Some pipeline results may have a `data.has_custom_instructions` field.
  - If true, this means the prompt includes custom instructions that might be out of the ordinary
  - Make sure you follow these instructions carefully, as they may override the normal flow of the pipeline or require special handling.
  - Use the `rad-log-error` skill if you run into any issues that you think are system errors or bugs.  
    - Mention errors at the end of the run so the user is aware.
- Don't read every single doc — including review reports unless it is absolutely critical to project safety.
  - Lean to progressively disclosing project information to yourself, only as needed.  
  - This is a common mistake that leads to context bloat and inefficiency.
- Don't read every skill that are used by the subagents.
  - You don't need to understand every detail of how the subagents work before handing off work to them.
  - Reading them and then repeating them in spawn prompts is a waste of time and tokens.
  - Only read them if you need to troubleshoot an issue or if the pipeline prompt specifically instructs you to do so.
- Avoid reading `state.json` directly if you can avoid it. 
  - You should use the pipeline script to manage state.
  - You should only read state.json if there is a problem.
  - You should avoid writing to state.json directly unless there is a very good reason to repair it.
- Heed the human gates and user preferences found in `~/.radorc/orchestration.yml` and the pipeline results.
  - You should not overrule or circumvent these! 
  - The user may override this and allow you to do so. 
- If a project starts having issues either pipeline or project related, get involved.  
  - If you need to fix something out of band, try to use subagents to keep the context clean.
  - Consider using a forked subagent with your context if you think it'll be more token efficient to do so.
  - Once the project is back on track, relax and go back to using the `radorch.mjs` script.
  - Try not to let little things halt the problem.  Be smart, be pragmatic, and BE SAFE!
  - If it's an urgent or critical issue, err on the side of caution and let the user know immediately.  
    - Don't wait until the end of the run to mention it.

## Additional Resources
- **`schemas/orchestration-state-v6.schema.json`** — State file JSON Schema
- **`scripts/radorch.mjs` CLI** — Pipeline runtime and many other tools.
- **`~/.radorc/orchestration.yml`** — System configuration; 
- **`~/.radorc/templates/`** — The review-intensity tier process templates.