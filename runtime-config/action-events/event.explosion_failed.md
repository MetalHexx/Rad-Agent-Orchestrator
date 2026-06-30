---
kind: event
name: explosion_failed
title: Explosion failed
description: The explosion script could not parse the Master Plan and the main agent must self-correct.
signal_payload:
  parse-error:
    required: true
    description: Structured JSON error payload `{ line, expected, found, message }` extracted from the script's `data.error`.
---

Signal `explosion_failed --parse-error '<json>'` only when the script returned `ok: true` with `data.error` present — that is the parse-failure shape. Real system failures (`ok: false` with `error.type: system_error`) route through `rad-log-error` instead and do not use this event.

The mutation handler stores the payload on `master_plan.last_parse_error`, increments `master_plan.parse_retry_count`, and re-routes back to the main agent for self-correction. The retry cap is hardcoded at 3; the fourth consecutive parse failure halts the pipeline via `rad-log-error`.
