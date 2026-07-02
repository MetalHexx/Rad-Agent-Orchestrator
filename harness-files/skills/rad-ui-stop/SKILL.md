---
name: rad-ui-stop
description: Use this skill to stop the rad orchestration dashboard UI.  It is the reference for how to stop the UI and report the result.  This is useful to invoke if the user is having issues using the UI.  It may help to stop the UI and restart it to resolve issues.  It is also useful to invoke if the user wants to stop the UI for any reason.
user-invocable: true
---

# rad-ui-stop

Invoke the bundled CLI to stop the running radorch dashboard UI:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" ui stop
```

The CLI sends SIGTERM to the recorded PID, removes the PID file, and emits a success envelope. If the UI was not running, the envelope still reports `stopped: true` (idempotent). Report the result to the user.
