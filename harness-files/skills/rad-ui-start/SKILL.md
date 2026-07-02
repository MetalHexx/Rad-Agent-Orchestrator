---
name: rad-ui-start
description: Use this skill to start the rad orchestration dashboard UI.  It is the reference for how to launch the UI and obtain the URL.  Use it when the conversation indicates the user wants to start the dashboard.  This is commonly used during brainstorming, planning or executing a project or sharing a visual diagram or markdown document with the user.  It provides a visual overview of the project and its current state, and allows the user to interact with the pipeline in a more intuitive way.
user-invocable: true
---

# rad-ui-start

Invoke the bundled CLI to launch the radorch dashboard UI:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" ui start
```

The CLI emits a single JSON envelope on stdout. On success the envelope's `data.url` field contains the URL the user should open in a browser; report it directly to the user. On failure the envelope's `error.message` describes the cause (typical case: every port 3000-3010 is taken) — relay it verbatim.
