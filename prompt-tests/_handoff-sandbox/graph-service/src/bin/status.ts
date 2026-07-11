#!/usr/bin/env node
// graph-service/src/bin/status.ts — the invocable `status` verb: reports whether the daemon is
// running (from a `/health` probe) as JSON, without spawning or mutating anything.
import { status } from '../lifecycle/ensure.js';

status()
  .then((result) => {
    console.log(JSON.stringify(result));
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
