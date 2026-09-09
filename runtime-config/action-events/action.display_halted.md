---
kind: action
name: display_halted
title: Display halted
description: Display the halt details to the operator and terminate the pipeline loop.
category: terminal
completion_event: null
---

Record where the run stopped and why by running `radorch.mjs session save` with `--project`, `--session`, `--harness`, `--cwd`, `--name`, and a `--description` of where the run stopped and why, with `--type final-rejected` when the halt is the operator's rejection at the final-approval gate, and `--type halted` for every other halt. `--description` is 1–2 sentences, high-level — see rad-session's Save section. If the response carries a conflict, relay the message to the operator verbatim and do not retry against a different project.

Display `data.context.details` to the operator so they understand why the pipeline stopped. The loop terminates here — no further actions will fire.
