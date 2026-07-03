---
name: rad-ui-status
description: Use this when you are having issues with the rad orchestration dashboard UI.  It is the reference for how to check the status of the UI and troubleshoot issues with it.
user-invocable: true
---

# rad-ui-status

Invoke the bundled CLI to check the radorch dashboard UI:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" ui status
```

The CLI returns `running: true` with `url` when the recorded PID is alive, otherwise `running: false`. Stale PID files are cleaned automatically. Relay the status (and URL when running) to the user.
