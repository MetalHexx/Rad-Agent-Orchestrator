#!/usr/bin/env node
// graph-service/src/bin/stop.ts — the invocable `stop` verb: signals the running daemon
// (`SIGTERM`) and reports once it's confirmed down (or already was) as JSON.
import { stop } from '../lifecycle/daemon.js';

stop()
  .then((result) => {
    console.log(JSON.stringify(result));
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
