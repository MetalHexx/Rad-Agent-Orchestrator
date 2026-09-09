---
kind: action
name: display_complete
title: Display complete
description: Display the project completion summary to the operator and terminate the pipeline loop.
category: terminal
completion_event: null
---

Record the run's completion by running `radorch.mjs session save` with `--project`, `--session`, `--harness`, `--cwd`, `--name`, `--type final-approved`, and a `--description` of what the approval concluded. `--description` is 1–2 sentences, high-level — see rad-session's Save section. If the response carries a conflict, relay the message to the operator verbatim and do not retry against a different project.

Resolve the project's group with `radorch.mjs project show --id <PROJECT> --json`, reading `data.group`; with a group, `radorch.mjs portfolio show --portfolio <group> --json` succeeding confirms it is a portfolio — pass the group value through verbatim, since `portfolio show` accepts a group name and is case-insensitive. With a confirmed portfolio, offer `/rad-portfolio debrief <PROJECT>`, and offer to compact first, since the context still holds the whole execution run and the debrief is document-heavy. Declining is expected — leave the command behind for later and say nothing further. No group, or not a portfolio: no offer, and no mention of one.

Display the completion summary to the operator. The loop terminates here — no further actions will fire.
